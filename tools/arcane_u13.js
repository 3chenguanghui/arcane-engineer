/**
 * U13 专项验收：三主题死亡形态（端口 9507）
 * 用法：node tools/arcane_u13.js
 * 输出：.screenshots/art/u13-{mech,rune,void}.png + u13-result.json
 *
 * 断言：三层各杀一只怪，主题标签正确、环形状 / 半径方向 / 粒子方向可辨、玩法不被打乱。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9507;
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2000);

  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1100);
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);

  /**
   * 在指定楼层杀一只怪，并把"新增加的环 / 粒子"全部快照回来
   * @param {number} floor 目标楼层（1=mech / 2=rune / 3=void）
   */
  const killOnFloor = async (floor) => {
    await ev(`window.__roamDebug.restart()`);
    await sleep(300);
    await ev(`window.__roamDebug.setFloor(${floor})`);
    await sleep(350);
    await ev(`(function(){ state.player.invuln = 9999; return true; })()`);
    return await ev(`(function(){
      var d = window.__roamDebug;
      d.clearEnemies();
      var p = state.player;
      var spawn = d.spawnEnemyAt('wanderer', p.x + 60, p.y, {});
      var killsBefore = state.kills;
      var embersBefore = state.embers || 0;
      var ringCountBefore = state.rings.length;
      var particleCountBefore = state.particles.length;
      d.hitNearest(99999);
      var newRings = state.rings.slice(ringCountBefore).map(function(r){
        return { shape: r.shape, grow: Math.round(r.grow * 100) / 100, color: r.color, life: r.maxLife };
      });
      var cx = p.x + 60, cy = p.y;
      var newParticles = state.particles.slice(particleCountBefore).map(function(k){
        var dist = Math.sqrt((k.x - cx) * (k.x - cx) + (k.y - cy) * (k.y - cy));
        var inward = (-(k.x - cx) * k.vx - (k.y - cy) * k.vy) > 0;
        return { dist: Math.round(dist * 10) / 10, vy: Math.round(k.vy * 10) / 10, inward: inward };
      });
      return {
        floor: state.floor, theme: state.themeId,
        killsDelta: state.kills - killsBefore,
        enemiesLeft: state.enemies.length,
        embersDelta: (state.embers || 0) - embersBefore,
        form: d.deathForm(),
        newRings: newRings,
        newParticles: newParticles,
        mode: state.mode
      };
    })()`);
  };

  // ---------- U13-1 / U13-2 机械层 ----------
  const mech = await killOnFloor(1);
  await shot('u13-mech.png');
  const mechShock = mech.newRings.filter((r) => r.shape === 'shockwave');
  ok('U13-1 机械层：主题 mech、标签「机械 · 零件炸散」、两圈 shockwave 橙金环',
    mech.theme === 'mech' && mech.form.last && mech.form.last.label === mech.form.config.mech.label
    && mechShock.length >= 2,
    { theme: mech.theme, form: mech.form.last, rings: mech.newRings });
  ok('U13-2 机械层：向下坠落的零件火花 ≥ shards（10）',
    mech.newParticles.filter((k) => k.vy > 0).length >= mech.form.config.mech.shards,
    { count: mech.newParticles.length, down: mech.newParticles.filter((k) => k.vy > 0).length });

  // ---------- U13-3 符文层 ----------
  const rune = await killOnFloor(2);
  await shot('u13-rune.png');
  const runeShapes = rune.newRings.map((r) => r.shape);
  const runeUp = rune.newParticles.filter((k) => k.vy < 0).length;
  ok('U13-3 符文层：主题 rune、标签「符文 · 溃散」、rune + hex 两种环、笔画粒子向上飘',
    rune.theme === 'rune' && rune.form.last && rune.form.last.label === rune.form.config.rune.label
    && runeShapes.indexOf('rune') >= 0 && runeShapes.indexOf('hex') >= 0
    && runeUp >= rune.form.config.rune.shards,
    { theme: rune.theme, form: rune.form.last, rings: runeShapes, up: runeUp, particles: rune.newParticles.length });

  // ---------- U13-4 虚空层 ----------
  const voidRes = await killOnFloor(3);
  await shot('u13-void.png');
  const voidRings = voidRes.newRings.filter((r) => r.grow < 0);
  const voidInward = voidRes.newParticles.filter((k) => k.inward && k.dist > 18).length;
  ok('U13-4 虚空层：主题 void、标签「虚空 · 坍缩」、两圈负增长环、内向暗粒 ≥ shards（12）',
    voidRes.theme === 'void' && voidRes.form.last && voidRes.form.last.label === voidRes.form.config.void.label
    && voidRings.length >= 2 && voidInward >= voidRes.form.config.void.shards,
    { theme: voidRes.theme, form: voidRes.form.last, rings: voidRes.newRings, inward: voidInward });

  // ---------- U13-5 不改玩法 ----------
  ok('U13-5 三层击杀都只 +1 击杀、敌人减少 1、余烬照发（≥0）',
    [mech, rune, voidRes].every((x) => x.killsDelta === 1 && x.enemiesLeft === 0 && x.embersDelta >= 0),
    [mech.killsDelta, rune.killsDelta, voidRes.killsDelta, mech.enemiesLeft, rune.enemiesLeft, voidRes.enemiesLeft]);

  // ---------- U13-6 帧率 / 异常 / 截图 ----------
  // 第 3 层击杀会清房触发奖励弹窗（弹窗一开主循环冻结），测帧率前先回一局干净状态
  await ev(`window.__roamDebug.restart()`);
  await sleep(900);
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);
  const fps = await ev(`(function(){
    return new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
  })()`);
  const errors = await ev(`(window.__errors || []).length`);
  const names = ['u13-mech.png', 'u13-rune.png', 'u13-void.png'];
  const sizes = names.map((n) => {
    try { return fs.statSync(path.join(OUT_DIR, n)).size; } catch (e) { return 0; }
  });
  const mode = await ev(`state.mode`);
  ok('U13-6 帧率 ≥90 / 无脚本错误 / 3 张截图 >10KB / 仍在游戏中',
    fps >= 90 && errors === 0 && sizes.every((s) => s > 10240) && mode === 'playing',
    { fps, errors, sizes, mode });

  fs.writeFileSync(path.join(OUT_DIR, 'u13-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== u13 ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
