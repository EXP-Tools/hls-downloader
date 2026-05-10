const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  parseCatalog: (url) => ipcRenderer.invoke('parse-catalog', url),
  startDownload: (episodes, saveDir, options) => ipcRenderer.invoke('start-download', episodes, saveDir, options),
  cancelDownload: () => ipcRenderer.send('cancel-download'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openDirectory: (dir) => ipcRenderer.invoke('open-directory', dir),
  openImage: (imgPath) => ipcRenderer.invoke('open-image', imgPath),
  setProxy: (config) => ipcRenderer.invoke('set-proxy', config),
  disableProxy: () => ipcRenderer.invoke('disable-proxy'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getProviders: () => ipcRenderer.invoke('get-providers'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  onProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },
  onLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('download-log', handler);
    return () => ipcRenderer.removeListener('download-log', handler);
  },
  onMenuAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  }
});
