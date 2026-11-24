/*
 * 文件描述：将已审核的中文词库应用于固定版本的上游插件。
 * 项目名称：Headlamp BBT
 * 文件名称：localize.mjs
 * 作者：Codex、Qintsg
 * 日期：2026-11-23
 */

import { parse } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import MagicString from 'magic-string';
import { discoverPrometheus } from './prometheus.mjs';

const traverse = babelTraverse.default;
const bilingualTerms = new Set([
  'Application',
  'Applications',
  'Certificate',
  'Certificates',
  'Certificate Request',
  'Certificate Requests',
  'Challenge',
  'Challenges',
  'Cluster Issuer',
  'Cluster Issuers',
  'Cluster Policy Report',
  'Cluster Policy Reports',
  'Container',
  'Containers',
  'DataSource',
  'DataSources',
  'DataVolume',
  'DataVolumes',
  'Deployment',
  'Instance Types',
  'Issuer',
  'Issuers',
  'Job',
  'Jobs',
  'Namespace',
  'Namespaces',
  'Node',
  'Nodes',
  'Order',
  'Orders',
  'PersistentVolumeClaim',
  'PodGroup',
  'PodGroups',
  'Policy Report',
  'Policy Reports',
  'Project',
  'Projects',
  'Queue',
  'Queues',
  'Service',
  'Virtual Machine',
  'Virtual Machines',
  'VirtualMachine',
  'VirtualMachineInstance',
  'Workload',
  'Workloads',
]);

/**
 * 为适合双语显示的术语保留原来的英文名称。
 *
 * :param key: 英文文案。
 * :param chinese: 简体中文译文。
 * :returns: 双语界面使用的文案。
 */
export function bilingualText(key, chinese) {
  if (/\bPods?\b/i.test(key) && chinese.includes('容器组')) {
    return chinese.replace(/容器组(?!\(Pod\))/gu, '容器组(Pod)');
  }
  return bilingualTerms.has(key) && key !== chinese ? `${chinese} (${key})` : chinese;
}

/**
 * 构建时确认含有插值的模板使用相同的参数。
 *
 * :param label: 译文模板。
 * :param count: 原模板的参数数量。
 * :returns: 嵌入JavaScript的模板表达式。
 */
function renderTemplate(label, count) {
  const parts = label.split(/\$\{(\d+)\}/g);
  const indexes = parts.filter((_, index) => index % 2).map(Number);
  if (
    indexes.length !== count ||
    new Set(indexes).size !== count ||
    indexes.some(i => i >= count)
  ) {
    throw new Error(`插件译文插值不匹配：${label}`);
  }
  return (
    '`' +
    parts
      .map((part, index) =>
        index % 2
          ? '${values[' + part + ']}'
          : part.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')
      )
      .join('') +
    '`'
  );
}

/**
 * 替换上游版本中已审核的单一表达式，位置不匹配时终止构建。
 *
 * :param source: 原始代码。
 * :param code: 当前的代码编辑对象。
 * :param find: 需要精确匹配的表达式。
 * :param replacement: 新表达式。
 */
function replaceExpression(source, code, find, replacement) {
  const start = source.indexOf(find);
  const end = start + find.length;
  if (start < 0 || source.indexOf(find, end) >= 0 || code.slice(start, end) !== find) {
    throw new Error(`插件表达式与已审核版本不一致：${find}`);
  }
  code.overwrite(start, end, replacement);
}

/**
 * 给固定版本的发布包应用词库和BBT所需的API接线。
 *
 * :param name: 插件发布目录名。
 * :param source: 校验过的上游JS发布包。
 * :param dictionary: 中文词库和需要精确匹配的字符位置。
 * :param expressions: 动态状态的翻译表达式。
 * :returns: 可由Headlamp载入的插件包。
 */
export function localizeBundle(name, source, dictionary, expressions) {
  const ast = parse(source, { sourceType: 'unambiguous' });
  const code = new MagicString(source);
  const applied = new Map();
  const matches = [];

  /**
   * 记录显示文案的位置，保留属性键、路由比较和状态判断。
   *
   * :param occurrence: Babel字符串路径。
   * :param key: 英文文案。
   */
  function match(occurrence, key) {
    if (!Object.hasOwn(dictionary, key)) return;
    const { node, parentPath } = occurrence;
    const entry = dictionary[key];
    if (
      occurrence.key === 'key' ||
      (occurrence.key === 'property' && parentPath.isMemberExpression()) ||
      parentPath.isImportDeclaration() ||
      parentPath.isExportDeclaration() ||
      parentPath.isTaggedTemplateExpression()
    )
      return;
    if (typeof entry !== 'string') {
      if (!entry.at.includes(node.start)) return;
    } else if (
      parentPath.isBinaryExpression() ||
      (parentPath.isAssignmentExpression() && occurrence.key === 'right') ||
      (parentPath.isSwitchCase() && occurrence.key === 'test') ||
      (parentPath.isObjectProperty() && parentPath.node.computed)
    )
      return;
    matches.push({ key, node, chinese: typeof entry === 'string' ? entry : entry.zh });
    applied.set(key, [...(applied.get(key) ?? []), node.start]);
  }

  traverse(ast, {
    StringLiteral(path) {
      match(path, path.node.value);
    },
    TemplateLiteral(path) {
      const key = path.node.quasis
        .map((value, index) => (index ? '${' + (index - 1) + '}' : '') + value.value.cooked)
        .join('');
      match(path, key);
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        name === 'headlamp_argocd' &&
        callee.type === 'MemberExpression' &&
        callee.property.name === 'registerSidebarEntryFilter'
      ) {
        // 使用Headlamp的API发现结果，授权用户无需列出集群级CRD对象。
        code.overwrite(path.node.start, path.node.end, 'void 0');
      }
    },
  });

  for (const [key, entry] of Object.entries(dictionary)) {
    const positions = applied.get(key) ?? [];
    if (
      !positions.length ||
      (typeof entry !== 'string' && entry.at.some(p => !positions.includes(p)))
    ) {
      throw new Error(`${name}缺少已审核的词条：${key}`);
    }
  }
  for (const { key, node, chinese } of matches.sort((a, b) => b.node.start - a.node.start)) {
    const english = source.slice(node.start, node.end);
    const dual = bilingualText(key, chinese);
    let translated = JSON.stringify(chinese);
    if (node.type === 'TemplateLiteral') {
      const values = node.expressions.map(
        value => '`${(' + code.slice(value.start, value.end) + ')}`'
      );
      translated = `((...values)=>${renderTemplate(chinese, values.length)})(${values.join(',')})`;
    } else if (dual !== chinese) {
      translated = `(__BBT_DUAL__?${JSON.stringify(dual)}:${translated})`;
    }
    code.overwrite(node.start, node.end, `(__BBT_ZH__?${translated}:${english})`);
  }
  for (const { find, replacement } of expressions) {
    replaceExpression(source, code, find, replacement.replaceAll('__HEADLAMP_ZH__', '__BBT_ZH__'));
  }
  if (name === 'prometheus') {
    replaceExpression(
      source,
      code,
      'async function wt(){const e=await Pe("pods",ze);if(e.type!=="none")return e;const a=await Pe("services",ze);if(a.type!=="none")return a;const r=await Pe("pods",kt);if(r.type!=="none")return r;const l=await Pe("services",Pt);return l.type!=="none"?l:Ie()}',
      'async function wt(cluster){return (' + discoverPrometheus.toString() + ')(Xe,cluster)}'
    );
    replaceExpression(source, code, 'const r=await wt();', 'const r=await wt(e);');
    replaceExpression(
      source,
      code,
      'return!e||!r?null:r[e]||null',
      'return e?(r?.[e]??{autoDetect:true}):null'
    );
  }
  const afterDirectives = ast.program.directives.at(-1)?.end ?? 0;
  code.appendLeft(
    afterDirectives,
    ';\nconst __BBT_DUAL__=window.headlampBbtPluginLocale==="zh-x-bbt",__BBT_ZH__=__BBT_DUAL__||window.headlampBbtPluginLocale==="zh";\n'
  );
  const result = code.toString();
  parse(result, { sourceType: 'unambiguous' });
  return result;
}
