/**
 * B3 专项验收：重甲脚步（近距震屏 + 远距静音 + 非重甲无脚步 + 减震兼容）
 * 用法：node tools/arcane_b3.js
 * 端口：9508
 * 输出：.screenshots/art/b3-footstep.png + b3-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9508;
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
  await sleep(1200);
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);

  /**
   * 在当前房间的四向 120px 处各尝试生成一只怪，取第一个能真的走动（累计脚步）的方向
   * @param {string} typeId 敌人类型
   * @param {number} ms 每次尝试的观察时长（毫秒）
   * @returns {Object} { typeId, stepsDelta, peak, last, offset, attempts }
   */
  const runWalk = async (typeId, ms) => {
    const offsets = [[120, 0], [-120, 0], [0, 120], [0, -120]];
    const attempts = [];
    let best = null;
    for (let i = 0; i < offsets.length; i += 1) {
      const res = await ev(`(function(){
        var d = window.__roamDebug;
        d.clearEnemies();
        var p = state.player;
        var ox = ${offsets[i][0]}, oy = ${offsets[i][1]};
        var spawn = d.spawnEnemyAt('${typeId}', p.x + ox, p.y + oy, {});
        var before = d.footstep().steps;
        var peak = 0;
        var t0 = performance.now();
        return new Promise(function(resolve){
          function tick(){
            peak = Math.max(peak, state.shake.power || 0);
            if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
            else {
              var f = d.footstep();
              resolve({
                typeId: '${typeId}',
                offset: [ox, oy],
                spawnOk: !!spawn,
                stepsDelta: f.steps - before,
                peak: Math.round(peak * 100) / 100,
                last: f.last
              });
            }
          }
          requestAnimationFrame(tick);
        });
      })()`);
      attempts.push(res);
      if (!best || res.stepsDelta > best.stepsDelta) best = res;
      if (res.stepsDelta >= 2) break;
    }
    return { best, attempts };
  };

  // ---------- B3-1 近距重甲：真的踩出脚步 + 震屏 ----------
  const heavyNear = await runWalk('patrol', 1600);
  await shot('b3-footstep.png');
  ok('B3-1 近距重甲（patrol 18/56）走 1.6s：脚步 ≥2 次、最近一次 dist ≤ 360、震幅 ≥ 下限 2.5',
    heavyNear.best.stepsDelta >= 2 && heavyNear.best.last && heavyNear.best.last.dist <= 360
    && heavyNear.best.last.power >= 2.5 && heavyNear.best.peak > 0,
    { best: heavyNear.best, attempts: heavyNear.attempts });

  // ---------- B3-2 距离衰减探针 ----------
  const probe = await ev(`(function(){
    var f = window.__roamDebug.footstep();
    return { heavyTypes: f.heavyTypes, near: f.probe(60), mid: f.probe(180), edge: f.probe(360), far: f.probe(600) };
  })()`);
  ok('B3-2 探针单调递减：60px 满幅(>3.6) → 180px 仍可感知 → 360px/600px 低于下限被丢弃',
    probe.near.raw > 3.6 && probe.mid.raw < probe.near.raw && probe.far.raw === 0
    && probe.edge.dropped === true && probe.far.dropped === true,
    probe);
  ok('B3-2b 重甲名单只含"大且慢"四类（含 patrol/graveter/warden/devourer）',
    probe.heavyTypes.indexOf('patrol') >= 0 && probe.heavyTypes.indexOf('graveter') >= 0
    && probe.heavyTypes.indexOf('warden') >= 0 && probe.heavyTypes.indexOf('devourer') >= 0
    && probe.heavyTypes.indexOf('phaser') < 0 && probe.heavyTypes.indexOf('crawler') < 0,
    probe.heavyTypes);

  // ---------- B3-3 非重甲对照 ----------
  const lightNear = await runWalk('crawler', 1600);
  ok('B3-3 非重甲对照（crawler 13/122）同距离 1.6s：脚步 0 次（只有重甲才有脚步）',
    lightNear.best.stepsDelta === 0,
    { best: lightNear.best });

  // ---------- B3-4 可访问性「减少屏震」兼容 ----------
  const a11y = await ev(`(function(){
    var d = window.__roamDebug;
    var base = d.footstep().probe(60);
    d.setA11y(true, false);
    var reduced = d.footstep().probe(60);
    d.setA11y(false, false);
    var restored = d.footstep().probe(60);
    return { base: base, reduced: reduced, restored: restored };
  })()`);
  ok('B3-4 减震开关：60px 震幅从满幅降到 0.35× 且被下限丢弃，关掉后恢复',
    a11y.base.amp >= 3.6 && Math.abs(a11y.reduced.amp - a11y.base.amp * 0.35) < 0.06
    && a11y.reduced.dropped === true && a11y.restored.amp === a11y.base.amp,
    a11y);

  // ---------- B3-5 玩法不变 + 帧率 + 异常 ----------
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
  const hp = await ev(`state.player.hp`);
  const mode = await ev(`state.mode`);
  ok('B3-5 玩法不变：玩家血量 >0、仍在游戏中、帧率 ≥90、无脚本错误',
    hp > 0 && mode === 'playing' && fps >= 90 && errors === 0,
    { hp, mode, fps, errors });

  // ---------- B3-6 截图 ----------
  const size = (() => { try { return fs.statSync(path.join(OUT_DIR, 'b3-footstep.png')).size; } catch (e) { return 0; } })();
  ok('B3-6 近距重甲截图存在（>10KB）', size > 10240, { size });

  fs.writeFileSync(path.join(OUT_DIR, 'b3-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== b3 ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
