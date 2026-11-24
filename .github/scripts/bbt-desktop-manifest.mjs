/*
 * 文件描述：生成桌面端版本信息并校验随附插件文件。
 * 项目名称：Headlamp BBT
 * 文件名称：bbt-desktop-manifest.mjs
 * 作者：Codex
 * 日期：2026-11-24
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [tag, verifyPlugins] = process.argv.slice(2);
const version = /^v(\d+\.\d+\.\d+)\.bbt\.([1-9]\d*)-(\d{10})$/.exec(tag);
if (!version) throw new Error('无效的BBT发布标签');
const [, upstream, sequence, timestamp] = version;
const read = path => readFileSync(new URL(path, import.meta.url));
const manifest = JSON.parse(read('../../app/app-build-manifest.json'));
manifest.checkForUpdates = false;
manifest.product = {
  ...manifest.product,
  name: 'headlamp-bbt',
  productName: 'Headlamp BBT',
  appId: 'cn.edu.sspu.bbt.headlamp',
  version: `${upstream}-bbt.${sequence}.${timestamp}`,
  artifactName: `Headlamp-BBT-${tag}-\${os}-\${arch}.\${ext}`,
};
manifest.platforms ??= {};
manifest.platforms.mac = { ...manifest.platforms.mac, appId: manifest.product.appId };
if (verifyPlugins === '--verify-plugins') {
  const bundled = JSON.parse(read('../../container/build-manifest.json')).plugins;
  const plugins = [...bundled.map(item => item.name), 'headlamp-plus', 'headlamp-gpu-monitor'];
  const localizedFiles = ['main.js', 'locales/zh/translation.json', 'locales/zh-x-bbt/translation.json'];
  manifest.verify = [
    ...(manifest.verify ?? []),
    ...plugins.flatMap(name => ['main.js', ...(name === 'headlamp_kubevirt' ? localizedFiles.slice(1) : [])].map(file => {
      const path = `.plugins/${name}/${file}`;
      return { path, sha256: createHash('sha256').update(read(`../../${path}`)).digest('hex') };
    })),
  ];
}
writeFileSync(new URL('../../app/bbt-build-manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
