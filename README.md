# HLS 批量下载器

基于 Electron 的 HLS / m3u8 视频批量下载桌面应用。

## 功能

- 输入动漫/影视目录页 URL，自动解析全部集数
- 勾选 / 全选 / 反选需要下载的集
- 逐集提取视频流，下载 HLS 分片并合并为 TS
- 支持 HTTP / SOCKS5 代理（含认证）
- 可选自动转 MP4（需 ffmpeg）
- **AI 辅助解析** — 内置解析器无法提取时，自动调用大模型分析页面；也可作为任意站点的通用解析方案
- 下载进度、日志实时显示

## 快速开始

```bash
npm install
npm start
```

Windows 可直接双击 `start.vbs`（无控制台窗口）。

### 使用流程

1. 粘贴目录页 URL
2. 点击「解析集数」
3. 勾选目标集 → 选择保存目录
4. 点击「开始下载」

## 设置

菜单栏「设置」：

| 项目 | 说明 |
|------|------|
| 代理设置 | HTTP / SOCKS5，填写主机端口和可选认证 |
| AI 辅助解析 | 开启后需选择服务商和模型，默认关闭 |
| 自动转 MP4 | 下载后用 ffmpeg 将 TS 转为 MP4 |

### AI 辅助解析

开启后：

- **已知站点**：常规解析结果为 0 时，AI 兜底
- **任意站点**：无内置解析器的 URL 直接走 AI 提取集数
- **单集视频**：AI 会将当前页面作为 1 集返回

服务商和模型列表自动读取本地 `~/.config/opencode/opencode.json` 配置。

## 项目结构

```
├── main.js              # 主进程：菜单、IPC、下载调度
├── preload.js           # 渲染进程桥接
├── downloader/
│   ├── parsers.js       # 站点评析器注册表
│   ├── parser.js        # 页面加载 + vid 提取 + Cloudflare 处理
│   ├── hls-engine.js    # m3u8 解析、分片下载、合并、ffmpeg 转码
│   └── ai-parser.js     # AI 解析：读取 opencode 配置、调用 LLM API
├── renderer/
│   ├── index.html
│   ├── style.css
│   └── renderer.js
└── imgs/                # 打赏图片
```

## 扩展站点

编辑 `downloader/parsers.js`，在 `siteParsers` 数组中新增对象：

```js
{
  name: '站点名',
  match: (url) => /域名/.test(url),
  parseEpisodeList(html, url) { /* 静态 HTML 解析，或 return null */ },
  jsExtract() { return `function() { ... return eps; }`; },
  transformUrl(ep, catalogUrl) { /* 可选：URL 格式转换 */ }
}
```

或者不做任何扩展，直接开启 AI 辅助解析处理任意站点。
