<div align="center">
  <h1>论坛译读 · Forum Translator</h1>
  <strong>读懂 Reddit 与 X，顺手积累进阶词汇</strong>
  <br><br>
  <a href="https://github.com/sunbigfly/forum-translater/raw/refs/heads/main/dist/forum-translator.user.js"><img alt="安装脚本" src="https://img.shields.io/badge/Userscript-安装脚本-536af5"></a>
  <img alt="版本" src="https://img.shields.io/badge/version-0.2.0-536af5">
  <a href="LICENSE"><img alt="许可证" src="https://img.shields.io/badge/license-MIT-f5de53"></a>
</div>

---

论坛译读是一款独立的油猴脚本，在 Reddit 与 X/Twitter 的原文下逐段追加中文译文。开启 AI 服务后，正文翻译与六级及以上词汇分析共用一次请求，译文先流式显示，词汇随后逐条出现。

## 安装与开始使用

1. 在浏览器中安装 Tampermonkey 等用户脚本管理器，推荐新版 Chrome 或 Edge。
2. [安装正式脚本](https://github.com/sunbigfly/forum-translater/raw/refs/heads/main/dist/forum-translator.user.js)。
3. 打开 Reddit 或 X，默认使用 Google 翻译；从油猴菜单打开「Reddit 翻译设置」或「X 翻译设置」。
4. 需要 AI 翻译与词汇学习时，配置兼容 Responses API 的服务地址、密钥和模型，选择 AI 并保存应用。

正式版与本地开发 Loader 只启用一个。与[图像深读](https://github.com/sunbigfly/image-insight)分别安装、分别配置；如同时安装，请关闭图像深读中的重复正文翻译功能。

## 能力一览

### 原文与译文对照

- 翻译 Reddit 标题、正文、评论及 X 推文，保留原文、链接、代码和段落结构。
- 提供多种译文样式，支持只看译文，以及标题、正文、评论独立开关。
- 优先处理视野内第一篇帖子，其他可见内容合批并发；滚动只调整未启动任务的顺序，不反复中断请求。
- 已完成结果保存在本地缓存。刷新、离开页面、站内路由切换或停用功能时取消旧任务。

### 词汇学习

- AI 在同一次翻译请求中挑选最多 6 个六级及以上词汇；难度由模型判断，不等同于官方词表认证。
- 显示音标、语境释义和朗读按钮；点击词汇行展开英文例句与中文释义。
- 原文和对应译文使用柔和颜色标记，支持收藏及间隔复习。
- 没有符合条件的词时不显示词汇区，也不显示预占位骨架。
- 使用 Google 或 Microsoft 翻译时，若开启词汇学习，仍需另外配置 AI，并会单独请求词汇分析。

### X 阅读布局

- 侧栏收纳、右栏隐藏及广告/浮动入口隐藏开关。
- 图片与视频默认等比缩放，悬停显示四边手柄，支持拖动和方向键微调。
- 图片、视频分别记忆尺寸，同类媒体包括引用帖共用设置；联排图片保留横向浏览。
- 在帖子详情页按 Escape 返回；有弹窗、输入焦点或全屏媒体时优先保留原交互。

## AI 配置

| 配置 | 说明 |
| --- | --- |
| Base URL | 包含 `/v1`，不包含 `/responses`；例如 `https://your-provider.example/v1` |
| API Key | 使用你自己的服务密钥，只保存于当前脚本存储 |
| 模型 | 地址和密钥完整后，从服务的 `/models` 获取可选模型 |
| 思考深度 | 默认 `low`；支持情况取决于模型和接口 |
| Fast | 开启后发送 `service_tier: priority`，是否生效由服务决定 |
| 请求/Token 额度 | 控制当前页面的调度，不是跨标签页账单上限 |

地址和密钥输入完整并停顿后会自动保存、获取模型。其他设置通过「保存并应用」生效。接口须兼容 Responses 流式输出；不会自动改用 Chat Completions 或其他翻译服务。

模型生成、网络和代理转发决定首字速度，客户端的快速扫描不代表毫秒级模型输出。稳定提示词前缀和缓存键用于帮助服务端复用，实际 KV/prompt cache 命中以服务返回的使用量为准。

## 数据与隐私

| 操作 | 数据去向 |
| --- | --- |
| Google / Microsoft 翻译 | 视口及预加载范围内的待译文字发送至所选公共接口 |
| AI 翻译和词汇 | 当前批次的文字及必要帖子上下文发送至你配置的服务 |
| 模型列表 | 向所配置服务发出带鉴权的 `/models` 请求 |
| 收藏、复习、尺寸设置 | 保存在浏览器的脚本存储中 |

默认启用正文翻译。可在设置中停用或缩小预加载范围。AI 请求可能产生服务费用，计费和数据保留政策由服务商决定。

API Key 不写入源码或译文缓存；脚本存储并非加密保险箱。`@connect *` 用于用户自定义 AI 域名，脚本仅匹配 Reddit 和 X/Twitter，不在其他网站执行。媒体调整只修改布局，不上传图片或视频进行识别。

## 兼容性与反馈

适配现代及旧版 Reddit、X/Twitter，网站改版可能影响节点识别。公共翻译接口可能限流；模型选词、音标和译文仍需自行判断。系统朗读依赖浏览器及已安装语音。

遇到问题请在 [Issues](https://github.com/sunbigfly/forum-translater/issues) 附上站点、复现步骤和已脱敏截图，**不要提交 API Key、Cookie 或私密帖子内容**。

## 本地开发

```bash
npm ci
npm run verify
```

源码位于 `src/`，测试位于 `tests/`。构建生成可阅读、非压缩的 `main.js` 和 `dist/forum-translator.user.js`，并输出包含 SHA-256 的构建报告。

构建还会生成仅供本机使用的 `dev.user.js`，其中路径自动指向当前工作区。安装 Loader 前需在浏览器扩展设置中允许访问文件网址；源码修改后构建并刷新页面即可。Loader 不提交到仓库。

- [发布说明](docs/RELEASING.md)
- [更新记录](CHANGELOG.md)
- [MIT 许可证](LICENSE)
- [复用来源与许可说明](THIRD_PARTY_NOTICES.md)
