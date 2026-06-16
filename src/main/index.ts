import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, powerMonitor, shell, Notification, screen } from 'electron';
import * as path from 'path';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import { execFile, spawn } from 'child_process';
import { randomUUID, createHash } from 'crypto';
import Store from 'electron-store';
import { autoUpdater } from 'electron-updater';

type SourceType = 'gist' | 'local';
type ContentType = 'markdown' | 'html';

function detectContentType(filename: string): ContentType {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.html' || ext === '.htm' ? 'html' : 'markdown';
}

type PollMode = 'interval' | 'time';

interface Tab {
  id: string;
  name: string;
  sourceType: SourceType;
  gistId: string;
  localFilePath: string;
  pollMode: PollMode;
  pollIntervalMinutes: number;
  pollTime: string; // "HH:MM" local time, used when pollMode === 'time'
  soundEnabled: boolean; // play the notification sound when this tab updates
}

interface TabPollState {
  lastEtag: string;
  lastUpdatedAt: string;
}

interface AppConfig {
  githubToken: string;
  pollOnStartup: boolean;
  pollOnWake: boolean;
}

interface StoreSchema {
  tabs: Tab[];
  tabStates: Record<string, TabPollState>;
  config: AppConfig;
}

const store = new Store<StoreSchema>({
  defaults: {
    tabs: [],
    tabStates: {},
    config: { githubToken: '', pollOnStartup: true, pollOnWake: true },
  },
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const pollTimers = new Map<string, NodeJS.Timeout>();
const startupTabIds = new Set<string>();
let isQuitting = false;
let mainObscured = false; // true while the main window is minimized or hidden to tray
let updateDownloaded = false;
let macUpdateAppPath: string | null = null;
let githubAuthPollTimer: NodeJS.Timeout | null = null;

// Public Client ID for the GitHub OAuth App used by the Device Authorization
// Flow. Device flow uses no client secret, so this identifier is safe to commit.
// Register an OAuth App at github.com/settings/applications/new, enable
// "Device Flow", and paste its Client ID here to activate browser sign-in.
const GITHUB_CLIENT_ID = 'Ov23liMmj3zwAASCEHOr';
const GITHUB_OAUTH_SCOPE = 'gist';

function welcomeFilePath(): string {
  return path.join(app.getAppPath(), 'assets/welcome.md');
}

function updatesSupported(): boolean {
  return process.platform !== 'darwin' && app.isPackaged;
}

function macUpdatesSupported(): boolean {
  return process.platform === 'darwin'; // dev: always enabled; prod: guarded by app.isPackaged
}

function sendUpdateStatus(payload: { status: string; version?: string; message?: string; manual?: boolean }): void {
  mainWindow?.webContents.send('update-status', payload);
}

function isNewerVersion(current: string, latest: string): boolean {
  // Leading integer of each dotted component; tolerates prerelease suffixes
  // (e.g. "0.4.0-beta") and missing components, which would otherwise be NaN.
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [ca = 0, cb = 0, cc = 0] = parse(current);
  const [la = 0, lb = 0, lc = 0] = parse(latest);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

function httpsGetFollowRedirects(url: string, redirectsLeft = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'DeNoti' } },
      (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          httpsGetFollowRedirects(res.headers.location, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    ).on('error', reject);
  });
}

// electron-builder writes a `latest-mac.yml` listing each artifact with a
// base64-encoded sha512. Extract the digest for a specific asset filename.
// Matches only indented `files:` entries (`  - url:` / `    sha512:`), never
// the top-level keys.
function parseSha512FromYml(yml: string, assetName: string): string | null {
  let inMatchingFile = false;
  for (const line of yml.split('\n')) {
    const urlMatch = line.match(/^\s+-\s+url:\s*(\S+)/);
    if (urlMatch) {
      inMatchingFile = urlMatch[1] === assetName;
      continue;
    }
    if (inMatchingFile) {
      const shaMatch = line.match(/^\s+sha512:\s*(\S+)/);
      if (shaMatch) return shaMatch[1];
    }
  }
  return null;
}

// The yml file name varies with arch/config, so scan every `.yml` release
// asset and return the first sha512 that matches our zip. Returns null if no
// metadata covers it — the caller fails closed in that case.
async function expectedSha512(assets: Array<Record<string, unknown>>, assetName: string): Promise<string | null> {
  const ymlAssets = assets.filter((a) => typeof a.name === 'string' && (a.name as string).endsWith('.yml'));
  for (const yml of ymlAssets) {
    try {
      const text = (await httpsGetFollowRedirects(yml.browser_download_url as string)).toString('utf8');
      const sha = parseSha512FromYml(text, assetName);
      if (sha) return sha;
    } catch {
      // try the next yml
    }
  }
  return null;
}

async function macCheckForUpdates(): Promise<void> {
  try {
    const releaseJson = await new Promise<string>((resolve, reject) => {
      https.get(
        {
          hostname: 'api.github.com',
          path: '/repos/damasioj/DeNoti/releases/latest',
          headers: { 'User-Agent': 'DeNoti', Accept: 'application/vnd.github+json' },
        },
        (res) => {
          if (res.statusCode !== 200) { res.resume(); reject(new Error(`GitHub API: ${res.statusCode}`)); return; }
          let body = '';
          res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          res.on('end', () => resolve(body));
          res.on('error', reject);
        }
      ).on('error', reject);
    });

    const release = JSON.parse(releaseJson) as Record<string, unknown>;
    const latestVersion = ((release.tag_name as string) || '').replace(/^v/, '');
    if (!latestVersion) { sendUpdateStatus({ status: 'error', message: 'Could not read latest version from GitHub.' }); return; }

    if (!isNewerVersion(app.getVersion(), latestVersion)) {
      sendUpdateStatus({ status: 'none' });
      return;
    }

    sendUpdateStatus({ status: 'available', version: latestVersion });

    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const assetName = `DeNoti-${latestVersion}-mac-${arch}.zip`;
    const assets = (release.assets as Array<Record<string, unknown>>) || [];
    const asset = assets.find((a) => a.name === assetName);
    if (!asset) {
      sendUpdateStatus({ status: 'error', message: `Release asset not found: ${assetName}` });
      return;
    }

    // Fail closed: never install a binary we can't verify against published metadata.
    const expectedDigest = await expectedSha512(assets, assetName);
    if (!expectedDigest) {
      sendUpdateStatus({ status: 'error', message: 'Cannot verify update integrity — checksum metadata is missing from the release.' });
      return;
    }

    const zipBuffer = await httpsGetFollowRedirects(asset.browser_download_url as string);

    const actualDigest = createHash('sha512').update(zipBuffer).digest('base64');
    if (actualDigest !== expectedDigest) {
      sendUpdateStatus({ status: 'error', message: 'Update integrity check failed (checksum mismatch). Installation aborted.' });
      return;
    }

    const tmpDir = path.join(os.tmpdir(), `denoti-update-${latestVersion}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const zipPath = path.join(tmpDir, assetName);
    fs.writeFileSync(zipPath, zipBuffer);

    await new Promise<void>((resolve, reject) => {
      execFile('unzip', ['-q', '-o', zipPath, '-d', tmpDir], (err) => { if (err) reject(err); else resolve(); });
    });

    const extractedApp = path.join(tmpDir, 'DeNoti.app');
    // Best-effort quarantine strip — ignores errors since Node's https download doesn't set quarantine
    await new Promise<void>((resolve) => {
      execFile('xattr', ['-rd', 'com.apple.quarantine', extractedApp], () => resolve());
    });

    macUpdateAppPath = extractedApp;
    updateTrayMenu();
    sendUpdateStatus({ status: 'downloaded', version: latestVersion, manual: true });
  } catch (err) {
    sendUpdateStatus({ status: 'error', message: (err as Error).message });
  }
}

function initAutoUpdater(): void {
  if (!updatesSupported()) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    updateTrayMenu();
    sendUpdateStatus({ status: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus({ status: 'none' });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    updateTrayMenu();
    sendUpdateStatus({ status: 'downloaded', version: info.version });
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'A new version of DeNoti is ready to install. Restart now to apply the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message);
    sendUpdateStatus({ status: 'error', message: err.message });
  });

  autoUpdater.checkForUpdates().catch((err) => console.error('[updater]', err.message));
}

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 600,
    minHeight: 400,
    show: false,
    icon: path.join(app.getAppPath(), 'assets/robot-bell.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'DeNoti',
    backgroundColor: '#16213e',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 13 } : undefined,
  });

  mainWindow.loadFile(path.join(app.getAppPath(), 'renderer/index.html'));

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    mainWindow.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
      console.log(`[renderer] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
      console.log(`[preload-error] ${preloadPath}: ${error}`);
    });
  }

  // Block all reload shortcuts so a hard refresh can't wipe renderer state.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if ((ctrl && input.key.toLowerCase() === 'r') || input.key === 'F5') {
      event.preventDefault();
    }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.show(); // show on launch — new content no longer force-shows the window
    if (store.get('config').pollOnStartup ?? true) checkAllTabs();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      mainObscured = true;
    }
  });

  // Track whether the main window is off-screen (minimized or hidden to tray) via
  // events — querying isVisible() at delivery time is unreliable on macOS.
  mainWindow.on('hide', () => { mainObscured = true; });
  mainWindow.on('minimize', () => { mainObscured = true; });
  mainWindow.on('show', () => { mainObscured = false; });
  mainWindow.on('restore', () => { mainObscured = false; });
  mainWindow.on('focus', () => { mainObscured = false; });

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-maximized'));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-unmaximized'));
}

function createTray(): void {
  const iconPath = path.join(app.getAppPath(), 'assets/robot-bell-dark.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  }
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 });
    icon.setTemplateImage(true);
  } else if (process.platform === 'win32') {
    icon = icon.resize({ width: 16, height: 16 });
  } else {
    icon = icon.resize({ width: 22, height: 22 });
  }

  tray = new Tray(icon);
  tray.setToolTip('DeNoti');
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      showWindow();
    }
  });
}

function updateTrayMenu(): void {
  const tabs = store.get('tabs');

  const menuItems: Electron.MenuItemConstructorOptions[] = [
    { label: 'Show DeNoti', click: () => showWindow() },
    {
      label: 'Settings',
      click: () => {
        showWindow();
        mainWindow?.webContents.send('navigate', 'settings');
      },
    },
  ];

  if (tabs.length > 0) {
    menuItems.push({ type: 'separator' });
    if (tabs.length === 1) {
      menuItems.push({
        label: `Poll: ${tabs[0].name}`,
        click: () => checkTabForUpdates(tabs[0].id),
      });
    } else {
      menuItems.push({ label: 'Poll All', click: () => checkAllTabs() });
      tabs.forEach((tab) => {
        menuItems.push({ label: `  ${tab.name}`, click: () => checkTabForUpdates(tab.id) });
      });
    }
  }

  if (app.isPackaged) {
    menuItems.push({ type: 'separator' });
    if (process.platform === 'darwin') {
      menuItems.push(
        macUpdateAppPath
          ? { label: 'Install Update & Restart', click: () => installMacUpdate() }
          : { label: 'Check for Updates', click: () => macCheckForUpdates().catch((err) => console.error('[mac-updater]', err.message)) }
      );
    } else {
      menuItems.push(
        updateDownloaded
          ? { label: 'Restart to Update', click: () => autoUpdater.quitAndInstall() }
          : { label: 'Check for Updates', click: () => autoUpdater.checkForUpdates().catch((err) => console.error('[updater]', err.message)) }
      );
    }
  }

  menuItems.push(
    { type: 'separator' },
    {
      label: 'Quit DeNoti',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    }
  );

  tray?.setContextMenu(Menu.buildFromTemplate(menuItems));
}

function showWindow(): void {
  if (!mainWindow) return;
  mainWindow.show();
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  } else {
    mainWindow.focus();
  }
}

function sendError(tabId: string, message: string): void {
  mainWindow?.webContents.send('tab-error', { tabId, message });
}

// macOS custom toast window — native notifications need a code-signed app, so on
// macOS we show our own transient pop-up instead. Created only on darwin.
let toastWindow: BrowserWindow | null = null;

function createToastWindow(): void {
  toastWindow = new BrowserWindow({
    width: 320,
    height: 110,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: path.join(app.getAppPath(), 'assets/robot-bell.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  toastWindow.setAlwaysOnTop(true, 'floating');
  toastWindow.loadFile(path.join(app.getAppPath(), 'renderer/toast.html'));
}

function positionToast(): void {
  if (!toastWindow) return;
  const display = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const { workArea } = display;
  const [w, h] = toastWindow.getSize();
  const margin = 16;
  toastWindow.setPosition(
    Math.round(workArea.x + workArea.width - w - margin),
    Math.round(workArea.y + workArea.height - h - margin)
  );
}

function showToast(tabId: string, name: string): void {
  if (!toastWindow) return;
  positionToast();
  toastWindow.showInactive(); // appear without stealing focus
  toastWindow.webContents.send('toast-show', { tabId, name });
}

function notifyUpdate(tabId: string): void {
  const name = store.get('tabs').find((t) => t.id === tabId)?.name ?? 'Tab';
  // macOS: native notifications require code-signing, so use the custom toast.
  if (process.platform === 'darwin') {
    showToast(tabId, name);
    return;
  }
  // Windows / Linux: native OS notification (works without signing).
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: name,
    body: 'File was updated',
    icon: path.join(app.getAppPath(), 'assets/robot-bell.png'),
    silent: true, // the per-tab notification sound is handled by the renderer
  });
  notification.on('click', () => {
    showWindow();
    mainWindow?.webContents.send('navigate-tab', tabId);
  });
  notification.show();
}

function deliverContent(
  tabId: string,
  payload: { content: string; contentType: ContentType; updatedAt: string; description: string; source: string }
): void {
  mainWindow?.webContents.send('tab-content', { tabId, ...payload });
  // While DeNoti is open the renderer just dots the tab; while it's minimized or
  // hidden to tray, surface a brief OS notification instead of popping the window.
  if (mainObscured) notifyUpdate(tabId);
}

function getTabState(tabId: string): TabPollState {
  const states = store.get('tabStates');
  return states[tabId] || { lastEtag: '', lastUpdatedAt: '' };
}

function setTabState(tabId: string, updates: Partial<TabPollState>): void {
  const states = store.get('tabStates');
  states[tabId] = { ...getTabState(tabId), ...updates };
  store.set('tabStates', states);
}

function checkAllTabs(): void {
  store.get('tabs').forEach((tab) => checkTabForUpdates(tab.id));
}

function checkTabForUpdates(tabId: string, force = false): void {
  const tab = store.get('tabs').find((t) => t.id === tabId);
  if (!tab) return;
  if (tab.sourceType === 'local') {
    checkLocalFile(tab, force);
  } else {
    fetchGist(tab, force);
  }
}

function checkLocalFile(tab: Tab, force = false): void {
  const filePath = tab.localFilePath.trim();

  if (!filePath) {
    sendError(tab.id, 'No local file configured. Edit tab settings.');
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendError(tab.id, `File not found: ${filePath}`);
    return;
  }

  const newUpdatedAt = String(stat.mtimeMs);
  const isStartup = startupTabIds.delete(tab.id);
  if (!isStartup && !force && newUpdatedAt === getTabState(tab.id).lastUpdatedAt) return;

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    sendError(tab.id, `Failed to read file: ${(err as Error).message}`);
    return;
  }

  setTabState(tab.id, { lastUpdatedAt: newUpdatedAt });
  deliverContent(tab.id, {
    content,
    contentType: detectContentType(filePath),
    updatedAt: new Date(stat.mtime).toISOString(),
    description: path.basename(filePath),
    source: filePath,
  });
}

function buildGistContent(gist: Record<string, unknown>): { content: string; contentType: ContentType } {
  const files = Object.values(gist.files as Record<string, Record<string, unknown>>);
  const allHtml = files.every((f) => detectContentType((f.filename as string) ?? '') === 'html');
  if (allHtml) {
    return {
      content: files.map((f) => (f.content as string) ?? '').join('\n\n'),
      contentType: 'html',
    };
  }
  return {
    content: files
      .map((f) => `# ${f.filename as string}\n\n${(f.content as string) ?? ''}`)
      .join('\n\n---\n\n'),
    contentType: 'markdown',
  };
}

function fetchGist(tab: Tab, force = false): void {
  if (!tab.gistId.trim()) {
    sendError(tab.id, 'No Gist ID configured. Edit tab settings.');
    return;
  }

  const { lastEtag, lastUpdatedAt } = getTabState(tab.id);
  const isStartup = startupTabIds.delete(tab.id);
  const { githubToken } = store.get('config');

  const headers: Record<string, string> = {
    'User-Agent': 'DeNoti/0.1.0',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;
  if (lastEtag && !isStartup && !force) headers['If-None-Match'] = lastEtag;

  const req = https.request(
    {
      hostname: 'api.github.com',
      path: `/gists/${tab.gistId.trim()}`,
      method: 'GET',
      headers,
    },
    (res) => {
      if (res.statusCode === 304) return;

      if (res.statusCode === 404) {
        sendError(tab.id, 'Gist not found. Check the Gist ID in settings.');
        return;
      }
      if (res.statusCode === 401) {
        sendError(tab.id, 'Unauthorized. Check your GitHub token in settings.');
        return;
      }
      if (res.statusCode !== 200) {
        sendError(tab.id, `GitHub API returned status ${res.statusCode}.`);
        return;
      }

      const etag = res.headers.etag as string | undefined;
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const gist = JSON.parse(body) as Record<string, unknown>;
          const newUpdatedAt = gist.updated_at as string;

          if (etag) setTabState(tab.id, { lastEtag: etag });

          if (isStartup || force || newUpdatedAt !== lastUpdatedAt) {
            setTabState(tab.id, { lastUpdatedAt: newUpdatedAt });
            const { content, contentType } = buildGistContent(gist);
            deliverContent(tab.id, {
              content,
              contentType,
              updatedAt: newUpdatedAt,
              description: (gist.description as string) || `Gist ${tab.gistId}`,
              source: tab.gistId,
            });
          }
        } catch {
          sendError(tab.id, 'Failed to parse GitHub response.');
        }
      });
    }
  );

  req.on('error', (err: Error) => {
    sendError(tab.id, `Network error: ${err.message}`);
  });

  req.end();
}

function msUntilTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleTimeBasedPoll(tabId: string): void {
  const tab = store.get('tabs').find((t) => t.id === tabId);
  if (!tab || (tab.pollMode ?? 'interval') !== 'time') return;

  const delay = msUntilTime(tab.pollTime || '09:00');
  pollTimers.set(tabId, setTimeout(() => {
    checkTabForUpdates(tabId);
    scheduleTimeBasedPoll(tabId);
  }, delay));
}

function startTabPolling(tabId: string): void {
  const existing = pollTimers.get(tabId);
  if (existing) { clearTimeout(existing); pollTimers.delete(tabId); }

  const tab = store.get('tabs').find((t) => t.id === tabId);
  if (!tab) return;

  if ((tab.pollMode ?? 'interval') === 'time') {
    scheduleTimeBasedPoll(tabId);
  } else {
    const intervalMs = Math.max(1, tab.pollIntervalMinutes) * 60 * 1000;
    pollTimers.set(tabId, setInterval(() => checkTabForUpdates(tabId), intervalMs));
  }
}

function startAllPolling(): void {
  for (const timer of pollTimers.values()) clearInterval(timer);
  pollTimers.clear();
  store.get('tabs').forEach((tab) => startTabPolling(tab.id));
}

function initDefaultTabs(): void {
  if (store.get('tabs').length > 0) return;

  // Migrate from pre-tabs settings format if present
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oldSettings = (store as any).get('settings') as any;
  if (oldSettings?.gistId || oldSettings?.localFilePath) {
    if (oldSettings.githubToken) {
      store.set('config', { githubToken: oldSettings.githubToken });
    }
    const name =
      oldSettings.sourceType === 'gist'
        ? `Gist ${oldSettings.gistId}`.trim()
        : path.basename(oldSettings.localFilePath || 'Local File');
    store.set('tabs', [
      {
        id: randomUUID(),
        name,
        sourceType: oldSettings.sourceType || 'local',
        gistId: oldSettings.gistId || '',
        localFilePath: oldSettings.localFilePath || welcomeFilePath(),
        pollMode: 'interval',
        pollIntervalMinutes: oldSettings.pollIntervalMinutes || 30,
        pollTime: '09:00',
        soundEnabled: true,
      },
    ]);
    return;
  }

  store.set('tabs', [
    {
      id: randomUUID(),
      name: 'Welcome',
      sourceType: 'local',
      gistId: '',
      localFilePath: welcomeFilePath(),
      pollMode: 'interval',
      pollIntervalMinutes: 30,
      pollTime: '09:00',
      soundEnabled: true,
    },
  ]);
}

// --- GitHub OAuth Device Flow ---

function clearGistEtags(): void {
  const states = store.get('tabStates');
  for (const tab of store.get('tabs')) {
    if (tab.sourceType === 'gist' && states[tab.id]) {
      states[tab.id] = { ...states[tab.id], lastEtag: '' };
    }
  }
  store.set('tabStates', states);
}

function setGithubToken(token: string): void {
  store.set('config', { ...store.get('config'), githubToken: token });
  clearGistEtags(); // re-fetch gist tabs with the new token
}

function sendGithubAuthStatus(payload: {
  status: 'connected' | 'error';
  username?: string;
  message?: string;
}): void {
  mainWindow?.webContents.send('github-auth-status', payload);
}

function githubPostForm(reqPath: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request(
      {
        hostname: 'github.com',
        path: reqPath,
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'DeNoti',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as Record<string, unknown>);
          } catch {
            reject(new Error('Unexpected response from GitHub.'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchGithubUsername(token: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: '/user',
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'DeNoti',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            resolve((JSON.parse(data) as { login?: string }).login);
          } catch {
            resolve(undefined);
          }
        });
      }
    );
    req.on('error', () => resolve(undefined));
    req.end();
  });
}

function pollForGithubToken(deviceCode: string, intervalSeconds: number): void {
  githubAuthPollTimer = setTimeout(() => {
    githubPostForm('/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })
      .then(async (res) => {
        if (typeof res.access_token === 'string') {
          setGithubToken(res.access_token);
          const username = await fetchGithubUsername(res.access_token);
          sendGithubAuthStatus({ status: 'connected', username });
          return;
        }
        switch (res.error) {
          case 'authorization_pending':
            pollForGithubToken(deviceCode, intervalSeconds);
            break;
          case 'slow_down':
            pollForGithubToken(deviceCode, intervalSeconds + 5);
            break;
          case 'expired_token':
            sendGithubAuthStatus({ status: 'error', message: 'The code expired before you authorized. Please try again.' });
            break;
          case 'access_denied':
            sendGithubAuthStatus({ status: 'error', message: 'Authorization was denied.' });
            break;
          default:
            sendGithubAuthStatus({ status: 'error', message: (res.error_description as string) || 'GitHub authorization failed.' });
        }
      })
      .catch((err: Error) => {
        sendGithubAuthStatus({ status: 'error', message: err.message });
      });
  }, intervalSeconds * 1000);
}

async function startGithubAuth(): Promise<{ started: boolean; userCode?: string; verificationUri?: string; message?: string }> {
  if (githubAuthPollTimer) {
    clearTimeout(githubAuthPollTimer);
    githubAuthPollTimer = null;
  }
  try {
    const res = await githubPostForm('/login/device/code', {
      client_id: GITHUB_CLIENT_ID,
      scope: GITHUB_OAUTH_SCOPE,
    });
    const deviceCode = res.device_code as string | undefined;
    const userCode = res.user_code as string | undefined;
    const verificationUri = (res.verification_uri as string) || 'https://github.com/login/device';
    const interval = (res.interval as number) || 5;
    if (!deviceCode || !userCode) {
      return { started: false, message: 'Could not start GitHub sign-in. Please try again.' };
    }
    shell.openExternal(verificationUri).catch(() => { /* user can navigate to the URL manually */ });
    pollForGithubToken(deviceCode, interval);
    return { started: true, userCode, verificationUri };
  } catch (err) {
    return { started: false, message: (err as Error).message };
  }
}

function installMacUpdate(): void {
  if (!macUpdateAppPath) return;
  // Current .app bundle is 3 levels up from the Electron binary inside it.
  const appBundle = path.resolve(process.execPath, '..', '..', '..');

  // Paths are passed as argv ($1 = new bundle, $2 = live bundle) rather than
  // interpolated, so unusual characters in the path can't break the script.
  // The swap is done with mv (atomic on the same volume) instead of copying
  // into the existing bundle, which would leave stale files behind. If the
  // copy or swap fails the original is restored and relaunched.
  const scriptPath = path.join(os.tmpdir(), 'denoti-install-update.sh');
  const script = `#!/bin/bash
NEW="$1"
DEST="$2"
STAGING="\${DEST}.new"
BACKUP="\${DEST}.bak"
sleep 2
rm -rf "$STAGING" "$BACKUP"
if ! cp -Rf "$NEW" "$STAGING"; then
  open "$DEST"
  exit 1
fi
if mv "$DEST" "$BACKUP" && mv "$STAGING" "$DEST"; then
  rm -rf "$BACKUP"
else
  [ -d "$BACKUP" ] && [ ! -e "$DEST" ] && mv "$BACKUP" "$DEST"
  rm -rf "$STAGING"
fi
open "$DEST"
`;
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  const child = spawn('/bin/bash', [scriptPath, macUpdateAppPath, appBundle], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  isQuitting = true;
  app.quit();
}

// IPC
ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('get-welcome-path', () => welcomeFilePath());

ipcMain.handle('get-config', () => store.get('config'));

ipcMain.handle('set-config', (_event, config: AppConfig) => {
  store.set('config', config);
  clearGistEtags(); // re-fetch gist tabs with the (possibly) updated token
  return { success: true };
});

ipcMain.handle('get-tabs', () => store.get('tabs'));

ipcMain.handle('set-tabs', (_event, newTabs: Tab[]) => {
  const oldTabs = store.get('tabs');
  const oldById = new Map(oldTabs.map((t) => [t.id, t]));
  const newById = new Map(newTabs.map((t) => [t.id, t]));

  // Stop polling and clean state for removed tabs
  for (const oldTab of oldTabs) {
    if (!newById.has(oldTab.id)) {
      if (pollTimers.has(oldTab.id)) {
        clearInterval(pollTimers.get(oldTab.id)!);
        pollTimers.delete(oldTab.id);
      }
      const states = store.get('tabStates');
      delete states[oldTab.id];
      store.set('tabStates', states);
    }
  }

  store.set('tabs', newTabs);

  for (const tab of newTabs) {
    const oldTab = oldById.get(tab.id);
    if (!oldTab) {
      startTabPolling(tab.id);
      checkTabForUpdates(tab.id);
    } else {
      const sourceChanged =
        oldTab.sourceType !== tab.sourceType ||
        oldTab.gistId !== tab.gistId ||
        oldTab.localFilePath !== tab.localFilePath;
      if (sourceChanged) {
        const states = store.get('tabStates');
        delete states[tab.id];
        store.set('tabStates', states);
        startTabPolling(tab.id);
        checkTabForUpdates(tab.id);
      } else if (
        oldTab.pollIntervalMinutes !== tab.pollIntervalMinutes ||
        (oldTab.pollMode ?? 'interval') !== (tab.pollMode ?? 'interval') ||
        (oldTab.pollTime ?? '09:00') !== (tab.pollTime ?? '09:00')
      ) {
        startTabPolling(tab.id);
      }
    }
  }

  updateTrayMenu();
  return { success: true };
});

ipcMain.handle('poll-now', (_event, tabId?: string) => {
  if (tabId) {
    checkTabForUpdates(tabId, true);
  } else {
    store.get('tabs').forEach((tab) => checkTabForUpdates(tab.id, true));
  }
});

ipcMain.handle('pick-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Text, Markdown & HTML', extensions: ['md', 'markdown', 'txt', 'html', 'htm'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('confirm-delete-tab', async (_event, tabName: string) => {
  if (!mainWindow) return false;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete Tab',
    message: `Delete "${tabName}"?`,
    detail: 'This removes the tab and stops monitoring its source. This cannot be undone.',
  });
  return response === 0;
});

ipcMain.handle('get-update-support', () => ({
  supported: updatesSupported() || macUpdatesSupported(),
  autoCheck: updatesSupported(), // electron-updater checks on launch; mac path is manual-only
}));

ipcMain.handle('check-for-updates', () => {
  if (macUpdatesSupported()) {
    macCheckForUpdates().catch((err: Error) => {
      sendUpdateStatus({ status: 'error', message: err.message });
    });
    return { supported: true };
  }
  if (!updatesSupported()) return { supported: false };
  autoUpdater.checkForUpdates().catch((err: Error) => {
    sendUpdateStatus({ status: 'error', message: err.message });
  });
  return { supported: true };
});

ipcMain.handle('install-mac-update', () => {
  if (!macUpdateAppPath) return { success: false, message: 'No update downloaded.' };
  installMacUpdate();
  return { success: true };
});

ipcMain.handle('start-github-auth', () => startGithubAuth());

ipcMain.handle('cancel-github-auth', () => {
  if (githubAuthPollTimer) {
    clearTimeout(githubAuthPollTimer);
    githubAuthPollTimer = null;
  }
});

ipcMain.handle('get-platform', () => process.platform);

ipcMain.handle('window-minimize', () => mainWindow?.minimize());

ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});

ipcMain.handle('window-close', () => mainWindow?.close());

ipcMain.handle('toast-dismiss', () => {
  toastWindow?.hide();
});

ipcMain.handle('toast-open-tab', (_event, tabId: string) => {
  showWindow();
  mainWindow?.webContents.send('navigate-tab', tabId);
  toastWindow?.hide();
});

// Lifecycle
app.on('ready', () => {
  Menu.setApplicationMenu(null);
  if (app.dock && !app.isPackaged) {
    app.dock.setIcon(path.join(app.getAppPath(), 'assets/robot-bell.png'));
  }
  initAutoUpdater();
  initDefaultTabs();
  store.get('tabs').forEach((tab) => startupTabIds.add(tab.id));
  createWindow();
  if (process.platform === 'darwin') createToastWindow();
  createTray();
  startAllPolling();

  powerMonitor.on('resume', () => {
    if (store.get('config').pollOnWake ?? true) checkAllTabs();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Keep alive in tray on all platforms
});

app.on('activate', () => {
  showWindow();
});
