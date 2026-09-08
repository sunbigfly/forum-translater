# 发布

1. 修改源码及对应测试，在 `src/userscript.meta.txt`、`package.json`、`package-lock.json` 中同步版本。
2. 更新 README 和 CHANGELOG，执行 `npm ci`、`npm run verify`。
3. 提交源码、文档、锁文件、`main.js` 和 `dist/`。不要提交 `.codex/`、`dev.user.js`、凭据或本机调试文件。
4. 推送 GitHub `main`，以 `dist/forum-translator.user.js` 作为正式安装文件。
5. Greasy Fork 使用同一份完整、非压缩的正式产物。首次发布填写简介；后续可从 GitHub 原始文件地址同步。
6. 检查公开页面版本和下载内容；Greasy Fork 可能添加自己的 `@downloadURL` / `@updateURL`，比对时仅忽略这两行。

源文件地址：
`https://raw.githubusercontent.com/sunbigfly/forum-translater/main/dist/forum-translator.user.js`

Greasy Fork 的新建、同步和公开下载均需分别验证，不能仅凭 GitHub 推送成功判断同步完成。
