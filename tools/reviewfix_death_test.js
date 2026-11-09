// 死亡归因 · 在"打完补丁的主文件副本"上自检（不是预览页）
// 用法：node tools\reviewfix_death_test.js [副本路径]
const path = require('path');
const { openPreview } = require('./preview_cdp');

const PAGE = process.argv[2] || '.reviewfix/index_patched.html';

const EXPR = `(async () => {
  const out = { ok: true, steps: [], fails: [] };
  const assert = (name, cond, extra) => {
    out.steps.push({ name: name, pass: !!cond, extra: extra === undefined ? null : extra });
    if (!cond) { out.ok = false; out.fails.push(name); }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  __roamDebug.start();
  await sleep(300);
  state.player.hpMax = 1e7;
  state.player.hp = 1e7;
  state.player.invuln = 0;
  const P = __roamDebug.p1;

  // 0) 分类表：ground 必须不存在；hazard 归 env（带 bossKind 仍算 boss）
  const cats = P.categories();
  assert('无 ground', cats.indexOf('ground') < 0, cats);
  assert('hazard→env', p1CategoryOf({ kind: 'hazard' }) === 'env', p1CategoryOf({ kind: 'hazard' }));
  assert('bossKind 优先', p1CategoryOf({ kind: 'hazard', bossKind: 'adjudicator' }) === 'boss');
  assert('collapse 无分支', p1CategoryOf({ kind: 'collapse' }) === 'other');

  // 1) 近战死：71% 近战 / 29% 远程，最大单次 38，主凶 裁决者
  state.floor = 12;
  P.reset();
  P.damagePlayer(38, 'contact', '裁决者');
  P.damagePlayer(33, 'contact', '裁决者');
  P.damagePlayer(29, 'bullet', '弓手');
  const d1 = P.detail();
  const sum1 = d1.reduce((s, i) => s + i.pct, 0);
  assert('近战 71%', d1[0] && d1[0].key === 'melee' && d1[0].pct === 71, d1[0] && d1[0].pct);
  assert('最大单次 38', d1[0] && d1[0].maxHit === 38, d1[0] && d1[0].maxHit);
  assert('主凶 裁决者', d1[0] && d1[0].topName === '裁决者', d1[0] && d1[0].topName);
  assert('合计 100', sum1 === 100, sum1);
  const s1 = P.summary();
  assert('总结含第 12 层', s1.indexOf('第 12 层') >= 0, s1);
  assert('总结含一次 38 点', s1.indexOf('38') >= 0, s1);

  // 2) 环境死：符阵 25 + 近战 5 → 环境 83
  state.floor = 12;
  P.reset();
  P.damagePlayer(25, 'sigil', '符阵');
  P.damagePlayer(5, 'contact', '小怪');
  const d2 = P.detail();
  assert('环境 83%', d2[0] && d2[0].key === 'env' && d2[0].pct === 83, d2[0] && d2[0].pct);
  assert('环境合计 100', d2.reduce((s, i) => s + i.pct, 0) === 100);

  // 3) 首领死：40 贴身 + 20 技能 → boss 100%，贴身子句 40 点（67%）
  state.floor = 12;
  P.reset();
  P.damagePlayer(20, 'contact', '裁决者', 'adjudicator');
  P.damagePlayer(20, 'hazard', '裁决者', 'adjudicator');
  P.damagePlayer(20, 'contact', '裁决者', 'adjudicator');
  const v = P.info().verdict;
  assert('标签含（含贴身）', v.label.indexOf('含贴身') >= 0, v.label);
  assert('判决 tag=boss', v.tag === 'boss', v.tag);
  assert('贴身子句 40 点', v.rule.indexOf('贴身接触 40 点') >= 0, v.rule);
  assert('贴身子句 67%', v.rule.indexOf('67%') >= 0, v.rule);
  const d3 = P.detail();
  assert('贴身计数 2 次', !!(d3[0].contact && d3[0].contact.dmg === 40 && d3[0].contact.hits === 2), d3[0].contact);
  assert('首领 100%', d3[0].pct === 100, d3[0].pct);
  assert('贴身不计入新分类', d3.length === 1, d3.map((i) => i.key));

  // 4) 死亡层骤升：第 1 层吃 40 远程，第 12 层吃 20 近战 → 近战本层 100% vs 全局 33%
  P.reset();
  state.floor = 1;
  P.damagePlayer(40, 'bullet', '弓手');
  state.floor = 12;
  P.damagePlayer(20, 'contact', '裁决者');
  const sp = P.spike();
  assert('骤升命中 melee', !!(sp && sp.key === 'melee'), sp);
  assert('骤升本层 100%', !!(sp && sp.floorPct === 100), sp && sp.floorPct);
  assert('骤升全局 33%', !!(sp && sp.runPct === 33), sp && sp.runPct);

  // 5) 结算 HTML 三件套
  const html = buildReviewHtml({ name: '裁决者', amount: 20, quote: null }, false);
  assert('有 data-p1-summary', html.indexOf('data-p1-summary="1"') >= 0);
  assert('有 data-p1-max', html.indexOf('data-p1-max=') >= 0);
  assert('有 data-p1-spike', html.indexOf('data-p1-spike="1"') >= 0);

  out.info = {
    categories: cats,
    melee: d1,
    env: d2,
    verdict: v,
    boss: d3,
    spike: sp,
    summary: s1
  };
  return out;
})()`;

(async () => {
  const res = await openPreview(PAGE, EXPR, { waitMs: 1500, timeoutMs: 25000 });
  const v = res.value || {};
  (v.steps || []).forEach((s) => console.log((s.pass ? 'PASS ' : 'FAIL ') + s.name
    + (s.extra !== null && s.extra !== undefined ? '  → ' + JSON.stringify(s.extra) : '')));
  if (res.errors && res.errors.length) console.log('页面错误：' + JSON.stringify(res.errors));
  console.log('RESULT: ' + (v.ok && !(res.errors || []).length ? 'PASS' : 'FAIL'));
  if (v.info) console.log('INFO: ' + JSON.stringify(v.info));
  process.exit(v.ok && !(res.errors || []).length ? 0 : 1);
})().catch((error) => {
  console.error('运行失败：' + error.message);
  process.exit(1);
});
