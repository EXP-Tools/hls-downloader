const { net } = require('electron');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function log(sendLog, msg) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (sendLog) sendLog(line);
}

async function fetchText(sendLog, url, referer) {
  return new Promise((resolve, reject) => {
    const req = net.request({
      url,
      headers: referer ? { Referer: referer } : {}
    });
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function downloadFile(sendLog, url, filePath, referer, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      await new Promise((resolve, reject) => {
        const req = net.request({
          url,
          headers: referer ? { Referer: referer } : {}
        });
        req.on('response', (res) => {
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            try {
              fs.writeFileSync(filePath, Buffer.concat(chunks));
              resolve();
            } catch (e) { reject(e); }
          });
          res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
      });
      return;
    } catch (e) {
      if (i === retries - 1) throw e;
      log(sendLog, `  重试 (${i + 1}/${retries}): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

function parseM3U8(content, baseUrl) {
  const lines = content.split('\n').map(l => l.trim());
  const segments = [];
  let isMaster = false;
  let currentVariant = null;
  const variants = [];
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      isMaster = true;
      const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
      const bwMatch = line.match(/BANDWIDTH=(\d+)/);
      currentVariant = {
        resolution: resMatch ? resMatch[1] : 'unknown',
        bandwidth: bwMatch ? parseInt(bwMatch[1]) : 0,
        uri: ''
      };
    } else if (currentVariant && !line.startsWith('#') && line.length > 0) {
      currentVariant.uri = resolveUrl(line, baseUrl);
      variants.push(currentVariant);
      currentVariant = null;
    }

    if (line.startsWith('#EXT-X-KEY')) {
      const methodMatch = line.match(/METHOD=([^,]+)/);
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (methodMatch && uriMatch) {
        currentKey = {
          method: methodMatch[1],
          uri: resolveUrl(uriMatch[1], baseUrl)
        };
      }
    }

    if (line.startsWith('#EXTINF')) {
      let duration = 0;
      const durMatch = line.match(/#EXTINF:\s*([\d.]+)/);
      if (durMatch) {
        duration = parseFloat(durMatch[1]);
      }
      i++;
      if (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith('#')) {
        const uri = lines[i].trim();
        segments.push({
          uri: resolveUrl(uri, baseUrl),
          duration,
          key: currentKey ? { ...currentKey } : null
        });
      }
    }
  }

  return { isMaster, variants, segments };
}

function resolveUrl(uri, baseUrl) {
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  if (uri.startsWith('//')) {
    const base = new URL(baseUrl);
    return base.protocol + uri;
  }
  try {
    return new URL(uri, baseUrl).href;
  } catch (_) {
    const base = new URL(baseUrl);
    if (uri.startsWith('/')) return base.origin + uri;
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    return base.origin + basePath + uri;
  }
}

async function downloadHLS(sendLog, sendProgress, m3u8Url, outputDir, fileNameBase) {
  log(sendLog, `获取 m3u8: ${m3u8Url}`);

  const referer = m3u8Url;
  const m3u8Content = await fetchText(sendLog, m3u8Url, referer);
  const parsed = parseM3U8(m3u8Content, m3u8Url);

  let mediaUrl = m3u8Url;
  let resolution = '';

  if (parsed.isMaster && parsed.variants.length > 0) {
    parsed.variants.sort((a, b) => b.bandwidth - a.bandwidth);
    const best = parsed.variants[0];
    mediaUrl = best.uri;
    resolution = best.resolution;
    log(sendLog, `多码率流: 选择最高画质 ${resolution} (${Math.round(best.bandwidth / 1000)}kbps)`);

    const mediaContent = await fetchText(sendLog, mediaUrl, referer);
    const mediaParsed = parseM3U8(mediaContent, mediaUrl);
    parsed.segments = mediaParsed.segments;
    parsed.variants = [];
  }

  if (parsed.segments.length === 0) {
    throw new Error('未找到视频分片 (m3u8 解析为空)');
  }

  log(sendLog, `共 ${parsed.segments.length} 个分片, 开始下载...`);

  const safeDir = fileNameBase.replace(/[<>:"/\\|?*]/g, '_').substring(0, 60);
  const tempDir = path.join(outputDir, '.temp_' + safeDir);
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  let downloaded = 0;
  const total = parsed.segments.length;
  const failedSegments = [];

  // Download encryption key if needed
  const hasKey = parsed.segments.some(s => s.key);
  if (hasKey) {
    log(sendLog, '检测到加密流, 暂不支持加密下载, 将尝试直接下载');
  }

  // Download segments with concurrency control
  const concurrency = 8;
  const queue = parsed.segments.map((seg, i) => ({ ...seg, index: i }));

  async function processBatch(batch) {
    const results = await Promise.allSettled(
      batch.map(async (seg) => {
        const urlPart = seg.uri.split('?')[0];
        const ext = urlPart.split('.').pop() || 'ts';
        const cleanExt = ext.length > 5 ? 'ts' : ext;
        const segPath = path.join(tempDir, `${String(seg.index + 1).padStart(6, '0')}.${cleanExt}`);
        await downloadFile(sendLog, seg.uri, segPath, referer);
        return seg.index;
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        downloaded++;
        if (sendProgress) sendProgress(downloaded, total);
      } else {
        failedSegments.push(r.reason);
        log(sendLog, `  分片下载失败: ${r.reason.message}`, 'warn');
      }
    }
  }

  for (let i = 0; i < queue.length; i += concurrency) {
    const batch = queue.slice(i, i + concurrency);
    await processBatch(batch);
  }

  if (downloaded === 0) {
    throw new Error('所有分片下载均失败');
  }

  log(sendLog, `分片下载完成: ${downloaded}/${total}`);

  // Merge segments
  log(sendLog, '合并分片中...');
  const outputPath = path.join(outputDir, `${safeDir}.ts`);
  const segmentFiles = fs.readdirSync(tempDir)
    .filter(f => /\.(ts|mp4|m4s|m4v)$/i.test(f))
    .sort()
    .map(f => path.join(tempDir, f));

  if (segmentFiles.length === 0) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error('没有成功下载的分片文件');
  }

  // Concatenate TS segments (binary concatenation works for MPEG-TS)
  const writeStream = fs.createWriteStream(outputPath);
  for (const segFile of segmentFiles) {
    const data = fs.readFileSync(segFile);
    writeStream.write(data);
  }
  writeStream.end();

  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  // Cleanup temp
  fs.rmSync(tempDir, { recursive: true, force: true });

  const fileSize = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1);
  log(sendLog, `完成: ${outputPath} (${fileSize} MB)`);
  return { outputPath, resolution, segmentCount: total };
}

module.exports = { fetchText, downloadFile, downloadHLS, parseM3U8, log, convertToMp4 };

async function convertToMp4(sendLog, tsPath) {
  const mp4Path = tsPath.replace(/\.ts$/i, '.mp4');
  log(sendLog, `转换: ${path.basename(tsPath)} → ${path.basename(mp4Path)}`);

  return new Promise((resolve, reject) => {
    // Try ffmpeg first, fall back to direct rename (TS plays fine in most players)
    const ffmpeg = spawn('ffmpeg', [
      '-y', '-i', tsPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-f', 'mp4',
      mp4Path
    ], { stdio: 'pipe' });

    let stderr = '';
    ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        try { fs.unlinkSync(tsPath); } catch (_) {}
        log(sendLog, 'MP4 转换完成');
        resolve(mp4Path);
      } else {
        log(sendLog, `ffmpeg 失败(code ${code}), 保留 TS 文件`);
        // Keep TS file, don't delete
        resolve(tsPath);
      }
    });

    ffmpeg.on('error', () => {
      log(sendLog, 'ffmpeg 不可用, 保留 TS 文件');
      resolve(tsPath);
    });
  });
}
