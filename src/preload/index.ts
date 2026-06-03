import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getSettings: (): Promise<unknown> =>
    ipcRenderer.invoke('get-settings'),

  setSettings: (settings: unknown): Promise<unknown> =>
    ipcRenderer.invoke('set-settings', settings),

  pollNow: (): Promise<void> =>
    ipcRenderer.invoke('poll-now'),

  onContent: (callback: (data: unknown) => void): void => {
    ipcRenderer.on('gist-content', (_event, data) => callback(data));
  },

  onError: (callback: (message: string) => void): void => {
    ipcRenderer.on('gist-error', (_event, message) => callback(message));
  },

  onNavigate: (callback: (page: string) => void): void => {
    ipcRenderer.on('navigate', (_event, page) => callback(page));
  },
});
