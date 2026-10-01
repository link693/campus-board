/* 创新功能测试：node tests/features.test.js
 *
 * 覆盖四项自主设计功能，断言的都是题目材料里真实存在的事实：
 *   - 撞车检测：9 月 19 日 19:00 的公开课与 19:30 的安全小组确实重叠
 *   - 精力预算：03/08/13 三条分别要求每周 4/5/6 小时
 *   - 时效预警：17 号资料写明提取信息有效至 9 月 22 日
 *   - 日历导出：生成的 .ics 结构必须合法可导入
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const logic = require(path.join(ROOT, "js", "logic.js"));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "activities.json"), "utf8"));
const TODAY = data.meta.baselineDate;
const byId = {};
data.activities.forEach((a) => { byId[a.id] = a; });

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

function assert(cond, msg) { if (!cond) throw new Error(msg || "断言失败"); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "值不相等"}：期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
}
function group(t) { console.log(`\n${t}`); }

/* ------------------------------------------------------------ 撞车检测 */

group("创新①撞车检测");

test("AI 公开课与安全小组在 9/19 晚间重叠（19:00 与 19:30）", () => {
  const conflicts = logic.findConflicts(byId["ai-intro-open-class"], data.activities, TODAY);
  const ids = conflicts.map((c) => c.activity.id);
  assert(ids.indexOf("cybersecurity-group") >= 0,
    `应检测到与网络安全小组撞车，实际：${ids.join(", ") || "无"}`);
});

test("撞车结果标明是否同日、时间区间与开始时间差", () => {
  const conflicts = logic.findConflicts(byId["ai-intro-open-class"], data.activities, TODAY);
  const hit = conflicts.find((c) => c.activity.id === "cybersecurity-group");
  eq(hit.sameDay, true, "应为同日撞车");
  eq(hit.severity, "conflict", "同日重叠应判为 conflict");
  eq(hit.range, "19:30—21:30", `区间应按时长推算，实际 ${hit.range}`);
  eq(hit.minutesApart, 30, "开始时间相差应为 30 分钟");
});

test("时间段完全不重叠的活动不会被误报", () => {
  const conflicts = logic.findConflicts(byId["frontend-exchange"], data.activities, TODAY);
  const ids = conflicts.map((c) => c.activity.id);
  // 前端交流会是 15:00—16:30，与晚间活动不重叠
  assert(ids.indexOf("cybersecurity-group") < 0, "不应与晚间活动撞车");
  assert(ids.indexOf("ai-intro-open-class") < 0, "不应与 19:00 的公开课撞车");
});

test("已结束的活动不参与撞车检测", () => {
  // 数学建模直播在 9/18 已结束，不应作为撞车对象出现
  const conflicts = logic.findConflicts(byId["ai-intro-open-class"], data.activities, TODAY);
  assert(conflicts.every((c) => c.activity.id !== "math-modeling-replay"), "已结束活动不应出现");
  // 已结束的活动自身也不应产生撞车列表
  eq(logic.findConflicts(byId["math-modeling-replay"], data.activities, TODAY).length, 0);
});

test("没有时间的活动不会崩溃，返回空列表", () => {
  ["research-assistant", "campus-photography-volunteer"].forEach((id) => {
    eq(logic.findConflicts(byId[id], data.activities, TODAY).length, 0, `${id} 应返回空列表`);
  });
});

test("单场时长：原文给出时段的用真实值，未给出的按 2 小时兜底", () => {
  const win = logic.sessionWindow(byId["frontend-exchange"]);
  eq((win.end - win.start) / 3600000, 1.5, "前端交流会应为 1.5 小时（15:00—16:30）");
  const noEnd = logic.sessionWindow(byId["language-corner"]);
  eq((noEnd.end - noEnd.start) / 3600000, 1.5, "语言角原文未给结束时间，按标注的 1.5 小时");
});

/* ------------------------------------------------------------ 精力预算 */

group("创新②精力预算");

test("三条招募的每周投入被正确提取为 4 / 5 / 6 小时", () => {
  eq(byId["innovation-team-recruit"].eligibility.weeklyHours, 4);
  eq(byId["campus-software-team"].eligibility.weeklyHours, 5);
  eq(byId["research-assistant"].eligibility.weeklyHours, 6);
  eq(byId["innovation-team-recruit"].eligibility.weeklyHoursText, "每周需稳定投入4小时以上");
});

test("预算 10 小时：三项加起来 15 小时，应判为超支", () => {
  const items = [
    { activity: byId["innovation-team-recruit"], registered: true },
    { activity: byId["campus-software-team"], registered: true },
    { activity: byId["research-assistant"], registered: true }
  ];
  const b = logic.computeBudget(items, 10);
  eq(b.committedHours, 15, "已投入应为 15 小时");
  eq(b.over, true, "应判为超支");
  eq(b.remaining, -5, "剩余应为 -5 小时");
});

test("预算 10 小时：贪心建议应塞进 4+5 两项（9 小时），而不是 6+5（11 小时）", () => {
  const items = [
    { activity: byId["innovation-team-recruit"] },
    { activity: byId["campus-software-team"] },
    { activity: byId["research-assistant"] }
  ];
  const b = logic.computeBudget(items, 10);
  eq(b.suggestion.length, 2, "应建议 2 项");
  eq(b.suggestionHours, 9, "建议组合应为 9 小时");
  const picked = b.suggestion.map((s) => s.activity.id);
  assert(picked.indexOf("innovation-team-recruit") >= 0 && picked.indexOf("campus-software-team") >= 0,
    `应选中 4 与 5 小时两项，实际：${picked.join(", ")}`);
});

test("预算充足时全部塞得下，不报超支", () => {
  const items = [
    { activity: byId["innovation-team-recruit"], registered: true },
    { activity: byId["campus-software-team"], registered: true }
  ];
  const b = logic.computeBudget(items, 20);
  eq(b.over, false);
  eq(b.committedHours, 9);
  eq(b.remaining, 11);
});

test("预算为 0 或未设置时不报超支，也不给建议", () => {
  const items = [{ activity: byId["research-assistant"], registered: true }];
  const zero = logic.computeBudget(items, 0);
  eq(zero.over, false, "预算为 0 时不应报超支");
  eq(zero.suggestion.length, 0, "预算为 0 时无建议");
});

test("没有时间要求的活动不计入预算", () => {
  const items = [
    { activity: byId["git-github-workshop"] },
    { activity: byId["language-corner"] }
  ];
  const b = logic.computeBudget(items, 10);
  eq(b.availableCount, 0, "无每周投入要求的活动不应计入");
  eq(b.allHours, 0);
});

/* ---------------------------------------------------------- 时效预警 */

group("创新③时效预警");

test("17 号资料的提取信息在基准日还有 3 天失效", () => {
  const e = logic.computeExpiry(byId["python-materials"], TODAY);
  assert(e, "应识别出时效信息");
  eq(e.daysLeft, 3, "9/19 到 9/22 应为 3 天");
  eq(e.expired, false);
  eq(e.urgent, true, "3 天内应标记为紧急");
  assert(/统一更新/.test(e.note), `应带上原文说明，实际：${e.note}`);
});

test("过了 9 月 22 日后判为已失效", () => {
  const e = logic.computeExpiry(byId["python-materials"], "2026-09-25");
  eq(e.expired, true);
  eq(e.urgent, false);
});

test("没有时效信息的活动返回 null，不误报", () => {
  eq(logic.computeExpiry(byId["ai-intro-open-class"], TODAY), null);
  eq(logic.computeExpiry(byId["campus-software-team"], TODAY), null);
});

/* ---------------------------------------------------------- 时间机器 */

group("创新④时间机器（状态变化预演）");

test("从 9/19 起 7 天内能预告即将消失与即将开始的节点", () => {
  const events = logic.projectTransitions(data.activities, TODAY, 7);
  assert(events.length > 0, "应给出未来节点");
  assert(events.every((e) => e.offsetDays >= 0 && e.offsetDays <= 7), "节点应落在 7 天窗口内");
});

test("预告里包含训练营 9/24 的报名截止", () => {
  const events = logic.projectTransitions(data.activities, TODAY, 7);
  const hit = events.find((e) => e.activity.id === "lanqiao-training-camp" && e.kind === "deadline");
  assert(hit, "应包含训练营报名截止节点");
  eq(hit.offsetDays, 5, "9/19 到 9/24 应为 5 天");
});

test("预告能指出某个节点当天会发生的状态变化", () => {
  const events = logic.projectTransitions(data.activities, TODAY, 7);
  const changes = events.filter((e) => e.changes);
  assert(changes.length > 0, "应至少有一个状态真正发生变化的节点");
  changes.forEach((e) => {
    assert(e.fromStatus.code !== e.toStatus.code,
      `${e.activity.id} 标记为变化但两侧状态相同`);
  });
});

test("窗口语义：span 表示「今天起向后 N 天」，只预告今天之后的节点", () => {
  const zero = logic.projectTransitions(data.activities, TODAY, 0);
  eq(zero.length, 0, "窗口 0 天不应包含任何未来节点");

  const one = logic.projectTransitions(data.activities, TODAY, 1);
  assert(one.length > 0, "窗口 1 天应包含明天的节点");
  assert(one.every((e) => e.offsetDays >= 1 && e.offsetDays <= 1),
    `窗口 1 天只应包含第 1 天的节点，实际偏移：${[...new Set(one.map((e) => e.offsetDays))].join(",")}`);

  const seven = logic.projectTransitions(data.activities, TODAY, 7);
  assert(seven.length > one.length, "窗口越大节点应越多");
  assert(seven.every((e) => e.offsetDays >= 1 && e.offsetDays <= 7), "节点应落在 1—7 天内");
});

test("把基准日改到 9/25，9/22 的失效节点不再出现在未来窗口", () => {
  const events = logic.projectTransitions(data.activities, "2026-09-25", 7);
  const expired = events.find((e) => e.kind === "expiry" && e.activity.id === "python-materials");
  assert(!expired, "已过去的节点不应作为未来预告出现");
});

/* ---------------------------------------------------------- 日历导出 */

group("日历导出（.ics）");

test("导出的 .ics 结构合法：起止标记配对、含必要字段", () => {
  const ics = logic.buildCalendar(data.activities, TODAY);
  assert(ics.indexOf("BEGIN:VCALENDAR") === 0, "应以 BEGIN:VCALENDAR 开头");
  assert(/END:VCALENDAR\r\n$/.test(ics), "应以 END:VCALENDAR 结束");
  const begins = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const ends = (ics.match(/END:VEVENT/g) || []).length;
  eq(begins, ends, "VEVENT 起止数量应一致");
  assert(begins > 10, `事件数量应充足，实际 ${begins}`);
  ["VERSION:2.0", "PRODID", "DTSTAMP", "UID:", "SUMMARY:"].forEach((key) => {
    assert(ics.indexOf(key) >= 0, `缺少必要字段 ${key}`);
  });
});

test("每个事件的 UID 唯一（日历导入时不冲突）", () => {
  const ics = logic.buildCalendar(data.activities, TODAY);
  const uids = (ics.match(/UID:[^\r\n]+/g) || []);
  const unique = new Set(uids);
  eq(unique.size, uids.length, "UID 应全部唯一");
});

test("报名截止会作为提前一天的提醒写入", () => {
  const ics = logic.buildCalendar([byId["public-service-volunteer"]], TODAY);
  // 报名截止 9/20 12:00 → 提醒日为 9/19
  assert(/DTSTART;VALUE=DATE:20260919/.test(ics),
    `应生成 9/19 的全天提醒，实际内容：\n${ics}`);
  assert(/报名截止提醒/.test(ics), "摘要应说明是截止提醒");
});

test("已结束的活动不写入日历", () => {
  const ics = logic.buildCalendar([byId["math-modeling-replay"]], TODAY);
  eq((ics.match(/BEGIN:VEVENT/g) || []).length, 0, "已结束活动不应产生事件");
});

test("中文与特殊字符被正确转义，不会破坏 ics 结构", () => {
  const fake = Object.assign({}, byId["badminton-meetup"], {
    title: '测试;含逗号,与反斜杠\\的标题',
    summary: "第一行\n第二行"
  });
  const ics = logic.buildCalendar([fake], TODAY);
  assert(ics.indexOf("测试\\;含逗号\\,与反斜杠\\\\的标题") >= 0,
    "分号、逗号与反斜杠应被转义");
  assert(ics.indexOf("第一行\\n第二行") >= 0, "换行应转义为 \\n");
  eq((ics.match(/BEGIN:VEVENT/g) || []).length, (ics.match(/END:VEVENT/g) || []).length,
    "转义后结构仍应完整");
});

test("长行按 iCalendar 规范折叠，不产生超长行", () => {
  const ics = logic.buildCalendar(data.activities, TODAY);
  const tooLong = ics.split("\r\n").filter((l) => l.length > 75);
  // 折叠后每行不超过 75 字符（中文按字符保守处理）
  assert(tooLong.length === 0, `存在 ${tooLong.length} 行超长：${tooLong[0]}`);
});

test("时间戳格式符合 iCalendar 本地时间格式", () => {
  eq(logic.icsStamp("2026-09-19T19:30:00+08:00"), "20260919T193000");
  eq(logic.icsStamp("2026-09-20T08:30:00+08:00"), "20260920T083000");
  eq(logic.icsStamp(null), null);
});

/* -------------------------------------------------------------- 汇总 */

console.log(`\n${"-".repeat(52)}`);
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项测试`);
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}
