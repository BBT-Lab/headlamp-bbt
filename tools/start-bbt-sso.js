/*
 * 文件描述：在本机以BBT单点登录模式运行Headlamp。
 * 项目名称：Headlamp BBT
 * 文件名称：start-bbt-sso.js
 * 作者：Codex
 * 日期：2026-11-19
 */

const { readFileSync, statSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');

/**
 * 读取SSO环境变量并在回环地址运行Headlamp本机网页。
 *
 * :returns: 无返回值。
 */
function main() {
  const root = resolve(__dirname, '..');
  const path = resolve(root, '.env.bbt-sso.local');
  const localConfig = parseEnv(readFileSync(path, 'utf8'));
  const env = { ...localConfig, ...process.env };
  env.HEADLAMP_STATIC_PLUGINS_DIR ??= resolve(root, '.plugins');
  env.HEADLAMP_CONFIG_USER_PLUGINS_DIR ??= resolve(root, '.plugins-user');
  env.NO_PROXY = [process.env.NO_PROXY, process.env.no_proxy, '.bbt.sspu.edu.cn']
    .filter(Boolean)
    .join(',');
  for (const key of [
    'HEADLAMP_CONFIG_OIDC_CLIENT_ID',
    'HEADLAMP_CONFIG_OIDC_CLIENT_SECRET',
    'HEADLAMP_CONFIG_OIDC_IDP_ISSUER_URL',
    'HEADLAMP_CONFIG_RANCHER_URL',
    'HEADLAMP_CONFIG_OIDC_CALLBACK_URL',
    'HEADLAMP_CONFIG_IN_CLUSTER_CONTEXT_NAME',
  ]) {
    if (!env[key]?.trim()) {
      throw new Error(`${path}缺少${key}`);
    }
  }

  const staticDir = resolve(root, 'frontend/build');
  statSync(resolve(staticDir, 'index.html'));
  const child = spawnSync(process.execPath, [
    resolve(__dirname, 'run-backend.js'),
    '-listen-addr=127.0.0.1',
    '-port=4466',
    `-html-static-dir=${staticDir}`,
  ], { cwd: root, env, stdio: 'inherit' });
  if (child.error) {
    throw child.error;
  }
  process.exitCode = child.status ?? 1;
}

main();
