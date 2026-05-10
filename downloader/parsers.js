const siteParsers = [
  // ====== 西瓜卡通 xgcartoon.com / twxgct.com ======
  {
    name: 'xgcartoon',
    match: (url) => /xgcartoon\.com|twxgct\.com/.test(url),

    parseEpisodeList(html, url) {
      // Always return null to use JS extraction (AMP pages need live DOM)
      return null;
    },

    // JS fallback for dynamic pages
    jsExtract() {
      return `
        function() {
          var eps = [], seen = {};
          var links = document.querySelectorAll('a');
          for (var i = 0; i < links.length; i++) {
            var a = links[i];
            var raw = (a.textContent || '').replace(/\\s+/g, ' ').trim();
            if (raw.length < 3 || raw.length > 80) continue;
            var href = a.href || a.getAttribute('href') || '';
            var isPD = href.indexOf('page_direct') >= 0;
            // Require episode-like text (contains Chinese 第 + 话/集)
            var hasDi = raw.indexOf('\\u7b2c') >= 0;
            var hasEpSuffix = raw.indexOf('\\u8bdd') >= 0 || raw.indexOf('\\u96c6') >= 0;
            // Must have page_direct link AND look like an episode title
            if (!isPD || !hasDi || !hasEpSuffix) continue;
            var chMatch = href.match(/chapter_id=([^&]+)/);
            var key = chMatch ? chMatch[1] : href;
            if (!key || seen[key]) continue;
            seen[key] = true;
            eps.push({ title: raw, url: href, chapterId: chMatch ? chMatch[1] : null });
          }
          return eps;
        }
      `;
    },

    transformUrl(ep, catalogUrl) {
      const slugMatch = catalogUrl.match(/\/detail\/([^_]+)/);
      const slug = slugMatch ? slugMatch[1] : null;
      if (!slug) return ep.url;

      ep._originalUrl = ep.url;
      const chMatch = ep.url.match(/chapter_id=([^&]+)/);
      if (chMatch) {
        ep.chapterId = chMatch[1];
        ep.url = `https://www.twxgct.com/video/${slug}/${chMatch[1]}.html`;
      }
      return ep.url;
    }
  },

  // ====== 肉视频 rou.video ======
  {
    name: 'rouvideo',
    match: (url) => /rou\.video/.test(url),

    parseEpisodeList(html, url) {
      return null;
    },

    jsExtract() {
      return `
        function() {
          var eps = [];
          var title = (document.querySelector('h1, [class*=title]') || {}).textContent || document.title || '';
          title = title.replace(/\\s+/g, ' ').trim();
          if (!title || title.length < 2) {
            title = document.title.replace(/\\s*-.*/, '').trim();
          }
          if (!title) title = '视频';
          eps.push({ title: title, url: location.href });
          return eps;
        }
      `;
    },

    transformUrl(ep) {
      return ep.url;
    }
  },

  // ====== 爱壹帆 yfsp.tv ======
  {
    name: 'yfsp',
    match: (url) => /yfsp\.tv/.test(url),

    parseEpisodeList(html, url) {
      const episodes = [];
      const seen = new Set();
      const baseOrigin = 'https://www.yfsp.tv';
      const playIdMatch = url.match(/\/play\/([^/?]+)/);
      const playId = playIdMatch ? playIdMatch[1] : '';

      // Try ep= parameter links
      const epRegex = /<a[^>]*href="([^"]*\bep=(\d+)[^"]*)"[^>]*>([^<]+)<\/a>/gi;
      let m;
      while ((m = epRegex.exec(html)) !== null) {
        const href = m[1].startsWith('http') ? m[1] : baseOrigin + m[1];
        const epNum = parseInt(m[2]);
        const text = m[3].trim();
        if (seen.has(epNum)) continue;
        seen.add(epNum);
        episodes.push({ title: `第${epNum}集 ${text}`.trim(), url: href, epNum });
      }

      // Try data attributes
      if (episodes.length === 0) {
        const btnRegex = /<[^>]*(?:data-ep|data-id|data-index)[^>]*=["']?(\d+)["']?[^>]*>([^<]*)<\/[^>]+>/gi;
        while ((m = btnRegex.exec(html)) !== null) {
          const epNum = parseInt(m[1]);
          const text = m[2].trim() || `第${epNum}集`;
          if (seen.has(epNum) || epNum < 1 || epNum > 2000) continue;
          seen.add(epNum);
          episodes.push({ title: `第${epNum}集 ${text}`, url: `${baseOrigin}/play/${playId}?ep=${epNum}`, epNum });
        }
      }

      if (episodes.length === 0) return null;
      return episodes;
    },

    jsExtract() {
      return `
        var eps = [], seen = {};
        document.querySelectorAll('[data-ep], [data-id], a[href*="ep="]').forEach(function(el) {
          var ep = el.getAttribute('data-ep') || el.getAttribute('data-id');
          if (!ep) {
            var m = (el.href || '').match(/ep=(\\d+)/);
            ep = m ? m[1] : null;
          }
          if (!ep || seen[ep]) return;
          seen[ep] = true;
          eps.push({ title: '第' + ep + '集 ' + (el.textContent||'').trim(), url: el.href || location.origin + location.pathname + '?ep=' + ep });
        });
        return eps;
      `;
    },

    transformUrl(ep) {
      return ep.url;
    }
  }
];

function getParser(url) {
  return siteParsers.find(p => p.match(url)) || null;
}

module.exports = { siteParsers, getParser };
