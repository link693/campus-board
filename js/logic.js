/* 校园活动板 · 领域逻辑层
 *
 * 本文件只做纯计算：不触碰 DOM、不读写存储。
 * 所有「是否已截止 / 还剩几天」都由基准日期实时推算，数据中不存在写死的状态。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CampusLogic = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /* ---------------------------------------------------------------- 常量 */

  var STATUS = {
    ENDED: "ended",
    CLOSED: "closed",
    LAST_CALL: "last-call",
    TODAY: "today",
    OPEN: "open",
    UPCOMING: "upcoming",
    ROLLING: "rolling",
    INFO: "info",
    UNKNOWN: "unknown"
  };

  var STATUS_META = {
    "ended": { label: "已结束", tone: "neutral", priority: 90, terminal: true },
    "closed": { label: "报名已截止", tone: "neutral", priority: 80, terminal: true },
    "last-call": { label: "即将截止", tone: "warning", priority: 10, terminal: false },
    "today": { label: "就在今天", tone: "danger", priority: 5, terminal: false },
    "open": { label: "报名中", tone: "success", priority: 20, terminal: false },
    "upcoming": { label: "即将开始", tone: "info", priority: 25, terminal: false },
    "rolling": { label: "长期有效", tone: "accent", priority: 40, terminal: false },
    "info": { label: "资料 / 无需报名", tone: "info", priority: 50, terminal: false },
    "unknown": { label: "时间待确认", tone: "warning", priority: 30, terminal: false }
  };

  var SOURCE_TYPES = {
    school: { label: "学校 / 校级", tone: "info", order: 1 },
    college: { label: "学院", tone: "accent2", order: 2 },
    association: { label: "校内组织", tone: "accent", order: 3 },
    student: { label: "学生自发", tone: "warning", order: 4 },
    unspecified: { label: "来源未标注", tone: "neutral", order: 5 }
  };

  var CATEGORY_LABELS = {
    "competition": "竞赛",
    "competition-training": "竞赛训练",
    "lecture": "讲座分享",
    "workshop": "工作坊",
    "study-group": "学习小组",
    "recruitment": "招募组队",
    "volunteer": "志愿服务",
    "cultural": "文化交流",
    "resource": "学习资料",
    "student-initiated": "同学发起"
  };

  /* 单条风险标记的权重：数据中已人工判定的标记 */
  var BASE_RISK_WEIGHT = {
    "suspicious": 40,
    "title-mismatch": 35,
    "missing-fee": 8,
    "vague-deadline": 8,
    "day-precision": 4,
    "location-pending": 6,
    "approval-required": 6,
    "expiring-link": 6,
    "schedule-conflict": 10,
    "two-stage": 4
  };

  /* 运行时特征信号：对任意文本（含用户新发布内容）做规则检测 */
  var SIGNAL_RULES = [
    { code: "private-contact", weight: 18, label: "只提供私人联系方式",
      detail: "以私人微信 / QQ 作为唯一联系渠道，缺少可核实的主办方信息。",
      patterns: [/私人微信/, /加微信/, /加我微信/, /微信号/, /私聊/, /加qq/i, /私下联系/] },
    { code: "high-return-low-barrier", weight: 20, label: "高收益低门槛表述",
      detail: "出现「零门槛」「日结」「轻松赚钱」等表述，与正常校园活动的收益结构不符。",
      patterns: [/零门槛/, /日结/, /轻松(赚钱|月入)/, /日入/, /高薪/, /无门槛/] },
    { code: "purchase-link", weight: 16, label: "含购买链接或优惠推广",
      detail: "内容以商品优惠、折扣或购买链接为主，与校园活动关联较弱。",
      patterns: [/购买链接/, /优惠(券|价|活动)/, /折扣/, /下单/, /淘宝/, /拼多多/, /微商/, /扫码购买/] },
    { code: "no-time-location", weight: 10, label: "无时间与地点",
      detail: "未提供活动时间与地点，无法判断是否可参与。",
      patterns: [] }
  ];

  var THRESHOLD = { suspicious: 40, attention: 18 };

  /* ------------------------------------------------------------ 时间工具 */

  var DAY_MS = 86400000;

  /** 从 ISO 字符串取出 YYYY-MM-DD（保留本地日期语义，不转 UTC）。 */
  function isoDatePart(iso) {
    if (typeof iso !== "string") return null;
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
    return m ? m[1] : null;
  }

  /** 把 YYYY-MM-DD 或 ISO 时间统一成一个可比较的 Date（本地时区）。 */
  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    var s = String(value);
    var datePart = isoDatePart(s);
    if (!datePart) return null;
    var timePart = "00:00:00";
    var tm = /T(\d{2}:\d{2}(?::\d{2})?)/.exec(s);
    if (tm) timePart = tm[1].length === 5 ? tm[1] + ":00" : tm[1];
    var d = new Date(datePart + "T" + timePart);
    return isNaN(d.getTime()) ? null : d;
  }

  /** 两个时间之间相差的整天数（按日历天，忽略时刻）。 */
  function daysBetween(from, to) {
    var a = toDate(from), b = toDate(to);
    if (!a || !b) return null;
    var da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    var db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((db - da) / DAY_MS);
  }

  function formatDate(iso) {
    var d = toDate(iso);
    if (!d) return "—";
    var wd = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 周" + wd;
  }

  function formatTime(iso) {
    var d = toDate(iso);
    if (!d) return null;
    var hh = d.getHours(), mm = d.getMinutes();
    if (hh === 0 && mm === 0) return null;
    return (hh < 10 ? "0" + hh : hh) + ":" + (mm < 10 ? "0" + mm : mm);
  }

  /** 人类可读的相对时间：3 天后 / 今天 / 已过 2 天。 */
  function relativeDays(target, today) {
    var n = daysBetween(today, target);
    if (n === null) return null;
    if (n === 0) return "今天";
    if (n === 1) return "明天";
    if (n === 2) return "后天";
    if (n > 0) return n + " 天后";
    if (n === -1) return "昨天";
    return "已过 " + Math.abs(n) + " 天";
  }

  /* ------------------------------------------------------------ 状态判定 */

  function isFullyPastDeadline(act, today) {
    var dl = toDate(act.registration.deadlineAt);
    if (!dl) return false;
    var end = new Date(dl.getFullYear(), dl.getMonth(), dl.getDate(), 23, 59, 59);
    return toDate(today) > end;
  }

  function hasOpenFallback(act) {
    return !!(act.registration && act.registration.closedFallback);
  }

  /** 长期招募类：需要报名、但没有截止日期（多为「长期 / 满员即止」）。 */
  function isLongTerm(act) {
    if (act.registration.required === false) return false;
    var text = (act.registration.deadlineText || "") + (act.capacity.text || "");
    return /长期|满员即止|未注明/.test(text) && !act.registration.deadlineAt;
  }

  function deadlineIsVague(act) {
    var text = (act.registration.deadlineText || "") + (act.registration.timePrecision || "");
    return !act.registration.deadlineAt && /未注明|未说明|满员即止/.test(text);
  }

  /**
   * 计算一个条目相对基准日的状态。
   *
   * 判定优先级（顺序本身即业务语义，不可随意调整）：
   *   已结束 → 报名已截止 → 无截止日的长期招募 → 无截止日的无需报名/资料
   *   → 明确的截止日期（含 3 天内预警）→ 活动开始日 → 兜底
   *
   * @param {object} act 结构化条目
   * @param {string} today 基准日 YYYY-MM-DD
   */
  function computeStatus(act, today) {
    var T = toDate(today);
    var start = toDate(act.schedule.firstSessionAt || act.schedule.endAt);
    var deadline = toDate(act.registration.deadlineAt);

    if (start && T > start) {
      // 开始时刻已过：若无结束时间，按当日结束处理
      var end = toDate(act.schedule.endAt);
      if (!end) {
        end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59);
      }
      if (T > end) {
        return mk(STATUS.ENDED, relativeDays(start, T), "该活动的举办时间已经过去。");
      }
    }

    if (isFullyPastDeadline(act, T)) {
      if (hasOpenFallback(act)) {
        return mk(STATUS.CLOSED, relativeDays(start || deadline, T),
          "报名已截止；" + act.registration.closedFallback + "。");
      }
      if (start && T <= start) {
        return mk(STATUS.CLOSED, relativeDays(start, T), "报名已截止，活动尚未开始，可关注后续同类信息。");
      }
      return mk(STATUS.CLOSED, relativeDays(deadline, T), "报名时间已过。");
    }

    var left = deadline ? daysBetween(T, deadline) : null;
    var imminent = left !== null && left >= 0 && left <= 3;
    var startsSoon = start ? daysBetween(T, start) : null;

    // 明确的截止日期优先，三天内进入预警
    if (imminent) {
      return mk(STATUS.LAST_CALL, relativeDays(deadline, T),
        left === 0 ? "今天是报名最后一天。" : "距离报名截止还有 " + left + " 天。");
    }

    // 三天内即将开始（含就在今天）：这是用户最该先看到的信息
    if (startsSoon !== null && startsSoon >= 0 && startsSoon <= 3) {
      if (startsSoon === 0) return mk(STATUS.TODAY, "今天", "活动就在今天举行。");
      return mk(STATUS.OPEN, relativeDays(start, T),
        startsSoon + " 天后开始" + (deadline ? "，报名仍在进行。" : "。"));
    }

    // 没有截止日期、且属于「长期 / 满员即止」的招募：不能臆造一个截止日
    if (!deadline && isLongTerm(act)) {
      return mk(STATUS.ROLLING, null, "长期招募，满员即止，建议尽早联系。");
    }

    // 没有截止日期、也不需要报名：属于资料或可直接参与的活动
    if (!deadline && act.registration.required === false) {
      return mk(STATUS.INFO, start ? relativeDays(start, T) : null,
        start ? "无需报名，按时到场或在线获取即可。" : "无需报名，长期开放。");
    }

    if (!deadline && deadlineIsVague(act)) {
      return mk(STATUS.UNKNOWN, null, "报名时间未明确，需要向主办方确认。");
    }

    if (start) {
      var d = daysBetween(T, start);
      if (d !== null && d > 0) return mk(STATUS.OPEN, relativeDays(start, T), "活动尚未开始。");
    }

    if (deadline) return mk(STATUS.OPEN, relativeDays(deadline, T), "报名通道开放中。");

    var freq = act.schedule.recurrence && act.schedule.recurrence.freq;
    if (freq) return mk(STATUS.ROLLING, null, "周期性开展，时间以主办方通知为准。");

    return mk(STATUS.INFO, null, "无需报名或为长期可获取的资源。");
  }

  function mk(code, relative, reason) {
    var meta = STATUS_META[code];
    return {
      code: code,
      label: meta.label,
      tone: meta.tone,
      priority: meta.priority,
      terminal: meta.terminal,
      relative: relative,
      reason: reason
    };
  }

  /* -------------------------------------------------------- 可参与性判定 */

  /**
   * 判断某学生能否参加，以及为什么。
   * @param {object} act
   * @param {{grade:number}} profile
   */
  function computeEligibility(act, profile) {
    var grade = profile && profile.grade ? Number(profile.grade) : null;
    var elig = act.eligibility || {};
    var range = elig.gradeRange;
    var result = { eligible: true, reasons: [] };

    if (grade && range) {
      if (grade < range[0]) {
        result.eligible = false;
        result.reasons.push("该机会要求 " + gradeLabel(range[0]) + "及以上");
      } else if (grade > range[1]) {
        result.eligible = false;
        result.reasons.push("该机会面向 " + gradeLabel(range[0]) + "至" + gradeLabel(range[1]));
      }
    }
    if (elig.openToAll === false && elig.otherConditions && elig.otherConditions.length) {
      result.conditions = elig.otherConditions.slice();
    } else {
      result.conditions = (elig.otherConditions || []).slice();
    }
    if (!grade) result.needsProfile = true;
    return result;
  }

  function gradeLabel(g) {
    return ["", "大一", "大二", "大三", "大四"][g] || ("大" + g);
  }

  /* ------------------------------------------------------ 可疑内容评分 */

  function normalize(text) {
    return String(text || "").replace(/\s+/g, "");
  }

  function detectSignals(act) {
    var haystack = normalize([
      act.title, act.summary, act.detail,
      act.registration && act.registration.method,
      act.registration && act.registration.methodNote,
      act.registration && act.registration.feeText
    ].filter(Boolean).join(" "));

    var signals = [];
    var hasUsableSchedule = !!(act.schedule && (act.schedule.firstSessionAt || act.schedule.startDateText));

    SIGNAL_RULES.forEach(function (rule) {
      if (rule.code === "no-time-location") {
        if (!hasUsableSchedule && !act.schedule.location) {
          signals.push({ code: rule.code, weight: rule.weight, label: rule.label, detail: rule.detail });
        }
        return;
      }
      var hit = rule.patterns.some(function (re) { return re.test(haystack); });
      if (hit) signals.push({ code: rule.code, weight: rule.weight, label: rule.label, detail: rule.detail });
    });

    // 「标题与内容不符」无法用关键词可靠判断，交由数据中的人工判定标记提供
    return signals;
  }

  /**
   * 综合「人工标记 + 运行时特征」给出可信度评分。
   * 评分只用于排序与提示，永远不用于删除内容。
   */
  function computeCredibility(act) {
    var items = [];
    var seen = {};

    (act.riskFlags || []).forEach(function (flag) {
      if (seen[flag.code]) return;
      seen[flag.code] = true;
      items.push({
        code: flag.code,
        label: flag.label,
        detail: flag.detail,
        weight: BASE_RISK_WEIGHT[flag.code] != null ? BASE_RISK_WEIGHT[flag.code] : 10,
        origin: "reviewed"
      });
    });

    detectSignals(act).forEach(function (sig) {
      if (seen[sig.code]) return;
      seen[sig.code] = true;
      items.push({
        code: sig.code,
        label: sig.label,
        detail: sig.detail,
        weight: sig.weight,
        origin: "runtime"
      });
    });

    var score = items.reduce(function (sum, it) { return sum + it.weight; }, 0);
    var level = score >= THRESHOLD.suspicious ? "suspicious"
      : score >= THRESHOLD.attention ? "attention" : "clean";

    /* 展示层去重：当已经有人工判定的"可疑"结论时，
       运行时的细分特征只是重复同一个结论，界面上合并展示更清楚。
       注意：去重只影响展示，评分与判定仍使用完整的 items。 */
    var hasReviewedSuspicious = items.some(function (it) {
      return it.origin === "reviewed" && it.code === "suspicious";
    });
    var displayed = hasReviewedSuspicious
      ? items.filter(function (it) { return it.origin === "reviewed"; })
      : items;

    return {
      score: score,
      level: level,
      signals: items,
      displaySignals: displayed,
      isSuspicious: level === "suspicious",
      needsAttention: level !== "clean"
    };
  }

  /* ---------------------------------------------------------- 筛选与排序 */

  function matchKeyword(act, keyword) {
    if (!keyword) return true;
    var q = normalize(keyword).toLowerCase();
    var fields = [act.title, act.summary, act.detail, (act.tags || []).join(" "),
      act.source.publisher, act.source.label, CATEGORY_LABELS[act.category] || ""];
    return fields.some(function (f) { return normalize(f).toLowerCase().indexOf(q) >= 0; });
  }

  function matchSource(act, types) {
    if (!types || !types.length) return true;
    return types.indexOf(act.source.type) >= 0;
  }

  function matchCategory(act, categories) {
    if (!categories || !categories.length) return true;
    return categories.indexOf(act.category) >= 0;
  }

  /**
   * 主筛选入口。
   * @param {object[]} activities
   * @param {object} options { today, keyword, sources, categories, statuses, freshOnly, grade, hideSuspicious }
   */
  function selectActivities(activities, options) {
    var opts = options || {};
    var today = opts.today;
    var result = [];

    activities.forEach(function (act) {
      var status = computeStatus(act, today);
      var cred = computeCredibility(act);
      var elig = computeEligibility(act, opts);

      if (!matchKeyword(act, opts.keyword)) return;
      if (!matchSource(act, opts.sources)) return;
      if (!matchCategory(act, opts.categories)) return;
      if (opts.statuses && opts.statuses.length && opts.statuses.indexOf(status.code) < 0) return;
      if (opts.freshOnly && status.terminal) return;
      if (opts.hideSuspicious && cred.isSuspicious) return;
      if (opts.onlyEligible && !elig.eligible) return;

      result.push({
        activity: act,
        status: status,
        credibility: cred,
        eligibility: elig
      });
    });

    return sortItems(result);
  }

  function sortItems(items) {
    return items.slice().sort(function (a, b) {
      // 1. 状态优先级：紧急与可参与的排在前面，已结束的沉底
      if (a.status.priority !== b.status.priority) return a.status.priority - b.status.priority;
      // 2. 可信度低的往后放（不删除，只降权）
      if (a.credibility.isSuspicious !== b.credibility.isSuspicious) {
        return a.credibility.isSuspicious ? 1 : -1;
      }
      // 3. 有明确时间的按时间先后
      var ta = timeKey(a.activity), tb = timeKey(b.activity);
      if (ta !== tb) return ta - tb;
      return a.activity.id < b.activity.id ? -1 : 1;
    });
  }

  function timeKey(act) {
    var d = toDate(act.registration.deadlineAt) || toDate(act.schedule.firstSessionAt);
    return d ? d.getTime() : Number.MAX_SAFE_INTEGER;
  }

  /* ------------------------------------------------------------ 分桶视图 */

  var BUCKETS = [
    { code: "urgent", title: "别错过", hint: "今天就到 / 三天内截止", statuses: ["today", "last-call"] },
    { code: "open", title: "还能报名", hint: "报名通道开放中", statuses: ["open", "unknown"] },
    { code: "rolling", title: "长期招募", hint: "满员即止，尽早联系", statuses: ["rolling"] },
    { code: "info", title: "无需报名 / 资料", hint: "直接参与或长期可看", statuses: ["info"] },
    { code: "closed", title: "已截止 / 已结束", hint: "保留记录，便于回溯", statuses: ["closed", "ended"] }
  ];

  function bucketize(items, options) {
    var opts = options || {};
    var buckets = BUCKETS.map(function (b) {
      return { code: b.code, title: b.title, hint: b.hint, items: [] };
    });
    var index = {};
    buckets.forEach(function (b) { index[b.code] = b; });

    items.forEach(function (item) {
      var bucket = null;
      for (var i = 0; i < BUCKETS.length; i++) {
        if (BUCKETS[i].statuses.indexOf(item.status.code) >= 0) { bucket = index[BUCKETS[i].code]; break; }
      }
      if (!bucket) bucket = index.info;
      bucket.items.push(item);
    });

    if (opts.hideEmpty) return buckets.filter(function (b) { return b.items.length > 0; });
    return buckets;
  }

  /* ------------------------------------------------------------ 时间线 */

  function buildTimeline(activities, options) {
    var opts = options || {};
    var today = opts.today;
    var entries = [];

    activities.forEach(function (act) {
      var status = computeStatus(act, today);
      if (status.code === "ended") return;

      if (act.registration.deadlineAt) {
        entries.push({
          activityId: act.id,
          kind: "deadline",
          kindLabel: "报名截止",
          at: act.registration.deadlineAt,
          label: act.title,
          status: status,
          daysLeft: daysBetween(today, act.registration.deadlineAt)
        });
      }
      if (act.schedule.firstSessionAt) {
        entries.push({
          activityId: act.id,
          kind: "session",
          kindLabel: "活动开始",
          at: act.schedule.firstSessionAt,
          label: act.title,
          status: status,
          daysLeft: daysBetween(today, act.schedule.firstSessionAt)
        });
      }
      if (act.schedule.endAt && act.category === "competition") {
        entries.push({
          activityId: act.id,
          kind: "submit",
          kindLabel: "作品提交",
          at: act.schedule.endAt,
          label: act.title,
          status: status,
          daysLeft: daysBetween(today, act.schedule.endAt)
        });
      }
    });

    entries.sort(function (a, b) {
      var da = toDate(a.at).getTime(), db = toDate(b.at).getTime();
      return da - db;
    });

    var todays = entries.filter(function (e) { return e.daysLeft === 0; });
    var upcoming = entries.filter(function (e) { return e.daysLeft > 0; });

    return {
      today: todays,
      upcoming: upcoming,
      all: entries,
      counts: {
        deadline: entries.filter(function (e) { return e.kind === "deadline"; }).length,
        session: entries.filter(function (e) { return e.kind === "session"; }).length,
        submit: entries.filter(function (e) { return e.kind === "submit"; }).length
      }
    };
  }

  /* --------------------------------------------------------- 派生数据 */

  function toItem(act, today, profile) {
    return {
      activity: act,
      status: computeStatus(act, today),
      credibility: computeCredibility(act),
      eligibility: computeEligibility(act, profile || {})
    };
  }

  function decorateAll(activities, today, profile) {
    return activities.map(function (act) { return toItem(act, today, profile); });
  }

  function summarize(items) {
    var s = { total: items.length, urgent: 0, open: 0, closed: 0, suspicious: 0, missingInfo: 0 };
    items.forEach(function (it) {
      if (it.status.code === "today" || it.status.code === "last-call") s.urgent++;
      if (it.status.code === "open" || it.status.code === "rolling" || it.status.code === "unknown") s.open++;
      if (it.status.code === "closed" || it.status.code === "ended") s.closed++;
      if (it.credibility.isSuspicious) s.suspicious++;
      if (it.activity.missingFields && it.activity.missingFields.length) s.missingInfo++;
    });
    return s;
  }

  function categoryOptions(activities) {
    var seen = {};
    activities.forEach(function (a) { seen[a.category] = (seen[a.category] || 0) + 1; });
    return Object.keys(seen).sort().map(function (code) {
      return { code: code, label: CATEGORY_LABELS[code] || code, count: seen[code] };
    });
  }

  function sourceOptions(activities) {
    var seen = {};
    activities.forEach(function (a) { seen[a.source.type] = (seen[a.source.type] || 0) + 1; });
    return Object.keys(SOURCE_TYPES).filter(function (t) { return seen[t]; }).map(function (t) {
      return { code: t, label: SOURCE_TYPES[t].label, count: seen[t], order: SOURCE_TYPES[t].order };
    });
  }

  function countdown(target, today) {
    var days = daysBetween(today, target);
    if (days === null) return null;
    var d = toDate(target);
    var base = toDate(today);
    var ms = d - new Date(base.getFullYear(), base.getMonth(), base.getDate());
    var hours = Math.floor(ms / 3600000);
    return {
      days: days,
      hours: Math.max(0, hours),
      text: days > 0 ? days + " 天" + (hours % 24 ? " " + (hours % 24) + " 小时" : "") : "今天",
      urgent: days <= 1
    };
  }

  /* -------------------------------------------------------------- 导出 */

  return {
    STATUS: STATUS,
    STATUS_META: STATUS_META,
    SOURCE_TYPES: SOURCE_TYPES,
    CATEGORY_LABELS: CATEGORY_LABELS,
    BUCKETS: BUCKETS,
    GRADE_LABELS: ["", "大一", "大二", "大三", "大四"],

    isoDatePart: isoDatePart,
    toDate: toDate,
    daysBetween: daysBetween,
    formatDate: formatDate,
    formatTime: formatTime,
    relativeDays: relativeDays,
    countdown: countdown,

    computeStatus: computeStatus,
    computeEligibility: computeEligibility,
    computeCredibility: computeCredibility,
    detectSignals: detectSignals,
    gradeLabel: gradeLabel,

    selectActivities: selectActivities,
    sortItems: sortItems,
    bucketize: bucketize,
    buildTimeline: buildTimeline,
    toItem: toItem,
    decorateAll: decorateAll,
    summarize: summarize,
    categoryOptions: categoryOptions,
    sourceOptions: sourceOptions,
    matchKeyword: matchKeyword
  };
});
