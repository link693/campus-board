/* 本地状态层测试：node tests/store.test.js
 *
 * 重点覆盖一个曾经真实发生的缺陷：localStorage 探测失败导致**静默降级为内存模式**，
 * 用户操作刷新后全部丢失。这类问题在浏览器里只表现为"数据没保存"，
 * 所以必须用测试把行为固定下来。
 */
"use strict";

const path = require("path");

const Store = require(path.resolve(__dirname, "..", "js", "store.js"));

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

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "值不相等"}：期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
}

/** 最小可用的 Storage 替身，行为与 localStorage 一致。 */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _dump: () => Object.fromEntries(map)
  };
}

console.log("\n本地状态层");

test("传入裸 Storage 时直接使用，不降级", () => {
  const s = fakeStorage();
  const store = Store.createStore(s);
  eq(store.isMemoryOnly(), false, "不应降级为内存模式");
  store.toggleFavorite("a");
  assert(s.getItem(Store.KEY) !== null, "写入应落到传入的存储里");
});

test("传入全局对象（window）时可正确解析 localStorage", () => {
  const s = fakeStorage();
  const store = Store.createStore({ localStorage: s });
  eq(store.isMemoryOnly(), false);
  store.toggleFavorite("x");
  const saved = JSON.parse(s.getItem(Store.KEY));
  eq(saved.favorites[0], "x");
});

test("传入 null 或不可用的全局对象时安全降级为内存模式", () => {
  const a = Store.createStore(null);
  eq(a.isMemoryOnly(), true, "null 应降级");
  a.toggleFavorite("y");
  eq(a.isFavorite("y"), true, "内存模式下仍需可用，不能抛错");

  const b = Store.createStore({});
  eq(b.isMemoryOnly(), true, "没有 localStorage 的对象应降级");
});

test("localStorage 访问抛异常时不会向外抛出（真实浏览器曾出现的 SecurityError）", () => {
  const hostile = {
    get localStorage() { throw new Error("SecurityError"); }
  };
  let store;
  try {
    store = Store.createStore(hostile);
  } catch (e) {
    throw new Error("构造 store 时不应抛出异常：" + e.message);
  }
  eq(store.isMemoryOnly(), true);
  store.toggleFavorite("z");
  eq(store.isFavorite("z"), true);
});

test("setItem 抛异常（配额满 / 隐私模式）时降级但不丢失本次操作", () => {
  const full = fakeStorage();
  full.setItem = () => { throw new Error("QuotaExceededError"); };
  const store = Store.createStore(full);
  // 构造时不抛错即为通过；写入失败也不应影响内存中的状态
  store.toggleFavorite("q");
  eq(store.isFavorite("q"), true, "写入失败后内存状态仍应正确");
});

test("收藏与报名可以来回切换", () => {
  const store = Store.createStore(fakeStorage());
  eq(store.isFavorite("a1"), false);
  eq(store.toggleFavorite("a1"), true);
  eq(store.isFavorite("a1"), true);
  eq(store.toggleFavorite("a1"), false);
  eq(store.isFavorite("a1"), false);

  eq(store.toggleRegistered("a1"), true);
  eq(store.isRegistered("a1"), true);
});

test("发布内容会带上 id 与创建时间，并可编辑、撤回", () => {
  const store = Store.createStore(fakeStorage());
  const post = store.addPost({ title: "约球", detail: "周日下午" });
  assert(/^user-/.test(post.id), "应自动生成 id");
  assert(post.createdAt, "应带创建时间");
  eq(store.myPosts().length, 1);

  store.updatePost(post.id, { title: "约球（改）" });
  eq(store.getPost(post.id).title, "约球（改）");
  assert(store.getPost(post.id).updatedAt, "编辑后应记录更新时间");

  eq(store.removePost(post.id), true);
  eq(store.myPosts().length, 0);
  eq(store.removePost("不存在"), false);
});

test("数据能被重新读回（模拟刷新页面）", () => {
  const s = fakeStorage();
  const first = Store.createStore(s);
  first.toggleFavorite("keep-1");
  first.toggleRegistered("keep-2");
  first.addPost({ title: "持久化测试", detail: "内容" });
  first.setFilters({ keyword: "羽毛球", grade: 1 });

  const second = Store.createStore(s); // 同一份存储，新的实例
  eq(second.isFavorite("keep-1"), true, "收藏应恢复");
  eq(second.isRegistered("keep-2"), true, "报名应恢复");
  eq(second.myPosts().length, 1, "发布应恢复");
  eq(second.filters().keyword, "羽毛球", "筛选偏好应恢复");
  eq(second.filters().grade, 1);
});

test("时间机器与精力预算的设置也会被持久化", () => {
  // 回归用例：这两个键曾经没有登记在 DEFAULTS.filters 里，
  // 而合并逻辑只保留默认值中存在的键，导致设置被静默丢弃。
  const s = fakeStorage();
  const first = Store.createStore(s);
  first.setFilters({ baseline: "2026-09-25", weeklyBudget: 10 });

  const second = Store.createStore(s);
  eq(second.filters().baseline, "2026-09-25", "基准日设置应恢复");
  eq(second.filters().weeklyBudget, 10, "每周预算应恢复");
});

test("默认偏好包含全部界面设置项，避免新增设置被静默丢弃", () => {
  const defaults = Store.createStore(fakeStorage()).filters();
  ["keyword", "status", "sources", "categories", "freshman", "hideSuspicious",
    "grade", "fromNow", "baseline", "weeklyBudget"].forEach((key) => {
    assert(Object.prototype.hasOwnProperty.call(defaults, key),
      `DEFAULTS.filters 缺少 ${key}，该设置将无法被保存`);
  });
});

test("损坏的存储内容不会导致崩溃，而是回退到默认值", () => {
  const s = fakeStorage();
  s.setItem(Store.KEY, "{ 这不是合法 JSON");
  const store = Store.createStore(s);
  eq(store.favoriteIds().length, 0);
  eq(store.filters().status, "all");
});

test("缺失字段的旧数据会被补全为默认值", () => {
  const s = fakeStorage();
  s.setItem(Store.KEY, JSON.stringify({ favorites: ["only-this"] }));
  const store = Store.createStore(s);
  eq(store.favoriteIds().length, 1, "应保留已有数据");
  eq(store.registeredIds().length, 0, "缺失字段应补默认值");
  eq(store.filters().status, "all", "嵌套缺失字段也应补全");
});

test("清空只影响本地数据，不影响外部数据源", () => {
  const store = Store.createStore(fakeStorage());
  store.toggleFavorite("a");
  store.addPost({ title: "t", detail: "d" });
  store.clearAll();
  eq(store.summary().favorites, 0);
  eq(store.summary().posts, 0);
  eq(store.registeredIds().length, 0);
});

test("概览计数正确", () => {
  const store = Store.createStore(fakeStorage());
  store.toggleFavorite("a");
  store.toggleFavorite("b");
  store.toggleRegistered("c");
  store.addPost({ title: "t", detail: "d" });
  const s = store.summary();
  eq(s.favorites, 2);
  eq(s.registered, 1);
  eq(s.posts, 1);
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
