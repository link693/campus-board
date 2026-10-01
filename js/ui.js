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

  function renderCard(item, today, store, handlers) {
    var act = item.activity;
    var status = item.status;
    var cred = item.credibility;
    var isUser = act.source.type === "user";

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

    /* 底部操作 */
    var foot = el("div", "card-foot");
    var stateText = el("span", "card-status-note", status.reason || "");
    stateText.title = status.reason || "";
    foot.appendChild(stateText);

    var actions = el("div", "card-actions");

    var favBtn = iconButton(store.isFavorite(act.id) ? "i-bookmark-fill" : "i-bookmark",
      store.isFavorite(act.id) ? "取消收藏" : "收藏", store.isFavorite(act.id));
    favBtn.addEventListener("click", function () { handlers.toggleFavorite(act.id); });
    actions.appendChild(favBtn);

    var regBtn = iconButton(store.isRegistered(act.id) ? "i-check" : "i-plus",
      store.isRegistered(act.id) ? "取消「我要参加」" : "标记我要参加", store.isRegistered(act.id));
    regBtn.addEventListener("click", function () { handlers.toggleRegistered(act.id); });
    actions.appendChild(regBtn);

    if (isUser) {
      var editBtn = iconButton("i-edit", "编辑我的发布");
      editBtn.addEventListener("click", function () { handlers.editPost(act.id); });
      actions.appendChild(editBtn);
    }

    var more = iconButton("i-chevron", "查看详情");
    more.addEventListener("click", function () { handlers.openDetail(act.id); });
    actions.appendChild(more);

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
        grid.appendChild(renderCard(item, today, store, handlers));
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
      missTitle.appendChild(el("span", null, "题目未提供的信息"));
      missSection.appendChild(missTitle);
      missSection.appendChild(el("p", "prose",
        "以下字段在原始材料中没有给出。平台不进行推测，需要你向主办方确认："));
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
    rawTitle.appendChild(el("span", null, "题目原文对照"));
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
      missing.title = note || "题目材料中没有给出该信息，平台不作推测";
      dd.appendChild(missing);
      if (note) dd.appendChild(el("span", "change-note", " " + note));
    }
    dl.appendChild(dd);
  }

  /* ============================================================ 时间线 */

  function renderTimeline(container, timeline, store, handlers, today) {
    container.textContent = "";
    if (!timeline.all.length) {
      container.appendChild(el("p", "prose", "暂时没有可展示的时间节点。"));
      return;
    }

    if (timeline.today.length) {
      container.appendChild(el("div", "tl-group-label", "就在今天"));
      timeline.today.forEach(function (e) { container.appendChild(tlItem(e, today, handlers)); });
    }

    var groups = {};
    var order = [];
    timeline.upcoming.forEach(function (e) {
      var d = L.isoDatePart(e.at);
      if (!groups[d]) { groups[d] = []; order.push(d); }
      groups[d].push(e);
    });

    order.forEach(function (d) {
      var rel = L.relativeDays(d, today);
      container.appendChild(el("div", "tl-group-label", L.formatDate(d) + (rel ? " · " + rel : "")));
      groups[d].forEach(function (e) { container.appendChild(tlItem(e, today, handlers)); });
    });
  }

  function tlItem(entry, today, handlers) {
    var btn = el("button", "tl-item");
    btn.type = "button";
    btn.dataset.kind = entry.kind;

    var when = el("div", "tl-when");
    var left = entry.daysLeft;
    var tone = left === 0 ? "danger" : left <= 3 ? "warning" : "accent";
    when.appendChild(el("span", "tl-left num", left === 0 ? "今天" : left + "天"));
    when.firstChild.dataset.tone = tone;
    when.appendChild(el("time", "tl-date", L.formatTime(entry.at) || "全天"));
    btn.appendChild(when);

    var body = el("div", "tl-body");
    body.appendChild(el("span", "tl-kind", entry.kindLabel));
    body.appendChild(el("span", "tl-title", entry.label));
    btn.appendChild(body);

    btn.addEventListener("click", function () { handlers.openDetail(entry.activityId); });
    return btn;
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

    deadlineText: deadlineText,
    scheduleText: scheduleText,
    capacityText: capacityText,
    eligibilityText: eligibilityText,
    statusIcon: statusIcon
  };
});
