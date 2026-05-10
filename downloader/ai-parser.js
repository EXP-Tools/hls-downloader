const fs = require('fs');
const path = require('path');
const os = require('os');

function getOpenCodeConfigPath() {
  for (const p of [
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    path.join(os.homedir(), '.opencode', 'opencode.json')
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readProviders() {
  const cfgPath = getOpenCodeConfigPath();
  if (!cfgPath) return [];

  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const providers = cfg.provider || {};
    const result = [];

    for (const [key, val] of Object.entries(providers)) {
      const npm = val.npm || '';
      const isOpenAI = npm.includes('@ai-sdk/openai') || npm.includes('openai-compatible');
      const isAnthropic = npm.includes('@ai-sdk/anthropic');
      if (!isOpenAI && !isAnthropic) continue;

      const models = val.models || {};
      const modelList = Object.entries(models).map(([id, m]) => ({
        id,
        name: m.name || id
      }));

      if (modelList.length === 0) continue;

      result.push({
        key,
        npm,
        isOpenAICompatible: isOpenAI,
        baseURL: (val.options?.baseURL || '').replace(/\/+$/, ''),
        apiKey: val.options?.apiKey || '',
        models: modelList
      });
    }

    return result;
  } catch (_) {
    return [];
  }
}

async function aiParseEpisodeList(provider, modelId, pageUrl, html) {
  const baseURL = provider.baseURL;
  const apiKey = provider.apiKey;

  const prompt = `You are an episode list extractor. Analyze the following HTML from a video/streaming page.

Extract ALL episodes OR the current video if it's a single video page.
For each entry, identify:
- title: the episode/video title
- url: the full URL or relative link to the episode page

Return a JSON object with format:
{ "episodes": [ { "title": "...", "url": "..." }, ... ] }

Important:
- If the page is a catalog with multiple episodes, list ALL episodes
- If the page is a single video (no episode list), include it as 1 episode with the current page title
- Skip navigation links, ads, and unrelated content
- Prefer complete URLs over relative paths

Page URL: ${pageUrl}

HTML (first 30KB):
${html.substring(0, 30000)}`;

  if (provider.isOpenAICompatible) {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: 'You parse HTML and extract episode data. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text.substring(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    try {
      const parsed = JSON.parse(content);
      return parsed.episodes || [];
    } catch (_) {
      // Try to extract JSON from the content
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.episodes || [];
      }
      throw new Error('AI response parsing failed');
    }
  }

  // Anthropic format
  if (provider.npm.includes('@ai-sdk/anthropic')) {
    const res = await fetch(`${baseURL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 4096,
        temperature: 0,
        system: 'You parse HTML and extract episode data. Return only valid JSON.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text.substring(0, 200)}`);
    }

    const data = await res.json();
    const content = data.content?.[0]?.text || '';
    try {
      const parsed = JSON.parse(content);
      return parsed.episodes || [];
    } catch (_) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.episodes || [];
      }
      throw new Error('AI response parsing failed');
    }
  }

  throw new Error('Unsupported provider type');
}

module.exports = { readProviders, aiParseEpisodeList, getOpenCodeConfigPath };
