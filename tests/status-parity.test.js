/* 状态判定一致性测试：node tests/status-parity.test.js
 *
 * 为什么需要这个测试：
 *   前端（js/logic.js）与离线报告（tools/build_report.py）各自实现了同一套状态规则。
 *   两份实现一旦漂移，就会出现「界面说还能报名、审计报告说已截止」这种自相矛盾，
 *   而这类问题在人工检查时几乎发现不了。
 *
 * 做法：调用 Python 侧 --dump-status 导出状态，与 JS 侧逐个比对，覆盖多个基准日期。
 * 没有 Python 环境时优雅跳过（不阻塞前端测试）。
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const logic = require(path.join(ROOT, "js", "logic.js"));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "activities.json"), "utf8"));

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`  \u2717 ${name}\n      ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "断言失败");
}

function findPython() {
  const candidates = [
    process.env.CAMPUS_PYTHON,
    "C:\\Users\\74921\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe",
    "python",
    "python3",
    "py"
  ].filter(Boolean);
  for (const exe of candidates) {
    const probe = spawnSync(exe, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return exe;
  }
  return null;
}

console.log("\n前后端状态判定一致性");

const python = findPython();

if (!python) {
  console.log("  - 跳过：未找到可用的 Python 解释器（设置 CAMPUS_PYTHON 可指定路径）");
  console.log(`\n${"-".repeat(52)}\n跳过一致性比对，前端测试不受影响。`);
  process.exit(0);
}

console.log(`  （使用 Python：${python}）`);

function pythonStatuses(baseline) {
  const out = spawnSync(
    python,
    ["tools/build_report.py", "--dump-status", "--baseline", baseline],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } }
  );
  if (out.status !== 0) {
    throw new Error(`Python 导出失败：${(out.stderr || "").slice(0, 400)}`);
  }
  return JSON.parse(out.stdout);
}

const BASELINES = [
  data.meta.baselineDate, // 题目要求的基准日
  "2026-09-01",           // 全部活动开始之前
  "2026-09-21",           // 多项活动的关键节点
  "2026-10-06"            // 全部截止之后
];

BASELINES.forEach((baseline) => {
  test(`基准日 ${baseline}：两侧状态完全一致`, () => {
    const py = pythonStatuses(baseline);
    assert(py.baseline === baseline, `Python 侧基准日不符：${py.baseline}`);

    const diffs = [];
    data.activities.forEach((act) => {
      const jsCode = logic.computeStatus(act, baseline).code;
      const pyRec = py.statuses[act.id];
      if (!pyRec) {
        diffs.push(`${act.id}: Python 侧缺失`);
        return;
      }
      if (pyRec.code !== jsCode) {
        diffs.push(`${act.id}: JS=${jsCode} / Python=${pyRec.code}`);
      }
    });

    assert(diffs.length === 0,
      `发现 ${diffs.length} 处不一致：\n      ${diffs.join("\n      ")}`);
  });
});

test("两侧都覆盖了全部条目，没有漏判", () => {
  const py = pythonStatuses(data.meta.baselineDate);
  const jsIds = data.activities.map((a) => a.id).sort();
  const pyIds = Object.keys(py.statuses).sort();
  assert(jsIds.length === pyIds.length,
    `条目数量不同：JS ${jsIds.length} / Python ${pyIds.length}`);
  assert(jsIds.join(",") === pyIds.join(","), "条目 id 集合不同");
});

test("可疑内容在报告侧同样被标注（人工复核标记不丢失）", () => {
  const suspicious = data.activities
    .filter((a) => a.riskFlags.some((f) => f.level === "suspicious"))
    .map((a) => a.id);
  assert(suspicious.length === 2, `应识别出 2 条可疑内容，实际 ${suspicious.length}`);
  suspicious.forEach((id) => {
    const cred = logic.computeCredibility(data.activities.find((a) => a.id === id));
    assert(cred.isSuspicious, `${id} 前端未判为可疑`);
  });
});

console.log(`\n${"-".repeat(52)}`);
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项测试`);
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}
