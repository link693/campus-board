/* 静态一致性检查：controller 引用的 DOM id 必须真实存在于 index.html，
 * 且 index.html 引用的静态资源文件都必须存在。
 * 这类断裂是前端最常见的"看起来写完、实际点不动"的问题。
 *
 * 用法：node tests/dom-wiring.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8");

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
  if (!cond) throw new Error(msg);
}

const htmlIds = new Set();
const idRe = /\bid="([^"]+)"/g;
let m;
while ((m = idRe.exec(html))) htmlIds.add(m[1]);

console.log("\nDOM 接线检查");

test("main.js 引用的每个 id 都存在于 index.html", () => {
  const missing = [];
  const re = /getElementById\("([^"]+)"\)/g;
  let mm;
  while ((mm = re.exec(mainJs))) {
    if (!htmlIds.has(mm[1])) missing.push(mm[1]);
  }
  assert(missing.length === 0, `index.html 中缺少这些 id：${missing.join(", ")}`);
});

test("ui.js 中 querySelector 的 id 选择器都存在", () => {
  const uiJs = fs.readFileSync(path.join(ROOT, "js", "ui.js"), "utf8");
  const missing = [];
  const re = /querySelector\("#([a-zA-Z0-9_-]+)"\)/g;
  let mm;
  while ((mm = re.exec(uiJs))) {
    if (!htmlIds.has(mm[1])) missing.push(mm[1]);
  }
  assert(missing.length === 0, `缺少：${missing.join(", ")}`);
});

test("html 中每个 id 都唯一", () => {
  const counts = {};
  let mm;
  const re = /\bid="([^"]+)"/g;
  while ((mm = re.exec(html))) counts[mm[1]] = (counts[mm[1]] || 0) + 1;
  const dup = Object.keys(counts).filter((k) => counts[k] > 1);
  assert(dup.length === 0, `重复 id：${dup.join(", ")}`);
});

test("引用的脚本与样式文件都存在（忽略缓存版本号查询串）", () => {
  const missing = [];
  const re = /(?:src|href)="((?:js|css|docs|data)\/[^"]+)"/g;
  let mm;
  while ((mm = re.exec(html))) {
    const raw = mm[1];
    const file = raw.split("?")[0];       // 去掉 ?v=xxx 缓存版本号
    if (!fs.existsSync(path.join(ROOT, file))) missing.push(raw);
  }
  assert(missing.length === 0, `文件不存在：${missing.join(", ")}`);
});

test("css 与 js 引用都带缓存版本号，避免改了看不到", () => {
  const re = /(?:src|href)="((?:js|css)\/[^"]+)"/g;
  let mm;
  const bad = [];
  while ((mm = re.exec(html))) {
    if (!/\?v=/.test(mm[1])) bad.push(mm[1]);
  }
  assert(bad.length === 0,
    `以下引用缺少 ?v= 版本号（浏览器可能复用旧文件）：\n      ${bad.join("\n      ")}`);
});

test("脚本加载顺序正确：data → logic → store → ui → main", () => {
  const order = ["js/data.js", "js/logic.js", "js/store.js", "js/ui.js", "js/main.js"];
  const positions = order.map((f) => html.indexOf(f));
  positions.forEach((p, i) => assert(p > 0, `${order[i]} 未被引用`));
  for (let i = 1; i < positions.length; i++) {
    assert(positions[i] > positions[i - 1], `${order[i]} 应在 ${order[i - 1]} 之后加载`);
  }
});

test("每个 use href 引用的图标 symbol 都已定义", () => {
  const defined = new Set();
  // 与属性顺序无关：只要 <symbol ... id="i-xxx" ...> 都算定义
  const symRe = /<symbol\b[^>]*\bid="([^"]+)"/g;
  let mm;
  while ((mm = symRe.exec(html))) defined.add(mm[1]);
  assert(defined.size > 15, `解析到的图标数量异常：${defined.size}`);
  const used = new Set();
  const useRe = /href="#(i-[a-z-]+)"/g;
  while ((mm = useRe.exec(html))) used.add(mm[1]);
  // ui.js 里动态生成的图标也要检查
  const uiJs = fs.readFileSync(path.join(ROOT, "js", "ui.js"), "utf8");
  const uiRe = /icon\("(i-[a-z-]+)"/g;
  while ((mm = uiRe.exec(uiJs))) used.add(mm[1]);

  const missing = [...used].filter((u) => !defined.has(u));
  assert(missing.length === 0, `未定义的图标：${missing.join(", ")}`);
});

test("每个图标 symbol 都声明了显式尺寸，避免被 max-width 撑满", () => {
  const symRe = /<symbol\b([^>]*)>/g;
  let mm;
  const bad = [];
  while ((mm = symRe.exec(html))) {
    const attrs = mm[1];
    if (!/\bwidth="/.test(attrs) || !/\bheight="/.test(attrs)) bad.push(attrs.trim());
  }
  assert(bad.length === 0, `缺少尺寸声明的 symbol：\n      ${bad.join("\n      ")}`);
});

test("组件样式层不存在任何硬编码颜色（必须走设计令牌）", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
  const lines = css.split("\n");
  const printStart = lines.findIndex((l) => l.includes("@media print"));
  const bad = [];
  lines.forEach((line, i) => {
    if (!/#[0-9a-fA-F]{3,8}\b/.test(line)) return;
    // 仅允许打印样式中的纯黑纯白，且必须出现在 @media print 之后
    const isPrintOnly = printStart >= 0 && i > printStart && /#(fff|000)\b/i.test(line);
    if (!isPrintOnly) bad.push(`第 ${i + 1} 行: ${line.trim()}`);
  });
  assert(bad.length === 0, `发现 ${bad.length} 处硬编码颜色：\n      ${bad.join("\n      ")}`);
});

test("视图层不使用内联样式写入颜色", () => {
  ["js/ui.js", "js/main.js"].forEach((file) => {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    const bad = [];
    src.split("\n").forEach((line, i) => {
      if (/\.style\.(color|background|borderColor|borderTopColor|borderLeftColor)\s*=/.test(line)) {
        bad.push(`${file}:${i + 1} ${line.trim()}`);
      }
    });
    assert(bad.length === 0, `存在内联颜色赋值：\n      ${bad.join("\n      ")}`);
  });
});

test("字体大小只在令牌中定义，组件层不出现裸 px 字号", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
  const bad = [];
  css.split("\n").forEach((line, i) => {
    if (/font-size:\s*\d/.test(line)) bad.push(`第 ${i + 1} 行: ${line.trim()}`);
  });
  assert(bad.length === 0, `存在裸字号（应使用 var(--fs-*)）：\n      ${bad.join("\n      ")}`);
});

test("可点元素尺寸不低于 36px（触屏可用性）", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
  const tokens = fs.readFileSync(path.join(ROOT, "css", "tokens.css"), "utf8");
  const MIN = 36;
  const bad = [];

  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css))) {
    const selectors = m[1].trim();
    const body = m[2];
    if (!/(^|[\s,])\.(icon-btn|act-btn|btn|chip|switch)\b/.test(selectors)) continue;
    if (/\[aria-pressed/.test(selectors)) continue;   // 状态变体不重复声明尺寸
    if (/::/.test(selectors)) continue;               // 伪元素是装饰，不是可点区域
    const h = /(?:^|[;\s])height:\s*(\d+)px/.exec(body);
    if (!h) continue;
    const value = Number(h[1]);
    if (value < MIN) bad.push(`${selectors.trim()} height:${value}px`);
  }

  // 分段控件由「外层容器留白 + 内部按钮」构成，检查整体高度是否达标
  const segOuter = /\.segmented\s*\{([^}]*)\}/.exec(css);
  const segInner = /\.segmented button\s*\{([^}]*)\}/.exec(css);
  if (segOuter && segInner) {
    const padRaw = /padding:\s*([^;]+);/.exec(segOuter[1]);
    // 令牌变量按 --sp-1 = 4px 解析，其余情况按 4px 处理
    const pad = padRaw ? (/(\d+)px/.test(padRaw[1]) ? Number(/(\d+)px/.exec(padRaw[1])[1]) : 4) : 0;
    const inner = Number((/height:\s*(\d+)px/.exec(segInner[1]) || [0, 0])[1]);
    if (inner && inner + pad * 2 < 40) {
      bad.push(`.segmented 整体高度 ${inner + pad * 2}px（按钮 ${inner}px + 留白 ${pad * 2}px）`);
    }
  }

  // 令牌层的最小尺寸变量也必须达标
  const tokenMin = /--h-control:\s*(\d+)px/.exec(tokens);
  if (tokenMin && Number(tokenMin[1]) < MIN) {
    bad.push(`--h-control:${tokenMin[1]}px`);
  }

  assert(bad.length === 0,
    `以下可点元素小于 ${MIN}px（用户在触屏上难以点中）：\n      ${bad.join("\n      ")}`);
});

test("卡片操作按钮同时具备图标与文字，且不是裸图标", () => {
  const ui = fs.readFileSync(path.join(ROOT, "js", "ui.js"), "utf8");
  assert(/var favBtn = el\("button", "act-btn"\)/.test(ui), "收藏按钮未使用 .act-btn");
  assert(/var regBtn = el\("button", "act-btn act-btn-primary"\)/.test(ui),
    "报名按钮未使用 .act-btn 主样式");
  // 两个按钮都必须带文字标签，而不是只有图标
  assert(/favOn \? "已收藏" : "收藏"/.test(ui), "收藏按钮缺少文字标签");
  assert(/regOn \? "已加入" : "我要参加"/.test(ui), "报名按钮缺少文字标签");
  // 图标必须成对出现（图标 + 文字）
  assert(/favBtn\.appendChild\(icon\(/.test(ui), "收藏按钮缺少图标");
  assert(/regBtn\.appendChild\(icon\(/.test(ui), "报名按钮缺少图标");
});

test("卡片操作按钮在深色底色上有可见的描边与底色", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
  // 必须精确匹配基类规则 `.act-btn {`（行首），
  // 否则会误匹配 `.card-actions .act-btn { flex: ... }` 这类组合选择器
  const block = /^\.act-btn\s*\{([^}]*)\}/m.exec(css);
  assert(block, "找不到 .act-btn 基类规则（必须单独成行定义）");
  const body = block[1];
  assert(/border:\s*1px solid var\(--border-strong\)/.test(body),
    "act-btn 缺少可见描边，会在深色卡片上融入背景");
  assert(/background:\s*var\(--surface-2\)/.test(body),
    "act-btn 缺少底色，会在深色卡片上融入背景");
  assert(/color:\s*var\(--text\)/.test(body),
    "act-btn 文字颜色过暗");
  assert(/height:\s*36px/.test(body), "act-btn 高度应为 36px");
});

console.log(`\n${"-".repeat(52)}`);
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项检查`);
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}
