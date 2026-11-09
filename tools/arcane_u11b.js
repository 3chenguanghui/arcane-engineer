/**
 * U11b「生存房 · 22 秒波次挑战」验收脚本（端口 9502）
 * 用法：node tools/arcane_u11b.js
 * 输出：.screenshots/art/u11b-*.png + u11b-result.json
 *
 * 思路：先用 setFloor 逐层抽样统计"生存房覆盖"，再重滚一轮停在一间生存房上，
 *      后续所有断言都在这一次真实生成的楼层里跑（setFloor 会整层重生成，不能复用统计层）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9502;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
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
  /**
   * 整屏截图
   * @param {string} name 文件名
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };
  /** 读 #contextHint 的当前文案与 key */
  const readHint = () => ev(`(function(){
    var el = document.querySelector('#contextHint');
    return el ? { text: el.innerText, key: el.dataset.key || '' } : null;
  })()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2000);

  // ---------- 1. 进游戏 ----------
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1200);
  const mode = await ev(`(function(){ var l = document.querySelector('#titleLayer'); return l && l.classList.contains('hidden') ? 'playing' : 'title'; })()`);
  ok('进入游戏', mode === 'playing', mode);

  // ---------- 2/3. 抽样：3 轮 × 4–14 层 = 33 次生成，统计覆盖率 ----------
  const covered = [];
  const multi = [];
  for (let round = 0; round < 3; round += 1) {
    for (let f = 4; f <= 14; f += 1) {
      await ev(`window.__roamDebug.setFloor(${f})`);
      await sleep(150);
      const a = await ev(`window.__roamDebug.survivalAudit()`);
      if (a.survivalRooms > 1) multi.push({ floor: f, n: a.survivalRooms });
      if (a.survivalRooms >= 1) covered.push(f);
    }
  }
  ok('抽样 33 次里至少 3 次出现生存房', covered.length >= 3,
    { hits: covered.length, rate: Math.round((covered.length / 33) * 100) + '%', floors: covered });
  ok('每层最多 1 间生存房', multi.length === 0, { offending: multi });

  // 重滚，停在有生存房的楼层（统计层已作废；多滚几轮防止随机落空）
  let audit = null;
  let liveFloor = -1;
  const missed = [];
  for (let pass = 0; pass < 3 && liveFloor < 0; pass += 1) {
    for (let f = 4; f <= 14 && liveFloor < 0; f += 1) {
      await ev(`window.__roamDebug.setFloor(${f})`);
      await sleep(200);
      const a = await ev(`window.__roamDebug.survivalAudit()`);
      if (a.roomId >= 0 && a.alter) { liveFloor = f; audit = a; }
      else missed.push({ f: f, rid: a.roomId, n: a.survivalRooms, types: a.types.join(',') });
    }
  }
  if (liveFloor < 0) throw new Error('找不到生存房，无法继续测试 · ' + JSON.stringify(missed.slice(-6)));

  const farOk = (v, min) => v === null || v >= min;   // Infinity 经 CDP 序列化会变成 null
  const altar = audit.alter;
  const roomBox = audit.room;

  // ---------- 4. 生存房不刷怪、未开始时不上闸 ----------
  ok('生存房进房不刷怪、不自动上闸', audit.roomType === 'survival' && audit.roomEnemies === 0 && audit.roomLocked === false,
    { roomType: audit.roomType, enemies: audit.roomEnemies, locked: audit.roomLocked });

  // ---------- 5. 祭坛落点合法 ----------
  ok('祭坛落点合法（可走 / 不堵门 / 离门 ≥40）',
    audit.altarWalkable === true && audit.altarBlocked === false && farOk(audit.altarDoorGap, 40),
    { walkable: audit.altarWalkable, blocked: audit.altarBlocked, doorGap: audit.altarDoorGap });

  // ---------- 6. 祭坛在房间内部 ----------
  const inRoomBox = altar && roomBox
    && altar.x > roomBox.x && altar.x < roomBox.x + roomBox.w
    && altar.y > roomBox.y && altar.y < roomBox.y + roomBox.h;
  ok('祭坛落在房间内部', !!inRoomBox, { altar: altar, room: roomBox });

  // ---------- 7. 走近祭坛：未开始提示 + 全景截图 ----------
  await ev(`window.__roamDebug.teleport(${altar.x + 48}, ${altar.y + 10})`);
  // 关掉"首局三步"教学提示（它们优先级最高，会把生存提示盖住）
  await ev(`(function(){ state.meta.hintsSeen = 1; state.player.hp = 50; state.player.aether = 10; return true; })()`);
  await sleep(420);
  const shotAltar = await shot('u11b-altar.png');
  const hintReady = await readHint();
  ok('未开始时提示「按 E 开始生存挑战 · 22 秒」',
    !!hintReady && hintReady.key === 'u11b-survival-ready' && /按 E 开始生存挑战/.test(hintReady.text),
    hintReady);

  // ---------- 8. 按 E 开始：落闸 + 首波 + 不下楼 ----------
  // 距离必须在"按键返回的同一轮 eval"里量，否则敌人已经开始追人（0.5 秒能贴上来 40px）
  const floorBefore = await ev(`window.__roamDebug.getState().floor`);
  const pressSnap = await ev(`(function(){
    var r = window.__roamDebug.pressE();
    var s = state.survival;
    var list = s ? state.enemies.filter(function(e){ return e.roomId === s.roomId; }) : [];
    var min = Infinity;
    list.forEach(function(e){ min = Math.min(min, dist(e.x, e.y, state.player.x, state.player.y)); });
    var room = s ? getSurvivalRoom() : null;
    return {
      press: r,
      active: !!s && s.active,
      locked: room ? !!room.locked : null,
      waves: s ? s.waves : 0,
      n: list.length,
      min: list.length ? Math.round(min * 10) / 10 : null
    };
  })()`);
  await sleep(180);
  const floorAfter = await ev(`window.__roamDebug.getState().floor`);
  ok('祭坛旁按 E 开始挑战（落闸 / 首波到位 / 楼层不变）',
    pressSnap.active === true && pressSnap.locked === true && pressSnap.waves >= 1 && pressSnap.n >= 1
    && floorAfter === floorBefore && pressSnap.press.floor === floorBefore,
    { active: pressSnap.active, locked: pressSnap.locked, waves: pressSnap.waves, enemies: pressSnap.n, floor: floorAfter });

  // ---------- 9. 挑战中提示 ----------
  await sleep(520);
  const hintRun = await readHint();
  ok('挑战中提示「生存中 · 剩余 Xs」',
    !!hintRun && hintRun.key === 'u11b-survival-run' && /生存中 · 剩余/.test(hintRun.text), hintRun);

  // ---------- 10. 首波不贴脸（刷点下限 56，直接量生成瞬间的距离） ----------
  ok('首波刷怪不贴脸（离玩家 ≥56）',
    pressSnap.n >= 1 && pressSnap.min !== null && pressSnap.min >= 56,
    { n: pressSnap.n, min: pressSnap.min });

  await ev(`state.player.hp = 999; state.player.aether = state.player.aetherMax; true`);
  const shotRun = await shot('u11b-run.png');

  // ---------- 11~13. 结算：计时结束 → 开门 → 发奖 ----------
  // 固定起点（生命 50 / 奥能 10），否则"回复量"会被上限截断成 0，无法判定
  await ev(`(function(){ window.__roamDebug.setHp(50); state.player.aether = 10; return true; })()`);
  const before = await ev(`window.__roamDebug.survivalAudit().counts`);
  const settled = await ev(`window.__roamDebug.survivalTick(22)`);
  ok('计时结束即结算（active=false / cleared=true / remain ≤0）',
    settled.active === false && settled.cleared === true && settled.remain !== null && settled.remain <= 0,
    { active: settled.active, cleared: settled.cleared, remain: settled.remain });

  const afterAudit = await ev(`window.__roamDebug.survivalAudit()`);
  const rewardDelta = {
    embers: afterAudit.counts.embers - before.embers,
    crystals: afterAudit.counts.crystalsEarned - before.crystalsEarned,
    hp: afterAudit.counts.hp - before.hp,
    aether: afterAudit.counts.aether - before.aether
  };
  ok('结算发放奖励（结晶 +4 / 余烬 +10 / 生命 +20 / 奥能 +45）',
    rewardDelta.crystals === 4 && rewardDelta.embers === 10
    && rewardDelta.hp >= 19 && rewardDelta.hp <= 20
    && rewardDelta.aether >= 44,
    rewardDelta);

  ok('结算后开门（locked=false / cleared=true）',
    afterAudit.roomLocked === false && afterAudit.cleared === true,
    { locked: afterAudit.roomLocked, cleared: afterAudit.cleared });

  // ---------- 14. 完成后提示 ----------
  await sleep(420);
  const hintDone = await readHint();
  ok('完成后提示「挑战已完成」',
    !!hintDone && hintDone.key === 'u11b-survival-done' && /挑战已完成/.test(hintDone.text), hintDone);
  await sleep(160);
  const shotDone = await shot('u11b-done.png');

  // ---------- 15. A/B 关闭不生成、重开恢复、换层重建 ----------
  await ev(`window.__roamDebug.setU11b(false)`);
  await sleep(120);
  const offNow = await ev(`window.__roamDebug.survivalAudit()`);
  await ev(`window.__roamDebug.setFloor(${liveFloor + 1})`);
  await sleep(480);
  const offNext = await ev(`window.__roamDebug.survivalAudit()`);
  const offOk = offNow.enabled === false && offNow.roomId === -1
    && offNext.enabled === false && offNext.roomId === -1 && offNext.survivalRooms === 0;

  await ev(`window.__roamDebug.setU11b(true)`);
  await sleep(120);
  let reAudit = null;
  for (let f = 4; f <= 14 && (!reAudit || reAudit.roomId < 0); f += 1) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    await sleep(390);
    reAudit = await ev(`window.__roamDebug.survivalAudit()`);
  }
  const reOk = offOk && !!reAudit && reAudit.enabled === true && reAudit.roomId >= 0
    && reAudit.survivalRooms === 1;
  ok('A/B 关闭后整层无生存房、重开恢复生成、换层重建', reOk,
    { offNow: { rid: offNow.roomId, n: offNow.survivalRooms }, offNext: { rid: offNext.roomId, n: offNext.survivalRooms },
      reopen: reAudit ? { rid: reAudit.roomId, n: reAudit.survivalRooms } : null });

  // ---------- 性能 + 错误 ----------
  await ev(`window.__roamDebug.clearEnemies()`);
  const perf = await ev(`(function(){
    return new Promise(function(resolve){
      var frames = 0;
      var t0 = performance.now();
      function tick(){
        frames += 1;
        if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
        else resolve({ fps: frames / ((performance.now() - t0) / 1000), errors: (window.__errors || []).slice(0, 6) });
      }
      requestAnimationFrame(tick);
    });
  })()`);
  ok('帧率 ≥ 60', perf.fps >= 60, { fps: Math.round(perf.fps * 10) / 10 });
  ok('运行期无脚本错误', (perf.errors || []).length === 0, perf.errors);

  const names = ['u11b-altar.png', 'u11b-run.png', 'u11b-done.png'];
  const sizes = names.map((n) => {
    const p = path.join(OUT_DIR, n);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  });
  ok('3 张截图均 > 10KB', sizes.every((s) => s > 10240), sizes);

  const passed = asserts.filter((a) => a.pass).length;
  console.log('----------------------------------------');
  console.log('U11b · ' + passed + '/' + asserts.length + ' PASS');
  console.log('PERF ' + JSON.stringify({ avgFps: Math.round(perf.fps * 10) / 10, errors: perf.errors.length }));
  fs.writeFileSync(path.join(OUT_DIR, 'u11b-result.json'),
    JSON.stringify({ passed: passed, total: asserts.length, asserts: asserts, perf: perf }, null, 2));

  void shotAltar; void shotRun; void shotDone;
  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (passed < asserts.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 200);
});
