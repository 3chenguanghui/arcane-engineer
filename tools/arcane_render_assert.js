// 第 8 轮 · 渲染断言（防"玩家双份/放大虚影"与"房间只剩线框"复发）
// 覆盖：①每帧玩家绘制次数必须 = 1；②绘制入口缩放必须 = dpr × cameraZoom；
//       ③每间已探索房间的地板像素覆盖率/纹理度达标；④连续 5 层各取样一次。
// 用法：node tools\arcane_render_assert.js *> RENDERBUG_assert.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9679;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'renderbug');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
/** 记录一条断言结果并打印（成功/失败同格式，便于日志检索） */
function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} · ${name}` + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1024,444', 'about:blank'
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
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map(); const errors = [];
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
  await send('Runtime.enable'); await send('Page.enable');
  // 用用户截图同比例的口径：1024×444（DSF=1）
  await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 444, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1500);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(700);
  await ev(`(() => { state.onboardSkipAll = true; try { hideIntroHint(true); } catch (e) {} return true; })()`);

  const floors = [1, 2, 3, 4, 5];
  for (const f of floors) {
    await ev(`(() => { window.__roamDebug.setFloor(${f}); window.__roamDebug.centerPlayer(); return true; })()`);
    await sleep(450);

    // ① + ②：连续采样 30 帧，逐帧检查玩家绘制次数与入口缩放
    const draw = await ev(`(async () => {
      const samples = [];
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        samples.push(window.__roamDebug.renderAudit());
      }
      const bad = samples.filter((s) => s.playerDraws !== 1);
      const scaleBad = samples.filter((s) => Math.abs(s.scale - s.dpr * s.camZoom) > 0.02);
      return {
        frame: samples.length,
        drawsUnique: Array.from(new Set(samples.map((s) => s.playerDraws))),
        scaleUnique: Array.from(new Set(samples.map((s) => s.scale))),
        camZooms: Array.from(new Set(samples.map((s) => s.camZoom))),
        dpr: samples[0] ? samples[0].dpr : null,
        badDraw: bad.length,
        badScale: scaleBad.length,
        lastScale: samples.length ? samples[samples.length - 1].scale : null,
        excessLog: samples.length ? samples[samples.length - 1].log : []
      };
    })()`);
    ok(`F${f} · 玩家每帧只绘制 1 次`, draw.badDraw === 0 && draw.drawsUnique.length === 1 && draw.drawsUnique[0] === 1,
      { drawsUnique: draw.drawsUnique, badDraw: draw.badDraw, samples: draw.frame });
    ok(`F${f} · 玩家绘制缩放无异常（= dpr × camZoom）`, draw.badScale === 0,
      { dpr: draw.dpr, camZoom: draw.camZooms, scale: draw.scaleUnique, badScale: draw.badScale });

    // ③：已探索房间地板覆盖（不是只剩线框）
    const cover = await ev(`(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cam = state.cam;
      const z = cameraZoom();
      const vw = state.viewW || window.innerWidth;
      const vh = state.viewH || window.innerHeight;
      const g = canvas.getContext('2d');
      const rooms = (state.rooms || []).filter((r) => r.visited);
      const out = [];
      rooms.forEach((room) => {
        const sx = (room.cx - room.w / 2 - cam.x) * z;
        const sy = (room.cy - room.h / 2 - cam.y) * z;
        const sw = room.w * z;
        const sh = room.h * z;
        const x0 = Math.max(6, sx + 26);
        const y0 = Math.max(6, sy + 26);
        const x1 = Math.min(vw - 6, sx + sw - 26);
        const y1 = Math.min(vh - 6, sy + sh - 26);
        if (x1 - x0 < 60 || y1 - y0 < 60) return;   // 可视面积太小不计
        const rx = Math.round(x0 * dpr);
        const ry = Math.round(y0 * dpr);
        const rw = Math.max(1, Math.round((x1 - x0) * dpr));
        const rh = Math.max(1, Math.round((y1 - y0) * dpr));
        const data = g.getImageData(rx, ry, Math.min(rw, canvas.width - rx), Math.min(rh, canvas.height - ry)).data;
        let lit = 0; let total = 0;
        const BUCKETS = 16;
        const hist = new Array(BUCKETS).fill(0);
        for (let y = 0; y < rh; y += 2) {
          for (let x = 0; x < rw; x += 2) {
            const i = (y * rw + x) * 4;
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (lum >= 14) lit += 1;
            hist[Math.min(BUCKETS - 1, Math.floor(lum / (256 / BUCKETS)))] += 1;
            total += 1;
          }
        }
        // 亮度层次：地板是"中间调为主 + 高低光点缀"，只剩线框的房间会退化到 2~3 档
        const tones = hist.filter((n) => n / Math.max(1, total) >= 0.01).length;
        out.push({
          room: room.id, type: room.type,
          visible: Number((lit / Math.max(1, total)).toFixed(3)),
          tones,
          px: rw + 'x' + rh
        });
      });
      return out;
    })()`);
    if (cover.length) {
      const minVis = Math.min(...cover.map((c) => c.visible));
      const minTones = Math.min(...cover.map((c) => c.tones));
      ok(`F${f} · 已探索房间地板覆盖率 ≥ 0.55（不是只剩线框）`, minVis >= 0.55, { rooms: cover, minVis });
      ok(`F${f} · 已探索房间有亮度层次（≥ 5 档，证明地板有明暗而非纯黑线框）`, minTones >= 5, { minTones });
    } else {
      console.log(`SKIP · F${f} · 没有足够大的已探索房间（可视面积 < 60×60）`);
    }
    await shot(`assert-F${f}.png`);
  }

  ok('运行期无页面异常', errors.length === 0, errors.slice(0, 4));
  const failed = results.filter((r) => !r.pass);
  console.log(`RESULT: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length})`);
  ws.close(); killEdge(edge); process.exit(failed.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
