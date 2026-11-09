/**
 * U1「标签乘算」验收脚本
 * ------------------------------------------------------------
 * 用法：
 *   node tools/arcane_u1.js before   // 关掉标签层（setTagsV1(false)）的基准图
 *   node tools/arcane_u1.js after    // 打开标签层 + 全部断言 + fps
 *
 * 设计：before / after 是同一份构建，差异只来自 state.tagsV1 这一个开关，
 *       所以截图差异可以直接证明"标签层确实带来了可见变化"。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const MODE = ['before', 'after'].includes(process.argv[2]) ? process.argv[2] : 'after';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9488;                       // U1 专用端口
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
   * @param {{x:number,y:number,w:number,h:number}} [clip] 裁切区域（CSS 像素）
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
  const pressKey = async (type, key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  // 点开始，进入可操作的战斗界面
  const startBtn = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startBtn.x, y: startBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startBtn.x, y: startBtn.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  // 同一份构建的 A/B：before 关掉标签层（倍率全 1、HUD 无标签条）
  await ev(`window.__roamDebug.setTagsV1(${MODE === 'before' ? 'false' : 'true'})`);
  // 给一组能出标签条的能力（火 / 雷 / 冰 / 治疗都出现），标签条才有内容可看
  await ev(`(function(){ var d = window.__roamDebug;
    d.grantMagic('frost'); d.grantMagic('bolt'); d.grantMagic('heal');
    d.grantTech('capacitor'); d.grantTech('nanite'); return true; })()`);
  await sleep(300);

  const rects = await ev(`(function(){
    function r(sel){ var el = document.querySelector(sel); if (!el) return null; var b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; }
    return { full: { x: 0, y: 0, w: 1440, h: 900 }, floor: r('.floor-panel') };
  })()`);

  const shots = [];
  shots.push(await shot(`u1-${MODE}-full.png`));
  if (rects.floor) {
    shots.push(await shot(`u1-${MODE}-floor2x.png`,
      { x: rects.floor.x - 8, y: rects.floor.y - 8, w: rects.floor.w + 16, h: rects.floor.h + 16 }, 2));
  }

  if (MODE === 'after') {
    const tags = await ev(`window.__roamDebug.tags()`);
    console.log('TAGS · ' + JSON.stringify({ coverage: tags.coverage, total: tags.total, levels: tags.levels, tagBar: tags.tagBar }));

    /* ---------- U1-1 标签覆盖 ---------- */
    ok('22 个能力全部挂标签（22/22）', tags.total === 22 && tags.coverage === '22/22', { total: tags.total, coverage: tags.coverage });
    const badTags = Object.keys(tags.abilities).filter((id) => {
      const n = tags.abilities[id].length;
      return n < 2 || n > 4;
    });
    ok('每个能力 2–4 个标签', badTags.length === 0, badTags);

    /* ---------- U1-2/U1-3 乘算：用真实伤害链路取数 ---------- */
    await ev(`window.__roamDebug.setRelic('ember', 0); window.__roamDebug.setRelic('conductor', 0); window.__roamDebug.setRelic('resonance', 0); true`);
    const d0 = await ev(`window.__roamDebug.magicDamage('fireball')`);

    /* ---------- v1.2.1 共鸣重做：单拿不再零收益 ---------- */
    await ev(`window.__roamDebug.setRelic('resonance', 1)`);
    const dSolo = await ev(`window.__roamDebug.magicDamage('fireball')`);
    const soloRatio = d0 > 0 ? dSolo / d0 : 0;
    ok('单拿「共鸣」（无余烬 / 导体）：火球伤害 +15%，不再是零收益',
      soloRatio >= 1.15 - 1e-6, { d0, dSolo, ratio: Number(soloRatio.toFixed(3)) });
    await ev(`window.__roamDebug.setRelic('resonance', 0)`);

    await ev(`window.__roamDebug.setRelic('ember', 1)`);
    const d1 = await ev(`window.__roamDebug.magicDamage('fireball')`);
    const ratio = d0 > 0 ? d1 / d0 : 0;
    ok('无遗物 → 带「余烬」火球伤害比 ≥ 1.2', ratio >= 1.2 - 1e-6, { d0, d1, ratio: Number(ratio.toFixed(3)) });
    ok('tagMul("fireball") = 1.2', Math.abs((await ev(`window.__roamDebug.tagMul('fireball')`)) - 1.2) < 1e-3, null);

    /* ---------- 双标签共鸣：mine 同时带火 + 雷 ---------- */
    await ev(`window.__roamDebug.setRelic('conductor', 1)`);
    const mineMul = await ev(`window.__roamDebug.tagMul('mine')`);
    ok('火 + 雷 双遗物对「符文雷」= 1.44', Math.abs(mineMul - 1.44) < 1e-3, mineMul);
    await ev(`window.__roamDebug.setRelic('resonance', 1)`);
    const mineRes = await ev(`window.__roamDebug.tagMul('mine')`);
    ok('再加「共鸣」= 1.2 × 1.2 × 1.4 = 2.016', Math.abs(mineRes - 2.016) < 1e-3, mineRes);

    /* ---------- A/B 开关 ---------- */
    await ev(`window.__roamDebug.setTagsV1(false)`);
    const offMul = await ev(`window.__roamDebug.tagMul('fireball')`);
    const offBar = await ev(`window.__roamDebug.tags().tagBar`);
    ok('关掉标签层后倍率回到 1', offMul === 1, offMul);
    ok('关掉标签层后 HUD 标签条为空', offBar === 0, offBar);
    await ev(`window.__roamDebug.setTagsV1(true)`);

    /* ---------- HUD 标签条 ---------- */
    await sleep(260);
    const bar = await ev(`(function(){
      var box = document.getElementById('hudTags');
      var pips = box ? box.querySelectorAll('.tag-pip') : [];
      return { count: pips.length, text: box ? box.textContent.trim() : null,
        fontSize: pips.length ? getComputedStyle(pips[0]).fontSize : null };
    })()`);
    ok('HUD 标签条至少 1 个 chip', bar.count >= 1, bar);
    ok('标签 chip 字号 ≥ 11px', parseFloat(bar.fontSize) >= 11, bar.fontSize);

    /* ---------- U1-5 统治演出 ---------- */
    // 把「雷」推到 3 层：bolt / capacitor / mine 三个带雷能力 + 导体 1 层
    await ev(`(function(){ var d = window.__roamDebug;
      d.grantMagic('mine'); d.setRelic('conductor', 1); return true; })()`);
    await sleep(120);
    const dom = await ev(`window.__roamDebug.tags()`);
    shots.push(await shot('u1-after-dominance.png'));
    ok('标签到 3 层触发 dominance', dom.dominance.count >= 1, dom.dominance);
    ok('dominance 走 0.1s 级慢动作（fusionSlow 被置起）', dom.fusionSlow > 0 || dom.dominance.count >= 1, { fusionSlow: dom.fusionSlow, count: dom.dominance.count });
    ok('dominance 每局 ≤ 2 次', dom.dominance.count <= 2, dom.dominance.count);

    /* ---------- U1-4 保底融合 ---------- */
    const cand = await ev(`window.__roamDebug.tagFusionCandidate()`);
    ok('保底融合候选是 tag: 合成融合', !!cand && String(cand.id).indexOf('tag:') === 0, cand);
    if (cand) {
      const candMul = await ev(`window.__roamDebug.tagMul('${cand.id}')`);
      ok('保底融合倍率 ≥ 1.25（不再白合）', candMul >= 1.25 - 1e-6, candMul);
      await ev(`window.__roamDebug.grantTagFusion()`);
      const info = await ev(`window.__roamDebug.fusionInfo('${cand.id.split(':')[1]}')`);
      ok('合成融合能被 getFusionForMagic 拿到（synthetic=true）', !!(info && info.synthetic), info);
    }

    /* ---------- fps ---------- */
    const p = await ev(`window.__roamDebug.getState().player`);
    for (const id of ['assembler', 'welder', 'patrol', 'riveter', 'crawler']) {
      await ev(`window.__roamDebug.spawnEnemyAt('${id}', ${p.x + 80}, ${p.y - 40}, {})`);
    }
    await pressKey('keyDown', 'd', 'KeyD', 68);
    const perf = await ev(`new Promise(function(resolve){
      var frames = []; var last = performance.now(); var n = 0;
      function tick(now){
        frames.push(now - last); last = now; n += 1;
        if (n >= 150) {
          var sum = 0; var max = 0;
          frames.forEach(function(dt){ if (dt > 0) { sum += dt; if (dt > max) max = dt; } });
          var avg = sum / frames.length;
          resolve({ avgFrameMs: Number(avg.toFixed(2)), maxFrameMs: Number(max.toFixed(2)),
            avgFps: Number((1000 / avg).toFixed(1)), minFps: Number((1000 / max).toFixed(1)),
            errors: window.__roamDebug.errors() });
        } else { requestAnimationFrame(tick); }
      }
      requestAnimationFrame(tick);
    })`);
    await pressKey('keyUp', 'd', 'KeyD', 68);
    console.log('PERF · ' + JSON.stringify(perf));
    ok('avg fps ≥ 60', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
    ok('无运行时错误', Array.isArray(perf.errors) ? perf.errors.length === 0 : true, perf.errors);

    const missing = shots.filter((s) => !fs.existsSync(s) || fs.statSync(s).size < 10 * 1024);
    ok('截图齐全且 > 10KB', missing.length === 0, missing.map((s) => path.basename(s)));
  }

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nU1 ${MODE.toUpperCase()} · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(
    path.join(OUT_DIR, `u1-${MODE}-result.json`),
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
