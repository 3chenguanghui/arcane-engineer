/**
 * 只读探针：新手教学 6 步是否真的能走完、能否跳过、是否不打断老玩家
 * ------------------------------------------------------------
 * 用法：node tools/diag_tutorial.js
 * 流程：新档开局 → 读第 1 步 → 依次触发 move/kill/pick/room/descend/fuse →
 *      完成后重开 tutorialBegin 应不出现 → 点设置页"重播"应回到第 1 步。
 * 只改内存与临时 profile，不写玩家真实存档目录（每轮 prepareProfile 是干净档）。
 */
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9763;
const FILE = path.resolve(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 读当前教学状态快照
 * @returns {Object} step / label / text / tip / visible / done
 */
const SNAP = `(() => {
  const ov = document.getElementById('tutOverlay');
  const tx = document.getElementById('tutText');
  const tip = document.getElementById('tutTip');
  const lb = document.getElementById('tutStepLabel');
  const t = state && state.tutorial;
  return {
    step: t ? t.step : null,
    done: t ? !!t.done : null,
    label: lb ? (lb.textContent || '').trim() : '',
    text: tx ? (tx.textContent || '').trim() : '',
    tip: tip ? (tip.textContent || '').trim() : '',
    visible: !!(ov && ov.dataset.on === '1' && !ov.classList.contains('is-hidden')),
    metaDone: !!(state && state.meta && state.meta.tutorialDone)
  };
})()`;

/** 主流程 */
async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.text || '') + ' ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) break;
    await sleep(250);
  }
  await ev("document.getElementById('btnStart').click()");
  await sleep(500);
  await ev("const c=document.querySelector('.char-card'); if(c) c.click();");
  await sleep(300);
  await ev("const b=document.getElementById('btnCharConfirm'); if(b) b.click();");
  await sleep(1600);

  console.log('T1 开局', JSON.stringify(await ev(SNAP)));

  /* 第 1 步：真实位移判定（tutorialTick 内部按累计位移 ≥60 放行） */
  await ev("state.player.x += 90; true");
  await sleep(260);
  console.log('T2 移动后', JSON.stringify(await ev(SNAP)));

  /* 第 2 步：击杀钩子（killEnemy 内调用的同一个函数） */
  await ev("tutorialOnKill(); true");
  await sleep(120);
  console.log('T3 击杀后', JSON.stringify(await ev(SNAP)));

  /* 第 3 步：选牌钩子（选牌函数内调用的同一个入口） */
  await ev("tutorialOnPickup('reward'); true");
  await sleep(120);
  console.log('T4 选牌后', JSON.stringify(await ev(SNAP)));

  /* 第 4 步：选房——走真实 performRoomTeleport，验证埋点在真实路径上 */
  const roomRes = await ev(`(() => {
    const cur = state.currentRoomId;
    const nb = (typeof roomNeighbors === 'function') ? roomNeighbors(cur) : [];
    const target = nb.find((id) => { const r = state.rooms[id]; return r && !r.visited && !r.cleared; }) || nb[0];
    if (target == null) return 'NO_NEIGHBOR';
    const ok = performRoomTeleport(target);
    return 'target=' + target + ' ok=' + ok + ' cur=' + state.currentRoomId;
  })()`);
  await sleep(400);
  console.log('T5 传送', roomRes);
  console.log('T6 传送后', JSON.stringify(await ev(SNAP)));

  /* 第 5 步：下楼——先把当前房伪装成已清首领，再走真实 descendFloor */
  const descRes = await ev(`(() => {
    const room = state.rooms[state.currentRoomId];
    if (!room) return 'NO_ROOM';
    room.type = 'boss';
    room.cleared = true;
    room.visited = true;
    const before = state.floor;
    try { descendFloor(); } catch (e) { return 'THROW ' + e.message; }
    return 'floor ' + before + ' -> ' + state.floor;
  })()`);
  await sleep(600);
  console.log('T7 下楼', descRes);
  console.log('T8 下楼后', JSON.stringify(await ev(SNAP)));

  /* 第 6 步：融合——真实 tryFuse 成功路径会调 tutorialOnPickup('fuse') */
  const fuseRes = await ev(`(() => {
    if (typeof unlockMetaRoot === 'function') unlockMetaRoot().fusion = true;
    const pair = FUSION_CONFIG.find((f) => !(state.ownedMagic || []).includes(f.magic) && !(state.ownedTech || []).includes(f.tech));
    if (!pair) return 'NO_PAIR';
    state.ownedMagic.push(pair.magic);
    state.ownedTech.push(pair.tech);
    const ok = tryFuse();
    return 'pair=' + pair.id + ' ok=' + ok + ' fusions=' + JSON.stringify(state.fusions);
  })()`);
  await sleep(400);
  console.log('T9 融合', fuseRes);
  console.log('T10 融合后', JSON.stringify(await ev(SNAP)));

  /* 老玩家不被打断：已完成后再调 tutorialBegin 不应出现 */
  await ev("tutorialBegin(); true");
  await sleep(160);
  console.log('T11 完成后重开', JSON.stringify(await ev(SNAP)));

  /* 设置页重播按钮：清标记 → 回第 1 步 */
  const replayRes = await ev(`(() => {
    const btn = document.getElementById('btnTutorialReplay');
    if (!btn) return 'NO_BTN';
    state.meta.tutorialDone = false;
    btn.click();
    return 'clicked';
  })()`);
  await sleep(300);
  console.log('T12 重播', replayRes);
  console.log('T13 重播后', JSON.stringify(await ev(SNAP)));

  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
