// 文件描述：校验 Headlamp Plus 的简体中文文案及其插值字段。
// 项目名：Headlamp Plus
// 文件名：check-locales.cjs
// 作者：Qintsg
// 日期：2026-11-21

const assert = require('node:assert/strict');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const typescript = require('typescript');

const root = path.resolve(__dirname, '..');
const localePath = 'locales/zh/translation.json';
const locale = JSON.parse(readFileSync(path.join(root, localePath), 'utf8'));
const keys = new Set([
  'Memory pressure',
  'Disk pressure',
  'PID pressure',
  'Network unavailable',
  'ready',
  'healthy',
  'active',
  '1h',
  '6h',
  '24h',
  '7d',
]);
for (const noun of ['node', 'namespace', 'workload', 'pod', 'error', 'warning']) {
  keys.add('{{count}} ' + noun);
  keys.add('{{count}} ' + noun + 's');
}

/**
 * 提取 TypeScript 源文件中的翻译键。
 *
 * :param file: 待检查的源文件路径。
 */
function collectKeys(file) {
  const source = typescript.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    typescript.ScriptTarget.Latest,
    true
  );
  typescript.forEachChild(source, function scan(node) {
    if (
      typescript.isCallExpression(node) &&
      typescript.isIdentifier(node.expression) &&
      ['t', 'translate'].includes(node.expression.text) &&
      node.arguments[0] &&
      typescript.isStringLiteral(node.arguments[0])
    ) {
      keys.add(node.arguments[0].text);
    }
    typescript.forEachChild(node, scan);
  });
}

const overview = path.join(root, 'src/overview');
collectKeys(path.join(root, 'src/common/ErrorBoundary.tsx'));
for (const entry of readdirSync(overview)) {
  if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
    collectKeys(path.join(overview, entry));
  }
}

const placeholders = text =>
  [...new Set([...text.matchAll(/{{\s*(\w+)\s*}}/g)].map(match => match[1]))].sort();
const bilingualPath = 'locales/zh-x-bbt/translation.json';
const bilingual = JSON.parse(readFileSync(path.join(root, bilingualPath), 'utf8'));
for (const key of keys) {
  if (key === 'Pod' || key === 'Pods') {
    assert.equal(locale[key], 'Pod', '简体中文保留Pod资源名');
    assert.equal(bilingual[key], 'Pod', '双语保留Pod资源名');
  } else {
    assert.match(locale[key] ?? '', /\p{Script=Han}/u, '简体中文文案缺失：' + key);
  }
  assert.deepEqual(placeholders(locale[key]), placeholders(key), '插值字段不匹配：' + key);
  assert.deepEqual(placeholders(bilingual[key]), placeholders(key), '双语插值字段不匹配：' + key);
}
assert.equal(bilingual['Try again'], locale['Try again']);

const packageDirectory = process.argv[2] ? path.resolve(process.argv[2]) : root;
const pack = JSON.parse(readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
assert.ok(pack.headlamp.i18n.includes('zh'));
assert.ok(pack.headlamp.i18n.includes('zh-x-bbt'));

const dist = process.argv[2] ? packageDirectory : path.resolve(root, '../../../.plugins/headlamp-plus');
if (existsSync(path.join(dist, 'main.js'))) {
  assert.deepEqual(JSON.parse(readFileSync(path.join(dist, localePath), 'utf8')), locale);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dist, bilingualPath), 'utf8')), bilingual);
  const bundle = readFileSync(path.join(dist, 'main.js'), 'utf8');
  assert.doesNotMatch(bundle, /headlamp-plus-language-reloaded|i18nextLng|Select locale/);
}

console.log('简体中文文案与插值字段已校验：' + keys.size + '项');
