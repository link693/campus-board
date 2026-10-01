/* 领域逻辑测试：node tests/logic.test.js
 *
 * 重点验证「以 2026-09-19 为基准日时，状态判定是否与题目材料的事实一致」。
 * 这里断言的是题目明确给出的事实（如「直播已结束」「报名已截止」），
 * 而不是实现细节——如果实现改动导致事实判定改变，测试必须失败。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const logic = require(path.join(ROOT, "js", "logic.js"));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "activities.json"), "utf8"));

const TODAY = data.meta.baselineDate;
const ACTIVITIES = data.activities;
const byId = {};
ACTIVITIES.forEach((a) => { byId[a.id] = a; });

/* ------------------------------------------------------------ 测试框架 */

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

function assert(cond, message) {
  if (!cond) throw new Error(message || "断言失败");
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || "值不相等"}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

function statusOf(id) {
  const act = byId[id];
  assert(act, `找不到条目 ${id}`);
  return logic.computeStatus(act, TODAY).code;
}

function group(title) { console.log(`\n${title}`); }

/* ---------------------------------------------------------------- 分组 */

group("数据集完整性");

test("题目 26 条原始信息全部被覆盖", () => {
  eq(data.meta.rawRecordCount, 26, "原始条数");
  const refs = new Set();
  ACTIVITIES.forEach((a) => { refs.add(a.sourceRef); a.relatedRefs.forEach((r) => refs.add(r)); });
  eq(refs.size, 26, "覆盖的原始编号数量");
});

test("结构化条目数为 24（09、20 已合并进 01、03）", () => {
  eq(ACTIVITIES.length, 24);
  eq(byId["lanqiao-training-camp"].relatedRefs.includes("09"), true, "01 应关联 09");
  eq(byId["innovation-team-recruit"].relatedRefs.includes("20"), true, "03 应关联 20");
});

test("条目 id 唯一且都带来源与摘要", () => {
  const ids = new Set();
  ACTIVITIES.forEach((a) => {
    assert(!ids.has(a.id), `id 重复：${a.id}`);
    ids.add(a.id);
    assert(a.rawSummary && a.rawSummary.length > 5, `${a.id} 缺少 rawSummary`);
    assert(a.source && a.source.type, `${a.id} 缺少来源类型`);
  });
});

/* -------------------------------------------------- 基准日状态判定（核心） */

group(`基准日 ${TODAY} 的状态判定`);

test("02 AI应用入门公开课：当天 19:00 举行 → 就在今天", () => {
  eq(statusOf("ai-intro-open-class"), logic.STATUS.TODAY);
});

test("04 数学建模分享会：直播 9/18 已结束 → 已结束（而非可报名）", () => {
  eq(statusOf("math-modeling-replay"), logic.STATUS.ENDED);
});

test("05 公益志愿服务：报名 9/20 12:00 截止，当天剩余 1 天 → 即将截止", () => {
  eq(statusOf("public-service-volunteer"), logic.STATUS.LAST_CALL);
});

test("09 的补充通知生效：训练营首训改为 9/21，基准日应判为报名中", () => {
  const s = logic.computeStatus(byId["lanqiao-training-camp"], TODAY);
  eq(s.code, logic.STATUS.OPEN);
  assert(s.reason.indexOf("天后开始") >= 0, `理由应说明还有几天开始，实际：${s.reason}`);
});

test("训练营地点采用 09 号补充通知的实验楼A402", () => {
  eq(byId["lanqiao-training-camp"].schedule.location, "实验楼A402");
});

test("19 路演观摩：原报名 9/18 已截止，但说明可候补入场 → 已截止且给出候补出路", () => {
  const s = logic.computeStatus(byId["innovation-roadshow"], TODAY);
  eq(s.code, logic.STATUS.CLOSED);
  assert(/候补/.test(s.reason), `理由应提到候补入场，实际：${s.reason}`);
});

test("06 Web开发小组：有「满员即止」但无截止日期 → 长期有效（不臆造截止日）", () => {
  eq(statusOf("web-dev-study-group"), logic.STATUS.ROLLING);
});

test("08 校园软件项目组与 16 摄影志愿者：长期招募 → 长期有效", () => {
  eq(statusOf("campus-software-team"), logic.STATUS.ROLLING);
  eq(statusOf("campus-photography-volunteer"), logic.STATUS.ROLLING);
});

test("17 Python 资料：无需报名、长期开放 → 资料类", () => {
  eq(statusOf("python-materials"), logic.STATUS.INFO);
});

test("11 科研入门分享会：未说明是否需报名 → 不谎称无需报名（应判为报名中/时间待确认类）", () => {
  const code = statusOf("research-intro-talk");
  assert(code !== logic.STATUS.INFO, `未说明报名方式时不应判为「无需报名」，实际 ${code}`);
});

test("18 网络安全小组：首次 9/19 19:30 → 就在今天", () => {
  eq(statusOf("cybersecurity-group"), logic.STATUS.TODAY);
});

test("12 能力挑战赛：截止 10/5，距今 16 天 → 报名中", () => {
  eq(statusOf("computer-ability-challenge"), logic.STATUS.OPEN);
});

test("13 科研助理：9/21 截止，基准日应为报名中（3 天内则算即将截止）", () => {
  const code = statusOf("research-assistant");
  assert(code === logic.STATUS.OPEN || code === logic.STATUS.LAST_CALL, `实际 ${code}`);
});

test("已结束的条目不会再被算作可报名", () => {
  const items = logic.decorateAll(ACTIVITIES, TODAY, {});
  const ended = items.filter((i) => i.status.code === logic.STATUS.ENDED);
  assert(ended.length >= 1, "应至少有 1 条已结束（04）");
  ended.forEach((i) => assert(i.status.terminal, "已结束应为终态"));
});

/* ------------------------------------------------------------ 日期计算 */

group("日期与相对时间");

test("基准日前后天数计算正确", () => {
  eq(logic.daysBetween(TODAY, "2026-09-20"), 1);
  eq(logic.daysBetween(TODAY, "2026-09-19"), 0);
  eq(logic.daysBetween(TODAY, "2026-09-18"), -1);
  eq(logic.daysBetween(TODAY, "2026-09-27"), 8);
});

test("带时区偏移的 ISO 时间按本地日期解析，不因 UTC 转换错位", () => {
  eq(logic.isoDatePart("2026-09-19T19:00:00+08:00"), "2026-09-19");
  eq(logic.relativeDays("2026-09-20T00:30:00+08:00", TODAY), "明天");
  eq(logic.relativeDays("2026-09-18T23:30:00+08:00", TODAY), "昨天");
});

test("人类可读日期包含星期", () => {
  const s = logic.formatDate("2026-09-19");
  assert(/9月19日/.test(s), `实际 ${s}`);
  assert(/周/.test(s), `应包含星期，实际 ${s}`);
});

test("倒计时在当天显示为「今天」且标记紧急", () => {
  const c = logic.countdown("2026-09-19T22:00:00+08:00", TODAY);
  eq(c.text, "今天");
  eq(c.urgent, true);
});

/* -------------------------------------------------------------- 筛选 */

group("筛选与排序");

test("关键词命中标题、标签与详情", () => {
  assert(logic.matchKeyword(byId["git-github-workshop"], "Git"), "应命中 Git");
  assert(logic.matchKeyword(byId["git-github-workshop"], "预约"), "应命中标签/详情");
  assert(!logic.matchKeyword(byId["git-github-workshop"], "羽毛球"), "不应命中无关词");
});

test("按来源筛选：学生自发只返回同学发布的内容", () => {
  const items = logic.selectActivities(ACTIVITIES, { today: TODAY, sources: ["student"] });
  eq(items.length, 4, "学生自发共 4 条（22/23/24/25）");
  items.forEach((i) => eq(i.activity.source.type, "student"));
});

test("freshOnly 会排除已截止与已结束的条目", () => {
  const items = logic.selectActivities(ACTIVITIES, { today: TODAY, freshOnly: true });
  items.forEach((i) => assert(!i.status.terminal, `${i.activity.id} 不应出现`));
  assert(items.length < ACTIVITIES.length, "应确实过滤掉了内容");
});

test("hideSuspicious 会隐藏可疑内容，但默认不隐藏", () => {
  const all = logic.selectActivities(ACTIVITIES, { today: TODAY });
  const hidden = logic.selectActivities(ACTIVITIES, { today: TODAY, hideSuspicious: true });
  eq(all.length - hidden.length, 2, "应过滤掉 2 条可疑信息");
  eq(all.length, 24);
});

test("排序：紧急条目排在已结束之前", () => {
  const items = logic.selectActivities(ACTIVITIES, { today: TODAY });
  const firstTerminal = items.findIndex((i) => i.status.terminal);
  const lastUrgent = items.map((i) => i.status.code).lastIndexOf("today");
  assert(firstTerminal === -1 || lastUrgent < firstTerminal, "紧急条目应排在终态之前");
});

test("分桶后每个条目都恰好落在一个桶里", () => {
  const items = logic.selectActivities(ACTIVITIES, { today: TODAY });
  const buckets = logic.bucketize(items, {});
  const total = buckets.reduce((n, b) => n + b.items.length, 0);
  eq(total, items.length, "分桶总数应与条目数一致");
});

test("别错过桶里只有今天就到或三天内截止的条目", () => {
  const items = logic.selectActivities(ACTIVITIES, { today: TODAY });
  const urgent = logic.bucketize(items, {}).find((b) => b.code === "urgent");
  urgent.items.forEach((i) => {
    assert(["today", "last-call"].indexOf(i.status.code) >= 0, `${i.activity.id} 不应在紧急桶`);
  });
});

/* ------------------------------------------------------ 年级与适用性 */

group("适用对象判定");

test("大一学生：13 科研助理（限大二及以上）不可参加", () => {
  const items = logic.selectActivities(ACTIVITIES, { today: TODAY, grade: 1 });
  const found = items.find((i) => i.activity.id === "research-assistant");
  if (found) eq(found.eligibility.eligible, false, "大一不应可参加");
  const only = logic.selectActivities(ACTIVITIES, { today: TODAY, grade: 1, onlyEligible: true });
  eq(only.some((i) => i.activity.id === "research-assistant"), false, "onlyEligible 时应被排除");
});

test("大一学生：08 校园软件项目组（面向大一、大二）可参加", () => {
  const items = logic.selectActivities(ACTIVITIES, { today: TODAY, grade: 1 });
  const found = items.find((i) => i.activity.id === "campus-software-team");
  assert(found, "应存在该条目");
  eq(found.eligibility.eligible, true);
});

test("大四学生：08 项目组不可参加（仅限大一、大二）", () => {
  const items = logic.selectActivities(ACTIVITIES, { today: TODAY, grade: 4 });
  const found = items.find((i) => i.activity.id === "campus-software-team");
  eq(found.eligibility.eligible, false);
});

test("年级标签可读", () => {
  eq(logic.gradeLabel(1), "大一");
  eq(logic.gradeLabel(4), "大四");
});

/* ---------------------------------------------------------- 可信度评分 */

group("可信度评估");

test("24「零门槛、日结 + 加私人微信」被判为可疑", () => {
  const c = logic.computeCredibility(byId["campus-part-time-benefits"]);
  eq(c.level, "suspicious");
  assert(c.score >= 40, `评分应较高，实际 ${c.score}`);
  const codes = c.signals.map((s) => s.code);
  assert(codes.indexOf("private-contact") >= 0, "应命中「只提供私人联系方式」");
  assert(codes.indexOf("high-return-low-barrier") >= 0, "应命中「高收益低门槛」");
});

test("25 标题为技术交流、实为商家推广被判为可疑", () => {
  const c = logic.computeCredibility(byId["digital-gadget-ad"]);
  eq(c.level, "suspicious");
  assert(c.signals.some((s) => s.code === "title-mismatch"), "应携带人工判定的标题不符标记");
});

test("22 羽毛球约球（费用AA）不应被误判为可疑", () => {
  const c = logic.computeCredibility(byId["badminton-meetup"]);
  eq(c.level, "clean", `误判了：${JSON.stringify(c.signals)}`);
});

test("正常的校级讲座不应被误判", () => {
  ["ai-intro-open-class", "college-ai-sharing", "language-corner", "git-github-workshop"]
    .forEach((id) => {
      const c = logic.computeCredibility(byId[id]);
      assert(c.level === "clean", `${id} 被误判为 ${c.level}：${JSON.stringify(c.signals)}`);
    });
});

test("每个可疑判定都必须给出可读理由", () => {
  ACTIVITIES.forEach((a) => {
    const c = logic.computeCredibility(a);
    c.signals.forEach((s) => {
      assert(s.label && s.detail, `${a.id} 的信号 ${s.code} 缺少说明`);
    });
  });
});

test("运行时特征检测对新增内容同样生效", () => {
  const fake = {
    id: "user-1", title: "急招兼职", summary: "零门槛日结，加微信详聊",
    detail: "日结工资", registration: { method: "加私人微信" }, schedule: {}, riskFlags: []
  };
  const c = logic.computeCredibility(fake);
  eq(c.level, "suspicious", "用户新发布的可疑内容也应被识别");
});

test("信息缺失情况被统计", () => {
  const items = logic.decorateAll(ACTIVITIES, TODAY, {});
  const s = logic.summarize(items);
  eq(s.total, 24);
  assert(s.missingInfo >= 20, `缺失字段条目应较多，实际 ${s.missingInfo}`);
  eq(s.suspicious, 2);
});

/* ------------------------------------------------------------ 时间线 */

group("个人时间线");

test("时间线包含报名截止与活动开始，且按时间升序", () => {
  const tl = logic.buildTimeline(ACTIVITIES, { today: TODAY });
  assert(tl.all.length > 10, `时间线条目应充足，实际 ${tl.all.length}`);
  for (let i = 1; i < tl.all.length; i++) {
    const prev = logic.toDate(tl.all[i - 1].at).getTime();
    const cur = logic.toDate(tl.all[i].at).getTime();
    assert(prev <= cur, `时间线未排序：${tl.all[i - 1].at} > ${tl.all[i].at}`);
  }
});

test("时间线不包含已结束的活动", () => {
  const tl = logic.buildTimeline(ACTIVITIES, { today: TODAY });
  tl.all.forEach((e) => {
    assert(logic.computeStatus(byId[e.activityId], TODAY).code !== logic.STATUS.ENDED,
      `${e.activityId} 已结束，不应出现在时间线`);
  });
});

test("时间线区分截止、开始与提交三类节点", () => {
  const tl = logic.buildTimeline(ACTIVITIES, { today: TODAY });
  eq(tl.counts.deadline > 0, true, "应有报名截止节点");
  eq(tl.counts.session > 0, true, "应有活动开始节点");
  eq(tl.counts.submit > 0, true, "应有竞赛作品提交节点");
});

test("今天确实有节点（02 公开课与 18 安全小组都在 9/19）", () => {
  const tl = logic.buildTimeline(ACTIVITIES, { today: TODAY });
  assert(tl.today.length >= 2, `实际 ${tl.today.length} 个`);
});

/* ------------------------------------------------------------ 基准日可配 */

group("基准日期可配置（状态不写死）");

test("把基准日改到 2026-09-28，训练营与志愿活动都应为已结束", () => {
  const later = "2026-09-28";
  eq(logic.computeStatus(byId["lanqiao-training-camp"], later).code, logic.STATUS.ENDED);
  eq(logic.computeStatus(byId["public-service-volunteer"], later).code, logic.STATUS.ENDED);
});

test("把基准日改到 2026-10-06，能力挑战赛应为已截止", () => {
  eq(logic.computeStatus(byId["computer-ability-challenge"], "2026-10-06").code, logic.STATUS.CLOSED);
});

test("基准日提前到 2026-09-01 时，训练营应仍在报名中", () => {
  eq(logic.computeStatus(byId["lanqiao-training-camp"], "2026-09-01").code, logic.STATUS.OPEN);
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
