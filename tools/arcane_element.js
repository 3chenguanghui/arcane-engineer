// P0-1 断言：元素附着与反应（总开关 / 五种形状 / 三种反应 / 死亡清除 / 同帧去重）
// 用法：node tools\arcane_element.js *> tools\element.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9687;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'element');
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

  // ---------- 1) 默认开启 + 来源表 ----------
  const base = await ev(`__roamDebug.element.info()`);
  check('默认开启总开关', base.enabled === true, base.enabled);
  const need = ['fireball', 'frost', 'bolt', 'blade', 'mine'];
  check('五种形状都有附着来源', need.every((k) => !!base.sources[k]), need.map((k) => base.sources[k]));
  check('来源覆盖三种反应所需', base.sources.frost === 'ice' && base.sources.bolt === 'thunder'
    && base.sources.blade === 'poison' && base.sources.fireball === 'fire', base.sources);

  // ---------- 2) 命中不存在的目标 ----------
  const ghost = await ev(`__roamDebug.element.hit('__nope__', 'fireball', 10)`);
  check('命中不存在的目标：不崩溃', ghost.ok === false, ghost);
  const ghostStats = await ev(`__roamDebug.element.info().stats`);
  check('命中不存在的目标：不产生统计', ghostStats.attached === 0 && ghostStats.reactions.frostBurst === 0, ghostStats);

  // ---------- 3) 总开关关闭：零行为差异 ----------
  const offCase = await ev(`(function(){
    __roamDebug.element.setEnabled(false);
    __roamDebug.element.resetStats();
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 80, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 5000; e.hpMax = 5000;
    var s1 = damageEnemy(e, 100, null, { abilityId: 'fireball', noCrit: true });
    var s2 = damageEnemy(e, 100, null, { abilityId: 'fireball', noCrit: true });
    var hasElemField = Object.prototype.hasOwnProperty.call(e, 'elem');
    var info = __roamDebug.element.info();
    return {
      dmg1: s1 && s1.damage, dmg2: s2 && s2.damage,
      hasElemField: hasElemField,
      stats: info.stats, elem: info.enemies[0] ? info.enemies[0].elem : null,
      hp: e.hp
    };
  })()`);
  check('关闭后不写 elem 字段', offCase.hasElemField === false && offCase.elem === null, offCase);
  check('关闭后无附着/反应统计', offCase.stats.attached === 0 && offCase.stats.reactions.frostBurst === 0, offCase.stats);
  check('关闭后两次伤害口径正常', offCase.dmg1 > 0 && offCase.dmg2 > 0, offCase);

  const onCase = await ev(`(function(){
    __roamDebug.element.setEnabled(true);
    __roamDebug.element.resetStats();
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 80, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 5000; e.hpMax = 5000;
    var s1 = damageEnemy(e, 100, null, { abilityId: 'fireball', noCrit: true });
    var s2 = damageEnemy(e, 100, null, { abilityId: 'fireball', noCrit: true, noElement: true });
    return { dmg1: s1 && s1.damage, dmg2: s2 && s2.damage, elem: e.elem ? Object.assign({}, e.elem) : null };
  })()`);
  check('开关打开：首发生效挂火', onCase.elem && onCase.elem.fire > 0, onCase.elem);
  check('开关前后单发伤害完全相同', offCase.dmg1 === onCase.dmg1, { off: offCase.dmg1, on: onCase.dmg1 });

  // ---------- 4) 五种技能形状真实施法都能附着 ----------
  const shapes = {};
  for (const id of need) {
    shapes[id] = await ev(`(function(){ __roamDebug.element.resetStats(); return __roamDebug.element.castShape('${id}'); })()`);
  }
  const expect = { fireball: 'fire', frost: 'ice', bolt: 'thunder', blade: 'poison', mine: 'fire' };
  need.forEach((id) => {
    check('形状 ' + id + ' → ' + expect[id],
      shapes[id].ok && shapes[id].attached.indexOf(expect[id]) >= 0,
      { attached: shapes[id].attached, hp: shapes[id].hp });
  });

  // ---------- 5) 霜爆（火 + 冰） ----------
  const burst = await ev(`(function(){
    __roamDebug.element.resetStats();
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 70, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 5000; e.hpMax = 5000;
    __roamDebug.element.attach(e.typeId, 'ice', 3);
    var before = e.hp;
    var r = __roamDebug.element.hit(e.typeId, 'fireball', 200, { noCrit: true });
    return { ok: r.ok, hpBefore: before, hpAfter: e.hp, elem: r.elem,
      stats: __roamDebug.element.info().stats };
  })()`);
  check('霜爆触发 1 次', burst.stats.reactions.frostBurst === 1, burst.stats);
  check('霜爆消耗冰并留下湿身 + 火', burst.elem && !burst.elem.ice && burst.elem.wet > 0 && burst.elem.fire > 0, burst.elem);
  check('霜爆有独立伤害结算', burst.hpBefore - burst.hpAfter > 200, { deal: burst.hpBefore - burst.hpAfter });

  // ---------- 6) 传导（雷 + 湿身） ----------
  const conduct = await ev(`(function(){
    __roamDebug.element.resetStats();
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 70, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 5000; e.hpMax = 5000;
    __roamDebug.element.attach(e.typeId, 'wet', 3);
    var before = e.hp;
    var r = __roamDebug.element.hit(e.typeId, 'bolt', 200, { noCrit: true });
    return { hpBefore: before, hpAfter: e.hp, elem: r.elem,
      stats: __roamDebug.element.info().stats };
  })()`);
  check('传导触发 1 次', conduct.stats.reactions.conduct === 1, conduct.stats);
  check('传导消耗湿身并留下感电', conduct.elem && !conduct.elem.wet && conduct.elem.thunder > 0, conduct.elem);
  check('传导有独立伤害结算', conduct.hpBefore - conduct.hpAfter > 200, { deal: conduct.hpBefore - conduct.hpAfter });

  // ---------- 7) 燃云（火 + 毒） ----------
  const cloud = await ev(`(function(){
    __roamDebug.element.resetStats();
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 70, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 5000; e.hpMax = 5000;
    __roamDebug.element.attach(e.typeId, 'poison', 4);
    var r = __roamDebug.element.hit(e.typeId, 'fireball', 200, { noCrit: true });
    var info = __roamDebug.element.info();
    return { elem: r.elem, clouds: info.clouds, stats: info.stats };
  })()`);
  check('燃云生成 1 朵云', cloud.clouds.length === 1 && cloud.clouds[0].damage > 0, cloud.clouds);
  check('燃云消耗毒并留下火', cloud.elem && !cloud.elem.poison && cloud.elem.fire > 0, cloud.elem);
  check('燃云触发计数 1', cloud.stats.reactions.fireCloud === 1, cloud.stats);

  const cloudTick = await ev(`(function(){
    var p = state.player;
    var e = state.enemies[0];
    var cx = state.elementClouds[0] ? state.elementClouds[0].x : e.x;
    var cy = state.elementClouds[0] ? state.elementClouds[0].y : e.y;
    var before = e.hp;
    for (var i = 0; i < 200; i += 1) {
      e.x = cx; e.y = cy;   // 钉在云里，验证 6 跳全部落地
      __roamDebug.element.tick(1 / 60);
      var c = state.elementClouds[0];
      if (c) { cx = c.x; cy = c.y; }
      if (!state.elementClouds.length) break;
    }
    return { hpBefore: before, hpAfter: e.hp, clouds: state.elementClouds.length, elapsed: state.elapsed };
  })()`);
  check('燃云 3 秒 6 跳后自动消失', cloudTick.clouds === 0, cloudTick.clouds);
  check('燃云持续伤害已结算', cloudTick.hpBefore - cloudTick.hpAfter >= 6, { deal: cloudTick.hpBefore - cloudTick.hpAfter });

  // ---------- 8) 同帧多次反应只结算一次 ----------
  const sameFrame = await ev(`(function(){
    __roamDebug.element.resetStats();
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 70, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 5000; e.hpMax = 5000;
    __roamDebug.element.attach(e.typeId, 'ice', 3);
    __roamDebug.element.hit(e.typeId, 'fireball', 200, { noCrit: true });
    // 反应会消耗冰；同帧再补一次冰，验证"冷却中只刷新、不重复结算"
    __roamDebug.element.attach(e.typeId, 'ice', 3);
    __roamDebug.element.hit(e.typeId, 'fireball', 200, { noCrit: true });
    return __roamDebug.element.info().stats;
  })()`);
  check('同帧两次火只爆 1 次', sameFrame.reactions.frostBurst === 1, sameFrame);
  check('第二次被冷却拦截', sameFrame.blocked >= 1, sameFrame);

  // ---------- 9) 冷却结束后可再次触发 ----------
  const later = await ev(`(function(){
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 70, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 5000; e.hpMax = 5000;
    __roamDebug.element.attach(e.typeId, 'ice', 3);
    var before = __roamDebug.element.info().stats.reactions.frostBurst;
    __roamDebug.element.tick(0.7);
    __roamDebug.element.attach(e.typeId, 'ice', 3);
    __roamDebug.element.hit(e.typeId, 'fireball', 200, { noCrit: true });
    return { before: before, after: __roamDebug.element.info().stats.reactions.frostBurst };
  })()`);
  check('冷却结束可再次霜爆', later.after === later.before + 1, later);

  // ---------- 10) 目标死亡：附着清除且不触发反应 ----------
  const death = await ev(`(function(){
    __roamDebug.element.resetStats();
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 70, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 80; e.hpMax = 80;
    __roamDebug.element.attach(e.typeId, 'ice', 3);
    __roamDebug.element.hit(e.typeId, 'fireball', 9999, { noCrit: true });
    return {
      alive: state.enemies.indexOf(e) >= 0,
      elem: e.elem, order: e.elemOrder,
      stats: __roamDebug.element.info().stats
    };
  })()`);
  check('致死一发不触发霜爆', death.stats.reactions.frostBurst === 0, death.stats);
  check('死亡后附着字段被清空', death.alive === false && death.elem === null && death.order === null, death);
  check('死亡清理计数 +1', death.stats.clearedOnDeath >= 1, death.stats);

  // ---------- 11) 三种附着共存 + 头顶徽记（截图） ----------
  const stack = await ev(`(function(){
    __roamDebug.element.resetStats();
    state.enemies.length = 0;
    var p = state.player;
    var e = spawnEnemy('chanter', p.x + 70, p.y, state.floor || 1, { roomId: state.currentRoomId });
    e.hp = 5000; e.hpMax = 5000;
    __roamDebug.element.attach(e.typeId, 'fire', 4);
    __roamDebug.element.attach(e.typeId, 'ice', 3);
    __roamDebug.element.attach(e.typeId, 'poison', 4);
    // 清掉上一次断言留下的环/飘字，并挪到镜头中心，便于看清头顶徽记
    var room = state.rooms[0];
    e.x = room.cx; e.y = room.cy - 20;
    state.rings.length = 0; state.floats.length = 0;
    state.beams.length = 0; state.sparks.length = 0; state.particles.length = 0;
    return { elem: e.elem ? Object.assign({}, e.elem) : null, order: e.elemOrder };
  })()`);
  check('三种附着可共存', stack.elem && stack.elem.fire > 0 && stack.elem.ice > 0 && stack.elem.poison > 0, stack);
  await sleep(120);
  await shot('element-status.png');
  check('状态徽记截图已生成', fs.existsSync(path.join(OUT, 'element-status.png')) && fs.statSync(path.join(OUT, 'element-status.png')).size > 20000, true);

  // ---------- 12) 关闭开关的性能口径（同口径 2000 发，取 3 次最小） ----------
  const perf = await ev(`(function(){
    function bench(enabled, withId) {
      __roamDebug.element.setEnabled(enabled);
      state.enemies.length = 0;
      var p = state.player;
      var e = spawnEnemy('chanter', p.x + 60, p.y, state.floor || 1, { roomId: state.currentRoomId });
      e.hp = 1e9; e.hpMax = 1e9;
      var best = 1e9;
      for (var round = 0; round < 3; round += 1) {
        var t0 = performance.now();
        for (var i = 0; i < 2000; i += 1) {
          damageEnemy(e, 1, null, withId ? { abilityId: 'fireball', noCrit: true, noElement: true } : { noCrit: true });
        }
        var cost = performance.now() - t0;
        if (cost < best) best = cost;
      }
      return best;
    }
    var off = bench(false, true);
    var noOpts = bench(false, false);
    __roamDebug.element.setEnabled(true);
    return { off: Math.round(off * 100) / 100, noOpts: Math.round(noOpts * 100) / 100,
      ratio: Math.round((off / Math.max(0.01, noOpts)) * 100) / 100 };
  })()`);
  check('关闭态与"无 id"路径同量级（≤1.6×）', perf.ratio <= 1.6, perf);

  // ---------- 13) 关闭开关后元素链路完全静默 ----------
  const silent = await ev(`(function(){
    __roamDebug.element.setEnabled(false);
    __roamDebug.element.resetStats();
    var r = __roamDebug.element.castShape('frost');
    var info = __roamDebug.element.info();
    return { attached: r.attached, stats: info.stats, clouds: info.clouds.length };
  })()`);
  check('关闭后施法不再挂附着', silent.attached.length === 0 && silent.stats.attached === 0, silent);
  check('关闭后不再产生燃云', silent.clouds === 0, silent.clouds);
  await ev(`__roamDebug.element.setEnabled(true); true`);

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
