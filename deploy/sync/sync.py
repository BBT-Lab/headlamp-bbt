"""同步GitHub仓库和Release到BBT GitLab。

项目名称：Headlamp BBT
文件名称：sync.py
作者：Codex
日期：2026-11-14
"""

import base64
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

GITHUB = "https://api.github.com/repos/BBT-Lab/headlamp-bbt"
GITLAB = "https://git.bbt.sspu.edu.cn/api/v4/projects/114"
GITHUB_REPO = "https://github.com/BBT-Lab/headlamp-bbt.git"
GITLAB_REPO = "https://git.bbt.sspu.edu.cn/Qintsg/headlamp-bbt.git"
CACHE = Path("/data/repository.git")
PRODUCTION_BRANCH = "bbt-production"
PRODUCTION_FILE = "production/headlamp.yaml"
RELEASE_TAG = re.compile(r"v\d+\.\d+\.\d+-bbt-\d{10}")


def api(
    url: str, token: str, method: str = "GET", body: dict[str, Any] | None = None
) -> Any:
    """调用GitHub或GitLab API。

    :param url: 完整API地址。
    :param token: API访问令牌。
    :param method: HTTP方法。
    :param body: JSON请求体。
    :return: 解析后的JSON。
    """
    headers = {"User-Agent": "headlamp-bbt-sync", "Accept": "application/json"}
    if url.startswith(GITLAB):
        headers["PRIVATE-TOKEN"] = token
    else:
        headers["Authorization"] = f"Bearer {token}"
        headers["Accept"] = "application/vnd.github+json"
    payload = None if body is None else json.dumps(body).encode("utf-8")
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=payload, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def pages(url: str, token: str) -> list[dict[str, Any]]:
    """读取分页API中的全部项目。

    :param url: 支持page和per_page参数的API地址。
    :param token: API访问令牌。
    :return: 全部分页结果。
    """
    result: list[dict[str, Any]] = []
    page = 1
    while True:
        separator = "&" if "?" in url else "?"
        items = api(f"{url}{separator}per_page=100&page={page}", token)
        if not isinstance(items, list):
            raise TypeError(f"分页接口未返回列表：{url}")
        result.extend(items)
        if len(items) < 100:
            return result
        page += 1


def git(args: list[str], env: dict[str, str]) -> None:
    """在本地缓存仓库运行Git。

    :param args: Git参数。
    :param env: 子进程环境变量。
    :return: 无返回值。
    """
    subprocess.run(["git", "-C", str(CACHE), *args], env=env, check=True)


def sync_git(token: str) -> None:
    """同步分支和标签，保留GitLab已有的独立引用。

    :param token: GitLab项目访问令牌。
    :return: 无返回值。
    """
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    credential = base64.b64encode(f"oauth2:{token}".encode()).decode()
    env["GIT_CONFIG_COUNT"] = "1"
    env["GIT_CONFIG_KEY_0"] = "http.https://git.bbt.sspu.edu.cn/.extraheader"
    env["GIT_CONFIG_VALUE_0"] = f"Authorization: Basic {credential}"
    if not (CACHE / "HEAD").exists():
        subprocess.run(
            ["git", "init", "--bare", "--initial-branch=main", str(CACHE)],
            env=env,
            check=True,
        )
    git(
        [
            "fetch",
            "--prune",
            GITHUB_REPO,
            "+refs/heads/*:refs/heads/*",
            "+refs/tags/*:refs/tags/*",
        ],
        env,
    )
    git(["push", GITLAB_REPO, "--all"], env)
    git(["push", GITLAB_REPO, "--tags"], env)


def upload_asset(
    release: dict[str, Any], asset: dict[str, Any], gitlab_token: str
) -> str:
    """复制Release附件到GitLab通用软件包仓库。

    :param release: GitHub Release信息。
    :param asset: GitHub附件信息。
    :param gitlab_token: GitLab项目令牌。
    :return: GitLab附件地址。
    """
    tag = release["tag_name"]
    name = asset["name"]
    if Path(name).name != name or not name:
        raise ValueError("附件名称无效")
    encoded_tag = urllib.parse.quote(tag, safe="")
    encoded_name = urllib.parse.quote(name, safe="")
    package_url = f"{GITLAB}/packages/generic/headlamp-bbt/{encoded_tag}/{encoded_name}"
    query = urllib.parse.urlencode(
        {
            "package_type": "generic",
            "package_name": "headlamp-bbt",
            "package_version": tag,
        }
    )
    packages = pages(f"{GITLAB}/packages?{query}", gitlab_token)
    files: list[dict[str, Any]] = []
    for package in packages:
        if package["name"] == "headlamp-bbt" and package["version"] == tag:
            files.extend(
                pages(f"{GITLAB}/packages/{package['id']}/package_files", gitlab_token)
            )

    matches = [item for item in files if item["file_name"] == name]
    source_digest = asset.get("digest")
    if (
        matches
        and source_digest
        and all(
            source_digest == f"sha256:{item.get('file_sha256')}" for item in matches
        )
    ):
        return package_url

    with tempfile.TemporaryDirectory(dir="/data") as directory:
        file_path = Path(directory) / name
        request = urllib.request.Request(
            asset["browser_download_url"], headers={"User-Agent": "headlamp-bbt-sync"}
        )
        with (
            urllib.request.urlopen(request, timeout=300) as response,
            file_path.open("wb") as file,
        ):
            shutil.copyfileobj(response, file)
        with file_path.open("rb") as file:
            digest = hashlib.file_digest(file, "sha256").hexdigest()
        if file_path.stat().st_size != asset["size"]:
            raise ValueError(f"附件大小不一致：{name}")
        if asset.get("digest") and asset["digest"] != f"sha256:{digest}":
            raise ValueError(f"GitHub附件摘要不一致：{name}")
        if matches:
            if any(item.get("file_sha256") != digest for item in matches):
                raise ValueError(f"GitLab已有同名但内容不同的附件：{name}")
        else:
            with file_path.open("rb") as file:
                request = urllib.request.Request(
                    package_url,
                    data=file,
                    method="PUT",
                    headers={
                        "PRIVATE-TOKEN": gitlab_token,
                        "Content-Length": str(file_path.stat().st_size),
                        "Content-Type": "application/octet-stream",
                    },
                )
                with urllib.request.urlopen(request, timeout=300) as response:
                    if response.status != 201:
                        raise RuntimeError(
                            f"附件上传失败：{name} HTTP {response.status}"
                        )
    return package_url


def publish_production(tag: str, asset_url: str, token: str) -> None:
    """将最新正式版的部署清单发布到Argo CD跟踪的分支。

    :param tag: 已同步的发布标签。
    :param asset_url: GitLab软件包中的部署清单地址。
    :param token: GitLab项目令牌。
    :return: 无返回值。
    """
    request = urllib.request.Request(asset_url, headers={"PRIVATE-TOKEN": token})
    with urllib.request.urlopen(request, timeout=120) as response:
        manifest = response.read()
    digest = hashlib.sha256(manifest).hexdigest()
    filter_query = urllib.parse.urlencode({"search": f"^{PRODUCTION_BRANCH}$"})
    branches = pages(f"{GITLAB}/repository/branches?{filter_query}", token)
    action = {
        "action": "create",
        "file_path": PRODUCTION_FILE,
        "content": base64.b64encode(manifest).decode("ascii"),
        "encoding": "base64",
    }
    body = {
        "branch": PRODUCTION_BRANCH,
        "commit_message": f"deploy: 发布Headlamp BBT {tag}",
        "actions": [action],
    }
    if any(branch["name"] == PRODUCTION_BRANCH for branch in branches):
        file_path = urllib.parse.quote(PRODUCTION_FILE, safe="")
        current = api(
            f"{GITLAB}/repository/files/{file_path}?ref={PRODUCTION_BRANCH}", token
        )
        if current["content_sha256"] == digest:
            return
        action["action"] = "update"
        action["last_commit_id"] = current["last_commit_id"]
    else:
        body["start_branch"] = "main"
    api(f"{GITLAB}/repository/commits", token, "POST", body)
    print(f"已更新Argo CD部署分支：{tag}", flush=True)


def sync_releases(github_token: str, gitlab_token: str) -> None:
    """同步已发布的Release、附件和说明。

    :param github_token: GitHub只读令牌。
    :param gitlab_token: GitLab项目令牌。
    :return: 无返回值。
    """
    source = pages(f"{GITHUB}/releases", github_token)
    existing = {
        item["tag_name"]: item for item in pages(f"{GITLAB}/releases", gitlab_token)
    }
    production = max(
        (
            release
            for release in source
            if not release["draft"]
            and not release["prerelease"]
            and RELEASE_TAG.fullmatch(release["tag_name"])
        ),
        key=lambda release: (release["published_at"], release["id"]),
        default=None,
    )
    production_asset = None
    for release in source:
        if release["draft"]:
            continue
        tag = release["tag_name"]
        description = release["body"] or ""
        if release["prerelease"]:
            description = f"预发布版本\n\n{description}"
        payload = {
            "name": release["name"] or tag,
            "description": description,
            "released_at": release["published_at"],
        }
        encoded_tag = urllib.parse.quote(tag, safe="")
        links = []
        for asset in pages(release["assets_url"], github_token):
            if asset["state"] != "uploaded":
                raise ValueError(f"附件尚未上传完成：{asset['name']}")
            links.append(
                {
                    "name": asset["name"],
                    "url": upload_asset(release, asset, gitlab_token),
                    "link_type": "package",
                }
            )
        if tag not in existing:
            api(
                f"{GITLAB}/releases",
                gitlab_token,
                "POST",
                {**payload, "tag_name": tag, "assets": {"links": links}},
            )
        else:
            current = existing[tag]
            current_date = datetime.datetime.fromisoformat(current["released_at"])
            source_date = datetime.datetime.fromisoformat(payload["released_at"])
            if (
                current["name"] != payload["name"]
                or current["description"] != payload["description"]
                or current_date != source_date
            ):
                api(f"{GITLAB}/releases/{encoded_tag}", gitlab_token, "PUT", payload)
            present = {item["name"]: item for item in current["assets"]["links"]}
            for link in links:
                if link["name"] not in present:
                    api(
                        f"{GITLAB}/releases/{encoded_tag}/assets/links",
                        gitlab_token,
                        "POST",
                        link,
                    )
                elif present[link["name"]]["url"] != link["url"]:
                    raise ValueError(f"GitLab已有不同地址的同名附件：{link['name']}")
        print(f"Release已同步：{tag}", flush=True)
        if release is production:
            production_asset = next(
                (link["url"] for link in links if link["name"] == "headlamp.yaml"),
                None,
            )
    if production is not None:
        if production_asset is None:
            raise ValueError(f"正式版缺少部署清单：{production['tag_name']}")
        publish_production(production["tag_name"], production_asset, gitlab_token)


def main() -> None:
    """运行一次仓库和Release同步。

    :return: 无返回值。
    """
    github_token = os.environ["GITHUB_TOKEN"]
    gitlab_token = os.environ["GITLAB_TOKEN"]
    sync_git(gitlab_token)
    sync_releases(github_token, gitlab_token)
    print("同步完成", flush=True)


if __name__ == "__main__":
    main()
