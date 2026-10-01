/* 校园活动板 · 本地状态层
 *
 * 满足题目要求 6：重要的用户操作结果在刷新或重新打开后合理保留。
 * 只使用 localStorage，失败时静默降级为内存存储，不影响主流程可用。
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CampusStore = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null), function (root) {
  "use strict";

  var KEY = "campus-board.v1";

  var DEFAULTS = {
    version: 1,
    favorites: [],
    registered: [],
    dismissed: [],
    drafts: [],
    filters: {
      keyword: "",
      status: "all",
      sources: [],
      categories: [],
      freshman: false,
      hideSuspicious: false,
      grade: 0,
      fromNow: true,
      /* 时间机器与精力预算的状态也必须在这里登记，
         否则合并逻辑不会保留它们（合并只认默认值里存在的键）。
         注意不能用 null 作默认值：合并会跳过 null，导致设置写不进去。 */
      baseline: "",
      weeklyBudget: 0,
      timelineView: "list"
    }
  };

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** 判断某个对象是否像一个 Storage 实现。 */
  function looksLikeStorage(obj) {
    return !!obj &&
      typeof obj.getItem === "function" &&
      typeof obj.setItem === "function" &&
      typeof obj.removeItem === "function";
  }

  /**
   * 解析可用的存储后端。
   *
   * 注意（曾经的真实缺陷）：访问 `window.localStorage` 本身在某些浏览器配置下会抛
   * SecurityError，把它当作函数参数传入更会直接在实参求值时抛错、绕过内部 try/catch。
   * 因此这里接收"全局对象或存储对象"，在 try/catch 内部完成访问与写入探测。
   */
  function resolveBackend(input) {
    if (looksLikeStorage(input)) return input;
    var candidates = [input, typeof window !== "undefined" ? window : null, root];
    for (var i = 0; i < candidates.length; i++) {
      var holder = candidates[i];
      if (!holder) continue;
      try {
        var storage = holder.localStorage;
        if (!looksLikeStorage(storage)) continue;
        var probe = "__campus_probe__";
        storage.setItem(probe, "1");
        storage.removeItem(probe);
        return storage;
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  function createStore(storage) {
    var backend = resolveBackend(storage);
    var memoryOnly = !backend;

    var memory = clone(DEFAULTS);
    var state = load();

    function load() {
      if (!backend) return clone(memory);
      try {
        var raw = backend.getItem(KEY);
        if (!raw) return clone(DEFAULTS);
        var parsed = JSON.parse(raw);
        return merge(DEFAULTS, parsed);
      } catch (e) {
        return clone(DEFAULTS);
      }
    }

    function merge(base, patch) {
      var out = clone(base);
      if (!patch || typeof patch !== "object") return out;
      Object.keys(base).forEach(function (k) {
        if (patch[k] === undefined || patch[k] === null) return;
        if (Array.isArray(base[k])) {
          out[k] = Array.isArray(patch[k]) ? patch[k].slice() : base[k].slice();
        } else if (typeof base[k] === "object") {
          out[k] = merge(base[k], patch[k]);
        } else {
          out[k] = patch[k];
        }
      });
      return out;
    }

    function persist() {
      if (!backend) {
        memory = clone(state);
        return true;
      }
      try {
        backend.setItem(KEY, JSON.stringify(state));
        return true;
      } catch (e) {
        memoryOnly = true;
        return false;
      }
    }

    function has(list, id) {
      return state[list].indexOf(id) >= 0;
    }

    function toggle(list, id) {
      var i = state[list].indexOf(id);
      if (i >= 0) state[list].splice(i, 1);
      else state[list].push(id);
      persist();
      return has(list, id);
    }

    return {
      /** 是否处于降级模式（localStorage 不可用） */
      isMemoryOnly: function () { return memoryOnly; },

      raw: function () { return clone(state); },

      /* ---------------------------------------------------- 收藏与报名 */

      isFavorite: function (id) { return has("favorites", id); },
      toggleFavorite: function (id) { return toggle("favorites", id); },
      favoriteIds: function () { return state.favorites.slice(); },

      /** 报名状态：'none' | 'registered' | 'done' */
      regState: function (id) { return state.registered.indexOf(id) >= 0 ? "registered" : "none"; },
      isRegistered: function (id) { return has("registered", id); },
      toggleRegistered: function (id) { return toggle("registered", id); },
      registeredIds: function () { return state.registered.slice(); },

      /** 用户主动忽略的条目（例如已读的可疑内容） */
      isDismissed: function (id) { return has("dismissed", id); },
      toggleDismissed: function (id) { return toggle("dismissed", id); },

      /* ------------------------------------------------------ 我的发布 */

      myPosts: function () { return state.drafts.slice(); },

      addPost: function (post) {
        var record = clone(post);
        record.id = "user-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
        record.createdAt = new Date().toISOString();
        state.drafts.unshift(record);
        persist();
        return record;
      },

      updatePost: function (id, patch) {
        for (var i = 0; i < state.drafts.length; i++) {
          if (state.drafts[i].id === id) {
            state.drafts[i] = Object.assign({}, state.drafts[i], patch, {
              updatedAt: new Date().toISOString()
            });
            persist();
            return state.drafts[i];
          }
        }
        return null;
      },

      removePost: function (id) {
        var before = state.drafts.length;
        state.drafts = state.drafts.filter(function (p) { return p.id !== id; });
        if (state.drafts.length !== before) {
          persist();
          return true;
        }
        return false;
      },

      getPost: function (id) {
        for (var i = 0; i < state.drafts.length; i++) {
          if (state.drafts[i].id === id) return state.drafts[i];
        }
        return null;
      },

      /* ------------------------------------------------------ 筛选偏好 */

      filters: function () { return clone(state.filters); },

      setFilters: function (patch) {
        state.filters = Object.assign({}, state.filters, patch || {});
        persist();
        return clone(state.filters);
      },

      resetFilters: function () {
        state.filters = clone(DEFAULTS.filters);
        persist();
        return clone(state.filters);
      },

      /* ---------------------------------------------------------- 维护 */

      clearAll: function () {
        state = clone(DEFAULTS);
        persist();
        return clone(state);
      },

      /** 本地数据概览，用于「我的」面板展示 */
      summary: function () {
        return {
          favorites: state.favorites.length,
          registered: state.registered.length,
          posts: state.drafts.length
        };
      }
    };
  }

  return {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    createStore: createStore
  };
});
