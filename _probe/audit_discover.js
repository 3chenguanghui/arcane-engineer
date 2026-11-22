/**
 * 体验审核 · 发现探针（只读，不写主文件）
 * ------------------------------------------------------------
 * 目的：确认运行时可用接口（__roamDebug / state / 相机 / 房间 / HUD DOM），
 *       供后续正式审核探针按实际字段取值，避免猜 API。
 * 用法：node _probe/audit_discover.js
 * 产出：shots/audit/discover.json + shots/audit/discover-title.png + discover-battle.png
 * 约束：Edge headless + CDP，视口 1440×900 dpr=1，临时 profile 落 D:\.temp，结束即删。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-audit-${process.pid}-${Date.now()}`);
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9741;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 找本机 Edge 可执行文件
 * @returns {string} Edge 绝对路径
 */
function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 msedge.exe');
}

/**
 * 计算文件 MD5（大写）
 * @param {string} file 文件路径
 * @returns {string} MD5
 */
function md5File(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(findEdge(), [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /**
   * 页面内执行表达式
   * @param {string} expression JS 表达式
   * @returns {Promise<any>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return { file: name, bytes: fs.statSync(f).size };
  };

  const t0 = Date.now();
  await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(3000);
  const titleShot = await shot('discover-title.png');

  const titleInfo = await ev(`(() => {
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const ids = ['btnStart','btnCharConfirm','introHint','introHintText','introHintSub','toast','onboardHint'];
    const out = {};
    ids.forEach((id) => { const el = document.getElementById(id); out[id] = el ? { visible: vis(el), text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200), rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() } : null; });
    out.debugKeys = window.__roamDebug ? Object.keys(window.__roamDebug) : null;
    return out;
  })()`);

  // 进游戏
  await ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1200);
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  await sleep(2600);
  const battleShot = await shot('discover-battle.png');

  const stateInfo = await ev(`(() => {
    const st = window.state;
    if (!st) return { noState: true };
    const z = (typeof cameraZoom === 'function') ? cameraZoom() : null;
    return {
      mode: st.mode, status: st.status, floor: st.floor,
      cam: st.cam ? { x: Math.round(st.cam.x), y: Math.round(st.cam.y) } : null,
      zoom: z,
      view: { w: st.viewW, h: st.viewH },
      floats: (st.floats || []).length,
      enemies: (st.enemies || []).length,
      rooms: (st.rooms || []).map((r) => ({ id: r.id, type: r.type, cx: Math.round(r.cx), cy: Math.round(r.cy), w: r.w, h: r.h, cleared: !!r.cleared })),
      player: st.player ? { x: Math.round(st.player.x), y: Math.round(st.player.y), hp: st.player.hp, maxHp: st.player.maxHp } : null,
      keys: Object.keys(st).slice(0, 120),
      fnNames: ['openReward','showRewardStage','loseGame','damagePlayer','castPrimary','castDevice','startDash','addFloat','updateHUD','buildRewardOptions','renderDeck','chooseCharacter']
        .filter((n) => typeof window[n] === 'function')
    };
  })()`);

  const domInfo = await ev(`(() => {
    const out = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (/^(script|style|link|meta|canvas)$/i.test(el.tagName)) return;
      let hasText = false;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) hasText = true;
      if (!hasText) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return;
      out.push({ tag: el.tagName.toLowerCase(), cls: el.className && String(el.className).slice(0, 60), id: el.id || '', text: el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80), fs: parseFloat(cs.fontSize), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
    });
    return { count: out.length, items: out };
  })()`);

  const report = {
    sourceBytes: fs.statSync(MAIN).size,
    sourceMd5: md5File(MAIN),
    viewport: '1440x900 dpr=1',
    bootMs: Date.now() - t0,
    titleInfo, stateInfo, domInfo,
    shots: { title: titleShot, battle: battleShot }
  };
  fs.writeFileSync(path.join(OUT, 'discover.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  try { ws.close(); } catch (e) { /* ignore */ }
  try { edge.kill(); } catch (e) { /* ignore */ }
  await sleep(600);
  try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); } catch (e) { console.log('PROFILE_CLEAN_FAIL ' + PROFILE); }
}

main().catch((e) => { console.error('DISCOVER_FAIL', e && e.stack || e); process.exitCode = 1; });
