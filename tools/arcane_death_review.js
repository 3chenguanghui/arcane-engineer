// 死亡归因 · 自检
// 用法：node tools\arcane_death_review.js
// 断言：三种死法输出正确；每类占比合计 100；图例含最大单次/主凶；首领场景出现骤升。
const { openPreview } = require('./preview_cdp');

const EXPR = String.raw`
(() => {
  const d = window.__previewDebug.p1;
  const errors = [];
  const assert = (cond, msg) => { if (!cond) errors.push(msg); };
  const find = (info, key) => info.list.find((item) => item.key === key) || null;

  const melee = d.scenario('melee');
  const env = d.scenario('env');
  const boss = d.scenario('boss');

  [melee, env, boss].forEach((info, i) => {
    const name = ['melee', 'env', 'boss'][i];
    assert(info.pctSum === 100, name + ' 占比合计应为 100，实际 ' + info.pctSum);
    assert(info.summary.indexOf('第 12 层') >= 0, name + ' 总结缺少楼层：' + info.summary);
    assert(info.summary.indexOf('打死') >= 0, name + ' 总结缺少死法：' + info.summary);
  });

  const m = find(melee, 'melee');
  assert(m && m.pct === 79 && m.maxHit === 38 && m.topName === '裁决者',
    'melee 字段错误：' + JSON.stringify(m));
  assert(melee.spike === null, 'melee 不应有骤升');

  const g = find(env, 'ground');
  assert(g && g.pct === 83 && g.maxHit === 20 && g.topName === '落锤',
    'ground 字段错误：' + JSON.stringify(g));
  assert(env.spike === null, 'env 不应有骤升');

  const b = find(boss, 'boss');
  assert(b && b.pct === 50 && b.maxHit === 40 && b.topName === '裁决者',
    'boss 字段错误：' + JSON.stringify(b));
  assert(boss.spike && boss.spike.key === 'boss' && boss.spike.floorPct === 100,
    'boss 应有骤升：' + JSON.stringify(boss.spike));

  const html = d.html();
  assert(html.indexOf('data-p1-summary="1"') >= 0, 'HTML 缺少总结节点');
  assert(html.indexOf('data-p1-max="') >= 0, 'HTML 缺少最大单次');
  assert(html.indexOf('data-p1-spike="') >= 0, 'HTML 缺少骤升标记');

  return { errors: errors, melee: melee, env: env, boss: boss, htmlLength: html.length };
})()
`;

(async () => {
  const { value, errors: pageErrors } = await openPreview('death-review-preview.html', EXPR, { waitMs: 1200 });
  const r = value || {};
  const errors = (r.errors || []).concat(pageErrors || []);
  console.log('=== 死亡归因自检 ===');
  console.log('近战：', JSON.stringify({ summary: r.melee && r.melee.summary, list: r.melee && r.melee.list }));
  console.log('环境：', JSON.stringify({ summary: r.env && r.env.summary, list: r.env && r.env.list }));
  console.log('首领：', JSON.stringify({ summary: r.boss && r.boss.summary, spike: r.boss && r.boss.spike }));
  if (errors.length) {
    console.error('FAIL');
    errors.forEach((e) => console.error(' - ' + e));
    process.exit(1);
  }
  console.log('PASS 三种死法、占比 100、最大单次/主凶/骤升均正确');
})();
