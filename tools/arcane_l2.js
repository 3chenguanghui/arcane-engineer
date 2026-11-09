/**
 * L2「敌人威胁语法」验收脚本
 * ------------------------------------------------------------
 * 用法：
 *   node tools/arcane_l2.js before   // setAiV2(false)，旧的 3 套 AI 基准图
 *   node tools/arcane_l2.js after    // 15 项断言 + 同屏节奏截图 + fps（跳过首帧预热）
 *
 * 断言口径见 .spec/u2-ai/spec.md 第 5 节。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const MODE = ['before', 'after'].includes(process.argv[2]) ? process.argv[2] : 'after';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9490;                        // L2 专用端口（L1 用 9489）
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言结果并打印
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 附加信息
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail == null ? '' : ' · ' + JSON.stringify(detail)));
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
   * 截一张图（可裁切 + 可放大）
   * @param {string} name 文件名
   * @param {{x:number,y:number,w:number,h:number}} [clip] 裁切区域
   * @param {number} [scale=1] 像素倍率
   */
  const shot = async (name, clip, scale = 1) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width: clip.w, height: clip.h, scale };
    const r = await send('Page.captureScreenshot', params);
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  const startBtn = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startBtn.x, y: startBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startBtn.x, y: startBtn.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  // 把玩家挪到第一个房间中心：保证 playerInRoom = true，行为块才会推进
  const rooms = await ev(`window.__roamDebug.getState().rooms`);
  const room = rooms[0];
  await ev(`window.__roamDebug.setPlayerPos(${room.cx}, ${room.cy})`);
  await sleep(200);
  const p = await ev(`window.__roamDebug.getState().player`);
  await ev(`window.__roamDebug.setAiV2(${MODE === 'before' ? 'false' : 'true'})`);
  await ev(`window.__roamDebug.setCritChance(0)`);

  const shots = [];
  const canvasRect = await ev(`(function(){ var c = document.getElementById('game'); var b = c.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);

  // ============================================================
  // 阶段 1：同屏节奏截图（before / after 同一摆位）
  // 四只怪分别被强制拉进 charge / burst / summon / suppress 的 2s 前摇，
  // 这样截图时一定能同时看到四种不同形状的预警。
  // ============================================================
  await ev(`window.__roamDebug.clearEnemies()`);
  await ev(`window.__roamDebug.spawnThreat('crawler', 150, -80)`);
  await ev(`window.__roamDebug.spawnThreat('riveter', -150, -80)`);
  await ev(`window.__roamDebug.spawnThreat('assembler', 150, 90)`);
  await ev(`window.__roamDebug.spawnThreat('welder', -150, 90)`);
  if (MODE === 'after') {
    await ev(`window.__roamDebug.forceBlock('crawler', 'charge', 2.0)`);
    await ev(`window.__roamDebug.forceBlock('riveter', 'burst', 2.0)`);
    await ev(`window.__roamDebug.forceBlock('assembler', 'summon', 2.0)`);
    await ev(`window.__roamDebug.forceBlock('welder', 'suppress', 2.0)`);
  }
  await sleep(220);

  // 用"四只怪的世界坐标 → 客户端坐标"的包围盒裁切，保证四种预警都在画面里
  const camInfo = await ev(`(function(){ var s = window.__roamDebug.getState(); return { cam: s.cam, view: s.view }; })()`);
  const threatPos = await ev(`window.__roamDebug.getState().enemyList.map(function(e){ return { x: e.x, y: e.y }; })`);
  const toClient = (wx, wy) => ({
    x: canvasRect.x + (wx - camInfo.cam.x) * (canvasRect.w / camInfo.view.w),
    y: canvasRect.y + (wy - camInfo.cam.y) * (canvasRect.h / camInfo.view.h)
  });
  const cps = threatPos.map((pos) => toClient(pos.x, pos.y));
  const pad = 120;
  const minX = Math.max(canvasRect.x, Math.min.apply(null, cps.map((c) => c.x)) - pad);
  const minY = Math.max(canvasRect.y, Math.min.apply(null, cps.map((c) => c.y)) - pad);
  const maxX = Math.min(canvasRect.x + canvasRect.w, Math.max.apply(null, cps.map((c) => c.x)) + pad);
  const maxY = Math.min(canvasRect.y + canvasRect.h, Math.max.apply(null, cps.map((c) => c.y)) + pad);
  const crop = { x: minX, y: minY, w: Math.max(260, maxX - minX), h: Math.max(260, maxY - minY) };

  shots.push(await shot(`l2-${MODE}-full.png`));
  shots.push(await shot(`l2-${MODE}-rhythm1.4x.png`, crop, 1.4));

  if (MODE === 'after') {
    const windups = await ev(`window.__roamDebug.getState().enemyList.filter(function(e){ return e.aiState === 'windup'; }).map(function(e){ return e.typeId + ':' + e.aiAction; })`);
    ok('同屏至少 3 种不同前摇同时存在', windups.length >= 3 &&
      new Set(windups.map((s) => s.split(':').slice(1).join(':'))).size >= 3, windups);
  }

  // ============================================================
  // 阶段 2（仅 after）：角色覆盖 / 前摇 / 打断 / 结算 / 距离 / 上限 / 自爆 / A-B / fps
  // ============================================================
  if (MODE === 'after') {
    // ---------- 1. 角色覆盖 15/15 ----------
    const audit = await ev(`window.__roamDebug.aiAudit()`);
    const cover128 = [1, 2, 3].map((k) => {
      const rows = audit.pools[k] || [];
      return new Set(rows.map((r) => r.role)).size;
    });
    ok('3 池 × 5 角色 = 15/15 覆盖', audit.coverage === '15/15' && cover128.every((n) => n === 5), { coverage: audit.coverage, perPool: cover128 });
    const meta = await ev(`window.__roamDebug.aiV2()`);
    ok('威胁语法开关默认开启 + 10 个行为块', meta.enabled === true && meta.blocks === 10, meta);
    // 池内角色不重复 + 块数量 2–3
    const blockCounts = Object.keys(audit.pools).reduce((acc, k) => acc.concat(audit.pools[k].map((r) => r.blocks.length)), []);
    ok('每只怪由 2–3 个行为块组成', blockCounts.every((n) => n >= 2 && n <= 3), blockCounts);

    // ---------- 2. 前摇时长 ----------
    await ev(`window.__roamDebug.clearEnemies()`);
    await ev(`window.__roamDebug.spawnThreat('riveter', 130, -40)`);
    await sleep(80);
    const burstWind = await ev(`window.__roamDebug.forceBlock('riveter', 'burst')`);
    ok('蓄力爆发前摇 ≥ 0.70s（可读）', burstWind && burstWind.state === 'windup' && burstWind.action === 'burst' && burstWind.timer >= 0.7,
      burstWind && { action: burstWind.action, timer: burstWind.timer });

    await ev(`window.__roamDebug.clearEnemies()`);
    await ev(`window.__roamDebug.spawnThreat('crawler', 150, 0)`);
    await sleep(80);
    const chargeWind = await ev(`window.__roamDebug.forceBlock('crawler', 'charge')`);
    ok('冲锋前摇 ≥ 0.50s（有预警）', chargeWind && chargeWind.state === 'windup' && chargeWind.action === 'charge' && chargeWind.timer >= 0.5,
      chargeWind && { action: chargeWind.action, timer: chargeWind.timer });

    // ---------- 3. 可打断 ----------
    await ev(`window.__roamDebug.hitEnemy('crawler', 10)`);
    await sleep(60);
    const interrupted = await ev(`window.__roamDebug.threatSnapshot('crawler')`);
    ok('前摇中受伤 ≥8 → 打断进入 recover', interrupted && interrupted.state === 'recover' && interrupted.action === null,
      interrupted && { state: interrupted.state, action: interrupted.action, timer: interrupted.timer });

    // ---------- 4. 不打断时照常结算（burst 真的打到玩家） ----------
    await ev(`window.__roamDebug.clearEnemies()`);
    await ev(`window.__roamDebug.resetPlayerInvuln()`);
    const hpBeforeBurst = await ev(`window.__roamDebug.playerHp()`);
    await ev(`window.__roamDebug.spawnThreat('riveter', 60, 0)`);
    await sleep(80);
    await ev(`window.__roamDebug.forceBlock('riveter', 'burst')`);
    await sleep(950);
    const hpAfterBurst = await ev(`window.__roamDebug.playerHp()`);
    ok('前摇不被打断 → 爆发正常结算（玩家掉血）', hpAfterBurst.hp < hpBeforeBurst.hp, { before: hpBeforeBurst, after: hpAfterBurst });

    // ---------- 5. 远程保持距离 ----------
    await ev(`window.__roamDebug.clearEnemies()`);
    await ev(`window.__roamDebug.spawnThreat('welder', 210, 0)`);
    await sleep(300);
    const kite1 = await ev(`window.__roamDebug.threatSnapshot('welder')`);
    await sleep(900);
    const kite2 = await ev(`window.__roamDebug.threatSnapshot('welder')`);
    ok('焊工保持中距离（不贴脸）：130–260px', kite2 && kite2.distance >= 130 && kite2.distance <= 260,
      { first: kite1 && kite1.distance, second: kite2 && kite2.distance });

    // ---------- 6. 绕圈骚扰 ----------
    await ev(`window.__roamDebug.clearEnemies()`);
    await ev(`window.__roamDebug.spawnThreat('runesprite', 108, 0)`);
    await sleep(220);
    const orbitSamples = [];
    for (let i = 0; i < 3; i += 1) {
      await sleep(420);
      orbitSamples.push(await ev(`window.__roamDebug.threatSnapshot('runesprite')`));
    }
    const orbitDistOk = orbitSamples.every((s) => s && Math.abs(s.distance - 108) <= 45);
    let orbitAngle = 0;
    if (orbitSamples.length === 3 && orbitSamples[0] && orbitSamples[2]) {
      const a0 = Math.atan2(orbitSamples[0].y - p.y, orbitSamples[0].x - p.x);
      const a2 = Math.atan2(orbitSamples[2].y - p.y, orbitSamples[2].x - p.x);
      orbitAngle = Math.abs(((a2 - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    }
    ok('符灵绕圈：距离 108±45 且角度变化 ≥0.5rad', orbitDistOk && orbitAngle >= 0.5,
      { distances: orbitSamples.map((s) => s && s.distance), angleDelta: Number(orbitAngle.toFixed(2)) });

    // ---------- 7. 召唤上限 ----------
    await ev(`window.__roamDebug.clearEnemies()`);
    await ev(`window.__roamDebug.spawnThreat('assembler', 170, -60)`);
    await sleep(120);
    const summonCounts = [];
    for (let i = 0; i < 3; i += 1) {
      await ev(`window.__roamDebug.setAiCooldown('assembler', 0)`);
      await ev(`window.__roamDebug.forceBlock('assembler', 'summon')`);
      await sleep(1150);
      summonCounts.push(await ev(`window.__roamDebug.getState().enemyList.filter(function(e){ return e.isSummoned; }).length`));
    }
    ok('连续 3 次召唤，场上召唤体始终 ≤2', summonCounts.every((n) => n <= 2) && summonCounts[summonCounts.length - 1] >= 1,
      summonCounts);

    // ---------- 8. 濒死自爆 ----------
    await ev(`window.__roamDebug.clearEnemies()`);
    await ev(`window.__roamDebug.resetPlayerInvuln()`);
    const hpBeforeBoom = await ev(`window.__roamDebug.playerHp()`);
    await ev(`window.__roamDebug.spawnThreat('shardling', 50, 0)`);
    await sleep(80);
    const shard = await ev(`window.__roamDebug.threatSnapshot('shardling')`);
    await ev(`window.__roamDebug.hitEnemy('shardling', ${Math.round(shard.hpMax * 0.7)})`);
    await ev(`window.__roamDebug.setAiCooldown('shardling', 0)`);
    await sleep(1200);
    const shardAfter = await ev(`window.__roamDebug.threatSnapshot('shardling')`);
    const hpAfterBoom = await ev(`window.__roamDebug.playerHp()`);
    ok('残片濒死自爆：自身消失且玩家在 74px 内掉血', shardAfter === null && hpAfterBoom.hp < hpBeforeBoom.hp,
      { alive: shardAfter, hpBefore: hpBeforeBoom, hpAfter: hpAfterBoom });

    // ---------- 9. 冲锋不越房 ----------
    await ev(`window.__roamDebug.clearEnemies()`);
    await ev(`window.__roamDebug.spawnThreat('crawler', 150, 0)`);
    await sleep(80);
    await ev(`window.__roamDebug.forceBlock('crawler', 'charge')`);
    await sleep(1000);
    const leak = await ev(`window.__roamDebug.threatSnapshot('crawler')`);
    ok('冲锋后仍在本房内（maxLeak ≤6px）', leak && leak.maxLeak <= 6, leak && { maxLeak: leak.maxLeak, distance: leak.distance });

    // ---------- 10. A/B 开关 ----------
    await ev(`window.__roamDebug.setAiV2(false)`);
    const offMeta = await ev(`window.__roamDebug.aiV2()`);
    const offSnap = await ev(`window.__roamDebug.threatSnapshot('crawler')`);
    ok('setAiV2(false)：开关关闭且怪回到普通走位', offMeta.enabled === false && offSnap && offSnap.state === 'approach',
      { enabled: offMeta.enabled, state: offSnap && offSnap.state });
    await ev(`window.__roamDebug.setAiV2(true)`);

    // ---------- 11. 无错误 + fps（跳过前 40 帧预热） ----------
    await ev(`window.__roamDebug.clearEnemies()`);
    for (const id of ['crawler', 'welder', 'patrol', 'riveter', 'assembler']) {
      await ev(`window.__roamDebug.spawnThreat('${id}', ${110 + Math.random() * 40}, ${-70 + Math.random() * 140})`);
    }
    const perf = await ev(`new Promise(function(resolve){
      var frames = []; var last = performance.now(); var warm = 0;
      function tick(now){
        var dt = now - last; last = now;
        if (warm < 40) { warm += 1; } else { frames.push(dt); }
        if (frames.length >= 150) {
          var sum = 0; var max = 0;
          frames.forEach(function(d){ if (d > 0) { sum += d; if (d > max) max = d; } });
          var avg = sum / frames.length;
          resolve({ avgFrameMs: Number(avg.toFixed(2)), maxFrameMs: Number(max.toFixed(2)),
            avgFps: Number((1000 / avg).toFixed(1)), minFps: Number((1000 / max).toFixed(1)),
            errors: window.__roamDebug.errors() });
        } else { requestAnimationFrame(tick); }
      }
      requestAnimationFrame(tick);
    })`);
    console.log('PERF · ' + JSON.stringify(perf));
    ok('avg fps ≥ 60（跳过首帧预热）', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
    ok('无运行时错误', Array.isArray(perf.errors) ? perf.errors.length === 0 : true, perf.errors);

    const missing = shots.filter((s) => !fs.existsSync(s) || fs.statSync(s).size < 10 * 1024);
    ok('截图齐全且 > 10KB', missing.length === 0, missing.map((s) => path.basename(s)));
  }

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nL2 ${MODE.toUpperCase()} · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(
    path.join(OUT_DIR, `l2-${MODE}-result.json`),
    JSON.stringify({ mode: MODE, passed, total: asserts.length, asserts }, null, 2)
  );

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 150);
});
