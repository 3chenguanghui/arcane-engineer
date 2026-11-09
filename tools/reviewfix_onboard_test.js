// 教学事件化 · 在"打完补丁的主文件副本"上自检（不是预览页）
// 用法：node tools\reviewfix_onboard_test.js [副本路径]
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
  const KEYS = ['firstRoom', 'firstChoice', 'firstElite', 'lowHp', 'firstCrystal'];

  __roamDebug.start();
  await sleep(400);
  const d = __roamDebug.onboard;
  state.meta.runs = 1;
  state.meta.bestFloor = 0;
  d.reset(true);
  state.player.invuln = 1e9;
  state.player.hp = state.player.hpMax;

  // 1) 事件表本身
  const steps = d.info().steps;
  assert('事件数=5', steps.length === 5, steps.map((s) => s.key));
  assert('序号 n=1..5', steps.map((s) => s.n).join(',') === '1,2,3,4,5', steps.map((s) => s.n));
  assert('文案≤12字', steps.every((s) => s.chars <= 12), steps.map((s) => s.chars));

  // 2) firstRoom：delay 1.2 秒，未到不显示
  const r1 = d.event('firstRoom');
  assert('firstRoom 接受', r1.ok === true, r1);
  await sleep(700);
  assert('1.2s 前不显示', d.info().hintVisible === false);
  await sleep(900);
  assert('firstRoom 上屏', d.info().hintVisible === true && d.info().hint.key === 'firstRoom', d.info().hint);
  onboardHideHint(false);
  onboardTick(0.6);

  // 3) 3 秒淡出（单独渲染一次，2.9s 还在、3.2s 收起）
  onboardRenderHint(ONBOARD_STEPS[0], false);
  onboardTick(2.9);
  assert('2.9s 仍在屏', onboardHintVisible() === true);
  onboardTick(0.35);
  assert('3.2s 已收起', onboardHintVisible() === false);

  // 4) firstChoice：走真实 openReward，提示必须长在弹窗内部
  openReward('floor', 'skill');
  await sleep(120);
  const line = d.modalLine();
  assert('弹窗内提示行', /选牌优先凑融合/.test(line || ''), line);
  if (ui.modalLayer) ui.modalLayer.classList.add('hidden');
  state.mode = 'playing';
  state.status = 'playing';
  onboardTick(3.1);
  onboardTick(0.6);

  // 5) firstElite：走真实进房回调
  onboardOnRoomEnter({ id: 987, type: 'elite' });
  assert('firstElite 上屏', !!(d.info().hint && d.info().hint.key === 'firstElite'), d.info().hint);

  // 6) Esc 可跳过
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert('Esc 立即收起', d.info().hintVisible === false);
  onboardTick(0.6);

  // 7) lowHp：走真实 damagePlayer（复用每局一次的 lowHpFired）
  state.player.invuln = 0;
  state.player.hp = state.player.hpMax * 0.25;
  state.fx.lowHpFired = false;
  __roamDebug.p1.damagePlayer(1, 'contact', '测试怪');
  assert('lowHp 记账', d.info().ev.lowHp === true, d.info().ev);
  onboardTick(3.1);
  onboardTick(0.6);
  state.player.hp = state.player.hpMax;
  state.player.invuln = 1e9;

  // 8) firstCrystal：走真实 grantRunCrystals
  grantRunCrystals(3, 'test');
  assert('firstCrystal 记账', d.info().ev.firstCrystal === true, d.info().ev);

  const info = d.info();
  assert('事件顺序', JSON.stringify(info.evOrder) === JSON.stringify(KEYS), info.evOrder);
  assert('seen 覆盖 5 条', KEYS.every((k) => info.seen[k] === true), info.seen);
  const rep = KEYS.map((k) => d.event(k).ok);
  assert('重复全部 false', rep.every((v) => v === false), rep);

  // 9) 第二局：runs=2 → 老玩家，播种后 0 次
  state.meta.runs = 2;
  state.meta.bestFloor = 0;
  d.reset(true);
  const i2 = d.info();
  assert('第二局 returning', i2.returning === true, i2.returning);
  assert('第二局已播种', KEYS.every((k) => i2.seen[k] === true), i2.seen);
  const rej = KEYS.map((k) => d.event(k).ok);
  assert('第二局全拒绝', rej.every((v) => v === false), rej);

  // 10) ③ 回归：新号 showFloor(5) 不被 bestFloor 抬高误判成老档
  state.meta.runs = 1;
  state.meta.bestFloor = 0;
  d.reset(true);
  d.showFloor(5);
  const i3 = d.info();
  assert('showFloor 基线=0', !!(i3.baseline && i3.baseline.bestFloor === 0), i3.baseline);
  assert('showFloor 不判老档', i3.returning === false, i3.returning);
  assert('showFloor 未播种', KEYS.every((k) => i3.seen[k] !== true), i3.seen);
  const ok3 = d.event('firstCrystal');
  assert('showFloor 后仍能触发', ok3.ok === true, ok3);

  // 11) 总开关关闭：队列里残留的提示不得继续出队（调试 set({enabled:false}) 不该还能弹）
  state.meta.runs = 1;
  state.meta.bestFloor = 0;
  d.reset(true);
  d.set({ enabled: true });
  onboardRenderHint(ONBOARD_STEPS[0], false);   // 屏上先有一条
  onboardShowHint('firstChoice');               // 第二条进队列
  d.set({ enabled: false });                    // 关闭会收起屏上那条，队列保留
  onboardTick(3.2);                             // gap 归零：无门禁时队列会在这一 tick 弹出来
  assert('关闭后不出队', d.info().hintVisible === false, d.info().hint);
  assert('队列仍挂起', d.info().queue.length === 1, d.info().queue);
  d.set({ enabled: true });
  onboardTick(0.6);   // 关闭期间 gap 不递减（整段 return），重开后要补够 0.5s 间隙
  assert('重开后队列继续', d.info().hintVisible === true && d.info().hint.key === 'firstChoice', d.info().hint);

  // 12) 调试口 resetRun：跑过一局后仍能重建"新号"（runs=1、bestFloor=0、returning=false）
  const rr = d.resetRun({ clearSeen: true, runs: 1, bestFloor: 0 });
  assert('resetRun 可重建新号',
    rr.baseline.runs === 1 && rr.baseline.bestFloor === 0 && rr.returning === false,
    rr.baseline);

  out.info = {
    evOrder: info.evOrder,
    seen: info.seen,
    baselineRun2: i2.baseline,
    baselineShowFloor5: i3.baseline,
    showFloorHint: d.info().hint ? d.info().hint.text : null
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
