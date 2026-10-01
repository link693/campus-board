#!/usr/bin/env python3
"""建立远端仓库并推送本地历史。

`gh` 未登录时，GitHub 不允许通过 API 创建仓库，因此本脚本采用两条可用路径：

  A. 已登录 gh：自动 create → push → 开通 Pages（最省事）
  B. 未登录 gh：你在网页建好空仓库后，脚本负责配置远端并推送（本文件默认路径）

用法：
    python tools/push_to_github.py                     # 默认仓库名 campus-board
    python tools/push_to_github.py --name my-repo      # 指定仓库名
    python tools/push_to_github.py --report            # 只打印将要执行的命令，不执行

注意：网页建仓时必须保持**空仓库**（不要勾选 Add README / .gitignore / license），
否则远端会存在本地没有的提交，push 会被拒绝。
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OWNER_FALLBACK = "link693"


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    """执行命令并原样透传输出。"""
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=ROOT, check=check, text=True)


def capture(cmd: list[str]) -> str:
    try:
        out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=False)
        return (out.stdout or "").strip()
    except FileNotFoundError:
        return ""


def gh_available() -> bool:
    if not capture(["gh", "--version"]):
        return False
    status = subprocess.run(["gh", "auth", "status"], cwd=ROOT, capture_output=True, text=True)
    return status.returncode == 0


def ssh_auth_ok() -> tuple[bool, str]:
    out = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-T", "git@github.com"],
        cwd=ROOT, capture_output=True, text=True, check=False
    )
    text = (out.stderr or "") + (out.stdout or "")
    return ("successfully authenticated" in text), text.strip()


def gh_login() -> str:
    user = capture(["gh", "api", "user", "--jq", ".login"])
    return user or DEFAULT_OWNER_FALLBACK


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="建立远端仓库并推送")
    parser.add_argument("--name", default="campus-board", help="GitHub 仓库名")
    parser.add_argument("--owner", default=None, help="仓库所属账号，默认从 gh 或 SSH 推断")
    parser.add_argument("--report", action="store_true", help="只打印步骤，不实际执行")
    parser.add_argument("--description", default="校园活动板：面向在校学生的校园活动与机会平台",
                        help="仓库描述（仅在自动建仓时使用）")
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    owner = args.owner or (gh_login() if gh_available() else DEFAULT_OWNER_FALLBACK)
    full = f"{owner}/{args.name}"
    ssh_url = f"git@github.com:{full}.git"

    if not (ROOT / ".git").exists():
        print("当前目录不是 Git 仓库，请先 git init。", file=sys.stderr)
        return 1

    commits = capture(["git", "rev-list", "--count", "HEAD"])
    branch = capture(["git", "branch", "--show-current"]) or "main"
    print(f"本地：{commits} 个提交，当前分支 {branch}，目标远端 {ssh_url}\n")

    if args.report:
        print("将要执行：")
        print(f"  git remote add origin {ssh_url}   # 若尚无 origin")
        print(f"  git push -u origin {branch}")
        print(f"  gh api repos/{full}/pages -X POST -f source.branch={branch} -f source.path=/")
        return 0

    ok, detail = ssh_auth_ok()
    print(f"SSH 认证：{'可用' if ok else '不可用'}")
    if detail:
        print(f"  {detail.splitlines()[0] if detail.splitlines() else ''}")
    if not ok:
        print("\nSSH 未能通过 GitHub 认证，请先配置密钥，或改用 HTTPS 并登录 gh。", file=sys.stderr)
        return 1

    if gh_available():
        print("\n检测到 gh 已登录，尝试自动创建仓库…")
        exist = subprocess.run(["gh", "repo", "view", full], cwd=ROOT, capture_output=True, text=True)
        if exist.returncode == 0:
            print(f"仓库 {full} 已存在，直接推送。")
        else:
            created = subprocess.run(
                ["gh", "repo", "create", full, "--public", "--source", ".", "--remote", "origin",
                 "--description", args.description],
                cwd=ROOT, text=True
            )
            if created.returncode != 0:
                print("自动创建失败（可能是账号无权限或名称冲突），请改为在网页建仓后重跑本脚本。",
                      file=sys.stderr)
                return 1
    else:
        print("\ngh 未登录：请在 https://github.com/new 建一个**空仓库**"
              f"（名称 {args.name}，Public，不要勾选任何初始化文件），然后重新运行本脚本。")

    remotes = capture(["git", "remote"])
    if "origin" in remotes.split():
        run(["git", "remote", "set-url", "origin", ssh_url])
    else:
        run(["git", "remote", "add", "origin", ssh_url])

    pushed = subprocess.run(["git", "push", "-u", "origin", branch], cwd=ROOT, text=True)
    if pushed.returncode != 0:
        print("\n推送失败。常见原因：远端仓库不是空的（含 README / .gitignore），\n"
              "或仓库名与账号不符。请确认后重试，必要时先删除远端仓库重建。", file=sys.stderr)
        return 1

    print(f"\n推送完成：https://github.com/{full}")
    print("接下来可在仓库 Settings → Pages 中把 Source 设为 GitHub Actions，"
          "工作流会在推送后自动发布站点。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
