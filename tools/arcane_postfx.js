// D 批 · 后处理质感专项验收（泛光 / 色差 / CRT 扫描线 / 暗角）
// 用法：node tools/arcane_postfx.js
// 覆盖：默认开关 / 逐项开与写档 / 刷新记忆 / 画面确实变化（像素签名）/ 低分辨率离屏缓冲 /
//       默认档帧预算硬断言（fps ≥ 55 且平均帧 ≤ 16.7ms）/ before-after 截图 / 零报错
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9564;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'postfx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/** 记录一条断言并打印 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');
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
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const nav = async () => {
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    await sleep(2200);
  };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(r.data, 'base64');
    fs.writeFileSync(path.join(OUT, name), buf);
    return buf.length;
  };

  await nav();
  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);
  await ev("state.player.invuln = 99999; state.player.hp = state.player.hpMax; true");

  /* ---------- 0) 默认开关与存档字段 ---------- */
  const info0 = await ev('window.__roamDebug.postfx.info()');
  check('默认：泛光开 / 色差关 / CRT 关 / 暗角开',
    info0.flags.bloom === true && info0.flags.chroma === false && info0.flags.crt === false
      && info0.flags.vignette === true, info0.flags);
  const saved0 = await ev("JSON.parse(localStorage.getItem('arcane_rogue_meta') || '{}').postfx");
  check('默认四分项写入存档',
    saved0 && saved0.bloom === true && saved0.chroma === false
      && saved0.crt === false && saved0.vignette === true, saved0);

  /* ---------- 1) 画面像素签名（400 点采样，前后可比） ---------- */
  const SIGN_EXPR = `(function(){
    render();
    var c = document.getElementById('game');
    var g = c.getContext('2d');
    var W = c.width, H = c.height;
    var sx = Math.max(1, Math.floor(W / 40)), sy = Math.max(1, Math.floor(H / 10));
    var sum = 0, i = 0;
    for (var y = sy / 2; y < H; y += sy) {
      for (var x = sx / 2; x < W; x += sx) {
        var d = g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        sum += d[0] * 3 + d[1] * 5 + d[2] * 7;
        i += 1;
      }
    }
    return { sig: sum, points: i };
  })()`;
  const allOff = await ev(`window.__roamDebug.postfx.set('bloom', false); window.__roamDebug.postfx.set('chroma', false); window.__roamDebug.postfx.set('crt', false); window.__roamDebug.postfx.set('vignette', false); ${SIGN_EXPR}`);
  const bloomOn = await ev(`window.__roamDebug.postfx.set('bloom', true); ${SIGN_EXPR}`);
  const chromaOn = await ev(`window.__roamDebug.postfx.set('bloom', false); window.__roamDebug.postfx.set('chroma', true); ${SIGN_EXPR}`);
  const crtOn = await ev(`window.__roamDebug.postfx.set('chroma', false); window.__roamDebug.postfx.set('crt', true); ${SIGN_EXPR}`);
  const vigOn = await ev(`window.__roamDebug.postfx.set('crt', false); window.__roamDebug.postfx.set('vignette', true); ${SIGN_EXPR}`);
  check('泛光开启后画面像素签名变化（不只是开关状态变了）',
    bloomOn.sig !== allOff.sig, { off: allOff.sig, bloom: bloomOn.sig });
  check('色差开启后画面像素签名变化', chromaOn.sig !== allOff.sig, { off: allOff.sig, chroma: chromaOn.sig });
  check('CRT 扫描线开启后画面像素签名变化', crtOn.sig !== allOff.sig, { off: allOff.sig, crt: crtOn.sig });
  /* 暗角只压边缘：中心区签名几乎不变，所以单独量"四角压暗"而非整屏签名 */
  const vigEdge = await ev(`(function(){
    var c = document.getElementById('game');
    var g = c.getContext('2d');
    function readCorners(){
      var W = c.width, H = c.height, pad = Math.round(Math.min(W, H) * 0.04);
      var px = [[pad,pad],[W-pad,pad],[pad,H-pad],[W-pad,H-pad]];
      var v = 0;
      px.forEach(function(p){ var d = g.getImageData(p[0], p[1], 1, 1).data; v += d[0] + d[1] + d[2]; });
      return v;
    }
    window.__roamDebug.postfx.set('vignette', false); render();
    var off = readCorners();
    window.__roamDebug.postfx.set('vignette', true); render();
    var on = readCorners();
    return { off: off, on: on, darker: on < off };
  })()`);
  check('暗角开启后四角像素确实变暗（边缘压暗生效）',
    vigOn.sig !== allOff.sig && vigEdge.darker === true, { sig: { off: allOff.sig, vig: vigOn.sig }, edge: vigEdge });

  /* ---------- 2) 低分辨率离屏缓冲（硬约束：重后处理不在主分辨率上跑） ---------- */
  const buf = await ev(`(function(){
    window.__roamDebug.postfx.set('chroma', true); render();
    var c = document.getElementById('game');
    var info = window.__roamDebug.postfx.info();
    return { canvasW: c.width, canvasH: c.height, buffer: info.buffer, stats: info.stats };
  })()`);
  check('后处理缓冲确实是低分辨率（宽 ≤ 主画布 50%）',
    !!buf.buffer && buf.buffer.w <= Math.round(buf.canvasW * 0.5) && buf.buffer.w > 0, buf);
  check('色差逐像素只在低分辨率缓冲上跑（像素数 ≤ 主画布 25%）',
    buf.stats.chromaPx > 0 && buf.stats.chromaPx <= Math.round(buf.canvasW * buf.canvasH * 0.25),
    { chromaPx: buf.stats.chromaPx, mainPx: buf.canvasW * buf.canvasH });

  /* ---------- 3) 截图：before（四项全关）/ after（默认：泛光 + 暗角） ---------- */
  await ev(`window.__roamDebug.postfx.set('chroma', false); window.__roamDebug.postfx.set('crt', false); window.__roamDebug.postfx.set('bloom', false); window.__roamDebug.postfx.set('vignette', false); render(); true`);
  const beforeShot = await shot('d-postfx-before.png');
  await ev(`window.__roamDebug.postfx.set('bloom', true); window.__roamDebug.postfx.set('vignette', true); render(); true`);
  const afterShot = await shot('d-postfx-after.png');
  check('before/after 截图都 > 60KB', beforeShot > 60 * 1024 && afterShot > 60 * 1024, { beforeShot, afterShot });

  /* ---------- 4) 刷新后记忆 ---------- */
  await ev(`window.__roamDebug.postfx.set('bloom', false); window.__roamDebug.postfx.set('chroma', true); window.__roamDebug.postfx.set('crt', true); window.__roamDebug.postfx.set('vignette', false); true`);
  const savedBefore = await ev("JSON.parse(localStorage.getItem('arcane_rogue_meta') || '{}').postfx");
  await nav();
  const afterReload = await ev('window.__roamDebug.postfx.info()');
  check('刷新后：四分项开关被记住（泛光关 / 色差开 / CRT 开 / 暗角关）',
    afterReload.flags.bloom === false && afterReload.flags.chroma === true
      && afterReload.flags.crt === true && afterReload.flags.vignette === false,
    { savedBefore, flags: afterReload.flags });

  /* ---------- 5) 性能：开/关对比 + 默认档帧预算硬断言 ---------- */
  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);
  const benchOff = await ev(`window.__roamDebug.postfx.set('bloom', false); window.__roamDebug.postfx.set('chroma', false); window.__roamDebug.postfx.set('crt', false); window.__roamDebug.postfx.set('vignette', false); window.__roamDebug.postfx.bench(120)`);
  const benchDefault = await ev(`window.__roamDebug.postfx.set('bloom', true); window.__roamDebug.postfx.set('vignette', true); window.__roamDebug.postfx.bench(120)`);
  const benchAll = await ev(`window.__roamDebug.postfx.set('chroma', true); window.__roamDebug.postfx.set('crt', true); window.__roamDebug.postfx.bench(120)`);
  console.log('PERF(记录) 后处理 fps：关=' + benchOff.fps + ' 默认(泛光+暗角)=' + benchDefault.fps + ' 全开=' + benchAll.fps);
  /* 第 20 项硬断言：默认档必须 ≥ 55fps 且平均帧 ≤ 16.7ms（不再"只记录不判红"） */
  const defAvgMs = benchDefault.ms / benchDefault.frames;
  check('默认档帧预算：fps ≥ 55 且平均帧 ≤ 16.7ms',
    benchDefault.fps >= 55 && defAvgMs <= 16.7,
    { fps: benchDefault.fps, avgMs: Math.round(defAvgMs * 100) / 100 });

  /* ---------- 6) 总开关关闭时四项全部不生效 ---------- */
  await ev(`window.__roamDebug.postfx.set('bloom', true); window.__roamDebug.postfx.set('chroma', true); window.__roamDebug.postfx.set('crt', true); window.__roamDebug.postfx.set('vignette', true); window.__roamDebug.setPostFx(false); ${SIGN_EXPR}`);
  const masterOff = await ev(`(function(){
    var info = window.__roamDebug.postfx.info();
    return { master: info.master, flags: info.flags, framesBefore: info.stats.frames };
  })()`);
  check('总开关关闭：master=false（四项即使勾选也不付成本）', masterOff.master === false, masterOff);

  /* ---------- 7) 恢复默认并结束 ---------- */
  await ev(`window.__roamDebug.setPostFx(true); window.__roamDebug.postfx.set('bloom', true); window.__roamDebug.postfx.set('chroma', false); window.__roamDebug.postfx.set('crt', false); window.__roamDebug.postfx.set('vignette', true); true`);
  const errs = await ev('window.__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'd-postfx-result.json'), JSON.stringify({
    pass, total: results.length, results,
    benches: { off: benchOff, default: benchDefault, all: benchAll },
    buffer: buf, sigs: { allOff, bloomOn, chromaOn, crtOn, vigOn }, vigEdge
  }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
