#!/bin/bash
# 文件描述：将已校验的Headlamp OCI归档导入Harbor。
# 项目名称：Headlamp BBT
# 文件名称：import-image.sh
# 作者：Codex
# 日期：2026-11-14
set -euo pipefail

archive=/work/headlamp-image.oci.tar
if [[ ! -f "$archive" ]]; then
    exit 0
fi

tag=$(cat /work/release)
expected=$(cat /work/headlamp-image.digest)
source_digest=$(skopeo inspect --raw "oci-archive:$archive" | sha256sum)
if [[ "sha256:${source_digest%% *}" != "$expected" ]]; then
    echo "OCI镜像清单摘要不匹配：$tag" >&2
    exit 1
fi

skopeo copy --all --preserve-digests \
    --dest-authfile /registry-auth/auth.json \
    --dest-cert-dir /registry-certs \
    --digestfile /work/harbor.digest \
    "oci-archive:$archive" \
    "docker://harbor.bbt.sspu.edu.cn/sspu/headlamp-bbt:$tag"

[[ $(cat /work/harbor.digest) == "$expected" ]]
echo "Harbor镜像已导入：$tag@$expected"
