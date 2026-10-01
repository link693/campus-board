/* 统一测试入口：依次运行全部自动化测试，任一失败即返回非零退出码。
 *
 * 用法：node tests/run-all.js
 * 只依赖 Node 标准库，不引入任何测试框架。
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SUITES = [
  { file: "tests/logic.test.js", title: "领域逻辑（状态判定 / 筛选 / 可信度 / 时间线）" },
  { file: "tests/store.test.js", title: "本地状态持久化" },
  { file: "tests/dom-wiring.test.js", title: "界面接线与设计令牌约束" }
];

function line(char) {
  return char.repeat(60);
}

function main() {
  const results = [];

  for (const suite of SUITES) {
    const abs = path.join(ROOT, suite.file);
    if (!fs.existsSync(abs)) {
      results.push({ title: suite.title, ok: false, code: -1 });
      console.log(`\n${line("=")}\n${suite.title}\n${line("=")}\n文件不存在：${suite.file}`);
      continue;
    }

    console.log(`\n${line("=")}\n${suite.title}\n${line("=")}`);
    const run = spawnSync(process.execPath, [abs], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" }
    });
    results.push({ title: suite.title, ok: run.status === 0, code: run.status });
  }

  console.log(`\n${line("=")}\n汇总\n${line("=")}`);
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  通过  ${r.title}`);
    } else {
      failed++;
      console.log(`  失败  ${r.title}（退出码 ${r.code}）`);
    }
  }

  if (failed === 0) {
    console.log("\n全部测试套件通过。");
    return 0;
  }
  console.log(`\n有 ${failed} 个测试套件未通过。`);
  return 1;
}

process.exit(main());
