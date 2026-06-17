import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke('get-version'),

  getWelcomePath: (): Promise<string> =>
    ipcRenderer.invoke('get-welcome-path'),

  getConfig: (): Promise<unknown> =>
    ipcRenderer.invoke('get-config'),

  setConfig: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke('set-config', config),

  getTabs: (): Promise<unknown> =>
    ipcRenderer.invoke('get-tabs'),

  setTabs: (tabs: unknown): Promise<unknown> =>
    ipcRenderer.invoke('set-tabs', tabs),

  pollNow: (tabId?: string): Promise<void> =>
    ipcRenderer.invoke('poll-now', tabId),

  pickFile: (): Promise<string | null> =>
    ipcRenderer.invoke('pick-file'),

  confirmDeleteTab: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('confirm-delete-tab', name),

  getUpdateSupport: (): Promise<{ supported: boolean; autoCheck: boolean }> =>
    ipcRenderer.invoke('get-update-support'),

  checkForUpdates: (): Promise<{ supported: boolean }> =>
    ipcRenderer.invoke('check-for-updates'),

  installMacUpdate: (): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke('install-mac-update'),

  onUpdateStatus: (callback: (data: unknown) => void): void => {
    ipcRenderer.on('update-status', (_event, data) => callback(data));
  },

  createGist: (opts: { name: string; filename: string }): Promise<{ success: boolean; gistId?: string; gistUrl?: string; message?: string }> =>
    ipcRenderer.invoke('create-gist', opts),

  importGists: (): Promise<{ success: boolean; gists?: Array<{ id: string; description: string; filename: string }>; message?: string }> =>
    ipcRenderer.invoke('import-gists'),

  startGithubAuth: (): Promise<{ started: boolean; userCode?: string; verificationUri?: string; message?: string }> =>
    ipcRenderer.invoke('start-github-auth'),

  cancelGithubAuth: (): Promise<void> =>
    ipcRenderer.invoke('cancel-github-auth'),

  onGithubAuthStatus: (callback: (data: unknown) => void): void => {
    ipcRenderer.on('github-auth-status', (_event, data) => callback(data));
  },

  onTabContent: (callback: (data: unknown) => void): void => {
    ipcRenderer.on('tab-content', (_event, data) => callback(data));
  },

  onTabError: (callback: (data: unknown) => void): void => {
    ipcRenderer.on('tab-error', (_event, data) => callback(data));
  },

  onNavigate: (callback: (page: string) => void): void => {
    ipcRenderer.on('navigate', (_event, page) => callback(page));
  },

  onNavigateTab: (callback: (tabId: string) => void): void => {
    ipcRenderer.on('navigate-tab', (_event, tabId) => callback(tabId));
  },

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  getPlatform: (): Promise<string> =>
    ipcRenderer.invoke('get-platform'),

  windowMinimize: (): Promise<void> =>
    ipcRenderer.invoke('window-minimize'),

  windowMaximize: (): Promise<void> =>
    ipcRenderer.invoke('window-maximize'),

  windowClose: (): Promise<void> =>
    ipcRenderer.invoke('window-close'),

  onWindowMaximized: (callback: () => void): void => {
    ipcRenderer.on('window-maximized', callback);
  },

  onWindowUnmaximized: (callback: () => void): void => {
    ipcRenderer.on('window-unmaximized', callback);
  },

  onToastShow: (callback: (data: unknown) => void): void => {
    ipcRenderer.on('toast-show', (_event, data) => callback(data));
  },

  toastDismiss: (): Promise<void> =>
    ipcRenderer.invoke('toast-dismiss'),

  toastOpenTab: (tabId: string): Promise<void> =>
    ipcRenderer.invoke('toast-open-tab', tabId),
});
