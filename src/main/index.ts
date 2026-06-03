import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as https from 'https';
import * as fs from 'fs';
import Store from 'electron-store';

type SourceType = 'gist' | 'local';

interface Settings {
  sourceType: SourceType;
  gistId: string;
  githubToken: string;
  localFilePath: string;
  pollIntervalMinutes: number;
}

interface StoreSchema {
  settings: Settings;
  lastEtag: string;
  lastUpdatedAt: string;
}

const store = new Store<StoreSchema>({
  defaults: {
    settings: {
      sourceType: 'local',
      gistId: '',
      githubToken: '',
      localFilePath: '', // resolved to the bundled welcome file on first run
      pollIntervalMinutes: 30,
    },
    lastEtag: '',
    lastUpdatedAt: '',
  },
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let isQuitting = false;

function welcomeFilePath(): string {
  return path.join(app.getAppPath(), 'assets/welcome.md');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 600,
    minHeight: 400,
    show: false,
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

  // Run the first check only once the renderer is ready to receive IPC,
  // otherwise the initial content message would be sent into the void.
  mainWindow.webContents.once('did-finish-load', () => {
    resolveDefaultLocalFile();
    checkForUpdates();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  const iconPath = path.join(app.getAppPath(), 'assets/tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    // Fallback: 1x1 transparent image
    icon = nativeImage.createEmpty();
  }
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 });
    icon.setTemplateImage(true);
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
  const settings = store.get('settings') as Settings;
  const sourceLabel =
    settings.sourceType === 'local'
      ? `Source: ${settings.localFilePath ? path.basename(settings.localFilePath) : 'local file'}`
      : `Source: Gist ${settings.gistId || '(none)'}`;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Show DeNoti',
      click: () => showWindow(),
    },
    {
      label: 'Settings',
      click: () => {
        showWindow();
        mainWindow?.webContents.send('navigate', 'settings');
      },
    },
    { type: 'separator' },
    {
      label: sourceLabel,
      enabled: false,
    },
    {
      label: `Polling every ${settings.pollIntervalMinutes} min`,
      enabled: false,
    },
    {
      label: 'Poll Now',
      click: () => checkForUpdates(),
    },
    { type: 'separator' },
    {
      label: 'Quit DeNoti',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray?.setContextMenu(menu);
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

function sendError(message: string): void {
  mainWindow?.webContents.send('gist-error', message);
}

function deliverContent(payload: {
  content: string;
  updatedAt: string;
  description: string;
  source: string;
}): void {
  mainWindow?.webContents.send('gist-content', payload);
  showWindow();
  if (!app.isPackaged) {
    console.log(`[deliver] ${payload.description} (${payload.content.length} chars), visible=${mainWindow?.isVisible()}`);
  }
}

/** On first run, point the default local source at the bundled welcome file. */
function resolveDefaultLocalFile(): void {
  const settings = store.get('settings') as Settings;
  if (settings.sourceType === 'local' && !settings.localFilePath) {
    store.set('settings', { ...settings, localFilePath: welcomeFilePath() });
    updateTrayMenu();
  }
}

function checkForUpdates(): void {
  const settings = store.get('settings') as Settings;
  if (settings.sourceType === 'local') {
    checkLocalFile();
  } else {
    fetchGist();
  }
}

function checkLocalFile(): void {
  const settings = store.get('settings') as Settings;
  const filePath = settings.localFilePath.trim();

  if (!filePath) {
    sendError('No local file configured. Open Settings to choose a file.');
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendError(`File not found: ${filePath}`);
    return;
  }

  const newUpdatedAt = String(stat.mtimeMs);
  const lastUpdatedAt = store.get('lastUpdatedAt') as string;
  if (newUpdatedAt === lastUpdatedAt) return; // No change since last poll

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    sendError(`Failed to read file: ${(err as Error).message}`);
    return;
  }

  store.set('lastUpdatedAt', newUpdatedAt);
  deliverContent({
    content,
    updatedAt: new Date(stat.mtime).toISOString(),
    description: path.basename(filePath),
    source: filePath,
  });
}

function buildGistContent(gist: Record<string, unknown>): string {
  const files = Object.values(gist.files as Record<string, Record<string, unknown>>);
  return files
    .map((file) => {
      const filename = file.filename as string;
      const content = (file.content as string) ?? '';
      return `# ${filename}\n\n${content}`;
    })
    .join('\n\n---\n\n');
}

function fetchGist(): void {
  const settings = store.get('settings') as Settings;

  if (!settings.gistId.trim()) {
    sendError('No Gist ID configured. Open Settings to get started.');
    return;
  }

  const lastEtag = store.get('lastEtag') as string;

  const headers: Record<string, string> = {
    'User-Agent': 'DeNoti/0.1.0',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (settings.githubToken) headers['Authorization'] = `Bearer ${settings.githubToken}`;
  if (lastEtag) headers['If-None-Match'] = lastEtag;

  const req = https.request(
    {
      hostname: 'api.github.com',
      path: `/gists/${settings.gistId.trim()}`,
      method: 'GET',
      headers,
    },
    (res) => {
      if (res.statusCode === 304) return; // No change

      if (res.statusCode === 404) {
        sendError('Gist not found. Check the Gist ID in Settings.');
        return;
      }

      if (res.statusCode === 401) {
        sendError('Unauthorized. Check your GitHub token in Settings.');
        return;
      }

      if (res.statusCode !== 200) {
        sendError(`GitHub API returned status ${res.statusCode}.`);
        return;
      }

      const etag = res.headers.etag as string | undefined;
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const gist = JSON.parse(body) as Record<string, unknown>;
          const lastUpdatedAt = store.get('lastUpdatedAt') as string;
          const newUpdatedAt = gist.updated_at as string;

          if (etag) store.set('lastEtag', etag);

          if (newUpdatedAt !== lastUpdatedAt) {
            store.set('lastUpdatedAt', newUpdatedAt);
            deliverContent({
              content: buildGistContent(gist),
              updatedAt: newUpdatedAt,
              description: (gist.description as string) || `Gist ${settings.gistId}`,
              source: settings.gistId,
            });
          }
        } catch {
          sendError('Failed to parse GitHub response.');
        }
      });
    }
  );

  req.on('error', (err: Error) => {
    sendError(`Network error: ${err.message}`);
  });

  req.end();
}

function startPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  const settings = store.get('settings') as Settings;
  const intervalMs = Math.max(1, settings.pollIntervalMinutes) * 60 * 1000;
  pollTimer = setInterval(checkForUpdates, intervalMs);
}

// IPC
ipcMain.handle('get-settings', () => store.get('settings'));

ipcMain.handle('set-settings', (_event, settings: Settings) => {
  store.set('settings', settings);
  store.set('lastEtag', '');
  store.set('lastUpdatedAt', '');
  updateTrayMenu();
  startPolling();
  checkForUpdates(); // Reflect the new source immediately
  return { success: true };
});

ipcMain.handle('poll-now', () => {
  checkForUpdates();
});

ipcMain.handle('pick-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Text & Markdown', extensions: ['md', 'markdown', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Lifecycle
app.on('ready', () => {
  createWindow();
  createTray();
  startPolling();
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
