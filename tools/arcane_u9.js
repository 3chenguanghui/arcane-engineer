/**
 * U9「标题屏减法 + 动态背景 + 情境提示」验收脚本（端口 9497）
 * 用法：
 *   node tools/arcane_u9.js before   // 只截改版前的标题屏（用于对照）
 *   node tools/arcane_u9.js          // 跑全部断言
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9497;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const MODE = process.argv[2] === 'before' ? 'before' : 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
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
    } catch (e) { /* 等 Edge */ }
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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2000);

  if (MODE === 'before') {
    const p = await shot('u9-title-before.png');
    const size = fs.statSync(p).size;
    console.log('BEFORE 截图：' + p + ' · ' + size + 'B');
    try { ws.close(); } catch (e) { /* 忽略 */ }
    killEdge(edge);
    return;
  }

  // ---------- 1. 标题屏减法：引导 0 条，核心保留 ----------
  const t0 = await ev(`(function(){
    var q = function(s){ return document.querySelectorAll(s).length; };
    var vis = function(s){ var el = document.querySelector(s); if (!el) return false;
      var r = el.getBoundingClientRect(); var cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
    return {
      guideItems: q('.title-guide .guide-item'),
      themesVisible: vis('.title-themes'),
      hasH1: vis('.title-card h1'),
      hasTagline: vis('.title-tagline'),
      hasStart: vis('#btnStart'),
      difficulties: q('.difficulty-mode'),
      stats: q('.title-stat'),
      sigil: !!document.querySelector('.title-sigil'),
      sigilClip: (function(){ var el = document.querySelector('.title-sigil');
        return el ? getComputedStyle(el).clipPath : null; })(),
      bgCanvas: !!document.getElementById('titleBg'),
      bgSize: (function(){ var c = document.getElementById('titleBg');
        return c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null; })()
    };
  })()`);
  ok('首屏引导已清零（0 条键位说明 / 主题介绍不可见）',
    t0.guideItems === 0 && t0.themesVisible === false,
    { guideItems: t0.guideItems, themesVisible: t0.themesVisible });
  ok('标题核心保留（标题 / 标语 / 开始 / 3 档难度 / 3 项统计）',
    t0.hasH1 && t0.hasTagline && t0.hasStart && t0.difficulties === 3 && t0.stats === 3,
    { h1: t0.hasH1, tagline: t0.hasTagline, start: t0.hasStart, diff: t0.difficulties, stats: t0.stats });
  ok('母题六边星存在且用 clip-path 绘制',
    t0.sigil === true && /polygon/.test(t0.sigilClip || ''),
    { sigil: t0.sigil, clipPath: t0.sigilClip });
  ok('动态背景 canvas 存在且有尺寸',
    t0.bgCanvas === true && t0.bgSize && t0.bgSize.cw > 300 && t0.bgSize.ch > 300,
    t0.bgSize);

  // ---------- 2. 背景在动：两帧像素哈希不同 ----------
  /**
   * 取标题背景的整图像素指纹（单点采样会漏掉 1px 线条，改用整图 dataURL 尾部）
   * @returns {Promise<string>} 像素指纹
   */
  const hashTitleBg = () => ev(`window.__roamDebug.titleBgHash()`);
  const bgA = await hashTitleBg();
  await sleep(420);
  const bgB = await hashTitleBg();
  ok('背景真的在动（420ms 两帧像素指纹不同）', bgA !== 'none' && bgA !== bgB, { a: bgA.slice(0, 40), b: bgB.slice(0, 40) });

  const bgStats = await ev(`window.__roamDebug.titleBgStats()`);
  ok('背景四层齐全（双符文环 / ≥40 微粒 / 主角剪影）',
    bgStats && bgStats.rings === 2 && bgStats.particles >= 40 && bgStats.silhouette === true && bgStats.running === true,
    bgStats);

  const titleShot = await shot('u9-title-after.png');
  ok('after 截图已生成（>10KB）', fs.statSync(titleShot).size > 10 * 1024, fs.statSync(titleShot).size);

  // ---------- 3. 首局三步提示 ----------
  await ev(`window.__roamDebug.clearHints()`);
  const btn = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await sleep(900);

  const hintDom = () => ev(`(function(){
    var el = document.getElementById('contextHint');
    if (!el) return { exists: false };
    var cs = getComputedStyle(el); var r = el.getBoundingClientRect();
    return { exists: true, text: el.innerText, visible: cs.display !== 'none' && cs.opacity !== '0' && r.height > 0,
      hidden: el.classList.contains('hidden') };
  })()`);
  const h1 = await hintDom();
  ok('首局情境提示出现（含 WASD 移动）',
    h1.exists && h1.visible && h1.text.indexOf('WASD') >= 0,
    h1);

  await sleep(5200);
  const h2 = await hintDom();
  ok('提示按时推进到「施法」', h2.visible && h2.text.indexOf('施法') >= 0, h2);

  await sleep(5200);
  const h3 = await hintDom();
  ok('提示按时推进到「影步」', h3.visible && h3.text.indexOf('影步') >= 0, h3);
  const hintShot = await shot('u9-context-hint.png');

  // ---------- 4. 一次性：hintsSeen 写存 ----------
  // 三步到 15s 才收尾；前面 sleep 是墙钟时间，state.elapsed 会略慢一点，这里留 1.5s 余量
  await sleep(4600);
  const seen = await ev(`window.__roamDebug.u9Audit().hintsSeen`);
  ok('三步走完后 meta.hintsSeen 置位（跨局不再弹）', seen === 1, { hintsSeen: seen });

  // ---------- 5. 靠近楼梯 ----------
  const auditNow = await ev(`window.__roamDebug.u9Audit()`);
  ok('审计接口能读到楼梯 / 宝箱坐标', !!(auditNow.stairs || auditNow.chest), { stairs: auditNow.stairs, chest: auditNow.chest });
  let stairsHint = null;
  if (auditNow.stairs) {
    await ev(`window.__roamDebug.clearEnemies()`);
    // 真实玩法里楼梯要清房后才 active；测试口直接置位，避免依赖敌人清空时序
    await ev(`window.__roamDebug.unlockStairs()`);
    await ev(`window.__roamDebug.teleport(${auditNow.stairs.cx + 20}, ${auditNow.stairs.cy})`);
    await sleep(700);
    stairsHint = await hintDom();
    ok('靠近楼梯提示「按 E 下楼」', stairsHint.visible && stairsHint.text.indexOf('E') >= 0 && stairsHint.text.indexOf('下楼') >= 0, stairsHint);
  } else {
    ok('靠近楼梯提示「按 E 下楼」', false, { reason: '本层无楼梯' });
  }

  // ---------- 6. 靠近宝箱 ----------
  // 首层不一定生成宝箱房：逐层尝试，直到找到一层带 chest 的图
  let chestRoom = auditNow.chest;
  for (let f = 2; f <= 7 && !chestRoom; f += 1) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    await sleep(400);
    const a = await ev(`window.__roamDebug.u9Audit()`);
    if (a.chest) chestRoom = a.chest;
  }
  if (chestRoom) {
    await ev(`window.__roamDebug.clearEnemies()`);
    await ev(`window.__roamDebug.teleport(${chestRoom.cx + 30}, ${chestRoom.cy})`);
    await sleep(700);
    const chestHint = await hintDom();
    ok('靠近宝箱提示含「宝箱」', chestHint.visible && chestHint.text.indexOf('宝箱') >= 0, chestHint);
  } else {
    ok('靠近宝箱提示含「宝箱」', false, { reason: '1–7 层都没有宝箱房' });
  }

  // ---------- 7. 进入游戏后背景停绘 ----------
  const bgStats2 = await ev(`window.__roamDebug.titleBgStats()`);
  ok('进入游戏后标题背景停止绘制（不占战斗帧）', bgStats2.running === false, bgStats2);

  // ---------- 8. A/B 关闭 ----------
  await ev(`window.__roamDebug.setU9(false)`);
  await sleep(300);
  const off = await ev(`(function(){
    var q = function(s){ return document.querySelectorAll(s).length; };
    var c = document.getElementById('titleBg');
    return { guideItems: q('.title-guide .guide-item'), themes: q('.title-themes'),
      bgRunning: window.__roamDebug.titleBgStats().running,
      bgVisible: c ? getComputedStyle(c).display !== 'none' : false };
  })()`);
  ok('A/B 关闭：旧版 7 条引导恢复 + 主题介绍恢复 + 背景停绘',
    off.guideItems === 7 && off.themes === 1 && off.bgRunning === false,
    off);

  await ev(`window.__roamDebug.setU9(true)`);
  await sleep(300);
  const back = await ev(`(function(){ return { guideItems: document.querySelectorAll('.title-guide .guide-item').length,
    bgRunning: window.__roamDebug.titleBgStats().running }; })()`);
  ok('A/B 恢复：引导重新清零 + 游戏内背景保持停绘',
    back.guideItems === 0 && back.bgRunning === false, back);

  // ---------- 9. 性能 + 错误 ----------
  const perf = await ev(`new Promise(function(resolve){
    var frames = []; var last = performance.now(); var warm = 0;
    function tick(now){
      var dt = now - last; last = now;
      if (warm < 40) { warm += 1; } else { frames.push(dt); }
      if (frames.length >= 150) {
        var sum = 0; var max = 0;
        frames.forEach(function(d){ if (d > 0) { sum += d; if (d > max) max = d; } });
        resolve({ avgFps: Number((1000 / (sum / frames.length)).toFixed(1)),
          minFps: Number((1000 / max).toFixed(1)), errors: window.__roamDebug.errors() });
      } else { requestAnimationFrame(tick); }
    }
    requestAnimationFrame(tick);
  })`);
  console.log('PERF · ' + JSON.stringify(perf));
  ok('avg fps ≥ 60（进入游戏后）', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
  ok('无运行时错误', perf.errors.length === 0, perf.errors);

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nU9 · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(path.join(OUT_DIR, 'u9-result.json'), JSON.stringify({ passed, total: asserts.length, asserts }, null, 2));

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 150);
});
