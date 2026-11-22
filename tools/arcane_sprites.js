/* ============================================================
   3D sprite 管线驱动（端口 9471 = 浏览器 / 9472 = 收图服务）
   ------------------------------------------------------------
   流程：
     1) 无头 Edge 打开主文件，用游戏自身绘制函数导出"现绘制"透明 PNG；
     2) 同一个浏览器跳到 sprites/build_sprites.html，跑 3D 渲染；
     3) 页面把 sheet / 对比图 base64 POST 回本机服务落盘；
     4) 写 manifest.json（尺寸、帧序、哈希）。
   只读主文件，不修改任何游戏代码。
   用法：node tools/arcane_sprites.js
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9471;
const HTTP_PORT = 9472;
const ROOT = path.join(__dirname, '..');
const GAME = path.join(ROOT, 'index_arcane_v2.html');
const SPRITES = path.join(ROOT, 'sprites');
const OUT = path.join(SPRITES, 'out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 起收图服务：静态托管 sprites/，接收 POST /save?name=xxx（body 为 base64）
 * @returns {Promise<http.Server>} 已监听的服务
 */
function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${HTTP_PORT}`);
    if (req.method === 'POST' && url.pathname === '/save') {
      const name = (url.searchParams.get('name') || 'out.png').replace(/[^\w.\-]/g, '_');
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const b64 = Buffer.concat(chunks).toString('utf8').replace(/^data:[^,]+,/, '');
          const buf = Buffer.from(b64, 'base64');
          fs.writeFileSync(path.join(OUT, name), buf);
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
          res.end(JSON.stringify({ ok: true, name, bytes: buf.length }));
        } catch (e) {
          res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
          res.end(String(e));
        }
      });
      return;
    }
    const file = path.join(SPRITES, decodeURIComponent(url.pathname === '/' ? '/build_sprites.html' : url.pathname));
    if (!file.startsWith(SPRITES) || !fs.existsSync(file)) {
      res.writeHead(404); res.end('404'); return;
    }
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'application/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', () => resolve(server)));
}

/**
 * 起无头 Edge（SwiftShader 软件 WebGL）
 * @returns {Promise<Object>} CDP 句柄
 */
async function openBrowser() {
  const profile = path.join(os.tmpdir(), 'arcane-sprites-' + process.pid);
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 */ }
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
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  };
  return { send, close };
}

/**
 * 求值并返回 JSON
 * @param {Function} send CDP send
 * @param {string} expr 表达式
 * @returns {Promise<any>} 结果
 */
async function evalJson(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text;
    throw new Error(d);
  }
  return r.result.value;
}

/**
 * 轮询等待页面内某个条件为真
 * @param {Function} send CDP send
 * @param {string} expr 布尔表达式
 * @param {number} timeoutMs 超时
 * @returns {Promise<boolean>} 是否就绪
 */
async function waitFor(send, expr, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJson(send, expr)) return true;
    } catch (e) { /* 页面还在加载 */ }
    await sleep(300);
  }
  return false;
}

/**
 * 从游戏页面导出"现绘制"的单位透明 PNG
 * @param {Function} send CDP send
 * @returns {Promise<Object>} {player:dataURL, assembler:dataURL}
 */
async function captureBefore(send) {
  return evalJson(send, `(() => {
    const keys = ['player', 'assembler', 'graveter'];
    const out = {};
    const prev = ctx;
    keys.forEach((key) => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const g = c.getContext('2d');
      ctx = g;
      g.save();
      g.translate(128, 128);
      try {
        if (key === 'player') {
          const p = state.player;
          const ox = p.x, oy = p.y, of = p.facingAngle;
          state._silhouettePass = true;
          p.x = 0; p.y = 0; p.facingAngle = 0;
          try { drawPlayer(); } finally {
            state._silhouettePass = false;
            p.x = ox; p.y = oy; p.facingAngle = of;
          }
        } else {
          const conf = ENEMY_CONFIG.find((i) => i.id === key);
          const fake = {
            id: 1, typeId: conf.id, radius: conf.radius, color: conf.color, accent: conf.accent,
            art: conf.art, body: conf.body, ai: conf.ai, facing: 0, wobble: 0,
            flash: 0, squash: 0, squashAngle: 0, windup: 0, windupScale: 0,
            fireTimer: 99, hitCooldown: 0, fireInterval: conf.fireInterval || 2,
            blinkTimer: 99, shieldHp: 0, frozenTime: 0, slowTime: 0,
            hp: 10, hpMax: 10, elite: false, affix: null
          };
          if (fake.art) drawRegionEnemy(fake, 0);
          else if (fake.typeId === 'wanderer') drawWispEnemy(fake, 0);
          else if (fake.typeId === 'shooter') drawTurretEnemy(fake, 0);
          else drawPhaserEnemy(fake, 0, 0);
        }
      } finally {
        g.restore();
        ctx = prev;
      }
      out[key] = c.toDataURL('image/png');
    });
    return out;
  })()`);
}

/**
 * 把 dataURL 通过页面 POST 回本机落盘
 * @param {Function} send CDP send
 * @param {string} name 文件名
 * @param {string} dataUrl PNG dataURL
 * @returns {Promise<Object>} 服务返回
 */
async function savePng(send, name, dataUrl) {
  return evalJson(send, `(async () => {
    const r = await fetch('http://127.0.0.1:${HTTP_PORT}/save?name=${name}', {
      method: 'POST', mode: 'no-cors', body: ${JSON.stringify(dataUrl)}
    });
    return { status: r.type };
  })()`);
}

/**
 * 计算文件 sha256 与大小
 * @param {string} file 路径
 * @returns {{bytes:number, sha256:string}} 指纹
 */
function fingerprint(file) {
  const buf = fs.readFileSync(file);
  return { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const { send, close } = await openBrowser();
  try {
    await send('Page.enable');
    await send('Runtime.enable');

    // ---- 1) 现绘制 ----
    await send('Page.navigate', { url: 'file:///' + GAME.replace(/\\/g, '/') });
    const gameOk = await waitFor(send, "typeof window.__roamDebug === 'object' && typeof window.__roamDebug.unitSilhouetteAt === 'function'", 60000);
    if (!gameOk) throw new Error('主文件调试口未就绪');
    const before = await captureBefore(send);
    await savePng(send, 'before_player.png', before.player);
    await savePng(send, 'before_assembler.png', before.assembler);
    await savePng(send, 'before_graveter.png', before.graveter);

    // ---- 2) 3D 渲染（主角 / 机械族 / 符文族各自独立 sheet） ----
    await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/build_sprites.html` });
    const labOk = await waitFor(send, 'window.__ready === true', 30000);
    if (!labOk) throw new Error('渲染台未就绪');

    // 屏幕尺寸取自 tools/arcane_sprite_probe.js 的实测（camZoom 0.85，dpr 1）
    const units = [
      { key: 'hero', label: '主角 · 奥术工程师', before: 'player', screenW: 64.6, screenH: 48.4 },
      { key: 'mech', label: '机械族 · 装配体', before: 'assembler', screenW: 64.6, screenH: 28.9 },
      { key: 'rune', label: '符文族 · 碑卫', before: 'graveter', screenW: 44.2, screenH: 38.3 }
    ];

    const meta = {};
    const built = {};
    for (const u of units) {
      const r = await evalJson(send, `window.__buildUnit(${JSON.stringify(u.key)})`);
      built[u.key] = r;
      await savePng(send, `${u.key}_sheet.png`, r.sheet);
      await savePng(send, `${u.key}_mask.png`, r.mask);
      const views = await evalJson(send, `window.__makeViews(${JSON.stringify(r.sheet)}, ${JSON.stringify({
        screenW: u.screenW, screenH: u.screenH, label: u.label
      })})`);
      await savePng(send, `${u.key}_views.png`, views);
      const shots = await evalJson(send, `window.__makeDirShots(${JSON.stringify(r.sheet)})`);
      for (const name of Object.keys(shots)) {
        await savePng(send, `${u.key}_${name}.png`, shots[name]);
      }
      const cmp = await evalJson(send, `window.__makeCompare(${JSON.stringify({
        beforeHero: before[u.before],
        afterSheet: r.sheet,
        screenW: u.screenW,
        screenH: u.screenH,
        label: u.label
      })})`);
      await savePng(send, `${u.key}_compare.png`, cmp);
      meta[u.key] = {
        label: u.label,
        beforeKey: u.before,
        screenW: u.screenW,
        screenH: u.screenH,
        cell: r.cell, cols: r.cols, rows: r.rows,
        anchor: [r.anchorX, r.anchorY],
        bottomMaxInCell: r.bottomMax,
        bboxW: r.bboxW,
        bboxH: r.bboxH,
        frameOrder: r.frameOrder, dirOrder: r.dirOrder
      };
    }

    await sleep(600);

    const result = {
      generatedAt: new Date().toISOString(),
      game: { path: GAME, ...fingerprint(GAME) },
      sheet: meta,
      files: {}
    };
    ['hero_sheet.png', 'hero_mask.png', 'hero_views.png', 'hero_compare.png',
      'mech_sheet.png', 'mech_mask.png', 'mech_views.png', 'mech_compare.png',
      'rune_sheet.png', 'rune_mask.png', 'rune_views.png', 'rune_compare.png',
      'before_player.png', 'before_assembler.png', 'before_graveter.png'].forEach((n) => {
      const f = path.join(OUT, n);
      if (fs.existsSync(f)) result.files[n] = fingerprint(f);
    });
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await close();
    server.close();
  }
}

main().catch((e) => { console.error('SPRITES FAIL:', e.message); process.exit(1); });
