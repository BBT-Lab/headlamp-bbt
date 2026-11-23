/*
 * 文件描述：将GPU Monitor打包到Headlamp本地及容器插件目录。
 * 项目名称：Headlamp BBT
 * 文件名称：stage.mjs
 * 作者：Codex
 * 日期：2026-11-23
 */

import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;
const target = resolve(root, '../../../.plugins/headlamp-gpu-monitor');
mkdirSync(target, { recursive: true });
cpSync(resolve(root, 'dist/main.js'), resolve(target, 'main.js'));
for (const file of ['package.json', 'LICENSE', 'NOTICE', 'locales']) {
  cpSync(resolve(root, file), resolve(target, file), { recursive: true });
}
