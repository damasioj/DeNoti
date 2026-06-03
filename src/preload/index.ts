import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getTabs: (): Promise<unknown> =>
    ipcRenderer.invoke('get-tabs'),

  setTabs: (tabs: unknown): Promise<unknown> =>
    ipcRenderer.invoke('set-tabs', tabs),

  pollNow: (tabId?: string): Promise<void> =>
    ipcRenderer.invoke('poll-now', tabId),

  pickFile: (): Promise<string | null> =>
    ipcRenderer.invoke('pick-file'),

  onTabContent: (callback: (data: unknown) => void): void => {
    ipcRenderer.on('tab-content', (_event, data) => callback(data));
  },

  onTabError: (callback: (data: unknown) => void): void => {
    ipcRenderer.on('tab-error', (_event, data) => callback(data));
  },

  onNavigate: (callback: (page: string) => void): void => {
    ipcRenderer.on('navigate', (_event, page) => callback(page));
  },
});
