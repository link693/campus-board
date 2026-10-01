/* 校园活动板 · 视图层
 *
 * 约定：
 * 1. 所有用户可见文本一律用 textContent 写入，不使用 innerHTML 拼接内容；
 *    仅图标使用固定的 SVG 片段（无变量插值）。
 * 2. 任何可点击元素都是真实的 button/a，带 aria 属性，键盘可用。
 * 3. 视觉属性全部来自 CSS 类与令牌，不在此处写内联样式数值。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CampusUI = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var L = null; /* 由 init 注入 CampusLogic */

  function init(logic) { L = logic; }

  /* ------------------------------------------------------------ DOM 工具 */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function icon(name, className) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (className) svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + name);
    svg.appendChild(use);
    return svg;
  }

  function badge(text, tone, iconName) {
    var b = el("span", "badge");
    b.dataset.tone = tone || "neutral";
    if (iconName) b.appendChild(icon(iconName));
    b.appendChild(el("span", null, text));
    return b;
  }

  function sourceTag(act) {
    var meta = L.SOURCE_TYPES[act.source.type] || L.SOURCE_TYPES.unspecified;
    var node = el("span", "source-tag");
    node.dataset.source = act.source.type;
    var iconName = act.source.type === "student" ? "i-users"
      : act.source.type === "college" ? "i-layers"
      : act.source.type === "school" ? "i-shield" : "i-info";
    node.appendChild(icon(iconName));
    node.appendChild(el("span", null, act.source.publisher || meta.label));
    return node;
  }

  function fact(iconName, text, strong) {
    var row = el("div", "fact");
    if (strong) row.dataset.strong = "true";
    row.appendChild(icon(iconName));
    row.appendChild(el("span", null, text));
    row.title = text;
    return row;
  }

  function iconButton(iconName, label, pressed) {
    var b = el("button", "icon-btn");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    b.appendChild(icon(iconName));
    return b;
  }

  /* -------------------------------------------------------- 时间与状态文案 */

  function deadlineText(item, today) {
    var act = item.activity;
    var reg = act.registration;
    if (reg.deadlineAt) {
      var rel = L.relativeDays(reg.deadlineAt, today);
      var time = L.formatTime(reg.deadlineAt);
      return "报名截止 " + L.formatDate(reg.deadlineAt) + (time ? " " + time : "") +
        (rel ? "（" + rel + "）" : "");
    }
    return reg.deadlineText || "报名时间未说明";
  }

  function scheduleText(act, today) {
    var s = act.schedule;
    if (!s.firstSessionAt) {
      if (s.recurrence && s.recurrence.note) return s.recurrence.note;
      if (s.endAt) return "截止 " + L.formatDate(s.endAt);
      return "活动时间未提供";
    }
    var text = L.formatDate(s.firstSessionAt);
    var t = L.formatTime(s.firstSessionAt);
    if (t) text += " " + t;
    if (s.recurrence && s.recurrence.note) text += " · " + s.recurrence.note;
    return text;
  }

  function capacityText(act) {
    var c = act.capacity;
    if (!c) return null;
    var parts = [];
    if (c.limit) parts.push("限 " + c.limit + " 人");
    else if (c.limitMin) parts.push("计划 " + c.limitMin + "—" + (c.limit || 8) + " 人");
    else parts.push(c.text || "人数未说明");
    if (c.caveat) parts.push(c.caveat);
    return parts.join("；");
  }

  function eligibilityText(act) {
    var e = act.eligibility || {};
    var parts = [];
    if (e.gradeRange && !(e.gradeRange[0] === 1 && e.gradeRange[1] === 4)) {
      parts.push("仅限 " + L.gradeLabel(e.gradeRange[0]) + "—" + L.gradeLabel(e.gradeRange[1]));
    } else if (e.openToAll) {
      parts.push("全校学生");
    }
    (e.otherConditions || []).forEach(function (c) { parts.push(c); });
    return parts.length ? parts.join("；") : null;
  }

  /* ============================================================ 指标卡 */

  function renderKpis(container, summary, timeline) {
    container.textContent = "";
    var cards = [
      { key: "total", label: "信息条目", value: summary.total, tone: "accent", iconName: "i-layers" },
      { key: "urgent", label: "三天内截止 / 今天就到", value: summary.urgent, tone: "warning", iconName: "i-bell" },
      { key: "open", label: "仍在开放", value: summary.open, tone: "accent", iconName: "i-play" },
      { key: "missing", label: "含缺失信息", value: summary.missingInfo, tone: "neutral", iconName: "i-info" }
    ];
    cards.forEach(function (c) {
      var node = el("div", "kpi");
      node.dataset.tone = c.tone;
      var label = el("span", "kpi-label");
      label.appendChild(icon(c.iconName));
      label.appendChild(el("span", null, c.label));
      node.appendChild(label);
      node.appendChild(el("span", "kpi-value num", c.value));
      container.appendChild(node);
    });
  }

  /* ============================================================ 卡片 */

  function renderCard(item, today, store, handlers, conflicts) {
    var act = item.activity;
    var status = item.status;
    var cred = item.credibility;
    var isUser = act.source.type === "user";
    var conflictList = conflicts || [];

    var card = el("article", "card");
    card.dataset.id = act.id;
    if (status.tone) card.style.setProperty("--tone-color", "var(--" + toneVar(status.tone) + ")");

    /* 顶部：状态 + 来源 */
    var top = el("div", "card-top");
    var meta = el("div", "card-meta");
    meta.appendChild(badge(status.label, status.tone, statusIcon(status.code)));
    meta.appendChild(sourceTag(act));
    if (act.updates && act.updates.length) {
      meta.appendChild(badge("已更新 " + act.updates.length + " 次", "info", "i-history"));
    }
    if (cred.isSuspicious) {
      meta.appendChild(badge("可疑信息", "danger", "i-alert"));
    } else if (cred.level === "attention") {
      meta.appendChild(badge("需注意", "warning", "i-info"));
    }
    if (conflictList.length) {
      meta.appendChild(badge("时间冲突 " + conflictList.length, "warning", "i-alert"));
    }
    var expiry = L.computeExpiry(act, today);
    if (expiry && !expiry.expired) {
      meta.appendChild(badge(expiry.daysLeft + " 天后失效", "danger", "i-clock"));
    }
    top.appendChild(meta);
    card.appendChild(top);

    /* 标题 */
    var h3 = el("h3", "card-title");
    var titleBtn = el("button", "card-title-btn", act.title);
    titleBtn.type = "button";
    titleBtn.addEventListener("click", function () { handlers.openDetail(act.id); });
    h3.appendChild(titleBtn);
    card.appendChild(h3);

    /* 摘要 */
    card.appendChild(el("p", "card-summary", act.summary));

    /* 关键事实 */
    var facts = el("div", "card-facts");
    var dl = deadlineText(item, today);
    facts.appendChild(fact("i-clock", dl, status.code === "last-call" || status.code === "today"));
    facts.appendChild(fact("i-calendar", scheduleText(act, today)));
    if (act.schedule.location) {
      facts.appendChild(fact("i-pin", act.schedule.location));
    }
    var cap = capacityText(act);
    if (cap) facts.appendChild(fact("i-users", cap));
    card.appendChild(facts);

    /* 底部操作：状态说明 + 明确的按钮（图标 + 文字，保证可点尺寸与可见性） */
    var foot = el("div", "card-foot");
    var stateText = el("span", "card-status-note", status.reason || "");
    stateText.title = status.reason || "";
    foot.appendChild(stateText);

    var actions = el("div", "card-actions");

    var favOn = store.isFavorite(act.id);
    var favBtn = el("button", "act-btn");
    favBtn.type = "button";
    favBtn.setAttribute("aria-pressed", String(favOn));
    favBtn.setAttribute("aria-label", favOn ? "取消收藏" : "收藏这条信息");
    favBtn.appendChild(icon(favOn ? "i-bookmark-fill" : "i-bookmark"));
    favBtn.appendChild(el("span", null, favOn ? "已收藏" : "收藏"));
    favBtn.addEventListener("click", function () { handlers.toggleFavorite(act.id); });
    actions.appendChild(favBtn);

    var regOn = store.isRegistered(act.id);
    var regBtn = el("button", "act-btn act-btn-primary");
    regBtn.type = "button";
    regBtn.setAttribute("aria-pressed", String(regOn));
    regBtn.setAttribute("aria-label", regOn ? "取消「我要参加」" : "标记我要参加");
    regBtn.appendChild(icon(regOn ? "i-check" : "i-plus"));
    regBtn.appendChild(el("span", null, regOn ? "已加入" : "我要参加"));
    regBtn.addEventListener("click", function () { handlers.toggleRegistered(act.id); });
    actions.appendChild(regBtn);

    if (isUser) {
      var editBtn = iconButton("i-edit", "编辑我的发布");
      editBtn.addEventListener("click", function () { handlers.editPost(act.id); });
      actions.appendChild(editBtn);
    }

    /* 详情入口：卡片标题可点，这里不再重复放一个箭头按钮，
       否则在 280px 宽的卡片里会把两个主要操作挤到放不下。 */
    foot.appendChild(actions);
    card.appendChild(foot);

    return card;
  }

  function statusIcon(code) {
    switch (code) {
      case "today": return "i-bell";
      case "last-call": return "i-clock";
      case "open": return "i-play";
      case "upcoming": return "i-calendar";
      case "rolling": return "i-users";
      case "closed": return "i-close";
      case "ended": return "i-check";
      case "unknown": return "i-info";
      default: return "i-info";
    }
  }

  function toneVar(tone) {
    switch (tone) {
      case "warning": return "warning";
      case "danger": return "danger";
      case "success": return "success";
      case "info": return "info";
      case "accent": return "accent";
      case "accent2": return "accent-2";
      default: return "neutral";
    }
  }

  /* ============================================================ 列表 */

  function renderFeed(container, groups, today, store, handlers) {
    container.textContent = "";

    var visible = groups.filter(function (g) { return g.items.length > 0; });
    if (!visible.length) {
      container.appendChild(renderEmpty());
      return;
    }

    /* 撞车只算一次：由控制器预先算好整张映射表，卡片按 id 取用 */
    var conflictMap = (handlers && handlers.conflictMap) || {};

    visible.forEach(function (group) {
      var section = el("section", "bucket");
      section.dataset.bucket = group.code;

      var head = el("div", "bucket-head");
      var title = el("h2", "bucket-title");
      title.appendChild(icon(bucketIcon(group.code)));
      title.appendChild(el("span", null, group.title));
      head.appendChild(title);
      head.appendChild(el("span", "bucket-count num", group.items.length + " 条"));
      head.appendChild(el("span", "bucket-hint", group.hint));
      section.appendChild(head);

      var grid = el("div", "cards");
      group.items.forEach(function (item) {
        grid.appendChild(renderCard(item, today, store, handlers, conflictMap[item.activity.id] || []));
      });
      section.appendChild(grid);
      container.appendChild(section);
    });
  }

  function bucketIcon(code) {
    switch (code) {
      case "urgent": return "i-bell";
      case "open": return "i-play";
      case "rolling": return "i-users";
      case "info": return "i-info";
      default: return "i-check";
    }
  }

  function renderEmpty() {
    var box = el("div", "empty");
    box.appendChild(icon("i-search"));
    box.appendChild(el("p", "empty-title", "没有符合条件的信息"));
    box.appendChild(el("p", "empty-desc", "试试清空筛选条件、换一个关键词，或关闭「新生模式」与「隐藏可疑信息」。"));
    return box;
  }

  /* ============================================================ 详情 */

  function renderDetail(drawer, item, today, store, handlers) {
    var act = item.activity;
    var status = item.status;
    var cred = item.credibility;

    var meta = drawer.querySelector("#drawer-meta");
    var title = drawer.querySelector("#drawer-title");
    var body = drawer.querySelector("#drawer-body");
    var foot = drawer.querySelector("#drawer-foot");

    meta.textContent = "";
    meta.appendChild(badge(status.label, status.tone, statusIcon(status.code)));
    meta.appendChild(sourceTag(act));
    meta.appendChild(badge(L.CATEGORY_LABELS[act.category] || act.category, "neutral"));
    if (act.updates && act.updates.length) {
      meta.appendChild(badge("已更新 " + act.updates.length + " 次", "info", "i-history"));
    }
    title.textContent = act.title;
    body.textContent = "";
    foot.textContent = "";

    /* 状态说明 */
    var statusBox = el("div", "trust");
    statusBox.dataset.level = status.tone === "danger" ? "suspicious" : (status.tone === "warning" ? "attention" : "info");
    if (statusBox.dataset.level === "info") statusBox.removeAttribute("data-level");
    statusBox.appendChild(icon(statusIcon(status.code)));
    var statusText = el("div");
    statusText.appendChild(el("strong", null, status.label + "。"));
    statusText.appendChild(document.createTextNode(" " + (status.reason || "")));
    statusBox.appendChild(statusText);
    body.appendChild(statusBox);

    /* 可信度提示（只在需要时出现） */
    if (cred.level !== "clean") {
      body.appendChild(renderTrust(cred));
    }

    /* 时间冲突：同一时段的活动重叠，列表形式看不出来 */
    if (handlers.conflicts && handlers.conflicts.length) {
      var conflictBox = renderConflicts(handlers.conflicts, handlers);
      if (conflictBox) body.appendChild(conflictBox);
    }

    /* 时效预警：如 17 号资料的提取信息有效期 */
    var expiryBox = renderExpiry(L.computeExpiry(act, today));
    if (expiryBox) body.appendChild(expiryBox);

    /* 关键信息 */
    var infoSection = el("section", "section");
    var infoTitle = el("h3", "section-title");
    infoTitle.appendChild(icon("i-info"));
    infoTitle.appendChild(el("span", null, "关键信息"));
    infoSection.appendChild(infoTitle);

    var dl = el("dl", "dl");
    addRow(dl, "报名方式", act.registration.required === false ? "无需报名"
      : (act.registration.method || null), act.registration.methodNote);
    addRow(dl, "报名截止", act.registration.deadlineAt
      ? L.formatDate(act.registration.deadlineAt) + (L.formatTime(act.registration.deadlineAt) ? " " + L.formatTime(act.registration.deadlineAt) : "")
      : null, act.registration.deadlineText);
    addRow(dl, "活动时间", scheduleText(act, today));
    addRow(dl, "活动地点", act.schedule.location, act.schedule.locationNote);
    addRow(dl, "适用对象", eligibilityText(act));
    addRow(dl, "人数与名额", capacityText(act));
    addRow(dl, "费用", act.registration.fee != null ? String(act.registration.fee) : null,
      act.registration.feeText || act.registration.feeNote);
    infoSection.appendChild(dl);
    body.appendChild(infoSection);

    /* 详细说明 */
    var detailSection = el("section", "section");
    var detailTitle = el("h3", "section-title");
    detailTitle.appendChild(icon("i-info"));
    detailTitle.appendChild(el("span", null, "详细说明"));
    detailSection.appendChild(detailTitle);
    detailSection.appendChild(el("p", "prose", act.detail));
    if (act.tags && act.tags.length) {
      var tags = el("div", "tag-list");
      act.tags.forEach(function (t) { tags.appendChild(el("span", "tag", t)); });
      detailSection.appendChild(tags);
    }
    body.appendChild(detailSection);

    /* 缺失信息：显式呈现，不隐藏 */
    if (act.missingFields && act.missingFields.length) {
      var missSection = el("section", "section");
      var missTitle = el("h3", "section-title");
      missTitle.appendChild(icon("i-alert"));
      missTitle.appendChild(el("span", null, "未标明或未说明的信息"));
      missSection.appendChild(missTitle);
      missSection.appendChild(el("p", "prose",
        "以下内容在原始信息中没有给出。平台不进行推测，需要你向主办方确认："));
      var missTags = el("div", "tag-list");
      act.missingFields.forEach(function (f) {
        missTags.appendChild(el("span", "tag tag-warning", f));
      });
      missSection.appendChild(missTags);
      body.appendChild(missSection);
    }

    /* 变更记录 */
    if (act.updates && act.updates.length) {
      var upSection = el("section", "section");
      var upTitle = el("h3", "section-title");
      upTitle.appendChild(icon("i-history"));
      upTitle.appendChild(el("span", null, "通知变更记录"));
      upSection.appendChild(upTitle);

      var list = el("div", "changes");
      act.updates.forEach(function (u) {
        var item = el("div", "change-item");
        var head = el("div", "change-head");
        head.appendChild(icon("i-history"));
        head.appendChild(el("span", null, "原始信息 " + u.ref + " 号的补充通知"));
        item.appendChild(head);

        var rows = el("div", "change-list");
        u.changes.forEach(function (c) {
          var row = el("div", "change-row");
          row.appendChild(el("span", "change-field", c.field));
          row.appendChild(el("span", "change-from", c.from));
          row.appendChild(el("span", "change-arrow", "→"));
          row.appendChild(el("span", "change-to", c.to));
          rows.appendChild(row);
        });
        item.appendChild(rows);

        if (u.actionHint) {
          item.appendChild(el("p", "change-note", "提示：" + u.actionHint));
        }
        list.appendChild(item);
      });
      upSection.appendChild(list);
      body.appendChild(upSection);
    }

    /* 原文对照：可核查，避免"AI 改写"质疑 */
    var rawSection = el("section", "section");
    var rawTitle = el("h3", "section-title");
    rawTitle.appendChild(icon("i-check"));
    rawTitle.appendChild(el("span", null, "原始信息对照"));
    rawSection.appendChild(rawTitle);
    var quote = el("blockquote", "raw-quote");
    quote.appendChild(el("span", "ref", "原始信息 " + act.sourceRef + " 号"));
    quote.appendChild(document.createTextNode("　" + act.rawSummary));
    rawSection.appendChild(quote);
    if (act.relatedRefs && act.relatedRefs.length) {
      rawSection.appendChild(el("p", "change-note",
        "本条已合并 " + act.relatedRefs.join("、") + " 号补充通知，原文内容完整保留在上方变更记录中。"));
    }
    body.appendChild(rawSection);

    /* 底部操作 */
    var favBtn = el("button", "btn btn-block");
    favBtn.type = "button";
    var setFav = function () {
      var on = store.isFavorite(act.id);
      favBtn.textContent = "";
      favBtn.appendChild(icon(on ? "i-bookmark-fill" : "i-bookmark"));
      favBtn.appendChild(el("span", null, on ? "已收藏" : "收藏"));
      favBtn.setAttribute("aria-pressed", String(on));
    };
    setFav();
    favBtn.addEventListener("click", function () {
      handlers.toggleFavorite(act.id);
      setFav();
    });

    var regBtn = el("button", "btn btn-primary btn-block");
    regBtn.type = "button";
    var setReg = function () {
      var on = store.isRegistered(act.id);
      regBtn.textContent = "";
      regBtn.appendChild(icon(on ? "i-check" : "i-plus"));
      regBtn.appendChild(el("span", null, on ? "我已报名 / 已参加" : "标记我要参加"));
      regBtn.setAttribute("aria-pressed", String(on));
    };
    setReg();
    regBtn.addEventListener("click", function () {
      handlers.toggleRegistered(act.id);
      setReg();
    });

    foot.appendChild(favBtn);
    foot.appendChild(regBtn);

    /* 日历导出：零后端、零权限，双击即可导入手机日历。
       这是"怕忘记截止时间"最直接有效的解法。 */
    if (L.sessionWindow(act) || act.registration.deadlineAt) {
      var icsBtn = el("button", "btn btn-block");
      icsBtn.type = "button";
      icsBtn.title = "下载 .ics 文件，双击即可导入手机或电脑日历";
      icsBtn.appendChild(icon("i-calendar"));
      icsBtn.appendChild(el("span", null, "加入日历"));
      icsBtn.addEventListener("click", function () {
        var ics = L.buildCalendar([act], today);
        var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = act.id + ".ics";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        if (handlers.onExport) handlers.onExport(act);
      });
      foot.appendChild(icsBtn);
    }
  }

  function renderTrust(cred) {
    var box = el("div", "trust");
    box.dataset.level = cred.level;
    box.appendChild(icon(cred.level === "suspicious" ? "i-alert" : "i-info"));
    var wrap = el("div");
    wrap.appendChild(el("strong", null,
      cred.level === "suspicious" ? "这条信息可能不是正常的校园活动" : "这条信息有需要留意的地方"));
    wrap.appendChild(el("p", null,
      "平台只做提示，不删除内容。判定依据（可信度评分 " + cred.score + "）："));
    var ul = el("ul", "trust-reasons");
    (cred.displaySignals || cred.signals).forEach(function (s) {
      var li = el("li", null, s.label + "：" + s.detail);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    wrap.appendChild(el("p", "change-note",
      "如果你确认这条信息与校园活动无关，可以忽略它；如需继续了解，请先核实主办方与线下地点。"));
    box.appendChild(wrap);
    return box;
  }

  function addRow(dl, label, value, note) {
    dl.appendChild(el("dt", null, label));
    var dd = el("dd");
    if (value) {
      dd.appendChild(document.createTextNode(value));
      if (note) dd.appendChild(el("span", "change-note", "（" + note + "）"));
    } else {
      var missing = el("span", "missing", "未提供");
      missing.title = note || "原始信息中没有给出该字段，平台不作推测";
      dd.appendChild(missing);
      if (note) dd.appendChild(el("span", "change-note", " " + note));
    }
    dl.appendChild(dd);
  }

  /* ============================================================ 时间线 */

  /**
   * 时间线：按「天 → 活动」两层归组。
   *
   * 为什么这样改：同一个活动可能有"报名截止"和"活动开始"两个节点，
   * 若把它们当作两条独立记录平铺，同一天里就会出现多行看起来重复的内容。
   * 按天归组后，一天一张卡，卡内按活动聚合，一个活动只出现一次。
   */
  function renderTimeline(container, timeline, store, handlers, today) {
    container.textContent = "";
    if (!timeline.all.length) {
      container.appendChild(el("p", "prose", "暂时没有可展示的时间节点。"));
      return;
    }

    /* 一次遍历：按日期建天，天内按活动归并，保持首次出现的顺序 */
    var days = [];
    var dayIndex = {};
    timeline.all.forEach(function (e) {
      var date = L.isoDatePart(e.at);
      if (!date) return;

      var day = dayIndex[date];
      if (!day) {
        day = {
          date: date,
          daysLeft: L.daysBetween(today, date),
          items: 0,
          groups: [],
          groupIndex: {}
        };
        dayIndex[date] = day;
        days.push(day);
      }
      day.items++;

      var group = day.groupIndex[e.activityId];
      if (!group) {
        group = { activityId: e.activityId, activity: null, nodes: [] };
        day.groupIndex[e.activityId] = group;
        day.groups.push(group);
      }
      /* 保留活动对象，供后续读取标题与状态 */
      if (!group.activity) group.activity = e.activity;
      group.nodes.push(e);
    });

    days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    days.forEach(function (day) {
      var card = el("div", "tlday");
      card.dataset.daysLeft = String(day.daysLeft);

      /* 日期头：日期 + 相对天数 + 当天节点数 */
      var head = el("div", "tlday-head");
      var dateWrap = el("div", "tlday-date");
      dateWrap.appendChild(el("span", "tlday-day", L.formatDate(day.date)));
      var rel = day.daysLeft === 0 ? "今天" : day.daysLeft === 1 ? "明天" : day.daysLeft + " 天后";
      var relNode = el("span", "tlday-rel", rel);
      relNode.dataset.tone = day.daysLeft === 0 ? "danger" : day.daysLeft <= 3 ? "warning" : "accent";
      dateWrap.appendChild(relNode);
      head.appendChild(dateWrap);
      head.appendChild(el("span", "tlday-count", day.groups.length + " 项"));
      if (day.items > day.groups.length) {
        head.appendChild(el("span", "tlday-note", "共 " + day.items + " 个节点"));
      }
      card.appendChild(head);

      /* 当天每个活动一行，行内用标签区分"报名截止 / 活动开始 / 作品提交" */
      day.groups.forEach(function (group) {
        var row = el("button", "tlrow");
        row.type = "button";

        var main = el("div", "tlrow-main");
        main.appendChild(el("span", "tlrow-title", group.activity.title));

        var meta = el("div", "tlrow-meta");
        /* 同一活动可能有多个节点，全部列出，不再拆成多行 */
        group.nodes.forEach(function (node, i) {
          if (i > 0) meta.appendChild(el("span", "tlrow-plus", "+"));
          var tag = el("span", "tlrow-tag");
          tag.dataset.kind = node.kind;
          tag.appendChild(icon(node.kind === "deadline" ? "i-clock"
            : node.kind === "submit" ? "i-external" : "i-play"));
          tag.appendChild(el("span", null,
            node.kindLabel + (node.kind === "session" && L.formatTime(node.at)
              ? " " + L.formatTime(node.at) : "")));
          meta.appendChild(tag);
        });
        main.appendChild(meta);

        row.appendChild(main);

        var status = L.computeStatus(group.activity, today);
        var badgeNode = el("span", "tlrow-status", status.label);
        badgeNode.dataset.tone = status.tone;
        row.appendChild(badgeNode);

        row.addEventListener("click", function () { handlers.openDetail(group.activity.id); });
        card.appendChild(row);
      });

      container.appendChild(card);
    });
  }

  /* ============================================================ 图例 */

  function renderSourceLegend(container, options, activeSources, onToggle) {
    container.textContent = "";
    options.forEach(function (opt) {
      var row = el("button", "legend-item");
      row.type = "button";
      row.setAttribute("aria-pressed", String(activeSources.indexOf(opt.code) >= 0));
      var dot = el("span", "dot");
      dot.dataset.tone = L.SOURCE_TYPES[opt.code].tone;
      row.appendChild(dot);
      row.appendChild(el("span", null, opt.label));
      row.appendChild(el("span", "num", opt.count));
      row.addEventListener("click", function () { onToggle(opt.code); });
      container.appendChild(row);
    });
  }

  /* ============================================================ 我的面板 */

  function renderMine(container, favorites, registered, posts, today, store, handlers) {
    container.textContent = "";

    container.appendChild(el("p", "prose",
      "收藏、报名标记与你发布的信息都保存在这台设备的浏览器里，刷新或重新打开都会保留。"));

    container.appendChild(mineSection(
      "我发布的（" + posts.length + "）",
      posts.length ? posts.map(function (p) {
        return {
          title: p.title,
          note: [p.scheduleText, p.location, p.capacity ? "限 " + p.capacity + " 人" : null]
            .filter(Boolean).join(" · ") || "时间地点未填写",
          actions: [
            { label: "编辑", iconName: "i-edit", run: function () { handlers.editPost(p.id); } },
            { label: "撤回", iconName: "i-trash", run: function () { handlers.removePost(p.id); }, danger: true }
          ]
        };
      }) : null,
      "还没有发布内容。点右上角「发布信息」，可以发起约球、招募搭子或组队。",
      "i-edit"
    ));

    container.appendChild(mineSection(
      "我要参加的（" + registered.length + "）",
      registered.length ? registered.map(function (a) {
        return {
          title: a.title,
          note: "报名截止 " + deadlineShort(a),
          actions: [{ label: "查看", iconName: "i-chevron", run: function () { handlers.openDetail(a.id); } }]
        };
      }) : null,
      "在卡片或详情里点「标记我要参加」，这里会汇总你的报名清单与截止时间。",
      "i-check"
    ));

    container.appendChild(mineSection(
      "收藏的（" + favorites.length + "）",
      favorites.length ? favorites.map(function (a) {
        return {
          title: a.title,
          note: (L.CATEGORY_LABELS[a.category] || a.category) + " · 来源 " + (L.SOURCE_TYPES[a.source.type] || {}).label,
          actions: [{ label: "查看", iconName: "i-chevron", run: function () { handlers.openDetail(a.id); } }]
        };
      }) : null,
      "点卡片右下角的书签图标即可收藏。",
      "i-bookmark"
    ));
  }

  function deadlineShort(act) {
    if (act.registration.deadlineAt) {
      return L.formatDate(act.registration.deadlineAt) + " " + (L.formatTime(act.registration.deadlineAt) || "");
    }
    return act.registration.deadlineText || "未说明";
  }

  function mineSection(title, items, emptyText, iconName) {
    var section = el("section", "section");
    var h = el("h3", "section-title");
    h.appendChild(icon(iconName || "i-info"));
    h.appendChild(el("span", null, title));
    section.appendChild(h);

    if (!items) {
      section.appendChild(el("p", "prose", emptyText));
      return section;
    }

    var list = el("div", "changes");
    items.forEach(function (it) {
      var row = el("div", "change-item");
      row.appendChild(el("div", "change-head", it.title));
      if (it.note) row.appendChild(el("p", "change-note", it.note));
      var actions = el("div", "filter-row");
      actions.style.marginTop = "var(--sp-3)";
      it.actions.forEach(function (a) {
        var b = el("button", "btn" + (a.danger ? " btn-danger" : ""));
        b.type = "button";
        b.appendChild(icon(a.iconName));
        b.appendChild(el("span", null, a.label));
        b.addEventListener("click", a.run);
        actions.appendChild(b);
      });
      row.appendChild(actions);
      list.appendChild(row);
    });
    section.appendChild(list);
    return section;
  }

  /* ============================================================ 时间机器 */

  /**
   * 把「未来几天会发生什么」渲染成一条可横向滚动的日程带。
   * 每张卡是一个日期，卡内是该日将发生的节点：报名截止、活动开始、信息失效。
   */
  function renderMachine(container, noteEl, descEl, transitions, today, handlers) {
    container.textContent = "";

    if (!transitions.length) {
      noteEl.textContent = "无";
      descEl.textContent = "以当前基准日往后看，未来一段时间内没有安排变化。";
      container.appendChild(el("p", "machine-empty", "可以试试把「今天」调早几天，或清空筛选条件。"));
      return;
    }

    var changed = transitions.filter(function (t) { return t.changes; }).length;
    noteEl.textContent = transitions.length + " 个节点" + (changed ? "，其中 " + changed + " 个会改变状态" : "");
    descEl.textContent = "所有状态都是按当前基准日算出来的。这里把未来几天的变化提前告诉你——" +
      "哪条会截止、哪天会开始、哪份资料会失效。";

    /* 按日期分组 */
    var groups = [];
    var index = {};
    transitions.forEach(function (t) {
      var key = t.offsetDays + "|" + L.isoDatePart(t.at);
      if (!index[key]) {
        index[key] = { offset: t.offsetDays, date: L.isoDatePart(t.at), items: [] };
        groups.push(index[key]);
      }
      index[key].items.push(t);
    });

    groups.forEach(function (g) {
      var day = el("div", "machine-day");

      var head = el("div", "machine-day-head");
      head.appendChild(el("span", "machine-day-date", L.formatDate(g.date)));
      head.appendChild(el("span", "machine-day-offset",
        g.offset === 1 ? "明天" : g.offset + " 天后"));
      day.appendChild(head);

      g.items.forEach(function (t) {
        var item = el("button", "machine-item");
        item.type = "button";
        item.dataset.kind = t.kind;
        item.appendChild(icon(t.kind === "deadline" ? "i-clock"
          : t.kind === "expiry" ? "i-alert" : "i-play"));

        var body = el("div", "machine-item-body");
        var label = t.kindLabel + (t.kind === "deadline" || t.kind === "session"
          ? " · " + (L.formatTime(t.at) || "") : "");
        body.appendChild(el("span", "machine-item-label", label.trim()));
        body.appendChild(el("span", "machine-item-title", t.activity.title));
        if (t.changes) {
          body.appendChild(el("span", "machine-item-change",
            t.fromStatus.label + " → " + t.toStatus.label));
        }
        item.appendChild(body);

        item.addEventListener("click", function () { handlers.openDetail(t.activity.id); });
        day.appendChild(item);
      });

      container.appendChild(day);
    });
  }

  /* ============================================================ 精力预算 */

  function renderBudget(panel, barEl, bodyEl, noteEl, budget, handlers) {
    /* 预算为 0 时整块隐藏；取消 hidden 后由 .panel 内既有块级结构自然纵向排列，
       不需要额外内联样式 */
    panel.hidden = !(budget && budget.budget > 0);
    if (panel.hidden) return;

    barEl.textContent = "";
    bodyEl.textContent = "";

    var ratio = budget.budget > 0 ? Math.min(1, budget.committedHours / budget.budget) : 0;
    var meter = el("div", "budget-meter");
    var fill = el("div", "budget-fill");
    fill.style.width = Math.round(ratio * 100) + "%";
    fill.dataset.over = String(budget.over);
    meter.appendChild(fill);
    barEl.appendChild(meter);

    var legend = el("div", "budget-legend");
    legend.appendChild(el("span", null, "已投入 " + budget.committedHours + " 小时"));
    legend.appendChild(el("span", null, "预算 " + budget.budget + " 小时"));
    barEl.appendChild(legend);

    noteEl.textContent = budget.committedCount + " 项在「我要参加」里";

    /* 数字概要 */
    var numbers = el("div", "budget-numbers");
    var stats = [
      { label: "已在「我要参加」", value: budget.committedCount + " 项", tone: null },
      { label: "已投入时间", value: budget.committedHours + " 小时/周",
        tone: budget.over ? "danger" : "accent" },
      { label: "剩余预算", value: (budget.remaining >= 0 ? budget.remaining : budget.remaining) + " 小时/周",
        tone: budget.remaining < 0 ? "danger" : null }
    ];
    stats.forEach(function (s) {
      var stat = el("div", "budget-stat");
      stat.appendChild(el("span", "budget-stat-label", s.label));
      var v = el("span", "budget-stat-value", s.value);
      if (s.tone) v.dataset.tone = s.tone;
      stat.appendChild(v);
      numbers.appendChild(stat);
    });
    bodyEl.appendChild(numbers);

    /* 建议 */
    if (budget.over) {
      var advice = el("div", "budget-advice");
      advice.appendChild(el("strong", null, "按当前预算排不下。"));
      advice.appendChild(document.createTextNode(
        " 你标记参加的机会合计每周需要 " + budget.committedHours + " 小时，超出预算 " +
        Math.abs(budget.remaining) + " 小时。"));
      bodyEl.appendChild(advice);

      if (budget.suggestion.length) {
        bodyEl.appendChild(el("p", "filter-hint",
          "若只保留下面这些，每周共 " + budget.suggestionHours + " 小时，能塞进预算："));
        var picks = el("div", "budget-picks");
        budget.suggestion.forEach(function (it) {
          var chip = el("button", "chip");
          chip.type = "button";
          chip.appendChild(icon("i-check"));
          chip.appendChild(el("span", null,
            it.activity.title + " · " + it.activity.eligibility.weeklyHours + "h"));
          chip.addEventListener("click", function () { handlers.openDetail(it.activity.id); });
          picks.appendChild(chip);
        });
        bodyEl.appendChild(picks);
      }
    } else if (budget.committedCount > 0) {
      var ok = el("div", "budget-advice");
      ok.dataset.tone = "accent";
      ok.appendChild(el("strong", null, "排得下。"));
      ok.appendChild(document.createTextNode(
        " 已投入 " + budget.committedHours + " 小时，还剩 " + budget.remaining + " 小时/周。"));
      if (budget.availableCount > budget.committedCount) {
        ok.appendChild(document.createTextNode(
          " 还有 " + (budget.availableCount - budget.committedCount) + " 项有时间投入要求的机会未标记。"));
      }
      bodyEl.appendChild(ok);
    } else {
      bodyEl.appendChild(el("p", "filter-hint",
        "在卡片上点「我要参加」，这里会帮你核算每周时间是否排得下。" +
        "已有 3 项机会写明了每周投入要求（4 / 5 / 6 小时）。"));
    }
  }

  /* ============================================================ 时效与撞车 */

  function renderExpiry(expiry) {
    if (!expiry) return null;
    var box = el("div", "expiry");
    box.dataset.tone = expiry.expired ? "danger" : "warning";
    box.appendChild(icon(expiry.expired ? "i-alert" : "i-clock"));
    var text = expiry.expired
      ? "该信息的有效期已过（" + L.formatDate(expiry.at) + "），需要等待主办方更新。"
      : "这条信息在 " + L.formatDate(expiry.at) + " 后失效（还有 " + expiry.daysLeft + " 天）。";
    var wrap = el("div");
    wrap.appendChild(el("strong", null, expiry.expired ? "已失效 " : "时效提醒 "));
    wrap.appendChild(document.createTextNode(text));
    if (expiry.note) wrap.appendChild(el("div", "change-note", "原文：" + expiry.note));
    box.appendChild(wrap);
    return box;
  }

  function renderConflicts(conflicts, handlers) {
    if (!conflicts.length) return null;
    var sameDay = conflicts.filter(function (c) { return c.severity === "conflict"; });
    var box = el("div", "conflict");

    var head = el("div", "conflict-head");
    head.appendChild(icon("i-alert"));
    head.appendChild(el("span", null,
      sameDay.length ? "时间冲突（" + conflicts.length + " 项）" : "时间相近（" + conflicts.length + " 项）"));
    box.appendChild(head);

    box.appendChild(el("p", "conflict-desc",
      sameDay.length
        ? "以下机会与这条在时间上重叠，需要二选一或提前与主办方确认能否兼顾："
        : "以下机会时间接近，注意赶场："));
    var list = el("div", "conflict-list");

    conflicts.forEach(function (c) {
      var item = el("button", "conflict-item");
      item.type = "button";
      item.appendChild(el("time", null, c.range + (c.sameDay ? "" : "（" + L.formatDate(c.activity.schedule.firstSessionAt) + "）")));
      item.appendChild(el("span", null, c.activity.title));
      item.appendChild(el("em", null, c.reason));
      item.addEventListener("click", function () { handlers.openDetail(c.activity.id); });
      list.appendChild(item);
    });

    box.appendChild(list);
    return box;
  }

  /* ============================================================ 密度与日历 */

  /**
   * 繁忙度密度条：14 格，一眼看出哪几天最挤。
   * 每格显示日期数字 + 用点的颜色区分"有活动"与"有截止"。
   */
  function renderDensity(container, density, handlers) {
    container.textContent = "";
    if (!density.length) return;

    var peak = density.reduce(function (max, d) { return Math.max(max, d.load); }, 0);

    density.forEach(function (d) {
      var cell = el("button", "density-cell");
      cell.type = "button";
      cell.dataset.level = String(d.level);
      cell.dataset.today = String(d.isToday);
      cell.dataset.weekend = String(d.isWeekend);
      cell.title = d.date + "（周" + d.weekday + "）：活动 " + d.sessions +
        " 场，截止 " + d.deadlines + " 项" + (d.conflicts ? "，冲突 " + d.conflicts + " 处" : "");

      cell.appendChild(el("span", "density-day", d.isToday ? "今" : String(d.day)));

      var dots = el("span", "density-dots");
      var total = Math.min(4, d.load);
      for (var i = 0; i < total; i++) {
        var dot = document.createElement("i");
        dot.dataset.kind = i < d.sessions ? "session" : "deadline";
        dots.appendChild(dot);
      }
      cell.appendChild(dots);

      if (handlers && handlers.onPickDate) {
        cell.addEventListener("click", function () { handlers.onPickDate(d.date); });
      }
      container.appendChild(cell);
    });

    if (peak >= 4) {
      var legend = el("div", "density-legend");
      [["session", "活动"], ["deadline", "报名截止"]].forEach(function (pair) {
        var span = el("span");
        var swatch = document.createElement("i");
        swatch.dataset.kind = pair[0];
        span.appendChild(swatch);
        span.appendChild(el("span", null, pair[1]));
        legend.appendChild(span);
      });
      container.parentNode.insertBefore(legend, container);
    }
  }

  /**
   * 月历视图：把活动摊到日历格子里。
   * 列表只能按状态排序，看不出"某一天到底挤了多少事"；日历把时间维度直接画出来。
   */
  function renderCalendarView(container, grid, today, handlers) {
    container.textContent = "";
    if (!grid) return;

    var wrap = el("div", "cal");

    var head = el("div", "cal-head");
    head.appendChild(el("span", "cal-month", grid.label));
    head.appendChild(el("span", "cal-stats",
      grid.stats.entries + " 个节点 · " + grid.stats.activeDays + " 天有事" +
      (grid.stats.conflictDays ? " · " + grid.stats.conflictDays + " 天冲突" : "")));
    wrap.appendChild(head);

    var weekdays = el("div", "cal-weekdays");
    grid.weekdayLabels.forEach(function (w) { weekdays.appendChild(el("span", null, w)); });
    wrap.appendChild(weekdays);

    grid.weeks.forEach(function (week) {
      var row = el("div", "cal-week");
      week.forEach(function (cell) {
        var node = el("button", "cal-cell");
        node.type = "button";
        node.dataset.outside = String(!cell.inMonth);
        node.dataset.past = String(cell.isPast && !cell.isToday);
        node.dataset.today = String(cell.isToday);
        node.dataset.conflict = String(cell.hasConflict);
        node.title = cell.date + "：" + cell.entries.length + " 个节点" +
          (cell.hasConflict ? "（存在时间冲突）" : "");

        node.appendChild(el("span", "cal-day", String(cell.day)));

        var marks = el("span", "cal-marks");
        cell.entries.slice(0, 4).forEach(function (e) {
          var dot = document.createElement("i");
          dot.dataset.kind = e.kind;
          marks.appendChild(dot);
        });
        node.appendChild(marks);

        if (cell.entries.length > 4) {
          node.appendChild(el("span", "cal-count", "+" + (cell.entries.length - 4)));
        } else if (cell.entries.length) {
          node.appendChild(el("span", "cal-count", String(cell.entries.length)));
        }

        node.addEventListener("click", function () { showDayDetail(wrap, cell, handlers); });
        row.appendChild(node);
      });
      wrap.appendChild(row);
    });

    /* 默认展开今天，让日历打开就有内容 */
    var todayCell = grid.weeks.reduce(function (found, w) {
      return found || w.filter(function (c) { return c.isToday; })[0];
    }, null);
    if (todayCell) showDayDetail(wrap, todayCell, handlers);

    container.appendChild(wrap);
  }

  function showDayDetail(wrap, cell, handlers) {
    var old = wrap.querySelector(".cal-detail");
    if (old) old.remove();

    var box = el("div", "cal-detail");
    box.appendChild(el("span", "cal-detail-date",
      L.formatDate(cell.date) + " · " + (cell.entries.length ? cell.entries.length + " 个节点" : "没有安排")));

    if (!cell.entries.length) {
      box.appendChild(el("p", "filter-hint", "这一天没有活动、截止或失效提醒。"));
    }

    cell.entries.forEach(function (e) {
      var item = el("button", "cal-detail-item");
      item.type = "button";
      item.dataset.kind = e.kind;
      item.appendChild(icon(e.kind === "deadline" ? "i-clock" : e.kind === "expiry" ? "i-alert" : "i-play"));
      item.appendChild(el("span", null, e.activity.title));
      item.appendChild(el("em", null, e.kind === "session" ? e.label : e.label));
      if (handlers && handlers.openDetail) {
        item.addEventListener("click", function () { handlers.openDetail(e.activity.id); });
      }
      box.appendChild(item);
    });

    if (cell.hasConflict) {
      var warn = el("div", "conflict");
      var warnHead = el("div", "conflict-head");
      warnHead.appendChild(icon("i-alert"));
      warnHead.appendChild(el("span", null, "这一天存在时间冲突"));
      warn.appendChild(warnHead);
      warn.appendChild(el("p", "conflict-desc", "展开任一活动可看到具体重叠时段与需要取舍的选项。"));
      box.appendChild(warn);
    }

    wrap.appendChild(box);
  }

  /* ============================================================ 提示条 */

  function toast(container, message, tone, iconName) {
    var node = el("div", "toast");
    node.dataset.tone = tone || "accent";
    node.appendChild(icon(iconName || "i-check"));
    node.appendChild(el("span", null, message));
    container.appendChild(node);
    setTimeout(function () {
      node.style.transition = "opacity var(--t-slow) var(--ease)";
      node.style.opacity = "0";
      setTimeout(function () { node.remove(); }, 320);
    }, 2600);
  }

  /* ============================================================ 筛选控件 */

  function renderStatusFilter(container, current, counts, onSelect) {
    container.textContent = "";
    var options = [
      { code: "all", label: "全部" },
      { code: "urgent", label: "即将截止" },
      { code: "open", label: "可报名" },
      { code: "rolling", label: "长期" },
      { code: "closed", label: "已结束" }
    ];
    options.forEach(function (opt) {
      var b = el("button", null, opt.label + (counts[opt.code] ? " " + counts[opt.code] : ""));
      b.type = "button";
      b.setAttribute("aria-pressed", String(current === opt.code));
      b.addEventListener("click", function () { onSelect(opt.code); });
      container.appendChild(b);
    });
  }

  function renderChips(container, options, active, onToggle) {
    container.textContent = "";
    options.forEach(function (opt) {
      var b = el("button", "chip");
      b.type = "button";
      b.setAttribute("aria-pressed", String(active.indexOf(opt.code) >= 0));
      b.appendChild(el("span", null, opt.label));
      b.appendChild(el("span", "chip-count", opt.count));
      b.addEventListener("click", function () { onToggle(opt.code); });
      container.appendChild(b);
    });
  }

  return {
    init: init,
    el: el,
    icon: icon,
    badge: badge,
    sourceTag: sourceTag,

    renderKpis: renderKpis,
    renderFeed: renderFeed,
    renderCard: renderCard,
    renderDetail: renderDetail,
    renderTimeline: renderTimeline,
    renderSourceLegend: renderSourceLegend,
    renderMine: renderMine,
    renderStatusFilter: renderStatusFilter,
    renderChips: renderChips,
    toast: toast,

    /* 创新功能 */
    renderMachine: renderMachine,
    renderBudget: renderBudget,
    renderExpiry: renderExpiry,
    renderConflicts: renderConflicts,
    renderDensity: renderDensity,
    renderCalendarView: renderCalendarView,

    deadlineText: deadlineText,
    scheduleText: scheduleText,
    capacityText: capacityText,
    eligibilityText: eligibilityText,
    statusIcon: statusIcon
  };
});
