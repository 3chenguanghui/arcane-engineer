/* ============================================================
   角色 / 怪物"真实屏幕尺寸"量具（端口 9471）
   ------------------------------------------------------------
   用途：给 3D sprite 管线定尺寸。只读，不写主文件。
   口径：
     1) 用游戏内同一套绘制函数（__roamDebug.unitSilhouetteAt）在 256px 离屏
        画布上量"原生像素包围盒"，所以量到的是绘制坐标，不含屏幕缩放；
     2) 屏幕像素 = 原生包围盒 × camZoom × dpr（dpr 取当前档位封顶值）；
     3) 同时输出 WebGL 可用性，用于判断无头渲染能不能跑。
   用法：node tools/arcane_sprite_probe.js
   输出：JSON 打印 + .screenshots/sprite-probe.json
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9471;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 起一个无头 Edge 并打开主文件，返回 CDP 通道
 * @returns {Promise<{ws:WebSocket, send:Function, close:Function}>} CDP 句柄
 */
async function openGame() {
  const profile = path.join(os.tmpdir(), 'arcane-sprite-probe-' + process.pid);
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, { resolve, reject });
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const close = async () => {
    try { ws.close(); } catch (e) { /* ignore */ }
    try { edge.kill(); } catch (e) { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  };
  return { send, close };
}

/**
 * 在页面里求值并返回 JSON
 * @param {Function} send CDP send
 * @param {string} expr 表达式
 * @returns {Promise<any>} 求值结果（JSON 反序列化后）
 */
async function evalJson(send, expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { send, close } = await openGame();
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    // 等调试口就绪
    let ready = false;
    for (let i = 0; i < 120; i += 1) {
      ready = await evalJson(send, "typeof window.__roamDebug === 'object' && typeof window.__roamDebug.unitSilhouetteAt === 'function'");
      if (ready) break;
      await sleep(250);
    }
    if (!ready) throw new Error('__roamDebug 未就绪');

    const report = await evalJson(send, `(() => {
      const D = window.__roamDebug;
      const audit = (typeof D.renderAudit === 'function') ? D.renderAudit() : null;
      const keys = ['player', 'assembler', 'welder', 'riveter', 'patrol', 'crawler', 'graveter', 'runesprite'];
      const out = {};
      keys.forEach((k) => {
        const m = D.unitSilhouetteAt(k, 256);
        if (!m) { out[k] = null; return; }
        out[k] = {
          bboxNative: m.natural ? m.natural.bbox : null,
          aspect: m.aspect.raw ? m.aspect.raw : m.aspect,
          fill: m.fill,
          complexity: m.complexity
        };
      });
      let gl = null;
      try {
        const c = document.createElement('canvas');
        const g2 = c.getContext('webgl2');
        gl = g2 ? { webgl2: true, renderer: (() => {
          const ext = g2.getExtension('WEBGL_debug_renderer_info');
          return ext ? g2.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g2.getParameter(g2.RENDERER);
        })() } : { webgl2: false, renderer: null };
      } catch (e) { gl = { webgl2: false, error: String(e) }; }
      return {
        view: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        audit,
        units: out,
        gl
      };
    })()`);

    const zoom = report.audit ? report.audit.camZoom : 1;
    const dpr = Math.min(report.view.dpr, 2.0);
    const rows = Object.entries(report.units).map(([k, v]) => {
      if (!v || !v.bboxNative) return { key: k, missing: true };
      const bw = v.bboxNative.w;
      const bh = v.bboxNative.h;
      return {
        key: k,
        nativeW: bw, nativeH: bh,
        screenW1x: Number((bw * zoom).toFixed(1)),
        screenH1x: Number((bh * zoom).toFixed(1)),
        screenW2x: Number((bw * zoom * dpr).toFixed(1)),
        screenH2x: Number((bh * zoom * dpr).toFixed(1))
      };
    });

    const final = {
      generatedAt: new Date().toISOString(),
      file: FILE,
      view: report.view,
      camZoom: zoom,
      dprCapUsed: dpr,
      gl: report.gl,
      units: rows
    };
    const outFile = path.join(OUT_DIR, 'sprite-probe.json');
    fs.writeFileSync(outFile, JSON.stringify(final, null, 2), 'utf8');
    console.log(JSON.stringify(final, null, 2));
  } finally {
    await close();
  }
}

main().catch((e) => { console.error('PROBE FAIL:', e.message); process.exit(1); });
