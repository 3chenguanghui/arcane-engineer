/**
 * X-A1 迷雾采样探针（只读诊断，不改游戏逻辑、不改 verify 断言）
 * ------------------------------------------------------------
 * 复现 arcane_verify.js 里 "X-A1 纯雾层不透明 p99 ≤12" 的采样方式：
 *   1) setFloor(6)，关 seam / bloom 后调 __roamDebug.fogLab.measure()
 *   2) 按 measure() 返回的 rect 重新取像素，找出最亮像素的屏幕坐标 / RGB
 *   3) 把最亮像素换回世界坐标，并列出附近的实体（敌人/道具/门），判断亮源是什么
 * 用法：node tools/arcane_fogsample_probe.js [--file=绝对路径] [--n=30]
 * 输出：控制台逐轮一行 + .screenshots/fog/fogsample.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9577;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'fog');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析命令行参数
 * @returns {{file:string,n:number}} 被测文件与轮数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const pick = (k, d) => {
    const hit = a.find((x) => x.startsWith('--' + k + '='));
    return hit ? hit.slice(k.length + 3) : d;
  };
  return {
    file: pick('file', path.join(ROOT, 'index_arcane_v2.html')),
    n: Number(pick('n', '30')),
    seq: pick('seq', 'plain')
  };
}

/**
 * 启动无头 Edge 并连上 CDP，加载指定文件（与其它工具同套路）
 * @param {string} file 被测 HTML 绝对路径
 * @returns {Promise<{ev:Function, close:Function}>} 探针句柄
 */
async function boot(file) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile(PORT);
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(proc); throw new Error('Edge 调试端口未就绪'); }

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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    await sleep(250);
    try { if (await ev(`typeof state !== 'undefined' && typeof generateFloor === 'function'`)) break; } catch (e) { /* 仍在解析 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, close };
}

/**
 * 页面内脚本：重复"干净换层 → 关 seam/bloom → measure → 找最亮像素" n 轮
 * @param {number} n 轮数
 * @param {number} pause 每轮等待毫秒
 * @param {string} seq plain=直接 setFloor(6)；c1=先扫 1..20 层再回 6 层（复刻 verify 的 X-A1 前置状态）
 */
const PAGE_SCRIPT = (n, pause, seq) => `(async function(){
  const d = window.__roamDebug;
  const sleep = (ms) => new Promise(function(r){ setTimeout(r, ms); });
  var out = [];
  for (var k = 0; k < ${n}; k += 1) {
    if (${JSON.stringify(seq)} === 'c1') {
      for (var f = 1; f <= 20; f += 1) d.setFloor(f);
    }
    d.setFloor(6);
    for (var i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    await sleep(${pause});
    var cfg0 = d.fogLab.config();
    d.fogLab.setSeam(0);
    d.fogLab.setBloom(false);
    await sleep(${pause});
    var m = d.fogLab.measure();
    var extra = null;
    if (m && m.rect) {
      var c = document.getElementById('game');
      var dpr = c.width / window.innerWidth;
      var pad = 26;
      var rx = Math.round((m.rect.x + pad) * dpr);
      var ry = Math.round((m.rect.y + pad) * dpr);
      var rw = Math.max(1, Math.round((m.rect.w - pad * 2) * dpr));
      var rh = Math.max(1, Math.round((m.rect.h - pad * 2) * dpr));
      var data = c.getContext('2d').getImageData(rx, ry, rw, rh).data;
      var best = { l: -1, rgb: null, gx: 0, gy: 0 };
      for (var y = 0; y < rh; y += 1) {
        for (var x = 0; x < rw; x += 1) {
          var j = (y * rw + x) * 4;
          var l = data[j] * 0.2126 + data[j + 1] * 0.7152 + data[j + 2] * 0.0722;
          if (l > best.l) best = { l: l, rgb: [data[j], data[j + 1], data[j + 2]], gx: (rx + x) / dpr, gy: (ry + y) / dpr };
        }
      }
      var z = cameraZoom();
      var wx = state.cam.x + best.gx / z;
      var wy = state.cam.y + best.gy / z;
      var near = [];
      (state.enemies || []).forEach(function(e){
        if (Math.hypot(e.x - wx, e.y - wy) < 60) near.push({ kind: 'enemy', type: e.typeId, d: Math.round(Math.hypot(e.x - wx, e.y - wy)) });
      });
      (state.pickups || state.drops || []).forEach(function(p){
        if (Math.hypot(p.x - wx, p.y - wy) < 60) near.push({ kind: 'pickup', d: Math.round(Math.hypot(p.x - wx, p.y - wy)) });
      });
      var room = state.rooms[m.roomId];
      /* 采样矩形与屏幕固定 UI 区域的重叠（判定"亮源是不是 HUD"） */
      var box = function(a, b) {
        var ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        var iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        return ix > 0 && iy > 0 ? Math.round(ix * iy) : 0;
      };
      var sampleBox = { x: m.rect.x + pad, y: m.rect.y + pad, w: m.rect.w - pad * 2, h: m.rect.h - pad * 2 };
      var hudTop = box(sampleBox, { x: 0, y: 0, w: window.innerWidth, h: 110 });
      var hudLeft = box(sampleBox, { x: 0, y: 0, w: 320, h: 300 });
      var hudRight = box(sampleBox, { x: window.innerWidth - 340, y: 0, w: 340, h: 300 });
      var hudBottom = box(sampleBox, { x: 0, y: window.innerHeight - 140, w: window.innerWidth, h: 140 });
      extra = {
        brightest: { l: Math.round(best.l * 10) / 10, rgb: best.rgb, screen: [Math.round(best.gx), Math.round(best.gy)], world: [Math.round(wx), Math.round(wy)] },
        room: { id: m.roomId, type: room && room.type, x: room && Math.round(room.x), y: room && Math.round(room.y), w: room && room.w, h: room && room.h },
        player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
        playerInSampleRoom: !!(room && state.player.x >= room.x && state.player.x <= room.x + room.w && state.player.y >= room.y && state.player.y <= room.y + room.h),
        hudOverlap: { top: hudTop, left: hudLeft, right: hudRight, bottom: hudBottom },
        cam: { x: Math.round(state.cam.x), y: Math.round(state.cam.y) },
        zoom: Math.round(z * 1000) / 1000,
        near: near.slice(0, 5)
      };
    }
    out.push({ k: k, p99: m && m.p99, avg: m && m.avg, max: m && m.max, px: m && m.px, rect: m && m.rect, roomId: m && m.roomId, extra: extra });
    SCENE_READ_CONFIG.seamMul = cfg0.seamMul;
    SCENE_READ_CONFIG.gridMul = cfg0.gridMul;
    if (typeof bakeScene === 'function') bakeScene();
    d.fogLab.setBloom(cfg0.bloom);
    await sleep(${pause});
  }
  return out;
})()`;

/**
 * 主流程：跑 n 轮，统计 p99 > 12 的比例，并打印失败轮的亮源证据
 */
async function main() {
  const args = parseArgs();
  const { ev, close } = await boot(args.file);
  try {
    const rows = await ev(PAGE_SCRIPT(args.n, 500, args.seq));
    const bad = rows.filter((r) => r.p99 != null && r.p99 > 12);
    rows.forEach((r) => {
      const flag = r.p99 != null && r.p99 > 12 ? 'BAD ' : 'ok  ';
      console.log(`${flag}#${r.k} p99=${r.p99} avg=${r.avg} max=${r.max} room=${r.roomId} px=${r.px}`);
    });
    console.log(`\n轮数 ${rows.length} / p99>12 的轮数 ${bad.length}（${(bad.length / rows.length * 100).toFixed(1)}%）`);
    bad.slice(0, 5).forEach((r) => {
      console.log(`BAD #${r.k} 最亮像素 ${r.extra && JSON.stringify(r.extra.brightest)} 房间 ${r.extra && JSON.stringify(r.extra.room)} 玩家在内=${r.extra && r.extra.playerInSampleRoom} 附近实体 ${r.extra && JSON.stringify(r.extra.near)}`);
    });
    fs.writeFileSync(path.join(OUT_DIR, 'fogsample.json'), JSON.stringify({ file: args.file, rows }, null, 2));
  } finally {
    close();
  }
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
