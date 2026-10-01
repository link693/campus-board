"""校验 activities.json 与题目原始材料的一致性，并生成前端数据文件。

这个脚本回答三个问题：
1. 结构是否合法（必填字段、时间格式、关系链是否闭环）；
2. 是否**没有编造**——每条条目的 rawSummary 必须能在题目原文中找到依据；
3. 是否**没有遗漏**——原题 26 条信息全部被覆盖，既不重复也不丢失。

用法：
    python tools/build_dataset.py            # 校验 + 生成 js/data.js
    python tools/build_dataset.py --check    # 只校验，不写文件
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACTIVITIES = ROOT / "data" / "activities.json"
RAW_SOURCE = ROOT / "data" / "raw_source.txt"
OUT_JS = ROOT / "js" / "data.js"

REQUIRED_TOP = {"id", "sourceRef", "relatedRefs", "rawSummary", "title", "source", "category",
                "tags", "summary", "detail", "registration", "schedule", "eligibility",
                "capacity", "missingFields", "riskFlags", "updates"}
REQUIRED_REG = {"required", "deadlineAt", "deadlineText", "method"}
REQUIRED_SCHED = {"firstSessionAt", "startDateText", "timeText", "recurrence", "location"}
REQUIRED_SRC = {"type", "label", "publisher"}
VALID_SOURCE_TYPES = {"school", "college", "association", "student", "unspecified"}
VALID_RISK_LEVELS = {"info", "attention", "suspicious"}

errors: list[str] = []
warnings: list[str] = []
RAW_TITLES: dict[str, str] = {}


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def parse_raw_source() -> tuple[dict[str, str], str]:
    """解析 raw_source.txt，返回 {编号: 原始行} 与全文。"""
    text = RAW_SOURCE.read_text(encoding="utf-8")
    rows: dict[str, str] = {}
    titles: dict[str, str] = {}
    for line in text.splitlines():
        if not line.startswith("R"):
            continue
        cells = [c.strip() for c in line.split("||")]
        # 实际结构为：R{行号}、编号列、标题、主要内容 —— 共 4 段
        # （编号列在源文档中重复出现一次，解析时以 R 后的行号为准）
        if len(cells) != 4:
            continue
        ref = cells[0][1:].strip()
        if not ref.isdigit() or ref == "00":
            continue
        titles[ref] = cells[2]
        rows[ref] = cells[3]
    RAW_TITLES.clear()
    RAW_TITLES.update(titles)
    return rows, text


def is_iso8601(value: str) -> bool:
    try:
        datetime.fromisoformat(value)
        return True
    except ValueError:
        return False


def collect_timestamps(obj, path: str = "") -> list[tuple[str, str]]:
    """递归收集所有形如 2026-xx-xxT.. 的时间字段。"""
    found: list[tuple[str, str]] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            found.extend(collect_timestamps(value, f"{path}.{key}"))
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            found.extend(collect_timestamps(value, f"{path}[{i}]"))
    elif isinstance(obj, str) and re.match(r"^\d{4}-\d{2}-\d{2}T", obj):
        found.append((path, obj))
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="校验并构建校园活动数据集")
    parser.add_argument("--check", action="store_true", help="只校验，不生成 js/data.js")
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    data = json.loads(ACTIVITIES.read_text(encoding="utf-8"))
    meta = data.get("meta", {})
    activities = data.get("activities", [])
    raw_rows, raw_text = parse_raw_source()

    if not raw_rows:
        err("raw_source.txt 中未解析到任何信息行，请先运行 tools/extract_docx.py")

    # ---------- 1. 结构校验 ----------
    seen_ids: set[str] = set()
    seen_refs: list[str] = []

    for act in activities:
        aid = act.get("id", "<无 id>")
        missing = REQUIRED_TOP - set(act)
        if missing:
            err(f"[{aid}] 缺少顶层字段: {sorted(missing)}")
            continue
        if aid in seen_ids:
            err(f"[{aid}] id 重复")
        seen_ids.add(aid)
        seen_refs.append(act["sourceRef"])

        reg = act["registration"]
        if REQUIRED_REG - set(reg):
            err(f"[{aid}] registration 缺少字段: {sorted(REQUIRED_REG - set(reg))}")
        sched = act["schedule"]
        if REQUIRED_SCHED - set(sched):
            err(f"[{aid}] schedule 缺少字段: {sorted(REQUIRED_SCHED - set(sched))}")
        src = act["source"]
        if REQUIRED_SRC - set(src):
            err(f"[{aid}] source 缺少字段: {sorted(REQUIRED_SRC - set(src))}")
        if src.get("type") not in VALID_SOURCE_TYPES:
            err(f"[{aid}] source.type 非法: {src.get('type')}")

        for flag in act["riskFlags"]:
            if flag.get("level") not in VALID_RISK_LEVELS:
                err(f"[{aid}] riskFlags.level 非法: {flag.get('level')}")
            if not flag.get("detail"):
                err(f"[{aid}] riskFlags 缺少 detail，必须说明判定理由")

        for path, value in collect_timestamps(act):
            if not is_iso8601(value):
                err(f"[{aid}] 时间格式非法 {path}={value}")

        # 状态色不得由装饰性字段决定：确保没有写死的人类可读状态文案
        if "statusText" in act or "status" in act:
            err(f"[{aid}] 数据中不应包含写死的 status/statusText，状态必须由基准日实时计算")

        elig = act["eligibility"]
        gr = elig.get("gradeRange")
        if gr is not None:
            if not (isinstance(gr, list) and len(gr) == 2 and 1 <= gr[0] <= gr[1] <= 4):
                err(f"[{aid}] gradeRange 非法: {gr}")

    # ---------- 2. 关系链闭环 ----------
    ref_index: dict[str, str] = {}
    for act in activities:
        ref_index[act["sourceRef"]] = act["id"]
    for act in activities:
        for ref in act["relatedRefs"]:
            if ref not in raw_rows:
                err(f"[{act['id']}] relatedRefs 引用了不存在的原始编号: {ref}")
            if ref == act["sourceRef"]:
                err(f"[{act['id']}] relatedRefs 不应包含自身编号 {ref}")

    # ---------- 3. 不编造：rawSummary 必须能在原文中定位 ----------
    for act in activities:
        ref = act["sourceRef"]
        raw_line = raw_rows.get(ref)
        if raw_line is None:
            err(f"[{act['id']}] sourceRef={ref} 在题目原文中不存在")
            continue
        if act["rawSummary"].strip() != raw_line.strip():
            err(f"[{act['id']}] rawSummary 与原文 {ref} 不一致，可能存在改写或编造\n"
                f"      原文: {raw_line}\n      数据: {act['rawSummary']}")
        raw_title = RAW_TITLES.get(ref, "")
        if raw_title and raw_title not in act["title"]:
            err(f"[{act['id']}] 标题偏离原文 {ref}：原文标题「{raw_title}」未出现在数据标题「{act['title']}」中")
        for ref2 in act["relatedRefs"]:
            line2 = raw_rows.get(ref2, "")
            if line2 and act["rawSummary"].strip() == line2.strip():
                err(f"[{act['id']}] 与 {ref2} 的 rawSummary 相同，疑似重复条目未合并")

    # ---------- 4. 不遗漏：26 条全部覆盖 ----------
    all_refs = set(seen_refs) | {r for act in activities for r in act["relatedRefs"]}
    missing_refs = sorted(set(raw_rows) - all_refs)
    if missing_refs:
        err(f"题目原文中有 {len(missing_refs)} 条信息未被任何条目覆盖: {missing_refs}")

    dup_refs = [r for r in seen_refs if seen_refs.count(r) > 1]
    if dup_refs:
        err(f"sourceRef 被多个条目重复使用: {sorted(set(dup_refs))}")

    if meta.get("rawRecordCount") != len(raw_rows):
        err(f"meta.rawRecordCount={meta.get('rawRecordCount')} 与实际原文条数 {len(raw_rows)} 不符")
    if meta.get("activityCount") != len(activities):
        err(f"meta.activityCount={meta.get('activityCount')} 与实际条目数 {len(activities)} 不符")

    # 基准日校验
    baseline = meta.get("baselineDate", "")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", baseline):
        err(f"meta.baselineDate 格式应为 YYYY-MM-DD，实际为 {baseline!r}")

    # ---------- 5. 提示级检查 ----------
    suspicious = [a["id"] for a in activities
                  if any(f["level"] == "suspicious" for f in a["riskFlags"])]
    if not suspicious:
        warn("没有识别出任何可疑信息，题目材料中确实存在推广类内容，请确认是否遗漏")
    for act in activities:
        if act["missingFields"] and not act["registration"].get("deadlineText"):
            warn(f"[{act['id']}] 存在缺失字段但未说明报名时间状态")

    # ---------- 输出 ----------
    print(f"原始信息条数: {len(raw_rows)}")
    print(f"结构化条目数: {len(activities)}")
    print(f"涉及来源类型: {sorted({a['source']['type'] for a in activities})}")
    print(f"可疑信息条目: {suspicious or '无'}")
    print(f"有变更记录的条目: {[a['id'] for a in activities if a['updates']] or '无'}")
    print(f"字段缺失条目数: {sum(1 for a in activities if a['missingFields'])}")

    for w in warnings:
        print(f"[警告] {w}")

    if errors:
        print(f"\n校验失败，共 {len(errors)} 个问题：", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print("\n校验通过：结构合法、关系链闭环、无编造、无遗漏。")

    if args.check:
        return 0

    # ---------- 生成 js/data.js ----------
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(
        "/* 该文件由 tools/build_dataset.py 自动生成，请勿手动修改。\n"
        "   数据源：data/activities.json（由 data/raw_source.txt 结构化而来）。\n"
        "   生成为 JS 常量而非 JSON 文件，是为了让 index.html 在 file:// 协议下也能直接打开。 */\n"
        f"window.CAMPUS_DATA = {payload};\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"已生成 {OUT_JS.relative_to(ROOT)}（{len(payload)} 字节）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
