/**
 * C1 挑战房验收：A0–A10
 * 用法：node tools/arcane_challenge.js
 * 端口：9523
 * 输出：.screenshots/art/challenge.png、challenge-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9523;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1300);
  await ev(`window.__errors = []; true`);

  // ---------- A0 配置 ----------
  const a0 = await ev(`window.__roamDebug.challenge.info()`);
  ok('A0 配置默认值（60s / 结晶+2 / 等级+1 / 三种条件）',
    a0.enabled === true && a0.config.timeLimit === 60 && a0.config.bonusCrystals === 2
      && a0.config.bonusCharges === 1 && a0.config.kinds.length === 3
      && a0.config.kinds.indexOf('timed') >= 0
      && a0.config.kinds.indexOf('nofusion') >= 0
      && a0.config.kinds.indexOf('primaryOnly') >= 0
      && a0.config.rewardText.indexOf('结晶') >= 0, a0.config);

  // ---------- A1 每层 1 间 + 房型/排除 ----------
  const a1 = await ev(`(function(){
    var out = [];
    [1,2,3,4,5,6].forEach(function(f){
      window.__roamDebug.challenge.setFloor(f);
      var info = window.__roamDebug.challenge.info();
      var paid = state.pricedDoors ? state.pricedDoors.paidRoomId : -1;
      var keyIds = state.openFloor ? state.openFloor.keyRoomIds : [];
      out.push({ floor: f, rooms: info.authoredRooms, paid: paid, keys: keyIds,
        spawn: state.spawnRoomId });
    });
    return out;
  })()`);
  const a1ok = a1.every((x) => x.rooms.length === 1
    && x.rooms[0].id !== x.spawn && x.rooms[0].type !== 'boss'
    && x.rooms[0].id !== x.paid && !x.keys.includes(x.rooms[0].id));
  ok('A1 每层恰好 1 间挑战房，且排除出生/首领/钥匙/代价房', a1ok, a1);

  // ---------- A2 条件按层轮换 ----------
  const a2 = await ev(`(function(){
    var out = [];
    [1,2,3,4].forEach(function(f){
      window.__roamDebug.challenge.setFloor(f);
      var info = window.__roamDebug.challenge.info();
      out.push({ floor: f, kind: info.authoredRooms[0] ? info.authoredRooms[0].kind : null });
    });
    return out;
  })()`);
  ok('A2 条件按层轮换：1 限时 / 2 禁融合 / 3 主槽 / 4 限时',
    a2[0].kind === 'timed' && a2[1].kind === 'nofusion'
      && a2[2].kind === 'primaryOnly' && a2[3].kind === 'timed', a2);

  // ---------- A3 门板条件 ----------
  const a3 = await ev(`window.__roamDebug.challenge.setFloor(1)`);
  const a3door = await ev(`(function(){
    var info = window.__roamDebug.challenge.info();
    var room = state.rooms[info.room ? info.room.id : info.authoredRooms[0].id];
    var door = state.doors.filter(function(d){ return d.targetRoomId === room.id; })[0];
    var dinfo = door ? doorInfoFor(door) : null;
    return { roomId: room.id, hasDoor: !!door, info: dinfo };
  })()`);
  ok('A3 门板写明挑战条件 + 达成奖励 + "可以不进门"',
    !!a3door.hasDoor && !!a3door.info && !!a3door.info.challenge
      && a3door.info.tip.indexOf('挑战') >= 0
      && a3door.info.tip.indexOf('结晶') >= 0
      && a3door.info.challenge.footerText.indexOf('不进') >= 0, a3door);

  // ---------- A4 不进门不开始；进门才开始 ----------
  const a4before = await ev(`(function(){
    return { started: window.__roamDebug.challenge.info().state.started,
      statsStarted: window.__roamDebug.challenge.info().stats.started };
  })()`);
  await sleep(600);
  const a4idle = await ev(`(function(){
    return { started: window.__roamDebug.challenge.info().state.started,
      statsStarted: window.__roamDebug.challenge.info().stats.started };
  })()`);
  const a4enter = await ev(`window.__roamDebug.challenge.enter()`);
  ok('A4 不进门不开始（站着 0.6s 仍未开始），进门后才 started',
    a4before.started === false && a4idle.started === false
      && a4idle.statsStarted === a4before.statsStarted
      && a4enter.state.started === true && a4enter.state.kind === 'timed', { before: a4before, idle: a4idle, enter: a4enter.state });

  // ---------- A5 限时达成 ----------
  const a5 = await ev(`(function(){
    /* 第 13 项修正：第 12 项给"额外结晶来源"加了本局额度（extraBudget / crystalsPerRunMax），
       前面的场景已经把额度用掉，导致挑战奖励被削成 0。这里把本局额度清零再测，
       断言仍然严格要求"基础收益 + 挑战 +2 / 等级 +1"，不是放宽。 */
    state.crystalRunGain = 0; state.crystalExtraSpent = 0;
    var before = { crystals: state.meta.crystals, charges: state.eliteRewardCharges };
    window.__roamDebug.challenge.clearNow();
    var info = window.__roamDebug.challenge.info();
    return { before: before, after: { crystals: state.meta.crystals,
      charges: state.eliteRewardCharges }, info: info.state, stats: info.stats,
      roomType: info.room ? info.room.type : null,
      /* 第 13 项修正：精英房清房结晶已改为可配置（第 12 项把 clearCrystals 归 0，
         收益改走"奖励等级 +1"），所以基础结晶要读配置而不是写死 1。
         基础等级则只给"精英路线上的房"，不是所有 elite 房。 */
      eliteClearCrystals: Math.max(0, Number(ELITE_ROUTE_CONFIG.clearCrystals) || 0),
      routeRoom: !!(state.eliteRoute && state.eliteRoute.roomIds.indexOf(info.state.roomId) !== -1),
      chargesPerRoom: ELITE_ROUTE_CONFIG.chargesPerRoom };
  })()`);
  /* 挑战房可能落在精英房：精英清房本身给结晶 / 等级，
     所以断言用"基础收益 + 挑战奖励"，只证明挑战额外那一份是 +2 / +1 */
  const baseCrystals = (x) => (x.roomType === 'elite' ? x.eliteClearCrystals : 0);
  const baseCharges = (x) => (x.routeRoom ? x.chargesPerRoom : 0);
  ok('A5 限时达成：结晶 +2、奖励等级 +1、success=true',
    a5.info.success === true && a5.info.done === true
      && a5.after.crystals === a5.before.crystals + baseCrystals(a5) + 2
      && a5.after.charges === a5.before.charges + baseCharges(a5) + 1
      && a5.stats.success >= 1, a5);

  // ---------- A6 超时未达成 ----------
  const a6 = await ev(`(function(){
    window.__roamDebug.challenge.setFloor(1);
    window.__roamDebug.challenge.setKind('timed');
    window.__roamDebug.challenge.enter();
    window.__roamDebug.challenge.violate('timeout');
    state.crystalRunGain = 0; state.crystalExtraSpent = 0;   // 同上：清空本局额外结晶额度
    var before = { crystals: state.meta.crystals, charges: state.eliteRewardCharges };
    window.__roamDebug.challenge.clearNow();
    var info = window.__roamDebug.challenge.info();
    return { before: before, after: { crystals: state.meta.crystals,
      charges: state.eliteRewardCharges }, info: info.state, stats: info.stats,
      roomType: info.room ? info.room.type : null,
      eliteClearCrystals: Math.max(0, Number(ELITE_ROUTE_CONFIG.clearCrystals) || 0),
      routeRoom: !!(state.eliteRoute && state.eliteRoute.roomIds.indexOf(info.state.roomId) !== -1),
      chargesPerRoom: ELITE_ROUTE_CONFIG.chargesPerRoom };
  })()`);
  ok('A6 超时未达成：不给额外结晶/等级，success=false，failed+1',
    a6.info.success === false && a6.info.done === true
      && a6.after.crystals === a6.before.crystals + baseCrystals(a6)
      && a6.after.charges === a6.before.charges + baseCharges(a6)
      && a6.stats.failed >= 1, a6);

  // ---------- A7 禁用融合：违规 / 干净 ----------
  /* 期望值 = 清房基础收益 + 挑战奖励。
     挑战房可能是精英房（精英清房自带 +1 结晶），所以不能硬写 delta===2，
     改成"基础收益 +（达成 ? 2 : 0）"，这样精确证明挑战奖励只有 +2，
     同时不管随机落到普通战斗房还是精英房都成立。 */
  const a7bad = await ev(`(function(){
    window.__roamDebug.challenge.setFloor(2);
    window.__roamDebug.challenge.setKind('nofusion');
    window.__roamDebug.challenge.enter();
    window.__roamDebug.challenge.violate('fusion');
    state.crystalRunGain = 0; state.crystalExtraSpent = 0;   // 清空本局额外结晶额度（第 12 项额度会削掉奖励）
    var c0 = state.meta.crystals;
    window.__roamDebug.challenge.clearNow();
    var info = window.__roamDebug.challenge.info();
    return { delta: state.meta.crystals - c0, success: info.state.success,
      fusionUsed: info.state.fusionUsed, roomType: info.room ? info.room.type : null,
      eliteClearCrystals: Math.max(0, Number(ELITE_ROUTE_CONFIG.clearCrystals) || 0) };
  })()`);
  const a7good = await ev(`(function(){
    window.__roamDebug.challenge.setFloor(2);
    window.__roamDebug.challenge.setKind('nofusion');
    window.__roamDebug.challenge.enter();
    state.crystalRunGain = 0; state.crystalExtraSpent = 0;   // 清空本局额外结晶额度（第 12 项额度会削掉奖励）
    var c0 = state.meta.crystals;
    window.__roamDebug.challenge.clearNow();
    var info = window.__roamDebug.challenge.info();
    return { delta: state.meta.crystals - c0, success: info.state.success,
      fusionUsed: info.state.fusionUsed, roomType: info.room ? info.room.type : null,
      eliteClearCrystals: Math.max(0, Number(ELITE_ROUTE_CONFIG.clearCrystals) || 0) };
  })()`);
  const a7base = (x) => (x.roomType === 'elite' ? x.eliteClearCrystals : 0);
  ok('A7 禁用融合：违规 → 失败无额外；未融合 → 成功 +2',
    a7bad.success === false && a7bad.delta === a7base(a7bad) && a7bad.fusionUsed === 1
      && a7good.success === true && a7good.delta === a7base(a7good) + 2 && a7good.fusionUsed === 0,
    { bad: a7bad, good: a7good });

  // ---------- A8 只准主槽：违规 / 干净 ----------
  // 与 A7 同理，用"基础收益 + 2"公式，避免挑战房随机落在精英房时误判
  const a8bad = await ev(`(function(){
    window.__roamDebug.challenge.setFloor(3);
    window.__roamDebug.challenge.setKind('primaryOnly');
    window.__roamDebug.challenge.enter();
    window.__roamDebug.challenge.violate('slot');
    state.crystalRunGain = 0; state.crystalExtraSpent = 0;   // 清空本局额外结晶额度（第 12 项额度会削掉奖励）
    var c0 = state.meta.crystals;
    window.__roamDebug.challenge.clearNow();
    var info = window.__roamDebug.challenge.info();
    return { delta: state.meta.crystals - c0, success: info.state.success,
      slotUsed: info.state.slotUsed, roomType: info.room ? info.room.type : null,
      eliteClearCrystals: Math.max(0, Number(ELITE_ROUTE_CONFIG.clearCrystals) || 0) };
  })()`);
  const a8good = await ev(`(function(){
    window.__roamDebug.challenge.setFloor(3);
    window.__roamDebug.challenge.setKind('primaryOnly');
    window.__roamDebug.challenge.enter();
    state.crystalRunGain = 0; state.crystalExtraSpent = 0;   // 清空本局额外结晶额度（第 12 项额度会削掉奖励）
    var c0 = state.meta.crystals;
    window.__roamDebug.challenge.clearNow();
    var info = window.__roamDebug.challenge.info();
    return { delta: state.meta.crystals - c0, success: info.state.success,
      slotUsed: info.state.slotUsed, roomType: info.room ? info.room.type : null,
      eliteClearCrystals: Math.max(0, Number(ELITE_ROUTE_CONFIG.clearCrystals) || 0) };
  })()`);
  const a8base = (x) => (x.roomType === 'elite' ? x.eliteClearCrystals : 0);
  ok('A8 只准主槽：用副槽 → 失败无额外；只用主槽 → 成功 +2',
    a8bad.success === false && a8bad.delta === a8base(a8bad) && a8bad.slotUsed === 1
      && a8good.success === true && a8good.delta === a8base(a8good) + 2 && a8good.slotUsed === 0,
    { bad: a8bad, good: a8good });

  // ---------- A9 A/B ----------
  const a9 = await ev(`(function(){
    window.__roamDebug.challenge.setEnabled(false);
    window.__roamDebug.challenge.setFloor(1);
    var off = window.__roamDebug.challenge.info();
    window.__roamDebug.challenge.setEnabled(true);
    window.__roamDebug.challenge.setFloor(1);
    var on = window.__roamDebug.challenge.info();
    return { off: off.authoredRooms.length, offEnabled: off.enabled,
      on: on.authoredRooms.length, onEnabled: on.enabled };
  })()`);
  ok('A9 A/B：enabled=false 时不生成挑战房；恢复后重新生成',
    a9.offEnabled === false && a9.off === 0 && a9.onEnabled === true && a9.on === 1, a9);

  // 截图：进门后挑战条可见
  await ev(`(function(){
    window.__roamDebug.challenge.setFloor(1);
    window.__roamDebug.challenge.enter();
    return true;
  })()`);
  await sleep(600);
  await shot('challenge.png');

  // ---------- A10 fps / 错误 / 截图 ----------
  const a10 = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){ return { fps: f, errors: (window.__errors || []).length }; });
  })()`);
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'challenge.png')).size; } catch (e) { shotSize = 0; }
  ok('A10 截图 >10KB / fps≥60 / 无脚本错误',
    shotSize > 10240 && a10.fps >= 60 && a10.errors === 0, { shot: shotSize, a10 });

  fs.writeFileSync(path.join(OUT_DIR, 'challenge-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log(`\n===== C1 challenge ${pass}/${asserts.length} ===== (shot ${shotSize}B, fps ${a10.fps})`);

  try { ws.close(); } catch (e) { /* ignore */ }
  try { killEdge(edge); } catch (e) { /* ignore */ }
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  if (pass !== asserts.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
