# Reddit 翻译模块复用记录

参考：Hacker News Reader Lite，Copyright (c) 2026 sunbigfly，MIT License。原始本地路径为用户指定的 `D:\OneDrive\桌面\hackernewreader`。本项目根目录 `LICENSE` 保留完整 MIT 许可；复制后由本仓库独立维护，无运行时跨仓库引用。

| 来源 | 当前 owner | 迁移内容及验证 |
| --- | --- | --- |
| `lite/src/translation/translation-task-manager.ts` | `src/translation/translation-task-manager.ts` | 三级优先级、订阅去重、并发、额度、取消；补充额度等待监听清理；迁入原测试 |
| `lite/src/translation/translation-text.ts` | `src/translation/translation-text.ts` | 分段、保护占位符、指纹、结构化回填；调整失败提示；迁入原测试 |
| `lite/src/translation/translation-service.ts` | `src/translation/provider.ts` | 改编 Google 请求参数、Microsoft token/翻译流程、结果校验；新 GM 请求与取消测试 |
| `scripts/build-userscript.mjs` | `scripts/build-userscript.mjs` | 借用 TS → esbuild → IIFE、CSS 编译注入思路；独立 TS 构建为 main.js 和 dist 脚本，固定文件 Loader 单独生成 |

新实现：Reddit DOM 规则、允许列表快照、视口调度与生命周期、缓存及独立设置面板。未搬入 HN 阅读器、论坛 API、原视图设置模型。

测试说明：Reddit fixture 是用于验证规则与生命周期的合成 DOM，不是已验收的实时页面快照。网络测试仅使用固定无敏感信息文本，真实油猴运行态与浏览器验收独立记录。

当前模块已从图像深读迁出。源码、设置、缓存、脚本身份与构建均由本项目独立拥有；不读取图像深读的设置或 API Key。

AI 追加复用：`lite/src/ai/ai-completion-client.ts` 的 Responses 输出/SSE 解码移入 `src/translation/ai.ts`，适配 GM 请求、取消、错误脱敏与完整响应检查；`translation-service.ts` 的 JSON id 与占位符提示约束移入同文件；`settings-store.ts` 的本地 HTTP/HTTPS 地址验证移入 `src/settings.ts`。由独立测试验证分片流、失败、取消、缓存身份及配置隔离。

设置面板追加参考：图像深读 WSL 最终版 `main.js` 中的 `renderSettings`、`.ii-settings-layout` 与表单样式（MIT，sunbigfly）。在 `src/ui.ts` 中适配为翻译专用分类与原生 dialog；没有修改或运行时依赖图像深读。

增量回填追加复用 HN `translation-service.ts` 的 `streamedJsonString` / `streamedJsonRecord`，接入本项目 AI → service → runtime 订阅回调。片段仅用于显示，完整译文才持久化。
