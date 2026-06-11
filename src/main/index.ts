import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, powerMonitor } from 'electron';
import * as path from 'path';
import * as https from 'https';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
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
let updateDownloaded = false;

function welcomeFilePath(): string {
  return path.join(app.getAppPath(), 'assets/welcome.md');
}

function initAutoUpdater(): void {
  if (process.platform === 'darwin' || !app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', () => {
    updateTrayMenu();
  });

  autoUpdater.on('update-downloaded', () => {
    updateDownloaded = true;
    updateTrayMenu();
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
  });

  autoUpdater.checkForUpdates().catch((err) => console.error('[updater]', err.message));
}

function createWindow(): void {
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
    backgroundColor: '#1a1a2e',
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

  mainWindow.webContents.once('did-finish-load', () => {
    if (store.get('config').pollOnStartup ?? true) checkAllTabs();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
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

  if (process.platform !== 'darwin' && app.isPackaged) {
    menuItems.push(
      { type: 'separator' },
      updateDownloaded
        ? { label: 'Restart to Update', click: () => autoUpdater.quitAndInstall() }
        : { label: 'Check for Updates', click: () => autoUpdater.checkForUpdates().catch((err) => console.error('[updater]', err.message)) }
    );
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

function deliverContent(
  tabId: string,
  payload: { content: string; contentType: ContentType; updatedAt: string; description: string; source: string }
): void {
  mainWindow?.webContents.send('tab-content', { tabId, ...payload });
  showWindow();
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

function checkTabForUpdates(tabId: string): void {
  const tab = store.get('tabs').find((t) => t.id === tabId);
  if (!tab) return;
  if (tab.sourceType === 'local') {
    checkLocalFile(tab);
  } else {
    fetchGist(tab);
  }
}

function checkLocalFile(tab: Tab): void {
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
  if (!isStartup && newUpdatedAt === getTabState(tab.id).lastUpdatedAt) return;

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

function fetchGist(tab: Tab): void {
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
  if (lastEtag && !isStartup) headers['If-None-Match'] = lastEtag;

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

          if (isStartup || newUpdatedAt !== lastUpdatedAt) {
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
    },
  ]);
}

// IPC
ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('get-welcome-path', () => welcomeFilePath());

ipcMain.handle('get-config', () => store.get('config'));

ipcMain.handle('set-config', (_event, config: AppConfig) => {
  store.set('config', config);
  // Clear etag cache for all gist tabs so they re-fetch with the updated token
  const states = store.get('tabStates');
  for (const tab of store.get('tabs')) {
    if (tab.sourceType === 'gist' && states[tab.id]) {
      states[tab.id] = { ...states[tab.id], lastEtag: '' };
    }
  }
  store.set('tabStates', states);
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
    checkTabForUpdates(tabId);
  } else {
    checkAllTabs();
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

// Lifecycle
app.on('ready', () => {
  if (app.dock && !app.isPackaged) {
    app.dock.setIcon(path.join(app.getAppPath(), 'assets/robot-bell.png'));
  }
  initAutoUpdater();
  initDefaultTabs();
  store.get('tabs').forEach((tab) => startupTabIds.add(tab.id));
  createWindow();
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
