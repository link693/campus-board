"""从考核题目 DOCX 中提取全部文字与表格，输出为纯文本以便结构化。

用法：
    python tools/extract_docx.py --input <题目.docx> --output data/raw_source.txt

说明：
    - 该脚本是数据链路的**第一步**，只做提取，不做任何解释或补全；
    - 提取结果 `data/raw_source.txt` 作为唯一事实来源（source of truth）存档，
      后续 build_dataset.py 只允许引用其中的内容，不允许引入外部事实。
"""

from __future__ import annotations

import argparse
import io
import sys

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

DEFAULT_INPUT = r"C:\Users\74921\Downloads\计算机协会软件部2026年秋季纳新第二轮考核题目.docx"
DEFAULT_OUTPUT = r"data/raw_source.txt"


def iter_blocks(parent):
    """按文档顺序遍历段落与表格。"""
    for child in parent.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def extract(path: str) -> str:
    doc = Document(path)
    lines: list[str] = []
    n = 0

    for block in iter_blocks(doc):
        if isinstance(block, Paragraph):
            text = block.text.rstrip()
            if text:
                n += 1
                lines.append(f"{n:03d}|{text}")
            else:
                lines.append("")
        else:
            n += 1
            lines.append(f"{n:03d}|=== TABLE {len(block.rows)}x{len(block.columns)} ===")
            for ri, row in enumerate(block.rows):
                cells = [
                    " ".join(p.text.strip() for p in cell.paragraphs if p.text.strip())
                    for cell in row.cells
                ]
                lines.append(f"R{ri:02d}|| " + " || ".join(cells))
            lines.append("=== END TABLE ===")

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="提取考核题目 DOCX 的全部文字与表格")
    parser.add_argument("--input", default=DEFAULT_INPUT, help="题目 DOCX 路径")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="输出文本路径")
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    text = extract(args.input)
    with io.open(args.output, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)

    print(f"已提取 {len(text)} 字符 -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
