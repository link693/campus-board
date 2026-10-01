#!/usr/bin/env python3
"""为静态资源写入版本号，解决浏览器与 CDN 缓存导致"改了却看不到"的问题。

做法：
    根据 css/js 文件内容计算短哈希，写进 data/asset-version.json，
    并把 index.html 中引用的 css/js 追加 ?v=<哈希> 查询串。
    文件内容一变，查询串就变，浏览器必须重新拉取。

用法：
    python tools/stamp_assets.py            # 写入版本号并更新 index.html
    python tools/stamp_assets.py --check    # 只检查版本号是否与当前内容一致
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
VERSION_FILE = ROOT / "data" / "asset-version.json"

# 参与版本计算的文件（顺序固定，保证哈希稳定）
TRACKED = [
    "css/tokens.css",
    "css/app.css",
    "js/data.js",
    "js/logic.js",
    "js/store.js",
    "js/ui.js",
    "js/main.js",
]


def compute_version() -> tuple[str, dict]:
    digest = hashlib.sha256()
    parts = {}
    for rel in TRACKED:
        path = ROOT / rel
        if not path.exists():
            raise SystemExit(f"缺少文件：{rel}")
        raw = path.read_bytes()
        digest.update(rel.encode("utf-8"))
        digest.update(raw)
        parts[rel] = hashlib.sha256(raw).hexdigest()[:8]
    return digest.hexdigest()[:10], parts


def update_index(version: str) -> int:
    """把 css/js 引用统一改写为 <path>?v=<version>，返回改写的引用数。"""
    html = INDEX.read_text(encoding="utf-8")
    changed = 0

    def repl(match: re.Match) -> str:
        nonlocal changed
        attr, path = match.group(1), match.group(2)
        # docs/ 与 data/ 下的文档链接不参与缓存版本控制
        if path.endswith(".md") or path.startswith("docs/") or path.startswith("data/"):
            return match.group(0)
        new = f'{attr}="{path}?v={version}"'
        if match.group(0) != new:
            changed += 1
        return new

    # 捕获路径时不吞掉已有的查询串，改由替换统一重写，避免出现 ?v=a?v=b
    pattern = re.compile(r'(href|src)="((?:css|js)/[^"?]+)(?:\?[^"]*)?"')
    html = pattern.sub(repl, html)
    INDEX.write_text(html, encoding="utf-8", newline="\n")
    return changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="写入静态资源版本号")
    parser.add_argument("--check", action="store_true", help="只校验版本号是否最新")
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    version, parts = compute_version()
    html = INDEX.read_text(encoding="utf-8")

    if args.check:
        recorded = None
        if VERSION_FILE.exists():
            recorded = json.loads(VERSION_FILE.read_text(encoding="utf-8")).get("version")
        stale = version != recorded
        unversioned = re.findall(r'(?:href|src)="(?:css|js)/[^"?]+"', html)
        if stale or unversioned:
            print(f"资源版本号不是最新：记录={recorded} 实际={version}", file=sys.stderr)
            if unversioned:
                print(f"index.html 中有 {len(unversioned)} 处引用没有版本号：{unversioned[:3]}",
                      file=sys.stderr)
            print("请运行：python tools/stamp_assets.py", file=sys.stderr)
            return 1
        print(f"资源版本号已是最新：{version}")
        return 0

    changed = update_index(version)
    VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    VERSION_FILE.write_text(
        json.dumps({"version": version, "files": parts}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8", newline="\n"
    )
    print(f"资源版本号：{version}")
    print(f"index.html 更新引用：{changed} 处")
    for rel, h in parts.items():
        print(f"  {rel}  {h}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
