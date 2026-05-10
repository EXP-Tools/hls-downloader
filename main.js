const { app, BrowserWindow, ipcMain, dialog, session, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { parseCatalog, extractVid, buildM3U8Url } = require('./downloader/parser');
const { getParser } = require('./downloader/parsers');
const { downloadHLS, convertToMp4 } = require('./downloader/hls-engine');

let mainWindow = null;
let cancelFlag = false;
let appSettings = {};

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function loadAppSettings() {
  try {
    appSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch (_) {
    appSettings = {
      proxy: { type: 'http', host: '', port: '', username: '', password: '' },
      defaultSaveDir: '',
      autoConvertMp4: false,
      proxyEnabled: false
    };
  }
}

function saveAppSettings() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(appSettings, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'HLS 批量下载器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const menu = buildMenu();
  mainWindow.setMenu(menu);

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function buildMenu() {
  const template = [
    {
      label: '设置',
      submenu: [
        {
          label: '代理设置',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.executeJavaScript('openProxySettings()').catch(() => {});
            }
          }
        },
        { type: 'separator' },
        {
          label: '自动转 MP4',
          type: 'checkbox',
          checked: appSettings.autoConvertMp4,
          click: (item) => {
            appSettings.autoConvertMp4 = item.checked;
            saveAppSettings();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.executeJavaScript(`onSettingChanged('autoConvertMp4', ${item.checked})`).catch(() => {});
            }
            sendLog(`自动转 MP4: ${appSettings.autoConvertMp4 ? '开启' : '关闭'}`);
          }
        }
      ]
    },
    {
      label: '关于',
      submenu: [
        {
          label: '版本信息',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.executeJavaScript('openAbout()').catch(() => {});
            }
          }
        },
        {
          label: '支持站点',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.executeJavaScript('openSites()').catch(() => {});
            }
          }
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

function sendLog(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-log', msg);
  }
}

function sendProgress(current, total, episodeIndex, episodeTitle) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', { current, total, episodeIndex, episodeTitle });
  }
}

async function applyProxy() {
  if (appSettings.proxyEnabled && appSettings.proxy.host && appSettings.proxy.port) {
    const { type, host, port, username, password } = appSettings.proxy;
    const scheme = type === 'socks5' ? 'socks5' : 'http';
    const auth = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
    await session.defaultSession.setProxy({
      proxyRules: `${scheme}://${auth}${host}:${port}`,
      proxyBypassRules: '<local>'
    });
  }
}

app.whenReady().then(() => {
  loadAppSettings();
  applyProxy();
  createWindow();

  ipcMain.handle('parse-catalog', async (_event, url) => {
    try {
      cancelFlag = false;
      sendLog('正在解析目录页面...');
      const result = await parseCatalog((msg) => sendLog(msg), url);

      if (result.success && result.episodes.length > 0) {
        const siteParser = getParser(url);
        if (siteParser && siteParser.transformUrl) {
          result.episodes.forEach(ep => siteParser.transformUrl(ep, url));
          sendLog(`已转换 ${result.episodes.length} 个视频 URL`);
        }
      }
      return result;
    } catch (e) {
      sendLog(`解析失败: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('start-download', async (_event, episodes, saveDir, options) => {
    try {
      cancelFlag = false;
      sendLog('========================================');
      sendLog(`开始批量下载, 共 ${episodes.length} 集`);
      sendLog(`保存目录: ${saveDir}`);
      if (options?.autoConvertMp4) sendLog('下载后自动转换 MP4');
      sendLog('========================================');

      const results = [];
      for (let i = 0; i < episodes.length; i++) {
        if (cancelFlag) { sendLog('下载已取消'); break; }
        const ep = episodes[i];
        sendLog('');
        sendLog(`--- [${i + 1}/${episodes.length}] ${ep.title} ---`);

        let vid = null;
        try {
          sendLog('正在加载视频页面提取 vid...');
          try {
            vid = await extractVid((msg) => sendLog(msg), ep.url);
          } catch (e1) {
            const fallbackUrl = ep._originalUrl;
            if (fallbackUrl && fallbackUrl !== ep.url) {
              sendLog(`直连失败, 尝试原始链接...`);
              vid = await extractVid((msg) => sendLog(msg), fallbackUrl);
            } else { throw e1; }
          }

          const m3u8Url = buildM3U8Url(vid);
          sendLog(`m3u8: ${m3u8Url}`);

          const safeTitle = ep.title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 80);
          const fileNameBase = `${String(i + 1).padStart(3, '0')}_${safeTitle}`;
          const result = await downloadHLS(
            (msg) => sendLog(msg),
            (cur, total) => sendProgress(cur, total, i, ep.title),
            m3u8Url, saveDir, fileNameBase
          );

          let finalPath = result.outputPath;

          // Auto-convert to MP4 if enabled
          if (appSettings.autoConvertMp4) {
            sendLog('正在转换为 MP4...');
            finalPath = await convertToMp4(
              (msg) => sendLog(msg),
              result.outputPath
            );
            sendLog(`MP4: ${finalPath}`);
          }

          results.push({
            episode: ep.title, status: 'ok',
            path: finalPath, resolution: result.resolution
          });
        } catch (e) {
          sendLog(`失败: ${e.message}`);
          results.push({ episode: ep.title, status: 'failed', error: e.message });
        }
      }

      const ok = results.filter(r => r.status === 'ok').length;
      const fail = results.filter(r => r.status === 'failed').length;
      sendLog('');
      sendLog('========================================');
      sendLog(`下载完成: 成功 ${ok} / 失败 ${fail}`);
      sendLog('========================================');
      return { success: true, results };
    } catch (e) {
      sendLog(`致命错误: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('open-directory', async (_event, dir) => {
    if (dir && fs.existsSync(dir)) {
      shell.openPath(dir);
      return { success: true };
    }
    return { success: false, error: '目录不存在' };
  });

  ipcMain.handle('open-image', async (_event, imgPath) => {
    let realPath = imgPath;
    try { realPath = new URL(imgPath).pathname; } catch (_) {}
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(realPath)) {
      realPath = realPath.substring(1);
    }
    if (!fs.existsSync(realPath)) return { success: false, error: '图片不存在' };
    shell.openPath(realPath);
    return { success: true };
  });

  ipcMain.handle('set-proxy', async (_event, config) => {
    try {
      const { type, host, port, username, password } = config;
      appSettings.proxy = { type, host, port, username, password };
      appSettings.proxyEnabled = true;

      const scheme = type === 'socks5' ? 'socks5' : 'http';
      const auth = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
      await session.defaultSession.setProxy({
        proxyRules: `${scheme}://${auth}${host}:${port}`,
        proxyBypassRules: '<local>'
      });

      saveAppSettings();
      sendLog(`代理已启用: ${scheme}://${host}:${port}`);
      return { success: true };
    } catch (e) {
      sendLog(`代理设置失败: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('disable-proxy', async () => {
    try {
      appSettings.proxyEnabled = false;
      await session.defaultSession.setProxy({ proxyRules: '' });
      saveAppSettings();
      sendLog('代理已关闭');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-settings', () => {
    return {
      proxy: appSettings.proxy,
      defaultSaveDir: appSettings.defaultSaveDir,
      autoConvertMp4: appSettings.autoConvertMp4,
      proxyEnabled: appSettings.proxyEnabled
    };
  });

  ipcMain.handle('save-settings', (_event, settings) => {
    appSettings = { ...appSettings, ...settings };
    saveAppSettings();
    return { success: true };
  });

  ipcMain.handle('get-app-info', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    return {
      version: pkg.version,
      author: 'Stream Recorder 逆向分析 & Electron 实现',
      sites: [
        { name: '西瓜卡通 (xgcartoon.com)', status: '完全支持', desc: '动画/影视目录页解析 + 批量下载' },
        { name: '西瓜卡通 (twxgct.com)', status: '完全支持', desc: '直接视频页下载' },
        { name: '爱壹帆国际版 (yfsp.tv)', status: '部分支持', desc: '需绕过 CloudFront 人机校验, 登录后可用' }
      ]
    };
  });

  ipcMain.on('cancel-download', () => {
    cancelFlag = true;
    sendLog('正在取消...');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
