# Reddit 翻译模块复用记录

参考：Hacker News Reader Lite，Copyright (c) 2026 sunbigfly，MIT License。原始本地路径为用户指定的 `D:\OneDrive\桌面\hackernewreader`。本项目根目录 `LICENSE` 保留完整 MIT 许可；复制后由本仓库独立维护，无运行时跨仓库引用。

| 来源 | 当前 owner | 迁移内容及验证 |
| --- | --- | --- |
| `lite/src/translation/translation-task-manager.ts` | `src/translation/translation-task-manager.ts` | 三级优先级、订阅去重、并发、额度、取消；补充额度等待监听清理；迁入原测试 |
| `lite/src/translation/translation-text.ts` | `src/translation/translation-text.ts` | 分段、保护占位符、指纹、结构化回填；调整失败提示；迁入原测试 |
| `lite/src/translation/translation-service.ts` | `src/translation/provider.ts` | 改编 Google 请求参数、Microsoft token/翻译流程、结果校验；新 GM 请求与取消测试 |
| `lite/src/settings/local-font-picker.ts` | `src/font-settings.ts`、`src/fonts.ts` | 改编本机字体读取与共享缓存、中文名称、去重搜索和实际字体预览；独立标题/正文字体与字号，使用独立设置模型与生命周期 |
| `scripts/build-userscript.mjs` | `scripts/build-userscript.mjs` | 借用 TS → esbuild → IIFE、CSS 编译注入思路；独立 TS 构建为 main.js 和 dist 脚本，固定文件 Loader 单独生成 |

新实现：Reddit DOM 规则、允许列表快照、视口调度与生命周期、缓存及独立设置面板。未搬入 HN 阅读器、论坛 API、原视图设置模型。

测试说明：Reddit fixture 是用于验证规则与生命周期的合成 DOM，不是已验收的实时页面快照。网络测试仅使用固定无敏感信息文本，真实油猴运行态与浏览器验收独立记录。

当前模块已从图像深读迁出。源码、设置、缓存、脚本身份与构建均由本项目独立拥有；不读取图像深读的设置或 API Key。

AI 追加复用：`lite/src/ai/ai-completion-client.ts` 的 Responses 输出/SSE 解码移入 `src/translation/ai.ts`，适配 GM 请求、取消、错误脱敏与完整响应检查；`translation-service.ts` 的 JSON id 与占位符提示约束移入同文件；`settings-store.ts` 的本地 HTTP/HTTPS 地址验证移入 `src/settings.ts`。由独立测试验证分片流、失败、取消、缓存身份及配置隔离。

设置面板追加参考：图像深读 WSL 最终版 `main.js` 中的 `renderSettings`、`.ii-settings-layout` 与表单样式（MIT，sunbigfly）。在 `src/ui.ts` 中适配为翻译专用分类与原生 dialog；没有修改或运行时依赖图像深读。

增量回填追加复用 HN `translation-service.ts` 的 `streamedJsonString` / `streamedJsonRecord`，接入本项目 AI → service → runtime 订阅回调。片段仅用于显示，完整译文才持久化。

## Lucide icons

`src/wordbook-icons.ts` uses Lucide 0.468.0 icons from https://github.com/lucide-icons/lucide.

```text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

```

## ECDICT core vocabulary snapshot

Source: https://github.com/skywind3000/ECDICT (ecdict.csv, retrieved 2026-09-09).
Includes 18,247 entries tagged CET4/CET6, Oxford core, or with frequency rank 1–20,000. Source SHA-256: `1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf`.

```text
MIT License

Copyright (c) 2025 Linwei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```

## opencc-js 1.4.2

Traditional-to-Simplified Chinese conversion, bundled locally. Source: https://github.com/nk2028/opencc-js

```text
MIT License

Copyright (c) 2020-2021 The nk2028 Project

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```

# Third-Party Licenses

This document lists third-party software whose data or code is incorporated into
`opencc-js` and describes the associated license obligations.

---

## opencc-data

- **Package**: [`opencc-data`](https://www.npmjs.com/package/opencc-data)
- **Repository**: <https://github.com/nk2028/opencc-data>
- **License**: Apache License, Version 2.0

Dictionary data distributed with `opencc-js` is generated at build time from the
source files provided by the `opencc-data` package.  The generated data is
therefore a derivative work of `opencc-data` and is redistributed under the
terms of the Apache License, Version 2.0.

A copy of the Apache License, Version 2.0 is reproduced below.

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship made available under
      the License, as indicated by a copyright notice that is included
      in or attached to the work (an example is provided in the Appendix
      below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and derivative works thereof.

      "Contribution" shall mean, as submitted to the Licensor for inclusion
      in the Work by the copyright owner or by an individual or Legal Entity
      authorized to submit on behalf of the copyright owner. For the purposes
      of this definition, "submitted" means any form of electronic, verbal,
      or written communication sent to the Licensor or its representatives,
      including but not limited to communication on electronic mailing lists,
      source code control systems, and issue tracking systems that are managed
      by, or on behalf of, the Licensor for the purpose of discussing and
      improving the Work, but excluding communication that is conspicuously
      marked or designated in writing by the copyright owner as "Not a
      Contribution."

      "Contributor" shall mean Licensor and any Legal Entity on behalf of
      whom a Contribution has been received by the Licensor and included
      within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by the combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a cross-claim
      or counterclaim in a lawsuit) alleging that the Work or any
      Contribution embodied within the Work constitutes direct or contributory
      patent infringement, then any patent licenses granted to You under
      this License for that Work shall terminate as of the date such
      litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or Derivative Works
          a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, You must include a readable copy of the
          attribution notices contained within such NOTICE file, in
          at least one of the following places: within a NOTICE text
          file distributed as part of the Derivative Works; within
          the Source form or documentation, if provided along with the
          Derivative Works; or, within a display generated by the
          Derivative Works, if and wherever such third-party notices
          normally appear. The contents of the NOTICE file are for
          informational purposes only and do not modify the License.
          You may add Your own attribution notices within Derivative
          Works that You distribute, alongside or in addition to the
          NOTICE text from the Work, provided that such additional
          attribution notices cannot be construed as modifying the
          License.

      You may add Your own license statement for Your modifications and
      may provide additional grant of rights to use, copy, modify, merge,
      publish, distribute, sublicense, and/or sell copies of the
      Derivative Works, subject to the terms of this License for the
      Work itself.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any conditions of TITLE,
      NONINFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR
      PURPOSE. You are solely responsible for determining the
      appropriateness of using or reproducing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or exemplary damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or all other
      commercial damages or losses), even if such Contributor has been
      advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may offer only
      conditions consistent with this License, and charge a fee for,
      acceptance of support, warranty, indemnity, or other liability
      obligations and/or rights consistent with this License.

   END OF TERMS AND CONDITIONS
```
