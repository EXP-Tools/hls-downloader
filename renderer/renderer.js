// ─── DOM refs ───
const $ = (id) => document.getElementById(id);
const elCatalogUrl = $('catalogUrl');
const elSaveDir = $('saveDir');
const elBtnParse = $('btnParse');
const elBtnSelectDir = $('btnSelectDir');
const elBtnOpenDir = $('btnOpenDir');
const elEpisodeSection = $('episodeSection');
const elEpisodeCount = $('episodeCount');
const elEpisodeList = $('episodeList');
const elBtnSelectAll = $('btnSelectAll');
const elBtnDeselectAll = $('btnDeselectAll');
const elBtnInvert = $('btnInvert');
const elBtnDownload = $('btnDownload');
const elBtnCancel = $('btnCancel');
const elLogSection = $('logSection');
const elLogContainer = $('logContainer');
const elBtnClearLog = $('btnClearLog');
const elProgressSection = $('progressSection');
const elProgressBar = $('progressBar');
const elProgressText = $('progressText');
const elStatusBar = $('statusBar');
const elSettingsModal = $('settingsModal');
const elSettingsProxyType = $('settingsProxyType');
const elSettingsProxyHost = $('settingsProxyHost');
const elSettingsProxyPort = $('settingsProxyPort');
const elSettingsProxyUser = $('settingsProxyUser');
const elSettingsProxyPass = $('settingsProxyPass');
const elSettingsSaveDir = $('settingsSaveDir');
const elBtnSettingsSelectDir = $('btnSettingsSelectDir');
const elSettingsAutoMp4 = $('settingsAutoMp4');
const elBtnSaveSettings = $('btnSaveSettings');
const elBtnCloseSettings = $('btnCloseSettings');
const elBtnDisableProxySettings = $('btnDisableProxySettings');
const elAboutModal = $('aboutModal');
const elAboutVersion = $('aboutVersion');
const elAboutAuthor = $('aboutAuthor');
const elBtnCloseAbout = $('btnCloseAbout');
const elSitesModal = $('sitesModal');
const elSitesList = $('sitesList');
const elBtnCloseSites = $('btnCloseSites');
const elSettingsAiEnabled = $('settingsAiEnabled');
const elSettingsAiProvider = $('settingsAiProvider');
const elSettingsAiModel = $('settingsAiModel');
const elAiOptions = $('aiOptions');

// ─── State ───
let episodes = [];
let resultsMap = {};
let isDownloading = false;
let appSettings = { autoConvertMp4: false, defaultSaveDir: '' };

// ─── Helpers ───
function setStatus(msg) { elStatusBar.textContent = msg; }
function show(el) { el.style.display = ''; }
function hide(el) { el.style.display = 'none'; }

function addLog(msg, cls) {
  show(elLogSection);
  const d = document.createElement('div');
  d.className = 'log-line' + (cls ? ' ' + cls : '');
  d.textContent = msg;
  elLogContainer.appendChild(d);
  elLogContainer.scrollTop = elLogContainer.scrollHeight;
}

// ─── Global functions for menu (called via executeJavaScript) ───
async function openProxySettings() {
  const s = await window.api.getSettings();
  elSettingsProxyType.value = s.proxy?.type || 'http';
  elSettingsProxyHost.value = s.proxy?.host || '';
  elSettingsProxyPort.value = s.proxy?.port || '';
  elSettingsProxyUser.value = s.proxy?.username || '';
  elSettingsProxyPass.value = s.proxy?.password || '';
  elSettingsSaveDir.value = s.defaultSaveDir || '';
  elSettingsAutoMp4.checked = s.autoConvertMp4 || false;
  elSettingsAiEnabled.checked = s.aiEnabled || false;
  elAiOptions.style.display = s.aiEnabled ? '' : 'none';
  appSettings = s;

  // Load providers and populate dropdowns
  const providers = await window.api.getProviders();
  elSettingsAiProvider.innerHTML = '<option value="">请选择...</option>';
  providers.forEach(p => {
    elSettingsAiProvider.innerHTML += `<option value="${p.key}">${p.key} (${p.baseURL?.substring(0, 30) || ''})</option>`;
  });
  if (s.aiProvider) elSettingsAiProvider.value = s.aiProvider;
  updateModelDropdown(providers, s.aiModel);

  elSettingsAiProvider.onchange = () => updateModelDropdown(providers, '');

  show(elSettingsModal);
}

function updateModelDropdown(providers, selected) {
  const provKey = elSettingsAiProvider.value;
  const prov = providers.find(p => p.key === provKey);
  elSettingsAiModel.innerHTML = '<option value="">请选择模型</option>';
  if (prov) {
    prov.models.forEach(m => {
      elSettingsAiModel.innerHTML += `<option value="${m.id}">${m.name || m.id}</option>`;
    });
  }
  if (selected) elSettingsAiModel.value = selected;
}

elSettingsAiEnabled.addEventListener('change', () => {
  elAiOptions.style.display = elSettingsAiEnabled.checked ? '' : 'none';
});

async function openAbout() {
  const info = await window.api.getAppInfo();
  elAboutVersion.textContent = info.version;
  elAboutAuthor.textContent = info.author;
  show(elAboutModal);
}

async function openSites() {
  const info = await window.api.getAppInfo();
  elSitesList.innerHTML = info.sites.map(s =>
    `<div class="site-card">
      <span class="site-name">${s.name}</span>
      <span class="site-status ${s.status === '完全支持' ? 'ok' : 'partial'}">${s.status}</span>
      <div class="site-desc">${s.desc}</div>
    </div>`
  ).join('');
  show(elSitesModal);
}

async function onSettingChanged(key, val) {
  appSettings[key] = val;
  updateDownloadBtn();
}

// ─── Settings Modal ───
elBtnSettingsSelectDir.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (dir) elSettingsSaveDir.value = dir;
});

elBtnDisableProxySettings.addEventListener('click', async () => {
  await window.api.disableProxy();
  elSettingsProxyHost.value = '';
  elSettingsProxyPort.value = '';
});

elBtnSaveSettings.addEventListener('click', async () => {
  const cfg = {
    type: elSettingsProxyType.value,
    host: elSettingsProxyHost.value.trim(),
    port: elSettingsProxyPort.value.trim(),
    username: elSettingsProxyUser.value.trim(),
    password: elSettingsProxyPass.value.trim()
  };
  if (cfg.host && cfg.port) await window.api.setProxy(cfg);

  const s = {
    proxy: cfg,
    defaultSaveDir: elSettingsSaveDir.value,
    autoConvertMp4: elSettingsAutoMp4.checked,
    proxyEnabled: !!(cfg.host && cfg.port),
    aiEnabled: elSettingsAiEnabled.checked,
    aiProvider: elSettingsAiProvider.value,
    aiModel: elSettingsAiModel.value
  };
  await window.api.saveSettings(s);
  appSettings = s;
  if (s.defaultSaveDir && !elSaveDir.value) elSaveDir.value = s.defaultSaveDir;
  updateDownloadBtn();
  hide(elSettingsModal);
  setStatus('设置已保存');
});

elBtnCloseSettings.addEventListener('click', () => hide(elSettingsModal));

// ─── Directory ───
elBtnSelectDir.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (dir) { elSaveDir.value = dir; updateDownloadBtn(); }
});
elSaveDir.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (dir) { elSaveDir.value = dir; updateDownloadBtn(); }
});
elBtnOpenDir.addEventListener('click', async () => {
  const dir = elSaveDir.value.trim();
  if (!dir) return setStatus('请先选择保存目录');
  await window.api.openDirectory(dir);
});

// ─── Donation QR ───
document.querySelectorAll('.donate-qr img').forEach(img => {
  img.addEventListener('click', () => {
    window.api.openImage(img.src);
  });
});

// ─── Parse Catalog ───
elBtnParse.addEventListener('click', async () => {
  const url = elCatalogUrl.value.trim();
  if (!url) return setStatus('请输入 URL');
  elBtnParse.disabled = true;
  setStatus('正在解析...');
  addLog('正在解析: ' + url);

  const res = await window.api.parseCatalog(url);
  if (res.success) {
    episodes = res.episodes;
    resultsMap = {};
    renderEpisodes();
    show(elEpisodeSection);
    localStorage.setItem('hls-last-url', elCatalogUrl.value);
    setStatus(`找到 ${episodes.length} 集`);
    addLog(`找到 ${episodes.length} 集`, 'success');
  } else {
    setStatus('解析失败');
    addLog('失败: ' + (res.error || '未知错误'), 'error');
  }
  elBtnParse.disabled = false;
});

// ─── Episode List ───
function renderEpisodes() {
  elEpisodeList.innerHTML = '';
  elEpisodeCount.textContent = `共 ${episodes.length} 集, 已选 ${getSel()} 集`;
  episodes.forEach((ep, i) => {
    const w = document.createElement('div');
    w.className = 'episode-item selected';
    w.dataset.index = i;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => { ep._selected = cb.checked; refreshCount(); });
    const lbl = document.createElement('label');
    lbl.textContent = ep.title;
    w.appendChild(cb); w.appendChild(lbl);
    elEpisodeList.appendChild(w);
    ep._selected = true;
  });
  updateDownloadBtn();
}

function getSel() { return episodes.filter(e => e._selected).length; }
function refreshCount() {
  elEpisodeCount.textContent = `共 ${episodes.length} 集, 已选 ${getSel()} 集`;
  updateDownloadBtn();
}
function updateDownloadBtn() {
  elBtnDownload.disabled = getSel() === 0 || isDownloading;
}

elBtnSelectAll.addEventListener('click', () => setAll(true));
elBtnDeselectAll.addEventListener('click', () => setAll(false));
elBtnInvert.addEventListener('click', () => {
  episodes.forEach(e => e._selected = !e._selected);
  document.querySelectorAll('.episode-item').forEach(w => {
    const i = +w.dataset.index;
    w.classList.toggle('selected', episodes[i]._selected);
    w.querySelector('input[type="checkbox"]').checked = episodes[i]._selected;
  });
  refreshCount();
});
function setAll(v) {
  episodes.forEach(e => e._selected = v);
  document.querySelectorAll('.episode-item').forEach(w => {
    w.classList.toggle('selected', v);
    w.querySelector('input[type="checkbox"]').checked = v;
  });
  refreshCount();
}

// ─── Download ───
elBtnDownload.addEventListener('click', async () => {
  const sel = episodes.filter(e => e._selected);
  if (!sel.length) return setStatus('请选择集数');

  let dir = elSaveDir.value.trim() || appSettings.defaultSaveDir;
  if (!dir) {
    dir = await window.api.selectDirectory();
    if (!dir) return setStatus('已取消');
    elSaveDir.value = dir;
  }

  isDownloading = true;
  resultsMap = {};
  elBtnDownload.style.display = 'none';
  elBtnCancel.style.display = '';
  elBtnParse.disabled = true;
  show(elProgressSection);
  setStatus('下载中...');

  const tgt = sel.map(e => ({ title: e.title, url: e.url, _originalUrl: e._originalUrl }));
  try {
    const res = await window.api.startDownload(tgt, dir, { autoConvertMp4: appSettings.autoConvertMp4 });
    if (res.success) {
      res.results.forEach((r, i) => {
        const idx = episodes.indexOf(sel[i]);
        if (idx >= 0) resultsMap[idx] = r;
      });
      updateStatus();
      setStatus('下载完成');
      addLog('全部完成!', 'success');
    } else {
      addLog('出错: ' + (res.error || ''), 'error');
    }
  } catch (e) {
    addLog('出错: ' + e.message, 'error');
  } finally {
    isDownloading = false;
    elBtnDownload.style.display = '';
    elBtnCancel.style.display = 'none';
    elBtnParse.disabled = false;
    updateDownloadBtn();
  }
});

elBtnCancel.addEventListener('click', () => {
  window.api.cancelDownload();
  elBtnCancel.disabled = true;
  addLog('正在取消...', 'warn');
});

function updateStatus() {
  document.querySelectorAll('.episode-item').forEach(w => {
    const i = +w.dataset.index;
    w.classList.remove('active', 'done', 'failed');
    if (resultsMap[i]) w.classList.add(resultsMap[i].status === 'ok' ? 'done' : 'failed');
  });
}

// ─── Log / Progress ───
window.api.onLog(addLog);
window.api.onProgress((d) => {
  show(elProgressSection);
  if (d.total > 0) {
    elProgressBar.style.width = Math.round(d.current / d.total * 100) + '%';
    elProgressText.textContent = `${d.episodeTitle}: ${d.current}/${d.total}`;
  }
  document.querySelectorAll('.episode-item').forEach(w => w.classList.remove('active'));
  const idx = episodes.findIndex(e => e.title === d.episodeTitle);
  if (idx >= 0) {
    const w = document.querySelector(`.episode-item[data-index="${idx}"]`);
    if (w) w.classList.add('active');
  }
});
elBtnClearLog.addEventListener('click', () => { elLogContainer.innerHTML = ''; hide(elLogSection); });

// ─── Modal close ───
elBtnCloseAbout.addEventListener('click', () => hide(elAboutModal));
elBtnCloseSites.addEventListener('click', () => hide(elSitesModal));
[elSettingsModal, elAboutModal, elSitesModal].forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) hide(m); })
);

// ─── Init ───
(async () => {
  const lastUrl = localStorage.getItem('hls-last-url');
  if (lastUrl) elCatalogUrl.value = lastUrl;
  const s = await window.api.getSettings();
  appSettings = s;
  if (s.defaultSaveDir) elSaveDir.value = s.defaultSaveDir;
  updateDownloadBtn();
  setStatus('就绪 - 输入目录页 URL 开始');
})();
