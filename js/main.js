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
    repoLink: document.getElementById("repo-link")
  };

  /* 筛选状态：从本地恢复，保证刷新后一致 */
  var filters = Object.assign({
    grade: 0,
    fromNow: true
  }, store.filters());

  var openDrawer = null;
  var lastFocused = null;
  var editingPostId = null;

  /* ============================================================ 数据组装 */

  /** 用户发布的内容规范化成与题目条目同构的对象，走同一套状态与可信度逻辑。 */
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

  function currentSelection() {
    var activities = allActivities();
    var opts = {
      today: TODAY,
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
    L.decorateAll(activities, TODAY, {}).forEach(function (it) {
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
    dom.todayValue.textContent = TODAY;
    dom.todayHint.textContent = "以考核当日为判断基准";

    /* 指标 */
    var summary = L.summarize(L.decorateAll(activities, TODAY, {}));
    var timeline = L.buildTimeline(activities, { today: TODAY });
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

    /* 列表 */
    UI.renderFeed(dom.feed, L.bucketize(items, { hideEmpty: true }), TODAY, store, handlers);

    /* 时间线 */
    UI.renderTimeline(dom.timeline, timeline, store, handlers, TODAY);
    dom.timelineNote.textContent = timeline.all.length + " 个节点";

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

  function persistFilters() {
    store.setFilters({
      keyword: filters.keyword,
      status: filters.status,
      sources: filters.sources,
      categories: filters.categories,
      freshman: filters.freshman,
      hideSuspicious: filters.hideSuspicious,
      grade: filters.grade,
      fromNow: filters.fromNow
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
    var act = allActivities().filter(function (a) { return a.id === id; })[0];
    if (!act) return;
    var item = L.toItem(act, TODAY, { grade: filters.grade || null });
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
      }
    };
    UI.renderDetail(dom.drawer, item, TODAY, store, handlers);
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

    UI.renderMine(dom.mineBody, favorites, registered, posts, TODAY, store, {
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
      freshman: false, hideSuspicious: false, grade: 0, fromNow: true };
    dom.q.value = "";
    store.resetFilters();
    render();
    UI.toast(dom.toasts, "已清空筛选条件", "accent", "i-close");
  });

  dom.openPublish.addEventListener("click", function () { openPublish(null); });

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
      s.posts + " 条我的发布，以及全部筛选偏好。题目自带的 26 条信息不受影响。是否继续？");
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
