/*
 * 文件描述：将Headlamp Plus构建产物和语言包放入项目插件目录。
 * 项目名称：Headlamp BBT
 * 文件名称：stage.mjs
 * 作者：Codex
 * 日期：2026-11-22
 */

import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dest = resolve(root, '../../../.plugins/headlamp-plus');
mkdirSync(dest, { recursive: true });
cpSync(resolve(root, 'dist/main.js'), resolve(dest, 'main.js'));
for (const entry of ['package.json', 'LICENSE', 'NOTICE', 'locales']) {
  cpSync(resolve(root, entry), resolve(dest, entry), { recursive: true });
}
