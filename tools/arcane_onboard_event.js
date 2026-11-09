// 首局事件教学 · 自检
// 用法：node tools\arcane_onboard_event.js
// 断言：5 条按顺序触发且各只一次；3 秒停留；Esc 可跳过；第二局 0 次。
const { openPreview } = require('./preview_cdp');

const EXPR = String.raw`
(async () => {
  const d = window.__previewDebug.onboard;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  const steps = [];
  const assert = (cond, msg) => { if (!cond) errors.push(msg); };

  // ---------- 第一局 ----------
  let info = d.resetRun({ clearSeen: true, runs: 1 });
  assert(info.returning === false, '首局 returning 应为 false（runs=1）');
  assert(Object.keys(info.seen).length === 0, '首局 seen 应为空');

  // 1) 第一次进房（带 1.2s 延迟）
  const ok1 = d.event('firstRoom').ok;
  assert(ok1, 'firstRoom 应被接受');
  await sleep(1600);
  let hi = d.info();
  steps.push({ key: 'firstRoom', ok: ok1, visible: hi.hintVisible, text: hi.hintText, t: hi.hintT });
  assert(hi.hintVisible, 'firstRoom 提示应可见');
  assert(hi.hintText.indexOf('WASD') >= 0, 'firstRoom 文案错误：' + hi.hintText);
  d.hide();

  // 2) 第一次三选一：必须渲染在弹窗内部（不能只是"弹出了"）
  const modal = d.modal('firstChoice');
  steps.push({ key: 'firstChoice', ok: modal.ok, line: modal.line });
  assert(modal.ok, 'firstChoice 应被接受');
  assert(modal.line && modal.line.indexOf('选牌优先凑融合') >= 0,
    '弹窗内应有教学行，实际：' + modal.line);
  assert(d.info().hintVisible === false, '三选一不应使用浮动提示（会被弹窗盖住）');
  d.closeModal();

  // 3) 第一次精英：检查 3 秒停留 + Esc 跳过
  assert(d.event('firstElite').ok, 'firstElite 应被接受');
  hi = d.info();
  assert(hi.hintVisible, 'firstElite 应可见');
  assert(hi.hintT > 2.0 && hi.hintT <= 3.0, '停留应约 3 秒，实际 ' + hi.hintT);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  steps.push({ key: 'firstElite', ok: true, skipped: true, t: hi.hintT });
  assert(d.info().hintVisible === false, 'Esc 应能跳过提示');

  // 4) 第一次低血
  assert(d.event('lowHp').ok, 'lowHp 应被接受');
  hi = d.info();
  assert(hi.hintVisible, 'lowHp 应可见');
  steps.push({ key: 'lowHp', ok: true, text: hi.hintText });
  d.hide();

  // 5) 第一次结晶
  assert(d.event('firstCrystal').ok, 'firstCrystal 应被接受');
  hi = d.info();
  assert(hi.hintVisible, 'firstCrystal 应可见');
  steps.push({ key: 'firstCrystal', ok: true, text: hi.hintText });
  d.hide();

  const after = d.info();
  assert(JSON.stringify(after.evOrder) === JSON.stringify(
    ['firstRoom', 'firstChoice', 'firstElite', 'lowHp', 'firstCrystal']),
    '触发顺序错误：' + JSON.stringify(after.evOrder));
  assert(Object.keys(after.seen).length === 5, '第一局后 5 条都应写进存档');

  // 各再触发一次，必须全部拒绝
  const repeats = ['firstRoom', 'firstChoice', 'firstElite', 'lowHp', 'firstCrystal']
    .map((k) => d.event(k).ok);
  assert(repeats.every((v) => v === false), '重复触发应全部拒绝：' + JSON.stringify(repeats));

  // ---------- 第二局 ----------
  const second = d.resetRun({ clearSeen: true, runs: 2 });
  const secondRejects = ['firstRoom', 'firstChoice', 'firstElite', 'lowHp', 'firstCrystal']
    .map((k) => d.event(k).ok);
  assert(second.returning === true, '第二局 returning 应为 true');
  assert(Object.keys(second.seen).length === 5, '第二局应播种 5 条已看');
  assert(secondRejects.every((v) => v === false), '第二局 5 条都应拒绝：' + JSON.stringify(secondRejects));

  return {
    errors: errors,
    steps: steps,
    firstRun: {
      evOrder: after.evOrder,
      seen: Object.keys(after.seen).length,
      repeats: repeats
    },
    secondRun: {
      returning: second.returning,
      seen: Object.keys(second.seen).length,
      rejects: secondRejects
    },
    configLife: 3.0
  };
})()
`;

(async () => {
  const { value, errors: pageErrors } = await openPreview('onboard-event-preview.html', EXPR, { waitMs: 1500 });
  const r = value || {};
  const errors = (r.errors || []).concat(pageErrors || []);
  console.log('=== 首局事件教学自检 ===');
  console.log('触发步骤：', JSON.stringify(r.steps, null, 2));
  console.log('第一局：', JSON.stringify(r.firstRun));
  console.log('第二局：', JSON.stringify(r.secondRun));
  if (errors.length) {
    console.error('FAIL');
    errors.forEach((e) => console.error(' - ' + e));
    process.exit(1);
  }
  console.log('PASS 5 条按顺序、各一次、第二局 0 次');
})();
