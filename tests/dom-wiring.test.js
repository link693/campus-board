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

test("引用的脚本与样式文件都存在", () => {
  const missing = [];
  const re = /(?:src|href)="((?:js|css|docs|data)\/[^"]+)"/g;
  let mm;
  while ((mm = re.exec(html))) {
    if (!fs.existsSync(path.join(ROOT, mm[1]))) missing.push(mm[1]);
  }
  assert(missing.length === 0, `文件不存在：${missing.join(", ")}`);
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

console.log(`\n${"-".repeat(52)}`);
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项检查`);
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}
