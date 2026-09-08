# 发布

1. 修改源码及对应测试，在 `src/userscript.meta.txt`、`package.json`、`package-lock.json` 中同步版本。
2. 更新 README 和 CHANGELOG，执行 `npm ci`、`npm run verify`。
3. 提交源码、文档、锁文件、`main.js` 和 `dist/`。不要提交 `.codex/`、`dev.user.js`、凭据或本机调试文件。
4. 推送 GitHub `main`，以 `dist/forum-translator.user.js` 作为正式安装文件。
5. Greasy Fork 使用同一份完整、非压缩的正式产物。首次发布填写简介；后续通过 GitHub push webhook 同步代码和说明。
6. 检查公开页面版本和下载内容；Greasy Fork 可能添加自己的 `@downloadURL` / `@updateURL`，比对时仅忽略这两行。

源文件地址：
`https://raw.githubusercontent.com/sunbigfly/forum-translater/main/dist/forum-translator.user.js`

Greasy Fork 的新建、同步和公开下载均需分别验证，不能仅凭 GitHub 推送成功判断同步完成。

正式发布页：[论坛译读 · Forum Translator](https://greasyfork.org/zh-CN/scripts/594954)。

GitHub 仓库已配置 push webhook；Greasy Fork 从 `main` 分支同步 `dist/forum-translator.user.js`，并从 `docs/GREASYFORK.md` 同步 Markdown 说明。Webhook 地址和签名密钥仅保存在平台设置中，不写入仓库。

推送后检查 GitHub Settings → Webhooks 的 delivery 响应，再检查 Greasy Fork 同步状态和公开版本。源码变更必须先构建并提交正式产物；仅推送源码不会改变安装脚本。
