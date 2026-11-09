// P6 专项验收：家具体积（三层明暗 + 45° 俯视偏移，像素采样 ΔL ≥ 18）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9537;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p6volume');

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
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
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
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);

  // ---- 1) 配置与覆盖范围 ----
  const info = await ev('__roamDebug.volume.info()');
  check('体积配置默认开启', info.config.enabled === true, { enabled: info.config.enabled });
  check('覆盖全部 7 类家具（装置 / 箱子 / 台面 / 凳子）',
    info.kinds.length >= 7,
    info.kinds.map((k) => k.kind));

  // ---- 2) 逐类像素采样：顶面 vs 侧面 / 投影 ----
  const probes = await ev('__roamDebug.volume.probeAll()');
  probes.forEach((p) => {
    check(`三层明度差 · ${p.label}（ΔL 顶/侧 ${p.dTopSide}，顶/影 ${p.dTopShadow}）`,
      p.pass === true && p.top > p.side && p.top > p.shadow,
      { top: p.top, side: p.side, shadow: p.shadow, dTopSide: p.dTopSide, dTopShadow: p.dTopShadow, depth: p.depth });
  });
  check('偏移量都在 4–9px（小物件自动收敛，45° 斜向）',
    probes.every((p) => p.depth >= 4 && p.depth <= 9),
    probes.map((p) => p.depth));

  // ---- 3) A/B：关闭后回到单层平涂，三档消失 ----
  const off = await ev(`(() => {
    __roamDebug.volume.set({ enabled: false });
    return { probes: __roamDebug.volume.probeAll(), config: __roamDebug.volume.info().config };
  })()`);
  check('A/B 关闭：所有家具退回单层平涂（不再满足 ΔL ≥ 18）',
    off.probes.every((p) => p.pass === false),
    off.probes.map((p) => ({ kind: p.kind, dTopSide: p.dTopSide, dTopShadow: p.dTopShadow })));
  const backOn = await ev(`(() => {
    __roamDebug.volume.set({ enabled: true });
    return __roamDebug.volume.probeAll();
  })()`);
  check('A/B 重新开启：全部家具恢复三层体积',
    backOn.every((p) => p.pass === true),
    backOn.map((p) => ({ kind: p.kind, dTopSide: p.dTopSide })));

  // ---- 4) 真场景 before/after（机械层装配间：平台 / 料箱 / 传送带 / 配电柜） ----
  await ev(`__roamDebug.volume.set({ enabled: false }); __roamDebug.setFloor(1); true`);
  await sleep(1400);
  const room = await ev(`(() => {
    const st = __roamDebug.getState();
    const rooms = st.rooms || [];
    const r = rooms.find((x) => x.variant === 0) || rooms[0];
    let moved = __roamDebug.teleport(r.cx, r.cy);
    if (!moved) moved = __roamDebug.teleport(r.cx - 40, r.cy);
    return { id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, variant: r.variant, moved,
      cam: __roamDebug.getState().cam, mode: __roamDebug.getState().mode };
  })()`);
  await sleep(800);
  await shot('furniture-flat.png');
  check('机械层装配间就位（before 截图已拍）',
    room.mode === 'playing' && room.w > 0 && room.h > 0,
    { room: { id: room.id, variant: room.variant, w: room.w, h: room.h }, cam: room.cam });

  await ev(`__roamDebug.volume.set({ enabled: true }); __roamDebug.teleport(${room.x + room.w * 0.5}, ${room.y + room.h * 0.5}); true`);
  await sleep(800);
  await shot('furniture-volume.png');
  check('重烘焙后场景仍在游戏态（after 截图已拍）',
    (await ev('__roamDebug.getState().mode')) === 'playing',
    { mode: await ev('__roamDebug.getState().mode') });

  // ---- 5) 截图文件确实落盘 ----
  const flatSize = fs.existsSync(path.join(OUT, 'furniture-flat.png')) ? fs.statSync(path.join(OUT, 'furniture-flat.png')).size : 0;
  const volSize = fs.existsSync(path.join(OUT, 'furniture-volume.png')) ? fs.statSync(path.join(OUT, 'furniture-volume.png')).size : 0;
  check('before/after 截图都已落盘（> 100KB）',
    flatSize > 100000 && volSize > 100000, { flatSize, volSize });

  const errs = await ev('__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'p6-result.json'), JSON.stringify({ pass, total: results.length, results }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
