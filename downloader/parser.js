const { BrowserWindow } = require('electron');
const { getParser } = require('./parsers');

async function parseCatalog(sendLog, catalogUrl) {
  const parser = getParser(catalogUrl);
  const needsVisibleWindow = catalogUrl.includes('yfsp.tv');

  if (!parser) {
    return { success: false, error: 'unsupported', message: '不支持的站点, 可开启 AI 辅助解析重试' };
  }

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1200, height: 800,
      show: needsVisibleWindow,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    let finished = false;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (!win.isDestroyed()) win.destroy();
      resolve(result);
    };

    setTimeout(() => {
      if (!finished && !needsVisibleWindow) finish({ success: true, episodes: [] });
    }, 30000);

    if (needsVisibleWindow) {
      win.setTitle('请完成人机验证后关闭窗口 - yfsp.tv');
      // Wait for Cloudflare challenge to pass or window to close
      win.on('closed', () => finish({ success: false, error: '验证窗口已关闭, 请重新解析' }));

      win.webContents.on('did-navigate', async (event, navUrl) => {
        // Detect if we passed Cloudflare and landed on actual content
        if (navUrl !== catalogUrl && navUrl.includes('yfsp.tv') && !navUrl.includes('challenge')) {
          sendLog && sendLog('验证通过, 正在解析...');
          await new Promise(r => setTimeout(r, 2000));
          try {
            const episodes = await win.webContents.executeJavaScript(
              `(function() { return (${parser.jsExtract()})() })()`
            );
            const epList = episodes || [];
            finish({ success: true, episodes: epList, parserName: parser.name });
          } catch (e) {
            finish({ success: false, error: e.message });
          }
        }
      });
    }

    win.webContents.on('did-finish-load', async () => {
      if (finished) return;
      try {
        // Check for Cloudflare challenge
        const cfDetected = await win.webContents.executeJavaScript(
          `document.title.indexOf('Just a moment') >= 0 || 
           document.body.innerText.indexOf('Checking your browser') >= 0 ||
           document.querySelector('#challenge-form, #challenge-stage, .cf-browser-verification') !== null`
        ).catch(() => false);

        if (cfDetected && !needsVisibleWindow) {
          // Site has challenge but we didn't expect it - show window
          win.show();
          win.setTitle('请完成人机验证 - 验证通过后自动解析');
          win.webContents.on('did-navigate', async (event, navUrl) => {
            if (navUrl !== catalogUrl && !navUrl.includes('challenge')) {
              sendLog && sendLog('验证通过, 正在解析...');
              await new Promise(r => setTimeout(r, 2000));
              const episodes = await win.webContents.executeJavaScript(
                `(function() { return (${parser.jsExtract()})() })()`
              );
              finish({ success: true, episodes: episodes || [], parserName: parser.name });
            }
          });
          return;
        }

        if (needsVisibleWindow) return; // yfsp: handled by did-navigate

        // Normal flow: wait for DOM then extract
        await new Promise(r => setTimeout(r, 5000));

        const pageUrl = await win.webContents.getURL();
        const pageTitle = await win.webContents.executeJavaScript('document.title');
        if (sendLog) sendLog(`页面: ${pageTitle.substring(0, 40)} | ${pageUrl.substring(0, 80)}`);

        let episodes = await win.webContents.executeJavaScript(
          `(function() { return (${parser.jsExtract()})() })()`
        );

        // Retry once after more wait if empty
        if (!episodes || episodes.length === 0) {
          if (sendLog) sendLog('首次提取为空, 等待后重试...');
          await new Promise(r => setTimeout(r, 5000));
          episodes = await win.webContents.executeJavaScript(
            `(function() { return (${parser.jsExtract()})() })()`
          );
        }

        const epList = episodes || [];
        if (sendLog) sendLog(`[${parser.name}] 找到 ${epList.length} 集`);
        finish({ success: true, episodes: epList, parserName: parser.name });
      } catch (e) {
        finish({ success: false, error: e.message });
      }
    });

    win.webContents.on('did-fail-load', (event, code, desc) => {
      if (needsVisibleWindow) return; // Don't fail on CF challenge pages
      finish({ success: false, error: `页面加载失败: ${desc}` });
    });

    win.loadURL(catalogUrl);
  });
}

async function extractVid(sendLog, videoPageUrl) {
  if (sendLog) sendLog(`加载视频页: ${videoPageUrl}`);

  const isRouVideo = videoPageUrl.includes('rou.video');

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1024, height: 768,
      show: isRouVideo,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    if (isRouVideo) {
      win.setTitle('rou.video - 请点击播放视频, m3u8 将自动捕获');
    }

    let resolved = false;

    const done = (err, vid) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
      if (err) reject(err);
      else resolve(vid);
    };

    const timer = setTimeout(() => {
      done(new Error(isRouVideo ? '等待超时 (60s), 请点击页面播放视频' : '提取 vid 超时 (30s)'));
    }, isRouVideo ? 60000 : 30000);

    // Network monitor: capture vid from CDN/player requests
    const ses = win.webContents.session;

    const baseUrls = [
      '*://pframe.xgcartoon.com/*',
      '*://*.xgcartoon.com/player*',
      '*://*.bzcdn.net/*/playlist.m3u8*',
      '*://*.bzcdn.net/*/video.m3u8*',
      '*://*.yfsp.tv/*m3u8*',
      '*://*.yfsp.tv/api/*',
      '*://rou.video/api/*/play*',
    ];

    // For rou.video, also monitor for any m3u8 URLs from CDN + MIME detection
    if (isRouVideo) {
      baseUrls.push(
        '*://v.rn244.xyz/*',
        '*://v.rn245.xyz/*', '*://v.rn246.xyz/*',
        '*://v.rn247.xyz/*', '*://v.rn248.xyz/*', '*://v.rn249.xyz/*',
        '*://*/*.m3u8*', '*://*/*playlist*', '*://*/*master.m3u8*'
      );
    }

    ses.webRequest.onBeforeRequest({ urls: baseUrls },
      (details, callback) => {
        const url = details.url;
        const isM3u8 = url.includes('.m3u8') || url.includes('playlist') || url.includes('master.m3u');

        // For rou.video: monitor any m3u8-looking URL from any domain
        if (isRouVideo && isM3u8 && !url.includes('.vtt') && !url.includes('/thumbs/')) {
          if (sendLog) sendLog(`[网络检测] m3u8: ${url.substring(0, 120)}`);
          done(null, url);
        }

        const vidMatch = url.match(/vid=([^&]+)/);
        if (vidMatch && !resolved) {
          if (sendLog) sendLog(`[网络检测] vid: ${vidMatch[1]}`);
          done(null, vidMatch[1]);
        }
        const cdnMatch = url.match(/bzcdn\.net\/([a-f0-9-]{20,})\/playlist/);
        if (cdnMatch && !resolved) {
          if (sendLog) sendLog(`[网络检测] vid (CDN): ${cdnMatch[1]}`);
          done(null, cdnMatch[1]);
        }
        // rou.video: extract full m3u8 URL
        const rouMatch = url.match(/\/hls\/([a-z0-9]+)\//i);
        if (rouMatch && !resolved && !url.includes('/thumbs/') && !url.includes('.vtt')) {
          if (sendLog) sendLog(`[网络检测] rou m3u8: ${url.substring(0, 120)}`);
          done(null, url);
        }
        callback({});
      }
    );

    win.webContents.on('did-finish-load', async () => {
      try {
        const pageTitle = await win.webContents.executeJavaScript('document.title');
        if (pageTitle && pageTitle.includes('Server error')) {
          done(new Error(`页面返回服务端错误: ${videoPageUrl.substring(0, 80)}`));
          return;
        }

        // For rou.video: call the play API from within the page context (has cookies)
        if (videoPageUrl.includes('rou.video')) {
          try {
            const apiResult = await win.webContents.executeJavaScript(`
              (async function() {
                try {
                  var vid = location.pathname.split('/').pop();
                  var res = await fetch('/api/v/' + vid + '/play', { method: 'POST' });
                  var data = await res.json();
                  return JSON.stringify(data);
                } catch(e) {
                  return 'ERROR:' + e.message;
                }
              })()
            `);
            if (apiResult && !apiResult.startsWith('ERROR')) {
              const data = JSON.parse(apiResult);
              const m3u8 = data.url || data.m3u8 || data.playlist || data.src || data.videoUrl || '';
              const bodyM3u8 = (typeof data === 'string' ? data : JSON.stringify(data)).match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
              if (m3u8) {
                if (sendLog) sendLog(`[API] rou m3u8: ${m3u8.substring(0, 120)}`);
                done(null, m3u8);
                return;
              } else if (bodyM3u8) {
                if (sendLog) sendLog(`[API] rou m3u8 (body): ${bodyM3u8[0].substring(0, 120)}`);
                done(null, bodyM3u8[0]);
                return;
              } else {
                if (sendLog) sendLog(`[API] rou 响应: ${JSON.stringify(data).substring(0, 200)}`);
              }
            }
          } catch (e) {
            if (sendLog) sendLog(`[API] rou 调用失败: ${e.message}`);
          }
        }

        // For rou.video: skip iframe/vid loop, rely on network monitor
        if (isRouVideo) return;

        for (let attempt = 0; attempt < 10; attempt++) {
          if (resolved) return;
          await new Promise(r => setTimeout(r, 3000));

          const result = await win.webContents.executeJavaScript(`
            (function() {
              var iframes = document.querySelectorAll('iframe');
              for (var i = 0; i < iframes.length; i++) {
                var src = iframes[i].src || '';
                var vidMatch = src.match(/vid=([^&]+)/);
                if (vidMatch) return { vid: vidMatch[1] };
              }
              var all = document.documentElement.outerHTML;
              var vm = all.match(/vid["'\\s:=]+(["'])?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\\1/i);
              if (vm) return { vid: vm[2] };
              return null;
            })()
          `);

          if (result && result.vid) {
            done(null, result.vid);
            return;
          }
        }

        if (!resolved) {
          const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
          const vidMatch = html.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
          if (vidMatch) {
            done(null, vidMatch[0]);
            return;
          }
        }

        if (!resolved) {
          done(new Error(`未找到 vid (页面: ${videoPageUrl.substring(0, 80)})`));
        }
      } catch (e) {
        if (!resolved) done(e);
      }
    });

    win.webContents.on('did-fail-load', (event, code, desc, validatedURL) => {
      done(new Error(`页面加载失败 (${code}): ${desc} [${validatedURL?.substring(0, 80)}]`));
    });

    win.loadURL(videoPageUrl);
  });
}

function buildM3U8Url(vid) {
  return `https://xgct-video.bzcdn.net/${vid}/playlist.m3u8`;
}

module.exports = { parseCatalog, extractVid, buildM3U8Url };
