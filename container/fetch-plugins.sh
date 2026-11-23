#!/bin/sh -e
# 文件描述：为给定目录生成Headlamp BBT随附插件。
# 项目名称：Headlamp BBT
# 文件名称：fetch-plugins.sh
# 作者：Codex
# 日期：2026-11-23

DESTDIR=$1

if [ -z "$DESTDIR" ]; then
  echo "Usage: $0 <destdir>"
  exit 1
fi

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
exec node "$SCRIPT_DIR/../plugins/bbt/bundled/prepare.mjs" "$DESTDIR"
