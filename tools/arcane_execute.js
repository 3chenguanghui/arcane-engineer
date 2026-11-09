// P0-2 断言：处决与破防（阈值 / 两次命中 / 首领破防 / S2→S1 降级 / 总开关 / 死亡清除）
// 用法：node tools\arcane_execute.js *> tools\execute.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9688;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'execute');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1536,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) throw new Error('Edge CDP 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + m.params.exceptionDetails.text);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 900, deviceScaleFactor: 1, mobile: false });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const checks = [];
  /** 记录一条断言 */
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + JSON.stringify(detail));
  };

  attachEdgeExit(edge);
  await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(1600);
  await ev(`(function(){ try { state.onboardSkipAll = true; hideIntroHint(true); } catch (e) {} ; document.getElementById('btnStart').click(); return true; })()`);
  await sleep(2600);
  await ev(`(function(){
    state.mode='playing'; state.status='playing';
    if (state.currentRoomId == null || state.currentRoomId < 0) state.currentRoomId = 0;
    var room = state.rooms[state.currentRoomId] || state.rooms[0];
    if (room) { state.player.x = room.cx; state.player.y = room.cy; }
    return { mode: state.mode, room: state.currentRoomId };
  })()`);

  // ---------- 1) 默认开启 + 阈值配置 ----------
  const base = await ev(`__roamDebug.execute.info()`);
  check('默认开启总开关', base.enabled === true, base.enabled);
  check('阈值：普通 15% / 精英 20% / 首领 35%',
    base.config.normalThreshold === 0.15 && base.config.eliteThreshold === 0.20
    && base.config.bossThreshold === 0.35, base.config);

  // ---------- 2) 普通：血量高于阈值不标记 ----------
  const above = await ev(`(function(){
    __roamDebug.execute.resetStats();
    var r = __roamDebug.execute.spawn('normal', 0.20);
    var hit = __roamDebug.execute.hit(r.id, 'fireball', 1, { noCrit: true, noElement: true });
    return { hit: hit, stats: __roamDebug.execute.info().stats };
  })()`);
  check('普通 20% 不标记（高于 15%）', above.hit.execTimer === 0 && above.stats.marks === 0, above);

  // ---------- 3) 普通：首次点亮 → 第二次处决 ----------
  const execNormal = await ev(`(function(){
    state.enemies.length = 0;
    __roamDebug.execute.resetStats();
    var r = __roamDebug.execute.spawn('normal', 0.10);
    var first = __roamDebug.execute.hit(r.id, 'fireball', 1, { noCrit: true, noElement: true });
    var statsAfterMark = __roamDebug.execute.info().stats;
    var second = __roamDebug.execute.hit(r.id, 'fireball', 1, { noCrit: true, noElement: true });
    return { first: first, second: second, statsAfterMark: statsAfterMark,
      stats: __roamDebug.execute.info().stats, last: __roamDebug.execute.info().last };
  })()`);
  check('首次命中点亮可处决（不直接杀）',
    execNormal.first.execTimer > 3.5 && execNormal.first.alive === true && execNormal.statsAfterMark.marks === 1,
    execNormal.first);
  check('第二次命中直接处决（hp 归零且移出场上）',
    execNormal.second.alive === false && execNormal.second.hpAfter === 0 && execNormal.stats.executes === 1,
    execNormal.second);
  check('第一次处决走 S2', execNormal.stats.s2 === 1 && execNormal.stats.s1 === 0, execNormal.stats);

  // ---------- 4) 精英：20% 阈值 ----------
  const eliteCase = await ev(`(function(){
    __roamDebug.execute.resetStats();
    __roamDebug.execute.spawn('elite', 0.21);
    var e21 = state.enemies[0];
    var h21 = __roamDebug.execute.hit(e21.id, 'fireball', 1, { noCrit: true, noElement: true });
    __roamDebug.execute.spawn('elite', 0.19);
    var e19 = state.enemies[0];
    var h19 = __roamDebug.execute.hit(e19.id, 'fireball', 1, { noCrit: true, noElement: true });
    return { h21: h21, h19: h19, stats: __roamDebug.execute.info().stats };
  })()`);
  check('精英 21% 不标记', eliteCase.h21.execTimer === 0, eliteCase.h21);
  check('精英 19% 点亮', eliteCase.h19.execTimer > 3.5 && eliteCase.stats.marks === 1, eliteCase.h19);

  // ---------- 5) 窗口 4 秒过期 ----------
  const expire = await ev(`(function(){
    __roamDebug.execute.resetStats();
    __roamDebug.execute.spawn('normal', 0.10);
    var e = state.enemies[0];
    __roamDebug.execute.hit(e.id, 'fireball', 1, { noCrit: true, noElement: true });
    var marked = e.execTimer;
    __roamDebug.execute.tick(4.3);
    return { marked: marked, after: e.execTimer, stats: __roamDebug.execute.info().stats };
  })()`);
  check('窗口 4 秒后自动过期', expire.marked > 3.5 && expire.after === 0 && expire.stats.expires >= 1, expire);

  // ---------- 6) 同帧两次处决：S2 → S1 降级 ----------
  const degrade = await ev(`(function(){
    state.enemies.length = 0;
    __roamDebug.execute.resetStats();
    var p = state.player;
    function mk() {
      var e = spawnEnemy('chanter', p.x + 60, p.y, state.floor || 1, { roomId: state.currentRoomId });
      e.hp = 50; e.hpMax = 500;   // 10%：低于普通阈值
      return e;
    }
    var a = mk(); var b = mk();
    __roamDebug.execute.hit(a.id, 'fireball', 1, { noCrit: true, noElement: true });
    __roamDebug.execute.hit(b.id, 'fireball', 1, { noCrit: true, noElement: true });
    state.elapsed = 100;
    __roamDebug.execute.hit(a.id, 'fireball', 1, { noCrit: true, noElement: true });
    __roamDebug.execute.hit(b.id, 'fireball', 1, { noCrit: true, noElement: true });
    return __roamDebug.execute.info().stats;
  })()`);
  check('同帧两次处决：第一次 S2、第二次降级 S1',
    degrade.executes === 2 && degrade.s2 === 1 && degrade.s1 === 1, degrade);

  // ---------- 7) 首领：35% 破防、一次性、伤害 ×1.25、不处决 ----------
  const bossCase = await ev(`(function(){
    // 基准：满血首领打 100，作为 ×1.25 的对照（避免写死绝对值被其它倍率干扰）
    __roamDebug.execute.spawn('boss', 1);
    var e0 = state.enemies[0];
    var plain = __roamDebug.execute.hit(e0.id, 'fireball', 100, { noCrit: true, noElement: true });
    __roamDebug.execute.resetStats();
    var r = __roamDebug.execute.spawn('boss', 0.36);
    var e = state.enemies[0];
    var hpMax = e.hpMax;
    var h1 = __roamDebug.execute.hit(e.id, 'fireball', 1, { noCrit: true, noElement: true });
    var statsH1 = __roamDebug.execute.info().stats;
    var hpMid = e.hp;
    // 打到 34%：这一发负责触发破防
    var h2 = __roamDebug.execute.hit(e.id, 'fireball', hpMax * 0.02, { noCrit: true, noElement: true });
    var s1 = __roamDebug.execute.info().stats;
    // 破防期间打 100：应结算 100 × 1.25
    var h3 = __roamDebug.execute.hit(e.id, 'fireball', 100, { noCrit: true, noElement: true });
    // 再补几发，验证不会重复破防、也不会被处决
    __roamDebug.execute.hit(e.id, 'fireball', 1, { noCrit: true, noElement: true });
    __roamDebug.execute.hit(e.id, 'fireball', 1, { noCrit: true, noElement: true });
    return { plain: plain, h1: h1, h2: h2, h3: h3, ratioMid: hpMid / hpMax,
      statsH1: statsH1, stats: s1, statsEnd: __roamDebug.execute.info().stats,
      alive: state.enemies.indexOf(e) >= 0, hp: e.hp, last: __roamDebug.execute.info().last };
  })()`);
  check('首领 36% 不破防', bossCase.h1.breakWindow === 0 && bossCase.statsH1.bossBreaks === 0,
    { h1: bossCase.h1, statsH1: bossCase.statsH1 });
  check('首领 34% 进入破防窗口', bossCase.h2.breakWindow > 0 && bossCase.stats.bossBreaks === 1,
    { h2: bossCase.h2, stats: bossCase.stats });
  check('破防期间伤害 ×1.25', bossCase.h3.dmg === Math.round(bossCase.plain.dmg * 1.25),
    { plain: bossCase.plain.dmg, break: bossCase.h3.dmg });
  check('首领不会被处决（仍存活）', bossCase.alive === true && bossCase.hp > 0 && bossCase.statsEnd.executes === 0
    && bossCase.last === null, { alive: bossCase.alive, hp: bossCase.hp, stats: bossCase.statsEnd });
  check('破防只触发一次', bossCase.statsEnd.bossBreaks === 1, bossCase.statsEnd);

  // ---------- 8) 反应伤害 / 无来源伤害不点亮 ----------
  const nonDirect = await ev(`(function(){
    __roamDebug.execute.resetStats();
    __roamDebug.execute.spawn('normal', 0.10);
    var e = state.enemies[0];
    var r = __roamDebug.execute.hit(e.id, 'fireball', 50, { noCrit: true, reaction: true });
    var rs = __roamDebug.execute.info().stats;
    var n = __roamDebug.execute.hit(e.id, null, 50, { noCrit: true });
    return { r: r, rs: rs, n: n, ns: __roamDebug.execute.info().stats };
  })()`);
  check('反应伤害不点亮红圈', nonDirect.r.execTimer === 0 && nonDirect.rs.marks === 0, nonDirect);
  check('无来源伤害不点亮红圈', nonDirect.n.execTimer === 0 && nonDirect.ns.marks === 0, nonDirect.ns);

  // ---------- 9) 死亡时清理处决字段 ----------
  const death = await ev(`(function(){
    __roamDebug.execute.resetStats();
    __roamDebug.execute.spawn('normal', 0.10);
    var e = state.enemies[0];
    __roamDebug.execute.hit(e.id, 'fireball', 1, { noCrit: true, noElement: true });
    var marked = e.execTimer;
    __roamDebug.execute.hit(e.id, 'fireball', 9999, { noCrit: true, noElement: true });
    return { marked: marked, alive: state.enemies.indexOf(e) >= 0,
      execTimer: e.execTimer, breakWindow: e.breakWindow, breakUsed: e.breakUsed,
      stats: __roamDebug.execute.info().stats };
  })()`);
  check('死亡后处决字段被清空',
    death.alive === false && death.execTimer === 0 && death.breakWindow === 0 && death.breakUsed === false,
    death);
  check('死亡清理计数 +1', death.stats.clearedOnDeath >= 1, death.stats);

  // ---------- 10) 总开关关闭：零字段 / 零统计 / 伤害一致 ----------
  const offCase = await ev(`(function(){
    __roamDebug.execute.setEnabled(false);
    __roamDebug.execute.resetStats();
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 80, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 5000; e.hpMax = 5000;
    e.hp = 500;   // 已经低于 15%，若开关生效会立刻点亮
    var s1 = damageEnemy(e, 100, null, { abilityId: 'fireball', noCrit: true, noElement: true });
    var hasTimer = Object.prototype.hasOwnProperty.call(e, 'execTimer');
    var hasBreak = Object.prototype.hasOwnProperty.call(e, 'breakWindow');
    return { dmg: s1 && s1.damage, hasTimer: hasTimer, hasBreak: hasBreak,
      hasStats: !!state.executionStats, alive: state.enemies.indexOf(e) >= 0 };
  })()`);
  check('关闭后不写 execTimer 字段', offCase.hasTimer === false && offCase.hasBreak === false, offCase);
  check('关闭后不创建统计桶', offCase.hasStats === false, offCase);

  const onCase = await ev(`(function(){
    __roamDebug.execute.setEnabled(true);
    __roamDebug.execute.resetStats();
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 80, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 5000; e.hpMax = 5000;
    var s1 = damageEnemy(e, 100, null, { abilityId: 'fireball', noCrit: true, noElement: true });
    return { dmg: s1 && s1.damage, alive: state.enemies.indexOf(e) >= 0 };
  })()`);
  check('开关前后单发伤害完全相同', offCase.dmg === onCase.dmg, { off: offCase.dmg, on: onCase.dmg });

  // 关闭时破防倍率不生效
  const offBreak = await ev(`(function(){
    __roamDebug.execute.setEnabled(false);
    __roamDebug.execute.spawn('boss', 0.34);
    var e = state.enemies[0];
    e.breakWindow = 5;   // 手动制造"窗口已开"的极端场景
    var s = damageEnemy(e, 100, null, { abilityId: 'fireball', noCrit: true, noElement: true });
    return { dmg: s && s.damage };
  })()`);
  const onBreak = await ev(`(function(){
    __roamDebug.execute.setEnabled(true);
    __roamDebug.execute.spawn('boss', 0.34);
    var e = state.enemies[0];
    e.breakWindow = 5;
    var s = damageEnemy(e, 100, null, { abilityId: 'fireball', noCrit: true, noElement: true });
    return { dmg: s && s.damage };
  })()`);
  check('关闭开关后破防倍率不生效（100）', offBreak.dmg === 100, offBreak);
  check('开启时破防倍率生效（125）', onBreak.dmg === 125, onBreak);

  // ---------- 11) 标记可读性截图 ----------
  const markShot = await ev(`(function(){
    __roamDebug.execute.setEnabled(true);
    __roamDebug.execute.resetStats();
    __roamDebug.execute.spawn('normal', 0.10);
    var e = state.enemies[0];
    __roamDebug.execute.hit(e.id, 'fireball', 1, { noCrit: true, noElement: true });
    var room = state.rooms[state.currentRoomId] || state.rooms[0];
    // 把玩家与目标一起挪到本房中心，并立刻对齐相机，确保截图里房间是亮的、标记在正中
    state.player.x = room.cx;
    state.player.y = room.cy + 46;
    e.x = room.cx; e.y = room.cy - 10;
    snapCamera();
    state.rings.length = 0; state.floats.length = 0;
    state.beams.length = 0; state.sparks.length = 0; state.particles.length = 0;
    return { execTimer: e.execTimer, marks: __roamDebug.execute.info().stats.marks };
  })()`);
  check('标记场景已建立', markShot.execTimer > 3.5 && markShot.marks === 1, markShot);
  await sleep(420);
  await shot('execution-mark.png');
  check('标记截图已生成', fs.existsSync(path.join(OUT, 'execution-mark.png'))
    && fs.statSync(path.join(OUT, 'execution-mark.png')).size > 20000, true);

  // ---------- 汇总 ----------
  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.filter((c) => !c.ok);
  console.log(`\nRESULT: ${pass}/${checks.length} ${fail.length ? 'FAIL' : 'PASS'}`);
  console.log('页面异常: ' + (errors.length ? errors.join(' | ') : '0'));
  if (fail.length) fail.forEach((f) => console.log('  FAILED: ' + f.name + ' ' + JSON.stringify(f.detail)));
  ws.close();
  edge.kill();
  process.exit(fail.length ? 1 : 0);
}

/** 兜底：进程退出时确保 Edge 被收走 */
function attachEdgeExit(edge) {
  const kill = () => { try { edge.kill(); } catch (e) {} };
  process.on('exit', kill);
  process.on('SIGINT', () => { kill(); process.exit(1); });
}

main().catch((err) => {
  console.log('FATAL ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
