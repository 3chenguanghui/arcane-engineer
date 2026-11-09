// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// P0-打击感专项验收：顿帧分级 / 击退分级 / 暴击 / 爆点白闪 / 多杀音阶
// 用法：node arcane_p0feel.js <html绝对路径> <截图输出目录>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9741;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p0_feel');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* wait */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const report = { assertions: [], notes: {} };
  const check = (name, ok, detail) => report.assertions.push({ name, ok: !!ok, detail });

  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);

  // 摆一只"打不死"的靶子，每次测试前重置它的击退速度与血量
  const prepDummy = async () => {
    await ev(`(function(){
      state.enemies.length = 0;
      var roomId = state.currentRoomId;
      var id = window.__roamDebug.spawnEnemy('assembler', 90, 0);
      var e = state.enemies.find(function(x){ return x.id === id; });
      if (e) { e.roomId = roomId; e.speed = 0; e.vx = 0; e.vy = 0; e.hp = 500; e.hpMax = 500; }
      state.particles.length = 0;
      state.rings.length = 0;
      return e ? true : false;
    })()`);
    await sleep(120);
  };

  // ========== 1. 轻击：无暴击、低伤害 ==========
  await prepDummy();
  await ev('FEEL_CONFIG.critChance = 0; true');
  const light = await ev('window.__roamDebug.hitNearest(10, 0)');
  const lightRings = await ev("state.rings.filter(function(r){ return String(r.color).indexOf('255, 255, 255') >= 0; }).length");
  const lightParticles = await ev('state.particles.length');
  await shot('01_light_hit.png');
  check('轻击：freeze = 轻击档（0.045）', light && Math.abs(light.freeze - 0.045) < 0.0001, light && light.freeze);
  check('轻击：击退倍率 = 1', light && light.knockbackMul === 1, light && light.knockbackMul);
  check('轻击：无暴击标记', light && light.crit === false, light && light.crit);
  check('命中点出现爆点白闪环', lightRings >= 1, lightRings);
  check('命中产生碎片粒子', lightParticles >= 3, lightParticles);
  report.notes.light = { damage: light.damage, freeze: light.freeze, vx: light.vx, particles: lightParticles };

  // ========== 2. 重击：低概率暴击下的大伤害 ==========
  await prepDummy();
  const heavy = await ev('window.__roamDebug.hitNearest(40, 0)');
  await shot('02_heavy_hit.png');
  check('重击：freeze = 重击档', heavy && Math.abs(heavy.freeze - 0.085) < 0.0001, heavy && heavy.freeze);
  check('重击：击退倍率 = 1.55（比轻击更远）', heavy && heavy.knockbackMul === 1.55, heavy && heavy.knockbackMul);
  check('重击：推速 > 轻击', heavy && light && Math.abs(heavy.vx) > Math.abs(light.vx),
    { heavyVx: heavy && heavy.vx, lightVx: light && light.vx });
  report.notes.heavy = { damage: heavy.damage, freeze: heavy.freeze, vx: heavy.vx, mul: heavy.knockbackMul };

  // ========== 3. 暴击：概率拉到 100% 验证倍率与手感 ==========
  await prepDummy();
  await ev('FEEL_CONFIG.critChance = 1; true');
  const crit = await ev('window.__roamDebug.hitNearest(10, 0)');
  await shot('03_crit_hit.png');
  check('暴击：crit 标记为真', crit && crit.crit === true, crit && crit.crit);
  check('暴击：伤害 = 1.6 倍（10 → 16）', crit && crit.damage === 16, crit && crit.damage);
  check('暴击：freeze = 暴击档（0.11）', crit && Math.abs(crit.freeze - 0.11) < 0.0001, crit && crit.freeze);
  check('暴击：击退倍率 = 2.1（最远）', crit && crit.knockbackMul === 2.1, crit && crit.knockbackMul);
  check('暴击：推速 > 重击', crit && heavy && Math.abs(crit.vx) > Math.abs(heavy.vx),
    { critVx: crit && crit.vx, heavyVx: heavy && heavy.vx });
  report.notes.crit = { damage: crit.damage, freeze: crit.freeze, vx: crit.vx, mul: crit.knockbackMul };

  // ========== 4. 多杀音阶递进：一发爆炸炸死 5 只 ==========
  await ev('FEEL_CONFIG.critChance = 0; window.__roamDebug.grantTech("field"); window.__roamDebug.fuse(); true');
  await ev(`(function(){
    state.enemies.length = 0; state.projectiles.length = 0; state.floats.length = 0;
    state.cooldowns = {}; state.player.aether = 70; state.player.hp = state.player.hpMax;
    state.combo.count = 0; state.combo.timer = 0; state.killPitchLog = [];
    state.explosionStats = { count: 0, totalHits: 0, bestHits: 0 };
    var roomId = state.currentRoomId;
    for (var i = 0; i < 6; i += 1) {
      var id = window.__roamDebug.spawnEnemy('assembler', 72 + i * 24, (i % 2 === 0 ? 8 : -8));
      var e = state.enemies.find(function(x){ return x.id === id; });
      if (e) { e.roomId = roomId; e.speed = 0; e.hp = 1; e.hpMax = 1; }
    }
    state.floats.length = 0;
    return state.enemies.length;
  })()`);
  await ev('window.__roamDebug.setMouseAim(0); true');
  await sleep(200);
  await ev('window.__roamDebug.cast(); true');
  await sleep(380);
  const pitchLog = await ev('window.__roamDebug.getState().killPitchLog');
  const frameKills = await ev('window.__roamDebug.getState().frameKills');
  await shot('04_multikill_pitch.png');
  const ascending = pitchLog.length >= 3 && pitchLog.every((v, i, arr) => i === 0 || v > arr[i - 1]);
  check('一次爆炸 ≥3 杀', pitchLog.length >= 3, pitchLog);
  check('击杀音高逐级上扬（同帧多杀）', ascending, pitchLog);
  check('音高上限不超过 1.6', pitchLog.every((v) => v <= 1.6 + 1e-9), pitchLog);
  report.notes.killPitchLog = pitchLog;
  report.notes.frameKillsLast = frameKills;

  // ========== 5. 帧率 / 报错 ==========
  await sleep(400);
  const st = await ev('window.__roamDebug.getState()');
  check('帧率 ≥60', st.fps >= 60, st.fps);
  report.notes.fps = st.fps;
  const errors = await ev('window.__roamDebug.errors()');
  check('运行无报错', Array.isArray(errors) && errors.length === 0, errors);
  report.notes.errors = errors;
  report.notes.mode = st.mode;
  await shot('05_final.png');

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  const failed = report.assertions.filter((a) => !a.ok);
  console.log(JSON.stringify(report, null, 2));
  console.log('==== 结果：' + (report.assertions.length - failed.length) + '/' + report.assertions.length + ' 通过 ====');
  if (failed.length) console.log('失败项：' + failed.map((a) => a.name).join(' | '));
  ws.close(); killEdge(edge);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
