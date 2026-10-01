/* 校园活动板 · 控制器
 *
 * 职责：读取数据 → 建立状态 → 绑定筛选与抽屉 → 渲染 → 处理发布与本地状态。
 * 业务判断一律调用 js/logic.js，本文件不重复实现状态规则。
 */
(function () {
  "use strict";

  var L = window.CampusLogic;
  var UI = window.CampusUI;
  var DATA = window.CAMPUS_DATA;

  if (!L || !UI || !DATA) {
    document.body.insertAdjacentHTML("afterbegin",
      '<p style="padding:16px;color:#ff6b81">数据或逻辑脚本未加载，请确认 js/ 目录完整。</p>');
    return;
  }

  UI.init(L);

  var TODAY = DATA.meta.baselineDate;
  // 传入 window 本身，让 store 在 try/catch 内部解析 localStorage，
  // 避免在实参求值阶段就抛错（历史上正是这个原因导致持久化静默失效）。
  var store = window.CampusStore.createStore(window);

  /* ------------------------------------------------------------ DOM 引用 */

  var dom = {
    kpis: document.getElementById("kpis"),
    feed: document.getElementById("feed"),
    todayValue: document.getElementById("today-value"),
    todayHint: document.getElementById("today-hint"),
    q: document.getElementById("q"),
    statusFilter: document.getElementById("status-filter"),
    gradeFilter: document.getElementById("grade-filter"),
    sourceFilter: document.getElementById("source-filter"),
    categoryFilter: document.getElementById("category-filter"),
    sourceLegend: document.getElementById("source-legend"),
    freshmanMode: document.getElementById("freshman-mode"),
    hideSuspicious: document.getElementById("hide-suspicious"),
    fromNow: document.getElementById("from-now"),
    moreFilters: document.getElementById("more-filters"),
    filtersToggle: document.getElementById("filters-toggle"),
    filtersCount: document.getElementById("filters-count"),
    summary: document.getElementById("result-summary"),
    resetFilters: document.getElementById("reset-filters"),
    timeline: document.getElementById("timeline"),
    timelineNote: document.getElementById("timeline-note"),
    overlay: document.getElementById("overlay"),
    drawer: document.getElementById("drawer"),
    drawerClose: document.getElementById("drawer-close"),
    publishDrawer: document.getElementById("publish-drawer"),
    publishForm: document.getElementById("publish-form"),
    publishCheck: document.getElementById("publish-check"),
    mineDrawer: document.getElementById("mine-drawer"),
    mineBody: document.getElementById("mine-body"),
    mineCount: document.getElementById("mine-count"),
    toasts: document.getElementById("toasts"),
    openPublish: document.getElementById("open-publish"),
    openMine: document.getElementById("open-mine"),
    clearLocal: document.getElementById("clear-local"),
    repoLink: document.getElementById("repo-link"),
    /* 创新功能：时间机器与精力预算 */
    baselineDate: document.getElementById("baseline-date"),
    resetDate: document.getElementById("reset-date"),
    baselineHint: document.getElementById("baseline-hint"),
    weeklyBudget: document.getElementById("weekly-budget"),
    budgetHint: document.getElementById("budget-hint"),
    machineStrip: document.getElementById("machine-strip"),
    machineNote: document.getElementById("machine-note"),
    machineDesc: document.getElementById("machine-desc"),
    budgetPanel: document.getElementById("budget-panel"),
    budgetBar: document.getElementById("budget-bar"),
    budgetBody: document.getElementById("budget-body"),
    budgetNote: document.getElementById("budget-note"),
    /* 时间线视图切换与密度条 */
    viewSwitch: document.getElementById("view-switch"),
    density: document.getElementById("density"),
    timelinePanel: document.getElementById("timeline")
  };

  /* 筛选状态：从本地恢复，保证刷新后一致。
     baseline 是"当前认为的今天"，可由时间机器改变；它贯穿全部状态计算。 */
  var filters = Object.assign({
    grade: 0,
    fromNow: true,
    baseline: TODAY,
    weeklyBudget: 0,
    timelineView: "list"
  }, store.filters());
  if (!filters.baseline) filters.baseline = TODAY;

  var openDrawer = null;
  var lastFocused = null;
  var editingPostId = null;

  /* ============================================================ 数据组装 */

  /** 用户发布的内容规范化成与内置条目同构的对象，走同一套状态与可信度逻辑。 */
  function normalizePost(post) {
    var hasDate = !!post.date;
    var hasDeadline = !!post.deadline;
    return {
      id: post.id,
      sourceRef: "用户发布",
      relatedRefs: [],
      rawSummary: post.detail || "",
      title: post.title,
      source: {
        type: "user",
        label: "我发布的",
        publisher: "我发布",
        publisherNote: "由当前用户在本地发布"
      },
      category: post.category || "student-initiated",
      tags: ["我发布"].concat(post.contact ? [post.contact] : []),
      summary: (post.detail || "").slice(0, 60),
      detail: post.detail || "",
      registration: {
        required: hasDeadline,
        deadlineAt: hasDeadline ? post.deadline + "T23:59:00+08:00" : null,
        deadlineText: hasDeadline ? "由发布者设置：" + post.deadline : "未设置报名截止",
        method: post.contact || null,
        methodNote: post.contact ? null : "未填写联系方式",
        prerequisites: [],
        fee: null,
        feeNote: "未填写费用信息"
      },
      schedule: {
        firstSessionAt: hasDate ? post.date + "T19:00:00+08:00" : null,
        startDateText: hasDate ? post.date : null,
        endAt: null,
        timeText: null,
        recurrence: null,
        location: post.location || null,
        locationNote: post.location ? null : "未填写地点"
      },
      eligibility: {
        gradeRange: [1, 4],
        openToAll: true,
        majors: null,
        otherConditions: []
      },
      capacity: {
        limit: post.capacity ? Number(post.capacity) : null,
        limited: !!post.capacity,
        text: post.capacity ? "计划 " + post.capacity + " 人" : "人数未填写",
        full: false
      },
      missingFields: [hasDate ? null : "活动时间", hasDeadline ? null : "报名截止", post.location ? null : "地点"]
        .filter(Boolean),
      riskFlags: [],
      updates: [],
      isUserPost: true
    };
  }

  function allActivities() {
    var posts = store.myPosts().map(normalizePost);
    return posts.concat(DATA.activities);
  }

  /* ============================================================ 派生数据 */

  /** 当前生效的"今天"：时间机器可改，默认为内置的基准日。 */
  function baseline() {
    return filters.baseline || TODAY;
  }

  function currentSelection() {
    var activities = allActivities();
    var opts = {
      today: baseline(),
      keyword: filters.keyword,
      sources: filters.sources,
      categories: filters.categories,
      statuses: statusCodes(filters.status),
      freshOnly: filters.fromNow,
      hideSuspicious: filters.hideSuspicious,
      grade: filters.grade || null,
      onlyEligible: !!filters.grade
    };
    var items = L.selectActivities(activities, opts);
    return { activities: activities, items: items };
  }

  /**
   * 撞车映射：一次算好全部活动的冲突关系，供卡片标记使用。
   * 放在这里而不是每张卡片各算一次，避免 O(n²) 重复计算。
   */
  function buildConflictMap(activities) {
    var map = {};
    activities.forEach(function (act) {
      var conflicts = L.findConflicts(act, activities, baseline());
      if (conflicts.length) map[act.id] = conflicts;
    });
    return map;
  }

  /** 标记为「我要参加」且有时间要求的条目，供精力预算使用。 */
  function registeredItems(activities) {
    var reg = {};
    store.registeredIds().forEach(function (id) { reg[id] = true; });
    return L.decorateAll(activities, baseline(), { grade: filters.grade || null })
      .map(function (it) {
        it.registered = !!reg[it.activity.id];
        return it;
      })
      .filter(function (it) { return it.registered; });
  }

  function statusCodes(status) {
    switch (status) {
      case "urgent": return ["today", "last-call"];
      case "open": return ["open", "unknown"];
      case "rolling": return ["rolling", "info"];
      case "closed": return ["closed", "ended"];
      default: return null;
    }
  }

  function statusCounts(activities) {
    var counts = { all: activities.length, urgent: 0, open: 0, rolling: 0, closed: 0 };
    L.decorateAll(activities, baseline(), {}).forEach(function (it) {
      var code = it.status.code;
      if (code === "today" || code === "last-call") counts.urgent++;
      else if (code === "open" || code === "unknown") counts.open++;
      else if (code === "rolling" || code === "info") counts.rolling++;
      else if (code === "closed" || code === "ended") counts.closed++;
    });
    return counts;
  }

  /* ============================================================ 渲染 */

  function render() {
    var sel = currentSelection();
    var activities = sel.activities;
    var items = sel.items;

    var handlers = {
      openDetail: openDetail,
      toggleFavorite: function (id) {
        var on = store.toggleFavorite(id);
        UI.toast(dom.toasts, on ? "已加入收藏" : "已取消收藏", "accent",
          on ? "i-bookmark-fill" : "i-bookmark");
        render();
        refreshMine();
      },
      toggleRegistered: function (id) {
        var on = store.toggleRegistered(id);
        UI.toast(dom.toasts, on ? "已加入「我要参加」" : "已移出「我要参加」", "accent",
          on ? "i-check" : "i-close");
        render();
        refreshMine();
      },
      editPost: function (id) { openPublish(id); },
      removePost: function (id) {
        store.removePost(id);
        UI.toast(dom.toasts, "已撤回该发布", "warning", "i-trash");
        render();
        refreshMine();
      }
    };

    /* 头部 */
    dom.todayValue.textContent = baseline();
    dom.todayHint.textContent = baseline() === TODAY ? "以发布当日为判断基准" : "已由时间机器改写";

    /* 指标 */
    var summary = L.summarize(L.decorateAll(activities, baseline(), {}));
    var timeline = L.buildTimeline(activities, { today: baseline() });
    UI.renderKpis(dom.kpis, summary, timeline);

    /* 筛选控件 */
    var counts = statusCounts(activities);
    UI.renderStatusFilter(dom.statusFilter, filters.status, counts, function (code) {
      filters.status = code;
      persistFilters();
      render();
    });

    renderGradeFilter();

    UI.renderChips(dom.sourceFilter, L.sourceOptions(activities), filters.sources, function (code) {
      toggleIn(filters.sources, code);
      persistFilters();
      render();
    });

    UI.renderChips(dom.categoryFilter, L.categoryOptions(activities), filters.categories, function (code) {
      toggleIn(filters.categories, code);
      persistFilters();
      render();
    });

    UI.renderSourceLegend(dom.sourceLegend, L.sourceOptions(activities), filters.sources, function (code) {
      toggleIn(filters.sources, code);
      persistFilters();
      render();
    });

    /* 折叠区：有选中条件时自动展开，并显示已选数量 */
    var selectedCount = filters.sources.length + filters.categories.length;
    if (selectedCount > 0) dom.moreFilters.dataset.open = "true";
    dom.filtersCount.textContent = selectedCount ? String(selectedCount) : "";
    dom.filtersCount.hidden = selectedCount === 0;
    dom.filtersToggle.setAttribute("aria-expanded", String(dom.moreFilters.dataset.open === "true"));

    /* 时间线视图切换按钮的选中态 */
    Array.prototype.forEach.call(dom.viewSwitch.querySelectorAll("button[data-view]"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.view === filters.timelineView));
    });

    dom.freshmanMode.setAttribute("aria-pressed", String(!!filters.freshman));
    dom.hideSuspicious.setAttribute("aria-pressed", String(!!filters.hideSuspicious));
    dom.fromNow.setAttribute("aria-pressed", String(!!filters.fromNow));

    /* 结果摘要 */
    dom.summary.textContent = "";
    var strong = document.createElement("strong");
    strong.textContent = items.length + " 条";
    dom.summary.appendChild(document.createTextNode("符合当前条件："));
    dom.summary.appendChild(strong);
    if (filters.grade) {
      dom.summary.appendChild(document.createTextNode(
        "，已按「" + L.gradeLabel(filters.grade) + "」过滤不适用的机会"));
    }

    /* 列表：撞车映射预先算好，避免每张卡片各算一次 */
    handlers.conflictMap = buildConflictMap(activities);
    UI.renderFeed(dom.feed, L.bucketize(items, { hideEmpty: true }), baseline(), store, handlers);

    /* 时间线：列表 / 日历 双视图 */
    if (filters.timelineView === "calendar") {
      UI.renderCalendarView(dom.timeline, L.buildCalendarGrid(activities, baseline()), baseline(), handlers);
      dom.timelineNote.textContent = "点任意日期查看当天安排；带橙色角标的日子存在时间冲突";
    } else if (filters.timelineView === "grid") {
      UI.renderTimeGrid(dom.timeline, L.buildTimeGrid(activities, baseline(), { days: 7 }),
        baseline(), handlers);
      dom.timelineNote.textContent = "横轴为未来七天、纵轴为小时；互相交叠的色块就是时间冲突";
    } else {
      UI.renderTimeline(dom.timeline, timeline, store, handlers, baseline());
      dom.timelineNote.textContent = timeline.all.length + " 个节点";
    }

    /* 繁忙度密度条：不点开任何东西也能看出哪几天最挤 */
    UI.renderDensity(dom.density, L.buildDensity(activities, baseline(), 14), {
      onPickDate: function (date) {
        filters.timelineView = "calendar";
        persistFilters();
        render();
        UI.toast(dom.toasts, "已切到日历并定位到 " + date, "accent", "i-calendar");
      }
    });

    /* 时间机器：未来几天的状态变化预演 */
    UI.renderMachine(dom.machineStrip, dom.machineNote, dom.machineDesc,
      L.projectTransitions(activities, baseline(), 7), baseline(), handlers);

    /* 精力预算：把「我要参加」的每周投入加起来，看是否排得下 */
    var budget = L.computeBudget(registeredItems(activities), filters.weeklyBudget);
    UI.renderBudget(dom.budgetPanel, dom.budgetBar, dom.budgetBody, dom.budgetNote,
      budget, handlers);
    renderBudgetHint(budget);

    /* 时间机器的状态显示 */
    dom.baselineDate.value = baseline();
    if (baseline() === TODAY) {
      dom.baselineHint.textContent = "当前为默认判断基准日";
      dom.baselineHint.dataset.tone = "";
    } else {
      var diff = L.daysBetween(TODAY, baseline());
      dom.baselineHint.textContent = "已改为 " + baseline() +
        "（相对默认基准日 " + (diff > 0 ? "+" : "") + diff + " 天），全部判定已重算";
      dom.baselineHint.dataset.tone = "warning";
    }

    dom.mineCount.textContent = store.summary().favorites + store.summary().registered;
    dom.mineCount.classList.toggle("btn-dot", store.summary().posts > 0);
  }

  function renderGradeFilter() {
    dom.gradeFilter.textContent = "";
    var options = [{ code: 0, label: "不限" }, { code: 1, label: "大一" }, { code: 2, label: "大二" },
      { code: 3, label: "大三" }, { code: 4, label: "大四" }];
    options.forEach(function (opt) {
      var b = UI.el("button", null, opt.label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(Number(filters.grade) === opt.code));
      b.addEventListener("click", function () {
        filters.grade = opt.code;
        // 选了大一即视为开启新生模式，两者语义一致，避免状态自相矛盾
        if (opt.code === 1) filters.freshman = true;
        persistFilters();
        render();
      });
      dom.gradeFilter.appendChild(b);
    });
  }

  function toggleIn(list, code) {
    var i = list.indexOf(code);
    if (i >= 0) list.splice(i, 1);
    else list.push(code);
  }

  /** 精力预算的提示文案 */
  function renderBudgetHint(budget) {
    if (budget.budget <= 0) {
      dom.budgetHint.textContent = "填写后可判断「我要参加」的机会是否排得下";
      dom.budgetHint.dataset.tone = "";
      return;
    }
    if (budget.committedCount === 0) {
      dom.budgetHint.textContent = "填好了。现在去标记几项「我要参加」，我会帮你核算";
      dom.budgetHint.dataset.tone = "";
      return;
    }
    if (budget.over) {
      dom.budgetHint.textContent = "超出预算 " + Math.abs(budget.remaining) + " 小时/周";
      dom.budgetHint.dataset.tone = "warning";
    } else {
      dom.budgetHint.textContent = "还剩 " + budget.remaining + " 小时/周";
      dom.budgetHint.dataset.tone = "success";
    }
  }

  function persistFilters() {
    store.setFilters({
      keyword: filters.keyword,
      status: filters.status,
      sources: filters.sources,
      categories: filters.categories,
      freshman: filters.freshman,
      hideSuspicious: filters.hideSuspicious,
      grade: filters.grade,
      fromNow: filters.fromNow,
      baseline: filters.baseline,
      weeklyBudget: filters.weeklyBudget,
      timelineView: filters.timelineView
    });
  }

  /* ============================================================ 抽屉控制 */

  function showDrawer(node) {
    lastFocused = document.activeElement;
    if (openDrawer && openDrawer !== node) hideDrawer(true);
    openDrawer = node;
    node.hidden = false;
    dom.overlay.dataset.open = "true";
    // 触发过渡
    requestAnimationFrame(function () { node.dataset.open = "true"; });
    var focusable = node.querySelector("button, [href], input, select, textarea");
    if (focusable) focusable.focus();
  }

  function hideDrawer(keepOverlay) {
    if (!openDrawer) return;
    var node = openDrawer;
    node.dataset.open = "false";
    node.hidden = true;
    openDrawer = null;
    if (!keepOverlay) dom.overlay.dataset.open = "false";
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  dom.overlay.addEventListener("click", function () { hideDrawer(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openDrawer) hideDrawer();
    if (e.key === "Tab" && openDrawer) trapFocus(e, openDrawer);
  });

  function trapFocus(e, node) {
    var focusable = node.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openDetail(id) {
    var activities = allActivities();
    var act = activities.filter(function (a) { return a.id === id; })[0];
    if (!act) return;
    var item = L.toItem(act, baseline(), { grade: filters.grade || null });
    var handlers = {
      toggleFavorite: function (aid) {
        var on = store.toggleFavorite(aid);
        UI.toast(dom.toasts, on ? "已加入收藏" : "已取消收藏", "accent",
          on ? "i-bookmark-fill" : "i-bookmark");
        render();
        refreshMine();
      },
      toggleRegistered: function (aid) {
        var on = store.toggleRegistered(aid);
        UI.toast(dom.toasts, on ? "已加入「我要参加」" : "已移出「我要参加」", "accent",
          on ? "i-check" : "i-close");
        render();
        refreshMine();
      },
      openDetail: openDetail,
      /* 撞车提示：详情里给出与这条冲突的其他机会 */
      conflicts: L.findConflicts(act, activities, baseline()),
      /* 日历导出成功后的反馈 */
      onExport: function (exported) {
        UI.toast(dom.toasts, "已导出日历文件，双击即可导入手机日历", "accent", "i-calendar");
        void exported;
      }
    };
    UI.renderDetail(dom.drawer, item, baseline(), store, handlers);
    showDrawer(dom.drawer);
  }

  /* ============================================================ 发布流程 */

  function openPublish(editId) {
    editingPostId = editId || null;
    var form = dom.publishForm;
    form.reset();
    clearErrors();

    if (editingPostId) {
      var post = store.getPost(editingPostId);
      if (post) {
        document.getElementById("p-title").value = post.title || "";
        document.getElementById("p-category").value = post.category || "student-initiated";
        document.getElementById("p-date").value = post.date || "";
        document.getElementById("p-deadline").value = post.deadline || "";
        document.getElementById("p-location").value = post.location || "";
        document.getElementById("p-capacity").value = post.capacity || "";
        document.getElementById("p-contact").value = post.contact || "";
        document.getElementById("p-detail").value = post.detail || "";
      }
      document.getElementById("publish-title").textContent = "编辑我的发布";
    } else {
      document.getElementById("publish-title").textContent = "发布活动或招募信息";
    }
    updatePublishCheck();
    showDrawer(dom.publishDrawer);
  }

  function collectForm() {
    return {
      title: document.getElementById("p-title").value.trim(),
      category: document.getElementById("p-category").value,
      date: document.getElementById("p-date").value,
      deadline: document.getElementById("p-deadline").value,
      location: document.getElementById("p-location").value.trim(),
      capacity: document.getElementById("p-capacity").value,
      contact: document.getElementById("p-contact").value.trim(),
      detail: document.getElementById("p-detail").value.trim()
    };
  }

  function clearErrors() {
    ["p-title-error", "p-detail-error"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.hidden = true;
    });
    document.getElementById("p-title").removeAttribute("aria-invalid");
    document.getElementById("p-detail").removeAttribute("aria-invalid");
  }

  function showError(inputId, errorId, message) {
    var input = document.getElementById(inputId);
    var box = document.getElementById(errorId);
    input.setAttribute("aria-invalid", "true");
    box.querySelector("span").textContent = message;
    box.hidden = false;
  }

  function updatePublishCheck() {
    var data = collectForm();
    if (!data.title && !data.detail) {
      dom.publishCheck.dataset.level = "";
      dom.publishCheck.textContent =
        "填写后会实时检查内容是否需要提醒同学注意，检查只做提示，不会阻止发布，也不会删除内容。";
      return;
    }
    var cred = L.computeCredibility(normalizePost(Object.assign({ id: "preview" }, data)));
    if (cred.level === "clean") {
      dom.publishCheck.dataset.level = "";
      dom.publishCheck.textContent = "检查通过：没有发现需要特别提醒同学的特征。";
    } else {
      dom.publishCheck.dataset.level = cred.level;
      dom.publishCheck.textContent =
        (cred.level === "suspicious" ? "提醒：这条内容可能被同学当作可疑信息。" : "提示：这条内容有需要留意的特征。") +
        " 依据：" + cred.signals.map(function (s) { return s.label; }).join("、") +
        "。你仍然可以发布，但建议补充可核实的主办方或线下地点。";
    }
  }

  ["p-title", "p-detail", "p-contact", "p-location"].forEach(function (id) {
    var node = document.getElementById(id);
    if (node) node.addEventListener("input", updatePublishCheck);
  });

  dom.publishForm.addEventListener("submit", function (e) {
    e.preventDefault();
    clearErrors();
    var data = collectForm();

    var ok = true;
    if (data.title.length < 4) {
      showError("p-title", "p-title-error", "标题至少 4 个字，写清楚是约人还是招募。");
      ok = false;
    }
    if (data.detail.length < 6) {
      showError("p-detail", "p-detail-error", "详细说明至少 6 个字，方便同学判断要不要参加。");
      ok = false;
    }
    if (data.date && data.deadline && data.deadline > data.date) {
      showError("p-detail", "p-detail-error", "报名截止时间晚于活动时间，请检查两个日期。");
      ok = false;
    }
    if (!ok) return;

    if (editingPostId) {
      store.updatePost(editingPostId, data);
      UI.toast(dom.toasts, "已更新你的发布", "accent", "i-edit");
    } else {
      var created = store.addPost(data);
      UI.toast(dom.toasts, "发布成功，已进入活动列表", "accent", "i-check");
      filters.sources = [];
      filters.status = "all";
      filters.categories = [];
      filters.keyword = "";
      dom.q.value = "";
      persistFilters();
      void created;
    }
    editingPostId = null;
    hideDrawer();
    render();
    refreshMine();
  });

  /* ============================================================ 我的面板 */

  function refreshMine() {
    var all = allActivities();
    var byId = {};
    all.forEach(function (a) { byId[a.id] = a; });
    var posts = store.myPosts();
    var favorites = store.favoriteIds().map(function (id) { return byId[id]; }).filter(Boolean);
    var registered = store.registeredIds().map(function (id) { return byId[id]; }).filter(Boolean);

    UI.renderMine(dom.mineBody, favorites, registered, posts, baseline(), store, {
      openDetail: function (id) {
        var post = store.getPost(id);
        if (post) { openPublish(id); return; }
        openDetail(id);
      },
      editPost: function (id) { openPublish(id); },
      removePost: function (id) {
        store.removePost(id);
        UI.toast(dom.toasts, "已撤回该发布", "warning", "i-trash");
        render();
        refreshMine();
      }
    });
  }

  /* ============================================================ 事件绑定 */

  var searchTimer = null;
  dom.q.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      filters.keyword = dom.q.value.trim();
      persistFilters();
      render();
    }, 160);
  });

  dom.freshmanMode.addEventListener("click", function () {
    filters.freshman = !filters.freshman;
    if (filters.freshman && !filters.grade) filters.grade = 1;
    if (!filters.freshman && filters.grade === 1) filters.grade = 0;
    persistFilters();
    render();
  });

  dom.hideSuspicious.addEventListener("click", function () {
    filters.hideSuspicious = !filters.hideSuspicious;
    persistFilters();
    render();
  });

  dom.fromNow.addEventListener("click", function () {
    filters.fromNow = !filters.fromNow;
    persistFilters();
    render();
  });

  dom.resetFilters.addEventListener("click", function () {
    filters = { keyword: "", status: "all", sources: [], categories: [],
      freshman: false, hideSuspicious: false, grade: 0, fromNow: true,
      baseline: TODAY, weeklyBudget: filters.weeklyBudget };
    dom.q.value = "";
    store.resetFilters();
    persistFilters();
    render();
    UI.toast(dom.toasts, "已清空筛选条件", "accent", "i-close");
  });

  /* 时间机器：改变"今天"，全部状态判定随之重算 */
  dom.baselineDate.addEventListener("change", function () {
    var value = dom.baselineDate.value;
    if (!value) { filters.baseline = TODAY; }
    else { filters.baseline = value; }
    persistFilters();
    render();
    UI.toast(dom.toasts,
      filters.baseline === TODAY ? "已回到默认判断基准日" : "已把基准日改为 " + filters.baseline,
      "accent", "i-history");
  });

  dom.resetDate.addEventListener("click", function () {
    filters.baseline = TODAY;
    persistFilters();
    render();
    UI.toast(dom.toasts, "已回到默认判断基准日 " + TODAY, "accent", "i-history");
  });

  /* 精力预算：每周可投入小时数 */
  var budgetTimer = null;
  dom.weeklyBudget.addEventListener("input", function () {
    clearTimeout(budgetTimer);
    budgetTimer = setTimeout(function () {
      var raw = dom.weeklyBudget.value;
      var hours = raw === "" ? 0 : Math.max(0, Math.min(60, Number(raw) || 0));
      filters.weeklyBudget = hours;
      persistFilters();
      render();
    }, 200);
  });

  dom.openPublish.addEventListener("click", function () { openPublish(null); });

  /* 时间线视图切换：列表 / 日历 */
  dom.viewSwitch.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-view]");
    if (!btn) return;
    filters.timelineView = btn.dataset.view;
    persistFilters();
    render();
  });

  dom.filtersToggle.addEventListener("click", function () {
    var open = dom.moreFilters.dataset.open === "true";
    dom.moreFilters.dataset.open = String(!open);
    dom.filtersToggle.setAttribute("aria-expanded", String(!open));
  });
  dom.openMine.addEventListener("click", function () { refreshMine(); showDrawer(dom.mineDrawer); });
  document.getElementById("drawer-close").addEventListener("click", function () { hideDrawer(); });
  document.getElementById("publish-close").addEventListener("click", function () { hideDrawer(); });
  document.getElementById("mine-close").addEventListener("click", function () { hideDrawer(); });

  dom.clearLocal.addEventListener("click", function () {
    var s = store.summary();
    var ok = window.confirm(
      "将清空本机保存的 " + s.favorites + " 条收藏、" + s.registered + " 条报名标记、" +
      s.posts + " 条我的发布，以及全部筛选偏好。内置的 26 条信息不受影响。是否继续？");
    if (!ok) return;
    store.clearAll();
    filters = { keyword: "", status: "all", sources: [], categories: [],
      freshman: false, hideSuspicious: false, grade: 0, fromNow: true };
    dom.q.value = "";
    hideDrawer();
    render();
    refreshMine();
    UI.toast(dom.toasts, "本地数据已清空", "warning", "i-trash");
  });

  /* ============================================================ 启动 */

  function boot() {
    /* 恢复筛选控件显示值 */
    dom.q.value = filters.keyword || "";
    dom.baselineDate.value = baseline();
    /* 预算输入框也要回填，否则刷新后看不到自己设置过的小时数 */
    dom.weeklyBudget.value = filters.weeklyBudget > 0 ? String(filters.weeklyBudget) : "";
    render();
    refreshMine();

    if (store.isMemoryOnly()) {
      UI.toast(dom.toasts, "浏览器禁用了本地存储，本次操作不会被保留", "warning", "i-alert");
    }

    /* 支持用 #活动id 直接打开详情，便于分享与演示 */
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
  }

  function openFromHash() {
    var hash = window.location.hash.replace("#", "");
    if (!hash || hash === "feed") return;
    var exists = allActivities().some(function (a) { return a.id === hash; });
    if (exists) openDetail(hash);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
