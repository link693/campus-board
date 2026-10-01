#!/usr/bin/env python3
"""本地静态服务器，用于预览 GitHub Pages 形态的站点。

为什么需要它：
    直接双击 index.html 已经可以完整使用（零依赖），
    但 Pages 会以子路径形式发布（例如 https://<用户>.github.io/campus-board/），
    用 HTTP 预览可以提前确认子路径下的资源、相对链接与运行时行为都正常。

用法：
    python tools/serve.py                # 默认 127.0.0.1:8080，从仓库根目录提供
    python tools/serve.py --port 9000
    python tools/serve.py --prefix campus-board   # 模拟子路径部署
"""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """保留 SimpleHTTPRequestHandler 的行为，只让日志更简洁。"""

    def log_message(self, fmt: str, *args) -> None:  # noqa: D102
        sys.stdout.write(f"  {self.address_string()} - {fmt % args}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="本地预览静态站点")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址")
    parser.add_argument("--port", type=int, default=8080, help="监听端口")
    parser.add_argument("--prefix", default="", help="模拟的子路径前缀，例如 campus-board")
    parser.add_argument("--directory", default=str(ROOT), help="提供服务的目录")
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    directory = Path(args.directory).resolve()
    if not (directory / "index.html").exists():
        print(f"目录中没有 index.html：{directory}", file=sys.stderr)
        return 1

    handler = functools.partial(QuietHandler, directory=str(directory))

    prefix = args.prefix.strip("/")
    url = f"http://{args.host}:{args.port}/" + (f"{prefix}/" if prefix else "")

    with socketserver.TCPServer((args.host, args.port), handler) as httpd:
        httpd.allow_reuse_address = True
        print("校园活动板 · 本地预览")
        print(f"  目录：{directory}")
        print(f"  地址：{url}")
        if prefix:
            print(f"  提示：请通过上面的子路径访问，以模拟 GitHub Pages 的发布形态。")
        print("  按 Ctrl+C 停止。\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
