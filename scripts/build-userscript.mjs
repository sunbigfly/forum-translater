import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('..', import.meta.url));
const meta = (await readFile(path.join(root, 'src/userscript.meta.txt'), 'utf8')).trim();
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
const result = await build({ entryPoints: [path.join(root, 'src/main.ts')], bundle: true, format: 'iife', platform: 'browser',
  target: ['chrome120', 'edge120'], treeShaking: true, minify: false, legalComments: 'inline', charset: 'utf8', write: false,
  define: { __FT_CSS__: JSON.stringify(css) } });
const code = result.outputFiles[0]?.text;
if (!code) throw new Error('No bundled output');
const sha = value => createHash('sha256').update(value).digest('hex');
const banner = '/*! MIT (c) 2026 sunbigfly. Translation primitives adapted from Hacker News Reader Lite; see THIRD_PARTY_NOTICES.md. */';
const content = `${meta}\n\n${banner}\n${code}`;
const directory = path.join(root, 'dist'); await mkdir(directory, { recursive: true });
const filename = 'forum-translator.user.js';
await writeFile(path.join(directory, filename), content);
await writeFile(path.join(root, 'main.js'), content);
const mainPath = path.join(root, 'main.js');
const mount = mainPath.match(/^\/mnt\/([a-z])\/(.+)$/i);
const url = mount ? `file:///${mount[1].toUpperCase()}:/${mount[2].split('/').map(encodeURIComponent).join('/')}` : pathToFileURL(mainPath).href;
const loader = meta.replace(/^(\/\/ @name\s+).+$/m, '$1[DEV] forum-translator · Local Loader')
  .replace(/^(\/\/ @namespace\s+).+$/m, '$1local.forum-translater.dev')
  .replace('// ==/UserScript==', `// @updateURL    none\n// @downloadURL  none\n// @require      ${url}\n// ==/UserScript==`);
await writeFile(path.join(root, 'dev.user.js'), `${loader}\n\nconsole.info('[forum-translator DEV] 已加载 Windows 本地文件。');\n`);
const report = { mode: 'production', artifact: filename, bytes: Buffer.byteLength(content), sha256: sha(content) };
await writeFile(path.join(directory, `${filename}.build.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
