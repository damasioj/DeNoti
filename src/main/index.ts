import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import * as path from 'path';
import * as https from 'https';
import Store from 'electron-store';

interface Settings {
  gistId: string;
  githubToken: string;
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
      gistId: '',
      githubToken: '',
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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1a1a2e',
  });

  mainWindow.loadFile(path.join(app.getAppPath(), 'renderer/index.html'));

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
      label: `Polling every ${settings.pollIntervalMinutes} min`,
      enabled: false,
    },
    {
      label: 'Poll Now',
      click: () => fetchGist(),
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

function buildContent(gist: Record<string, unknown>): string {
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
    mainWindow?.webContents.send('gist-error', 'No Gist ID configured. Open Settings to get started.');
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
        mainWindow?.webContents.send('gist-error', 'Gist not found. Check the Gist ID in Settings.');
        return;
      }

      if (res.statusCode === 401) {
        mainWindow?.webContents.send('gist-error', 'Unauthorized. Check your GitHub token in Settings.');
        return;
      }

      if (res.statusCode !== 200) {
        mainWindow?.webContents.send('gist-error', `GitHub API returned status ${res.statusCode}.`);
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
            const content = buildContent(gist);
            mainWindow?.webContents.send('gist-content', {
              content,
              updatedAt: newUpdatedAt,
              description: gist.description as string,
              gistId: settings.gistId,
            });
            // Auto-popup on new content
            showWindow();
          }
        } catch {
          mainWindow?.webContents.send('gist-error', 'Failed to parse GitHub response.');
        }
      });
    }
  );

  req.on('error', (err: Error) => {
    mainWindow?.webContents.send('gist-error', `Network error: ${err.message}`);
  });

  req.end();
}

function startPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  const settings = store.get('settings') as Settings;
  const intervalMs = Math.max(1, settings.pollIntervalMinutes) * 60 * 1000;
  fetchGist();
  pollTimer = setInterval(fetchGist, intervalMs);
}

// IPC
ipcMain.handle('get-settings', () => store.get('settings'));

ipcMain.handle('set-settings', (_event, settings: Settings) => {
  store.set('settings', settings);
  store.set('lastEtag', '');
  store.set('lastUpdatedAt', '');
  updateTrayMenu();
  startPolling();
  return { success: true };
});

ipcMain.handle('poll-now', () => {
  fetchGist();
});

// Lifecycle
app.on('ready', () => {
  createWindow();
  createTray();
  startPolling();

  // Show window immediately on first launch so the user can reach Settings
  const settings = store.get('settings') as Settings;
  if (!settings.gistId) {
    mainWindow?.once('ready-to-show', () => {
      mainWindow?.show();
      mainWindow?.webContents.send('navigate', 'settings');
    });
  }
});

app.on('window-all-closed', () => {
  // Keep alive in tray on all platforms
});

app.on('activate', () => {
  showWindow();
});
