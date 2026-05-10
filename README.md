# HLS 批量下载器

基于 Electron 的 HLS 视频批量下载桌面应用。

## 功能

- 输入动漫/影视目录页 URL，自动解析全部集数
- 勾选/全选/反选需要下载的集数
- 逐集自动提取视频流，下载 HLS 分片并合并为 TS 文件
- 支持 HTTP / SOCKS5 代理（菜单栏「设置 → 代理设置」）
- 可选自动转 MP4（需系统安装 ffmpeg）
- AI 辅助解析（当常规解析失败时，调用 AI 自动提取集数）
- 下载进度实时显示

## 使用

```bash
npm install
npm start
```

或双击 `start.vbs`（Windows 无控制台窗口启动）。

1. 输入目录页 URL
2. 点击「解析集数」
3. 勾选要下载的集，选择保存目录
4. 点击「开始下载」

## 设置

通过菜单栏「设置」进入：

- **代理设置** — HTTP / SOCKS5 代理，支持认证
- **AI 辅助解析** — 开启后，常规解析失败的页面会自动调用 AI 提取集数。需先在设置中选择服务商和模型（自动读取本地 opencode 配置）
- **自动转 MP4** — 下载合并后自动用 ffmpeg 转为 MP4

## 项目结构

```
├── main.js              # Electron 主进程
├── preload.js           # IPC 桥接
├── downloader/
│   ├── parsers.js       # 各站点评析器
│   ├── parser.js        # 页面加载 + vid 提取
│   ├── hls-engine.js    # m3u8 下载 + 分片合并 + ffmpeg 转码
│   └── ai-parser.js     # AI 辅助解析 (opencode 集成)
├── renderer/
│   ├── index.html       # UI
│   ├── style.css
│   └── renderer.js
└── imgs/                # 打赏二维码
```

## 添加新站点

编辑 `downloader/parsers.js`，新增一个解析器对象：

```js
{
  name: '站点名',
  match: (url) => /域名/.test(url),
  parseEpisodeList(html, url) { /* HTML 解析, 或 return null 用 JS 提取 */ },
  jsExtract() { return `function() { ... return eps; }`; },
  transformUrl(ep, catalogUrl) { /* 转换 episode URL */ }
}
```
