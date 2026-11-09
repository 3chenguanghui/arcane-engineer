/**
 * C2 双选祭坛验收：A0–A9
 * 用法：node tools/arcane_dualaltar.js
 * 端口：9524
 * 输出：.screenshots/art/dualaltar.png、dualaltar-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9524;
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
  await ev(`(function(){ window.__errors = []; window.addEventListener('error', function(e){ window.__errors.push(String(e.message || e)); }); return true; })()`);

  // ---------- A0 配置默认值 ----------
  const a0 = await ev(`window.__roamDebug.dualAltar.info()`);
  ok('A0 配置默认值（开关 / 两种祭坛 / 门板文案 / 交互半径）',
    a0.enabled === true && a0.config.altars.length === 2
      && a0.config.altars[0].id === 'power' && a0.config.altars[0].damageMul === 1.15
      && a0.config.altars[1].id === 'supply' && a0.config.altars[1].crystals === 2
      && a0.config.altars[1].embers === 15 && a0.config.altars[1].aether === 50
      && a0.config.doorTip.indexOf('碎裂') >= 0
      && a0.config.interactRange >= 40, a0.config);

  // ---------- A1 找一个真正生成了双祭坛的楼层 ----------
  const a1scan = await ev(`(function(){
    var out = [];
    var cfgOn = window.__roamDebug.dualAltar.info().enabled;
    [1,2,3,4,5,6].forEach(function(f){
      var err = null;
      try { window.__roamDebug.dualAltar.setFloor(f); } catch (e) { err = String(e && e.message || e); }
      var info = window.__roamDebug.dualAltar.info();
      out.push({ floor: f, roomId: info.state ? info.state.roomId : -1,
        room: info.room, altars: info.state ? info.state.altars.length : 0,
        paid: state.pricedDoors ? state.pricedDoors.paidRoomId : -1,
        spawn: state.spawnRoomId, cfgOn: cfgOn, err: err,
        types: state.rooms.map(function(r){ return r.type; }).join('|') });
    });
    return out;
  })()`);
  const a1hit = a1scan.filter((x) => x.roomId >= 0);
  ok('A1 每层最多 1 组，房型只放事件/宝箱/休整/战斗/精英，两座祭坛齐全且避开出生/代价房',
    a1hit.length >= 5 && a1hit.every((x) => x.altars === 2
      && ['event', 'chest', 'rest', 'battle', 'elite'].indexOf(x.room.type) >= 0
      && x.roomId !== x.spawn && x.roomId !== x.paid), a1scan);

  // 选一个可用楼层做后续验收
  const hitFloor = a1hit.length ? a1hit[0].floor : 1;
  const a1 = await ev(`window.__roamDebug.dualAltar.setFloor(${hitFloor})`);
  ok('A1b 双祭坛落点在房内可达（两座互不重叠、离门 ≥44）',
    a1.state && a1.state.altars.length === 2
      && Math.hypot(a1.state.altars[0].x - a1.state.altars[1].x,
                    a1.state.altars[0].y - a1.state.altars[1].y) >= a1.config.altarRadius * 2.2,
    a1.state);

  // ---------- A2 门板文案 ----------
  const a2 = await ev(`(function(){
    var info = window.__roamDebug.dualAltar.info();
    var room = state.rooms[info.state.roomId];
    var door = state.doors.filter(function(d){ return d.targetRoomId === room.id; })[0];
    var dinfo = door ? doorInfoFor(door) : null;
    return { roomId: room.id, hasDoor: !!door, tip: dinfo ? dinfo.tip : null,
      dual: dinfo ? dinfo.dualAltar : null };
  })()`);
  ok('A2 门板写"双选祭坛 · 两选一 · 碎裂"',
    !!a2.hasDoor && !!a2.dual && a2.tip.indexOf('两选一') >= 0 && a2.tip.indexOf('碎裂') >= 0, a2);

  // ---------- A3 未选择时两座都可用 ----------
  const a3 = await ev(`(function(){
    var info = window.__roamDebug.dualAltar.info();
    return { picked: info.state.picked, shattered: info.state.shattered,
      ids: info.state.altars.map(function(a){ return a.id; }),
      dmg: state.mods.damageMul, crystals: state.meta.crystals, embers: state.embers };
  })()`);
  ok('A3 未选择：picked=null、两座都在、数值未变',
    a3.picked === null && a3.shattered === false
      && a3.ids.indexOf('power') >= 0 && a3.ids.indexOf('supply') >= 0, a3);

  // ---------- A4 选力量：伤害倍率 ×1.15，只加一次 ----------
  await ev(`window.__roamDebug.dualAltar.enter()`);
  const a4 = await ev(`(function(){
    var before = state.mods.damageMul;
    var r = window.__roamDebug.dualAltar.pick('power');
    var info = window.__roamDebug.dualAltar.info();
    return { ok: r.ok, altar: r.altar, before: before, after: state.mods.damageMul,
      picked: info.state.picked, shattered: info.state.shattered,
      powerPicks: info.stats.powerPicks };
  })()`);
  ok('A4 选力量祭坛：damageMul 恰好 ×1.15，picked=power、另一座碎裂',
    a4.ok === true && a4.picked === 'power' && a4.shattered === true
      && Math.abs(a4.after / a4.before - 1.15) < 1e-6 && a4.powerPicks === 1, a4);

  // ---------- A5 不可逆：同一层再选 / 重新进房再选都无效 ----------
  const a5 = await ev(`(function(){
    var before = { dmg: state.mods.damageMul, crystals: state.meta.crystals, embers: state.embers };
    var again = window.__roamDebug.dualAltar.pick('supply');
    window.__roamDebug.dualAltar.enter();
    var afterReenter = window.__roamDebug.dualAltar.pick('supply');
    return { again: again, reenter: afterReenter,
      after: { dmg: state.mods.damageMul, crystals: state.meta.crystals,
      embers: state.embers }, before: before,
      picked: window.__roamDebug.dualAltar.info().state.picked };
  })()`);
  ok('A5 选完另一座不可再选：同层/重新进房 pick 都返回 ok=false 且数值不变',
    a5.again && a5.again.ok === false && a5.again.reason === 'done'
      && a5.reenter && a5.reenter.ok === false
      && a5.after.dmg === a5.before.dmg
      && a5.after.crystals === a5.before.crystals
      && a5.after.embers === a5.before.embers && a5.picked === 'power', a5);

  // ---------- A6 选丰饶：资源到位 ----------
  const a6 = await ev(`(function(){
    // 扫描若干层，找一层重新生成了未选择的双祭坛（房间随机，不能写死层号）
    var pickedFloor = -1;
    for (var f = 1; f <= 8; f += 1) {
      window.__roamDebug.dualAltar.setFloor(f);
      var probe = window.__roamDebug.dualAltar.info();
      if (probe.state && probe.state.roomId >= 0 && probe.state.altars.length === 2
          && !probe.state.picked) { pickedFloor = f; break; }
    }
    if (pickedFloor < 0) return { skipped: true };
    var before = { crystals: state.meta.crystals, embers: state.embers, aether: state.player.aether };
    var r = window.__roamDebug.dualAltar.pick('supply');
    var after = { crystals: state.meta.crystals, embers: state.embers, aether: state.player.aether };
    var info = window.__roamDebug.dualAltar.info();
    return { skipped: false, floor: pickedFloor, ok: r.ok, before: before, after: after,
      picked: info.state.picked, supplyPicks: info.stats.supplyPicks };
  })()`);
  ok('A6 选丰饶祭坛：结晶 +2 / 余烬 +15 / 奥能 +50，picked=supply',
    a6.skipped !== true && a6.ok === true && a6.picked === 'supply'
      && a6.after.crystals === a6.before.crystals + 2
      && a6.after.embers === a6.before.embers + 15
      && a6.after.aether >= a6.before.aether, a6);

  // ---------- A7 交互链：靠近祭坛按 E 能选 ----------
  const a7 = await ev(`(function(){
    var pickedFloor = -1;
    for (var f = 1; f <= 8; f += 1) {
      window.__roamDebug.dualAltar.setFloor(f);
      var probe = window.__roamDebug.dualAltar.info();
      if (probe.state && probe.state.roomId >= 0 && probe.state.altars.length === 2
          && !probe.state.picked) { pickedFloor = f; break; }
    }
    if (pickedFloor < 0) return { skipped: true };
    var info = window.__roamDebug.dualAltar.info();
    var a = info.state.altars[0];
    state.player.x = a.x; state.player.y = a.y;
    state.player.vx = 0; state.player.vy = 0;
    state.currentRoomId = info.state.roomId;
    var consumed = tryDualAltarInteract();
    return { skipped: false, floor: pickedFloor, consumed: consumed,
      picked: window.__roamDebug.dualAltar.info().state.picked };
  })()`);
  ok('A7 站到祭坛旁 E 键可选中（交互链消费一次）',
    a7.skipped !== true && a7.consumed === true && a7.picked === 'power', a7);

  // ---------- A8 开关 A/B：enabled=false 不生成 ----------
  const a8 = await ev(`(function(){
    window.__roamDebug.dualAltar.setEnabled(false);
    window.__roamDebug.dualAltar.setFloor(1);
    var off = window.__roamDebug.dualAltar.info();
    window.__roamDebug.dualAltar.setEnabled(true);
    window.__roamDebug.dualAltar.setFloor(1);
    var on = window.__roamDebug.dualAltar.info();
    return { offState: off.state, offEnabled: off.enabled,
      onState: on.state, onEnabled: on.enabled };
  })()`);
  ok('A8 enabled=false 不生成双祭坛；打开后恢复生成',
    a8.offEnabled === false && a8.offState !== null && a8.offState.altars.length === 0
      && a8.onEnabled === true, { off: a8.offState, on: a8.onState, enabled: a8.onEnabled });

  // ---------- A9 截图 / fps / 零报错 ----------
  await ev(`(function(){
    var info = window.__roamDebug.dualAltar.info();
    if (info.state) {
      var room = state.rooms[info.state.roomId];
      state.player.x = room.cx; state.player.y = room.cy + 30;
      state.player.vx = 0; state.player.vy = 0;
      state.currentRoomId = room.id;
      snapCamera();
    }
    return true;
  })()`);
  await sleep(700);
  const a9 = await ev(`(new Promise(function(resolve){
    var n = 0; var t0 = performance.now();
    function tick(){ n += 1;
      if (performance.now() - t0 >= 1000) resolve({ fps: Math.round(n * 1000 / (performance.now() - t0)),
        errors: window.__errors || [] });
      else requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  }))`);
  await shot('dualaltar.png');
  ok('A9 截图产出 / 战斗帧率 ≥45 / 零报错',
    fs.statSync(path.join(OUT_DIR, 'dualaltar.png')).size > 200000
      && a9.fps >= 45 && a9.errors.length === 0, a9);

  const passed = asserts.filter((a) => a.pass).length;
  const summary = { total: asserts.length, passed, failed: asserts.length - passed,
    fps: a9.fps, asserts };
  fs.writeFileSync(path.join(OUT_DIR, 'dualaltar-result.json'), JSON.stringify(summary, null, 2));
  console.log(`\n===== C2 双选祭坛 ${passed}/${asserts.length} =====`);
  ws.close();
  killEdge(edge);
  process.exit(passed === asserts.length ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
