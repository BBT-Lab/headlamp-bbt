/*
 * 文件描述：构建Headlamp BBT随附插件及其本地化文件。
 * 项目名称：Headlamp BBT
 * 文件名称：prepare.mjs
 * 作者：Codex
 * 日期：2026-11-23
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { x as extract } from 'tar';
import { bilingualText, localizeBundle } from './localize.mjs';

const directory = import.meta.dirname;
const root = resolve(directory, '../../..');
const manifest =
  process.env.HEADLAMP_BBT_PLUGIN_MANIFEST ?? join(root, 'container/build-manifest.json');
const destination = resolve(process.argv[2] ?? join(root, '.plugins'));
const cache =
  process.env.HEADLAMP_BBT_PLUGIN_CACHE_DIR ?? join(tmpdir(), 'headlamp-bbt-plugin-cache');

/**
 * 读取JSON文件，只有明确允许缺失的文件才使用空值。
 *
 * :param path: JSON文件路径。
 * :param missing: 可选缺失值。
 * :returns: JSON内容。
 */
async function readJson(path, missing) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && missing !== undefined) return missing;
    throw error;
  }
}

/**
 * 下载固定的插件发布包并核对SHA-256。
 *
 * :param plugin: 发布包下载与摘要配置。
 * :returns: 已校验的包路径。
 */
async function archiveFor({ archive, sha256 }) {
  const filename = join(cache, basename(new URL(archive).pathname));
  let data;
  try {
    data = await readFile(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(archive, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`下载插件失败：${archive} HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(data).digest('hex') !== sha256.toLowerCase()) {
    throw new Error(`插件归档SHA-256不匹配：${archive}`);
  }
  await writeFile(filename, data);
  return filename;
}

/**
 * 从固定上游源码重建使用原生语言包的KubeVirt插件。
 *
 * :param source: 已解包的上游源码。
 * :param patch: BBT本地化差异文件名。
 */
async function buildKubeVirt(source, patch) {
  const options = { cwd: source, stdio: 'inherit' };
  execFileSync('git', ['apply', '-p2', join(directory, patch)], options);
  if (process.platform === 'win32') {
    execFileSync(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', 'npm ci --no-audit --no-fund && npm run build'],
      options
    );
  } else {
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], options);
    execFileSync('npm', ['run', 'build'], options);
  }
  await cp(join(source, 'dist/main.js'), join(source, 'main.js'));
}

/**
 * 保存插件实际用到的语言包，并将其登记到插件清单。
 *
 * :param stage: 插件安装目录。
 * :param name: 词库文件前缀。
 * :param metadata: 插件清单。
 */
async function writeLocales(stage, name, metadata) {
  const zh = {
    ...(await readJson(join(stage, 'locales/zh/translation.json'), {})),
    ...(await readJson(join(directory, 'locales', name + '.locale.zh.json'), {})),
  };
  if (!Object.keys(zh).length) return;
  const dual = Object.fromEntries(
    Object.entries(zh).map(([key, value]) => [key, bilingualText(key, value)])
  );
  metadata.headlamp.i18n = [...new Set([...(metadata.headlamp.i18n ?? []), 'zh', 'zh-x-bbt'])];
  for (const [language, catalog] of [
    ['zh', zh],
    ['zh-x-bbt', dual],
  ]) {
    const path = join(stage, 'locales', language);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'translation.json'), JSON.stringify(catalog, null, 2) + '\n');
  }
}

/**
 * 将一个插件的可运行文件安装到目标目录。
 *
 * :param plugin: 发布配置。
 */
async function stagePlugin(plugin) {
  const { name, patch } = plugin;
  const work = await mkdtemp(join(tmpdir(), 'headlamp-bbt-plugin-'));
  try {
    await extract({ file: await archiveFor(plugin), cwd: work, strip: 1, strict: true });
    const metadataPath = join(work, 'package.json');
    if (patch) {
      await buildKubeVirt(work, patch);
    } else {
      const main = join(work, 'main.js');
      const dictionary = await readJson(join(directory, 'locales', name + '.zh.json'), {});
      const expressions = await readJson(
        join(directory, 'locales', name + '.expressions.json'),
        []
      );
      const source = await readFile(main, 'utf8');
      await writeFile(main, localizeBundle(name, source, dictionary, expressions));
    }
    const metadata = await readJson(metadataPath);
    metadata.headlamp ??= {};
    metadata.headlamp.bbtFixedLocale = !patch;
    await writeLocales(work, name, metadata);
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
    const target = join(destination, name);
    await mkdir(target, { recursive: true });
    await Promise.all(
      ['main.js', 'package.json', 'locales', 'LICENSE', 'NOTICE', 'NOTICE.md'].map(async file => {
        try {
          await cp(join(work, file), join(target, file), { recursive: true });
        } catch (error) {
          if (error.code !== 'ENOENT' || ['main.js', 'package.json'].includes(file)) throw error;
        }
      })
    );
    console.log(`${name} ${metadata.version}`);
  } finally {
    await rm(work, { recursive: true });
  }
}

await mkdir(cache, { recursive: true });
for (const plugin of (await readJson(manifest)).plugins) {
  await stagePlugin(plugin);
}
