/**
 * 打击感 1/2/3 探针：命中停顿 / 屏震 / 受击闪白 的实测读数 + 同机位截图
 * ------------------------------------------------------------
 * 用法：node tools/fx123_probe.js [目标html] [输出目录]
 * 默认：index_arcane_v2.html → .screenshots/fx123
 *
 * 输出：
 *   - measure.json：普通 / 精英 / 首领 三档的 顿帧请求值、屏震峰值与时长、
 *     闪白可见毫秒、顿帧期间模拟时间比（simDtRatio）
 *   - hit_normal.png / hit_elite.png / hit_boss.png：同机位、闪白峰值帧截图
 *   - scene.png：固定机位战斗全景
 *
 * 说明：本脚本只读游戏状态、不写存档；命中通过 __roamDebug.hitNearest 注入。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9733;
const ROOT = path.join(__dirname, '..');
/* 命令行传相对路径时按项目根解析成绝对路径，否则 file:/// 会指向盘符根目录 */
const FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = process.argv[3] ? path.resolve(ROOT, process.argv[3]) : path.join(ROOT, '.screenshots', 'fx123');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 就绪 */ }
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
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  /* 3.2MB 单文件首次解析较慢：等"开始按钮"和调试口都就绪再点，避免点空 */
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    try {
      ready = await ev("!!document.getElementById('btnStart')");
    } catch (e) { ready = false; }
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('btnStart 未出现（页面未加载完成）');
  /* 用真实鼠标事件点开始（.click() 在部分版本里不触发游戏的指针链路） */
  const btn = await ev("(function(){ var el = document.getElementById('btnStart'); var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  for (let i = 0; i < 60; i += 1) {
    const has = await ev("typeof window.__roamDebug === 'object' && !!window.__roamDebug");
    if (has) break;
    await sleep(250);
  }
  await sleep(1400);
  /* 无头环境偶尔吞掉标题层点击，且首局会先弹三角色选择：探针里显式跳过选人再开局
     （只改本次运行的临时标志，不写存档、不影响玩法数据） */
  const mode0 = await ev("(function(){ return (state && state.mode) || 'unknown'; })()");
  if (mode0 === 'title') {
    await ev("(function(){ if (typeof closeCharSelect === 'function') closeCharSelect(); __charSkipPick = true; __charPickedThisBoot = true; if (typeof startGame === 'function') { startGame(); return 'called'; } return 'no-fn'; })()");
    await sleep(1200);
  }
  /* 兜底：选人页若仍留着，截图会拍到遮罩而不是战斗画面 */
  await ev("(function(){ if (typeof closeCharSelect === 'function') closeCharSelect(); var cl = (window.ui && ui.charLayer) || document.getElementById('charLayer'); if (cl) { cl.classList.add('hidden'); cl.style.display = 'none'; } return !!(cl && cl.style.display === 'none'); })()");
  await sleep(300);
  console.log('CHARLAYER', await ev("(function(){ var cl = (window.ui && ui.charLayer) || document.getElementById('charLayer'); return cl ? { cls: cl.className, disp: cl.style.display, open: !!window.__charSelectOpen } : 'none'; })()"));
  console.log('MODE', JSON.stringify(await ev("(function(){ var s = window.__roamDebug.getState(); return { mode: s.mode, status: s.status, enemies: s.enemies }; })()")));

  /* 帧桶在 update() 开头会被重建，从外部直接 damageEnemy 会被丢掉。
     这里把命中注入到"本帧 flush 之前"，保证走完整的分级 → 顿帧/屏震链路。 */
  await ev(`(function(){
    if (window.__fxHooked) return true;
    window.__fxHooked = true;
    window.__fxQueue = [];
    var origFlush = window.fxTierFlush;
    window.fxTierFlush = function () {
      if (window.__fxQueue.length) {
        var f = window.__fxQueue.shift();
        try { f(); } catch (e) { window.__fxErr = String(e); }
      }
      return origFlush.apply(this, arguments);
    };
    return true;
  })()`);

  /**
   * 打一次并采样：返回顿帧 / 屏震 / 闪白 的实测值
   * @param {string} cls normal | elite | boss
   * @param {number} dmg 注入伤害
   */
  const probe = async (cls, dmg, noHitStop) => {
    // 0) 可选：临时关掉顿帧，单独量"闪白真实墙钟时长"（顿帧会把模拟时间按 0.16× 拉慢，混在一起量不准）
    if (noHitStop) await ev("(function(){ HITSTOP_CONFIG.enabled = false; return true; })()");
    // 1) 固定机位 + 唯一目标，保证三次截图同机位
    await ev(`(function(){
      var d = window.__roamDebug;
      d.centerPlayer();
      d.despawnAll();
      state.shake.time = 0; state.shake.power = 0; state.shake.dur = 0;
      state.hitStop = 0;
      var id = d.spawnEnemy('wanderer', 150, -40);
      var e = state.enemies[state.enemies.length - 1];
      e.elite = ${cls === 'elite' ? 'true' : 'false'};
      e.isBoss = ${cls === 'boss' ? 'true' : 'false'};
      e.hpMax = 99999; e.hp = 99999;
      e.aiV2 = null;
      window.__probeEnemy = e;
      return { id: id, count: state.enemies.length, x: e.x, y: e.y };
    })()`);
    await sleep(120);

    // 2) 注入 + 逐帧采样放在同一个页面内 promise 里：
    //    否则 CDP 往返 ~20ms，等"命中生效"的这段时间足够把 40ms 的顿帧吃掉一半。
    const sample = await ev(`new Promise(function(resolve){
      var e = window.__probeEnemy;
      var rec = {
        hitStopPeak: 0, hitStopMs: 0, simRatioMin: 1,
        flashPeak: 0, flashMs: 0,
        shakePeak: 0, shakeDur: 0, frames: 0
      };
      var hitStart = -1, hitEnd = -1, flashStart = -1, flashEnd = -1;
      var flashSimMs = 0, hitStopSimMs = 0, lastElapsed = state.elapsed;
      var ang = Math.atan2(e.y - state.player.y, e.x - state.player.x);
      var t0 = performance.now();
      /* 本帧 flush 前注入一次真实伤害，走完整分级链路 */
      window.__fxQueue.push(function(){ damageEnemy(e, ${dmg}, ang); });
      function step(){
        var now = performance.now();
        rec.frames += 1;
        /* 用游戏时钟的增量统计"游戏时间可见时长"：无头环境帧率不稳定，
           用墙钟采样会有 ±1 帧的量化误差，游戏时间才是参数真正约束的量 */
        var dSim = Math.max(0, state.elapsed - lastElapsed);
        lastElapsed = state.elapsed;
        var hs = state.hitStop || 0;
        if (hs > rec.hitStopPeak) rec.hitStopPeak = hs;
        if (hs > 0 && hitStart < 0) hitStart = now;
        if (hs <= 0 && hitStart >= 0 && hitEnd < 0) hitEnd = now;
        if (hs > 0) hitStopSimMs += dSim;
        var ratio = (state.feel && state.feel.simDtRatio) || 1;
        if (ratio < rec.simRatioMin) rec.simRatioMin = ratio;
        if (e && e.flash > 0) {
          if (flashStart < 0) flashStart = now;
          flashEnd = now;
          flashSimMs += dSim;
          if (e.flash > rec.flashPeak) rec.flashPeak = e.flash;
        }
        if (state.shake.power > rec.shakePeak) rec.shakePeak = state.shake.power;
        if (state.shake.dur > rec.shakeDur) rec.shakeDur = state.shake.dur;
        if (now - t0 < 520) requestAnimationFrame(step);
        else {
          rec.hitStopMs = (hitStart >= 0 && hitEnd > 0) ? Math.round(hitEnd - hitStart) : 0;
          rec.flashMs = (flashStart >= 0 && flashEnd > 0) ? Math.round(flashEnd - flashStart + 16) : 0;
          rec.flashSimMs = Math.round(flashSimMs * 1000);
          rec.hitStopSimMs = Math.round(hitStopSimMs * 1000);
          rec.requestedMs = Math.round((HITSTOP_STATS.lastRequest || 0) * 1000);
          rec.lastHitStopMs = (state.feel && state.feel.lastHitStopMs) || 0;
          rec.shakeLastPeak = SHAKE_STATS.lastPeak || 0;
          rec.shakeLastDur = SHAKE_STATS.lastDur || 0;
          // 主文件没有 enemyClassRank（那是候选副本新增的分档函数），这里做类型保护，
          // 否则 rAF 回调抛 ReferenceError 会让整个 promise 永不 resolve（表现为探针卡死）
          var rank = (typeof enemyClassRank === 'function')
            ? enemyClassRank(e)
            : (e.isBoss ? 2 : (e.elite ? 1 : 0));
          rec.flags = { elite: !!e.elite, boss: !!e.isBoss, rank: rank };
          resolve(rec);
        }
      }
      requestAnimationFrame(step);
    })`);

    // 4) 闪白峰值帧截图：把 flash 顶到最大值保持不动，只为截图（不改逻辑时长）
    await ev(`(function(){ var e = window.__probeEnemy; if (e) e.flash = 9; return true; })()`);
    await sleep(140);
    await shot('hit_' + cls + '.png');
    await ev(`(function(){ var e = window.__probeEnemy; if (e) e.flash = 0; return true; })()`);
    await sleep(80);

    const lastHit = await ev("(function(){ return state.lastHit || null; })()");
    if (noHitStop) await ev("(function(){ HITSTOP_CONFIG.enabled = true; return true; })()");
    return { cls: cls, dmg: dmg, lastHit: lastHit, sample: sample, err: await ev("window.__fxErr || null") };
  };

  // 固定机位战斗全景（6 怪 + 玩家）
  await ev(`(function(){
    var d = window.__roamDebug;
    d.centerPlayer();
    d.despawnAll();
    ['wanderer', 'warden', 'wanderer', 'warden', 'wanderer', 'warden'].forEach(function (id, i) {
      var a = Math.PI * 2 * i / 6;
      d.spawnEnemy(id, Math.cos(a) * 140, Math.sin(a) * 110);
    });
    return state.enemies.length;
  })()`);
  await sleep(300);
  await shot('scene.png');

  const rows = [];
  rows.push(await probe('normal', 10));   // 轻击：伤害 < 20
  rows.push(await probe('elite', 10));    // 精英：同一伤害，只有敌档不同
  rows.push(await probe('boss', 10));     // 首领：同一伤害
  rows.push(await probe('normal', 40));   // 重击（伤害 ≥ 20）
  rows.push(await probe('normal', 10, true)); // 关顿帧单量闪白墙钟时长

  const report = {
    when: new Date().toISOString(),
    file: FILE,
    bytes: fs.statSync(FILE).size,
    rows: rows
  };
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.rows.map((r) => ({
    cls: r.cls, dmg: r.dmg,
    requestMs: r.sample.requestedMs, feelMs: r.sample.lastHitStopMs, flags: r.sample.flags,
    hitStopPeak: +r.sample.hitStopPeak.toFixed(3), hitStopMs: r.sample.hitStopMs,
    simRatioMin: r.sample.simRatioMin,
    shakePeak: +r.sample.shakePeak.toFixed(2), shakeDur: +r.sample.shakeDur.toFixed(2),
    flashPeak: +r.sample.flashPeak.toFixed(3), flashMs: r.sample.flashMs,
    flashSimMs: r.sample.flashSimMs, hitStopSimMs: r.sample.hitStopSimMs
  })), null, 2));

  ws.close();
  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
