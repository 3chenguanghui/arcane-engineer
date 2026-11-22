/* ============================================================
   单位 sprite 验收量具（hero / mech 共用，不写主文件）
   ------------------------------------------------------------
   口径（全部逐朝向，8 个方向各算一遍）：
     · 旧画法：
         hero → state.player.facingAngle = d*45°，用游戏自己的 drawPlayer()
         其它 → 构造 ENEMY_CONFIG 对应的 fake 敌人（facing = d*45°），
                调 drawRegionEnemy()（含族剪影 drawSilhouetteFlare）
       都在 320×320 离屏画布上画，原点 (160,160) = "脚底锚点所在世界点"。
     · 新模型：直接量 sprite sheet 第 d 行第 0 列（160×160 单元格）。
     · k[d] = sqrt(旧实心像素 / 格内实心像素)
       —— 面积对齐，缩放后该朝向的实心面积正好等于旧画法。
     · 宽高比 = bboxW / bboxH（缩放不变，只能靠造型改）。
     · 锚点：
         bottom   = 全 bbox 最低不透明像素（可能被展翼/尾刺投影带偏）
         bottomMid= bbox 中间 16% 列内的最低像素 = "角色本体的脚"
       接入用 bottomMid，Δ = bottom - bottomMid 单独报告。
   用法：node tools/arcane_hero_accept.js [hero|mech]
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
/* 端口可用环境变量覆盖：上一次异常退出会留下占着 9473/9474 的 Edge/Node，
   复用旧浏览器会量到旧页面（本轮排查"量出来全是 0"就是踩到这个坑）。 */
const PORT = Number(process.env.CDP_PORT || 9473);
const HTTP_PORT = Number(process.env.HTTP_PORT || 9474);
const ROOT = path.join(__dirname, '..');
/* 基线文件：默认用活动主文件；设 GAME_REF 可钉死到固定快照（防止并发写者漂移） */
const GAME = process.env.GAME_REF
  ? path.resolve(ROOT, process.env.GAME_REF)
  : path.join(ROOT, 'index_arcane_v2.html');
const SPRITES = path.join(ROOT, 'sprites');
const OUT = path.join(SPRITES, 'out');
let CELL = 160;              // 由渲染台返回的 cell 覆盖（提质后为 320）
const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
/* 单位选择：argv[2] = hero | mech | rune；机械族对应 crawler，符文族对应 graveter（碑卫）。
   argv[2] = trio 时不跑验收，只把三族已有的 PNG 拼成一张 1× 三列对照图。 */
const UNIT = ['hero', 'mech', 'rune'].includes(process.argv[2]) ? process.argv[2] : 'hero';
const ENEMY_KEY = UNIT === 'mech' ? 'crawler' : (UNIT === 'rune' ? 'graveter' : null);
const PREFIX = UNIT + '_';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 起静态服务：托管 sprites/，并接收 POST /save 落盘
 * @returns {Promise<http.Server>} 已监听服务
 */
function startServer() {
  fs.mkdirSync(OUT, { recursive: true });
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
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, bytes: buf.length }));
        } catch (e) {
          res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
          res.end(String(e));
        }
      });
      return;
    }
    const file = path.join(SPRITES, decodeURIComponent(url.pathname === '/' ? '/build_sprites.html' : url.pathname));
    if (!file.startsWith(SPRITES) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', () => r(server)));
}

/**
 * 起无头 Edge（SwiftShader 软件 WebGL），返回 CDP 句柄
 * @returns {Promise<{send:Function, close:Function}>} 句柄
 */
async function openBrowser() {
  // 若端口上已经有之前遗留的本工具浏览器，直接复用（避免端口占用导致反复失败）
  let target = null;
  let reused = false;
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
    reused = !!target;
  } catch (e) { /* 没有就新起 */ }

  const profile = path.join(os.tmpdir(), 'arcane-hero-accept-' + process.pid);
  let edge = null;
  if (!reused) {
    edge = spawn(EDGE, [
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--allow-file-access-from-files', '--window-size=1440,900',
      '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank'
    ], { stdio: 'ignore' });

    for (let i = 0; i < 160; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (e) { /* 等浏览器起 */ }
      await sleep(250);
    }
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
      if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1; pending.set(seq, { resolve, reject });
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const close = async () => {
    try { ws.close(); } catch (e) { /* ignore */ }
    if (reused) return;   // 复用来的浏览器不关，留给下一次
    try { edge.kill(); } catch (e) { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  };
  return { send, close };
}

/**
 * 求值并取回 JSON
 * @param {Function} send CDP send
 * @param {string} expr 表达式
 * @returns {Promise<any>} 结果
 */
async function evalJson(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const e = r.exceptionDetails.exception;
    throw new Error(e ? e.description : r.exceptionDetails.text);
  }
  return r.result.value;
}

/**
 * 轮询等待页面条件成立
 * @param {Function} send CDP send
 * @param {string} expr 布尔表达式
 * @param {number} ms 超时
 * @returns {Promise<boolean>} 是否就绪
 */
async function waitFor(send, expr, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await evalJson(send, expr)) return true; } catch (e) { /* 加载中 */ }
    await sleep(300);
  }
  return false;
}

/**
 * 把 dataURL 经页面 POST 回本机落盘
 * @param {Function} send CDP send
 * @param {string} name 文件名
 * @param {string} dataUrl PNG dataURL
 * @returns {Promise<any>} 服务返回
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
 * 像素统计：在给定矩形内量 bbox / 实心像素 / 饱和度 / 最低不透明像素
 * —— 这段会被注入到页面里执行，所以在浏览器侧运行
 * @param {Uint8ClampedArray} d RGBA 数据
 * @param {number} W 整图宽
 * @param {number} x0 区域左
 * @param {number} y0 区域上
 * @param {number} w 区域宽
 * @param {number} h 区域高
 * @returns {Object} 统计结果
 */
const MEASURE_FN = `
  function measure(d, W, x0, y0, w, h) {
    let left = 1e9, right = -1, top = 1e9, bottom = -1;
    let solid = 0, any = 0, satSum = 0, satN = 0;
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        const a = d[(y * W + x) * 4 + 3];
        if (a < 16) continue;
        any += 1;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (a < 128) continue;
        solid += 1;
        const r = d[(y * W + x) * 4] / 255;
        const g = d[(y * W + x) * 4 + 1] / 255;
        const b = d[(y * W + x) * 4 + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 0.02) { satSum += (mx - mn) / mx; satN += 1; }
      }
    }
    if (right < 0) return null;
    /* 脚底锚点：只看 bbox 中间 16% 列 —— 展翼/尾刺的投影通常在两侧，
       把它们排除后剩下的最低点才是"角色本体的脚" */
    const midW = Math.max(1, Math.round((right - left + 1) * 0.16));
    const mx0 = Math.max(x0, Math.round((left + right) / 2 - midW / 2));
    const mx1 = Math.min(x0 + w - 1, mx0 + midW - 1);
    let bottomMid = -1;
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = mx0; x <= mx1; x += 1) {
        if (d[(y * W + x) * 4 + 3] >= 16 && y > bottomMid) bottomMid = y;
      }
    }
    return {
      x: left, y: top, w: right - left + 1, h: bottom - top + 1,
      areaSolid: solid, areaAny: any,
      aspect: +((right - left + 1) / (bottom - top + 1)).toFixed(3),
      sat: satN ? +(satSum / satN).toFixed(3) : 0,
      bottom: bottom, bottomMid: bottomMid, cx: (left + right) / 2
    };
  }
`;

/**
 * 在游戏页里逐朝向导出旧画法并统计
 * @param {Function} send CDP send
 * @returns {Promise<Array>} 8 个朝向的统计
 */
async function measureOld(send) {
  return evalJson(send, `(() => {
    ${MEASURE_FN}
    const S = 320;
    const out = [];
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    const prev = ctx;
    const p = state.player;
    const ox = p.x, oy = p.y, of = p.facingAngle, ofi = p.facing;
    const hasFi = p.facing !== undefined;
    state._silhouettePass = true;
    for (let d = 0; d < 8; d += 1) {
      g.clearRect(0, 0, S, S);
      ctx = g;
      g.save();
      g.translate(S / 2, S / 2);
      try {
        p.x = 0; p.y = 0;
        p.facingAngle = d * Math.PI / 4;
        if (hasFi) p.facing = d * Math.PI / 4;
        drawPlayer();
      } finally {
        g.restore();
        ctx = prev;
      }
      const d2 = g.getImageData(0, 0, S, S).data;
      out.push(measure(d2, S, 0, 0, S, S));
    }
    state._silhouettePass = false;
    p.x = ox; p.y = oy; p.facingAngle = of;
    if (hasFi) p.facing = ofi;
    return { stats: out, dpr: window.devicePixelRatio, zoom: (typeof cameraZoom === 'function' ? cameraZoom() : null) };
  })()`);
}

/**
 * 在游戏页里逐朝向导出"敌人旧画法"并统计
 * ------------------------------------------------------------
 * 与 drawUnitForSilhouette 同口径，但把 fake.facing 设成逐朝向，
 * 这样 drawMechEnemy 内的 ctx.rotate(enemy.facing) 才会真的转。
 * 注意：drawSilhouetteFlare 在 rotate 之前画，本身不随朝向转 —— 这是旧画法的真实行为。
 * @param {Function} send CDP send
 * @param {string} key ENEMY_CONFIG 的 id（这里用 crawler）
 * @returns {Promise<Array>} 8 个朝向的统计
 */
async function measureOldEnemy(send, key) {
  return evalJson(send, `(() => {
    ${MEASURE_FN}
    const S = 320;
    const out = [];
    const conf = ENEMY_CONFIG.find((item) => item.id === ${JSON.stringify(key)});
    if (!conf) return { stats: [], zoom: null, error: 'ENEMY_CONFIG 无此 id' };
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    const prev = ctx;
    for (let d = 0; d < 8; d += 1) {
      const fake = {
        id: 1, typeId: conf.id, radius: conf.radius, color: conf.color, accent: conf.accent,
        art: conf.art, body: conf.body, ai: conf.ai, facing: d * Math.PI / 4, wobble: 0,
        flash: 0, squash: 0, squashAngle: 0, windup: 0, windupScale: 0,
        fireTimer: 99, hitCooldown: 0, fireInterval: conf.fireInterval || 2,
        blinkTimer: 99, shieldHp: 0, frozenTime: 0, slowTime: 0,
        hp: 10, hpMax: 10, elite: false, affix: null
      };
      g.clearRect(0, 0, S, S);
      ctx = g;
      g.save();
      g.translate(S / 2, S / 2);
      try { drawRegionEnemy(fake, 0); } finally { g.restore(); ctx = prev; }
      const d2 = g.getImageData(0, 0, S, S).data;
      out.push(measure(d2, S, 0, 0, S, S));
    }
    return { stats: out, dpr: window.devicePixelRatio, zoom: (typeof cameraZoom === 'function' ? cameraZoom() : null) };
  })()`);
}

/**
 * 量旧画法的"1× 轮廓对比度"（灰阶 0–255）
 * ------------------------------------------------------------
 * 口径与渲染台 `__makeEdgeContrast` 完全一致：
 *   旧图按 cameraZoom 缩到实机像素 → 脚点压在砖底中点 → 取剪影边缘像素，量 |L(边缘) − L(砖)|。
 * 这样"旧画法"和"新 sprite"量的是同一件事，才能当门槛用。
 * @param {Function} send CDP send
 * @returns {Promise<Object>} {T, zoom, dirs:[{dir,mean,p25,min,n}]}
 */
async function measureOldEdge(send) {
  return evalJson(send, `(() => {
    const S = 320;
    const zoom = (typeof cameraZoom === 'function' ? cameraZoom() : 0.85);
    const T = Math.round(160 * zoom);
    const names = ['E','SE','S','SW','W','NW','N','NE'];
    const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

    /* ① 背景：和渲染台 paintFloorTile 同一套渐变 */
    const bgCv = document.createElement('canvas'); bgCv.width = T; bgCv.height = T;
    const bgG = bgCv.getContext('2d', { willReadFrequently: true });
    const grd = bgG.createLinearGradient(0, 0, 0, T);
    grd.addColorStop(0, '#243040'); grd.addColorStop(0.55, '#1a2430'); grd.addColorStop(1, '#121a24');
    bgG.fillStyle = grd; bgG.fillRect(0, 0, T, T);
    const hl = bgG.createRadialGradient(T * 0.3, T * 0.22, 2, T * 0.3, T * 0.22, T * 0.9);
    hl.addColorStop(0, 'rgba(120,160,200,0.10)'); hl.addColorStop(1, 'rgba(120,160,200,0)');
    bgG.fillStyle = hl; bgG.fillRect(0, 0, T, T);
    const bgD = bgG.getImageData(0, 0, T, T).data;

    /* ② 旧画法逐朝向渲到 320 画布（原点 = 脚点） */
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    const prev = ctx;
    const p = state.player;
    const ox = p.x, oy = p.y, of = p.facingAngle, ofi = p.facing;
    const hasFi = p.facing !== undefined;
    const conf = ENEMY_CONFIG.find((it) => it.id === ${JSON.stringify(ENEMY_KEY)});
    const USE_HERO = ${UNIT === 'hero'};
    const out = [];
    for (let d = 0; d < 8; d += 1) {
      g.clearRect(0, 0, S, S);
      ctx = g; g.save(); g.translate(S / 2, S / 2);
      try {
        if (USE_HERO) {
          state._silhouettePass = true;
          p.x = 0; p.y = 0; p.facingAngle = d * Math.PI / 4;
          if (hasFi) p.facing = d * Math.PI / 4;
          drawPlayer();
        } else {
          const fake = {
            id: 1, typeId: conf.id, radius: conf.radius, color: conf.color, accent: conf.accent,
            art: conf.art, body: conf.body, ai: conf.ai, facing: d * Math.PI / 4, wobble: 0,
            flash: 0, squash: 0, squashAngle: 0, windup: 0, windupScale: 0,
            fireTimer: 99, hitCooldown: 0, fireInterval: conf.fireInterval || 2,
            blinkTimer: 99, shieldHp: 0, frozenTime: 0, slowTime: 0,
            hp: 10, hpMax: 10, elite: false, affix: null
          };
          drawRegionEnemy(fake, 0);
        }
      } finally { g.restore(); ctx = prev; }
      if (USE_HERO) state._silhouettePass = false;

      /* ③ 1× 合成：整张旧图按 zoom 缩放，脚点 (S/2,S/2) 落到砖底中点 */
      const dx = T / 2 - (S / 2) * zoom;
      const dy = T - (S / 2) * zoom;
      const aCv = document.createElement('canvas'); aCv.width = T; aCv.height = T;
      const aG = aCv.getContext('2d', { willReadFrequently: true });
      aG.drawImage(c, 0, 0, S, S, dx, dy, S * zoom, S * zoom);
      const aD = aG.getImageData(0, 0, T, T).data;
      const cCv = document.createElement('canvas'); cCv.width = T; cCv.height = T;
      const cG = cCv.getContext('2d', { willReadFrequently: true });
      {
        const gg = cG.createLinearGradient(0, 0, 0, T);
        gg.addColorStop(0, '#243040'); gg.addColorStop(0.55, '#1a2430'); gg.addColorStop(1, '#121a24');
        cG.fillStyle = gg; cG.fillRect(0, 0, T, T);
        const hh = cG.createRadialGradient(T * 0.3, T * 0.22, 2, T * 0.3, T * 0.22, T * 0.9);
        hh.addColorStop(0, 'rgba(120,160,200,0.10)'); hh.addColorStop(1, 'rgba(120,160,200,0)');
        cG.fillStyle = hh; cG.fillRect(0, 0, T, T);
      }
      cG.drawImage(c, 0, 0, S, S, dx, dy, S * zoom, S * zoom);
      const cD = cG.getImageData(0, 0, T, T).data;

      const deltas = [];
      const at = (x, y) => (y * T + x) * 4;
      for (let y = 1; y < T - 1; y += 1) {
        for (let x = 1; x < T - 1; x += 1) {
          const i = at(x, y);
          if (aD[i + 3] < 128) continue;
          /* 轮廓线 = α=128 等值线（旧画法带半透明光晕，用"α<40"取不到边缘） */
          const edge = aD[at(x - 1, y) + 3] < 128 || aD[at(x + 1, y) + 3] < 128 ||
                       aD[at(x, y - 1) + 3] < 128 || aD[at(x, y + 1) + 3] < 128;
          if (!edge) continue;
          deltas.push(Math.abs(lum(cD[i], cD[i + 1], cD[i + 2]) - lum(bgD[i], bgD[i + 1], bgD[i + 2])));
        }
      }
      deltas.sort((a, b) => a - b);
      const n = deltas.length;
      /* 诊断：1× 合成后角色在砖上的 alpha 包围盒（用来确认"没量到"是位置问题还是判据问题） */
      let bx0 = T, by0 = T, bx1 = -1, by1 = -1, aN = 0;
      for (let y = 0; y < T; y += 1) {
        for (let x = 0; x < T; x += 1) {
          if (aD[(y * T + x) * 4 + 3] < 250) continue;
          aN += 1;
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
          if (y < by0) by0 = y; if (y > by1) by1 = y;
        }
      }
      out.push({
        dir: names[d],
        mean: n ? +(deltas.reduce((a, b) => a + b, 0) / n).toFixed(1) : 0,
        p25: n ? +deltas[Math.floor(n * 0.25)].toFixed(1) : 0,
        min: n ? +deltas[0].toFixed(1) : 0,
        n: n,
        solid: aN,
        box: bx1 >= 0 ? [bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1] : null
      });
    }
    p.x = ox; p.y = oy; p.facingAngle = of;
    if (hasFi) p.facing = ofi;
    return { T: T, zoom: zoom, dirs: out };
  })()`);
}

/**
 * 在渲染台页里逐行（逐朝向）量 sprite sheet
 * @param {Function} send CDP send
 * @param {string} sheetDataUrl sheet 图
 * @returns {Promise<Array>} 8 个朝向的统计
 */
async function measureNew(send, sheetDataUrl) {
  return evalJson(send, `(async () => {
    ${MEASURE_FN}
    const im = new Image();
    im.src = ${JSON.stringify(sheetDataUrl)};
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const out = [];
    for (let r = 0; r < 8; r += 1) out.push(measure(d, c.width, 0, r * ${CELL}, ${CELL}, ${CELL}));
    return out;
  })()`);
}

/* 出图用的单位元信息：屏幕基准尺寸按旧画法 1× 尺寸给 */
const UNIT_META = {
  hero: { name: '主角 · 奥术工程师', screenW: 54, screenH: 69, cmpLabel: '' },
  /* 机械族目标 2.06 是侧视（E/W）；对比图也取 E，才是同一条口径 */
  mech: { name: '机械族 · 履带爬行者', screenW: 70, screenH: 34, cmpLabel: '机械族 · 履带爬行者（侧视 E 对照）' },
  rune: { name: '符文族 · 碑卫', screenW: 44, screenH: 52, cmpLabel: '符文族 · 碑卫（侧视 E 对照）' }
};

/**
 * 三族 1× 三列对照：只读已落盘的 sheet 与 accept.json，不重渲
 * ------------------------------------------------------------
 * 为什么不在这里重跑三族：重跑会各自重新排版（同一模型三次渲染仍有浮点差异），
 * 而且耗时成倍。三列图要回答的是"同一套描边在三族身上像不像一套"，
 * 只要图与 k 都来自各自最近一次验收产物即可。
 * @returns {Promise<void>}
 */
async function runTrio() {
  const server = await startServer();
  const { send, close } = await openBrowser();
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/build_sprites.html` });
    if (!await waitFor(send, 'window.__ready === true', 40000)) throw new Error('渲染台未就绪');
    const units = [
      { key: 'hero', name: '主角' },
      { key: 'mech', name: '机械族' },
      { key: 'rune', name: '符文族' }
    ];
    const rows = units.map((u) => {
      const p = path.join(OUT, `${u.key}_accept.json`);
      if (!fs.existsSync(p)) throw new Error(`缺 ${u.key}_accept.json（先跑 node tools/arcane_hero_accept.js ${u.key}）`);
      const rep = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!rep.noRimKs || rep.noRimKs.some((k) => k == null)) throw new Error(`${u.key} 缺 noRimKs`);
      return { name: u.name, key: u.key, rep: rep };
    });
    const zoom = rows[0].rep.zoom || 0.85;
    for (const spec of [{ dir: 0, tag: 'E', title: '侧视 E' }, { dir: 2, tag: 'S', title: '正视 S' }]) {
      const payload = {
        dir: spec.dir,
        zoom: zoom,
        label: `三族 1× 三列对照 · ${spec.title}`,
        rows: rows.map((r) => {
          const a = r.rep.anchorY;
          return {
            name: r.name,
            oldUrl: `/out/before_${r.key}_${spec.tag}.png`,
            norimUrl: `/out/${r.key}_sheet_norim.png`,
            norimK: r.rep.noRimKs[spec.dir],
            rimUrl: `/out/${r.key}_sheet.png`,
            rimK: r.rep.rows[spec.dir].k,
            anchorY: Array.isArray(a) ? a[spec.dir] : (a || 279)
          };
        })
      };
      const url = await evalJson(send, `window.__makeTrio(${JSON.stringify(payload)})`);
      await savePng(send, `trio_${spec.tag}.png`, url);
      console.log(`已写 out/trio_${spec.tag}.png`);
    }
  } finally {
    await close();
    server.close();
  }
}

/* 符文族单独一行 anchorY（顺序 E,SE,S,SW,W,NW,N,NE）：
   碑卫是悬浮体，套统一 279 会把整块碑压到地上、丢掉"浮着"的观感。
   取值 = 本朝向格内最低点（α≥128） − 11/k[d]；11 是旧画法实测"实体最低点
   位于敌人锚点下方 11"，单位是 320 格（measureOldEnemy 画进 320 画布，不乘 zoom），
   1× 屏幕为 11×0.85 = 9.35px。光晕（α≥16）最低到 18，不参与对齐。
   推导与例外理由见规格 §3.10.4。 */
const RUNE_ANCHOR_ROWS = [222.8, 216.8, 220.7, 220.3, 218.6, 217.1, 221.1, 226.1];
/* 统一契约锚点：160 格 138 → 320 格 276；统一描边使剪影外扩 3px，接入改 276+3=279。
   注意：轮廓对比度的量测帧仍固定在 276，不跟接入锚点走（门槛也在 276 帧上量的）。 */
const CONTRACT_ANCHOR = 279;
const ANCHOR_ROWS = UNIT === 'rune' ? RUNE_ANCHOR_ROWS : null;

async function main() {
  const meta = UNIT_META[UNIT];
  const server = await startServer();
  const { send, close } = await openBrowser();
  try {
    /* 上一版（改前）的数字：先读固定副本，后面 hero_accept.json 会被覆盖 */
    let prevKs = null;
    const prevPath = path.join(OUT, `v8_${PREFIX}accept.json`);
    if (fs.existsSync(prevPath)) {
      try {
        const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
        prevKs = (prev.rows || []).map((r) => r.k);
      } catch (e) { prevKs = null; }
    }
    await send('Page.enable');
    await send('Runtime.enable');

    // ---------- 1) 旧画法 8 朝向 ----------
    await send('Page.navigate', { url: 'file:///' + GAME.replace(/\\/g, '/') });
    const gameOk = await waitFor(send, "typeof window.__roamDebug === 'object' && typeof window.__roamDebug.unitSilhouetteAt === 'function'", 90000);
    if (!gameOk) throw new Error('主文件调试口未就绪');
    const before = UNIT === 'hero' ? await measureOld(send) : await measureOldEnemy(send, ENEMY_KEY);
    if (!before.stats || !before.stats.length || !before.stats[0]) {
      throw new Error('旧画法量测为空' + (before.error ? '：' + before.error : ''));
    }
    /* 旧画法的 1× 轮廓对比度：新判据的门槛，必须先量旧画法 */
    const oldEdge = await measureOldEdge(send);

    /* 旧画法 E / S 两个朝向的单图：
       E 用于"侧视同机位"对照，S 用于"正面短板"对照；三族对照图也要同一批，
       所以两个朝向都存盘，不能只留一张。 */
    const oldShots = await evalJson(send, `(() => {
      const S = 320;
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      const g = c.getContext('2d');
      const prev = ctx;
      const USE_HERO = ${UNIT === 'hero'};
      const conf = USE_HERO ? null : ENEMY_CONFIG.find((item) => item.id === ${JSON.stringify(ENEMY_KEY)});
      const p = USE_HERO ? state.player : null;
      const ox = p ? p.x : 0, oy = p ? p.y : 0, of = p ? p.facingAngle : 0, ofi = p ? p.facing : undefined;
      const hasFi = p ? p.facing !== undefined : false;
      const shot = (d) => {
        g.clearRect(0, 0, S, S);
        ctx = g; g.save(); g.translate(S / 2, S / 2);
        try {
          if (USE_HERO) {
            state._silhouettePass = true;
            p.x = 0; p.y = 0; p.facingAngle = d * Math.PI / 4;
            if (hasFi) p.facing = d * Math.PI / 4;
            drawPlayer();
          } else {
            const fake = {
              id: 1, typeId: conf.id, radius: conf.radius, color: conf.color, accent: conf.accent,
              art: conf.art, body: conf.body, ai: conf.ai, facing: d * Math.PI / 4, wobble: 0,
              flash: 0, squash: 0, squashAngle: 0, windup: 0, windupScale: 0,
              fireTimer: 99, hitCooldown: 0, fireInterval: conf.fireInterval || 2,
              blinkTimer: 99, shieldHp: 0, frozenTime: 0, slowTime: 0,
              hp: 10, hpMax: 10, elite: false, affix: null
            };
            drawRegionEnemy(fake, 0);
          }
        } finally { g.restore(); ctx = prev; }
        if (USE_HERO) state._silhouettePass = false;
        return c.toDataURL('image/png');
      };
      const out = { E: shot(0), S: shot(2) };
      if (p) { p.x = ox; p.y = oy; p.facingAngle = of; if (hasFi) p.facing = ofi; }
      return out;
    })()`);
    const oldS = oldShots.S;

    // ---------- 2) 新模型 ----------
    await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/build_sprites.html` });
    if (!await waitFor(send, 'window.__ready === true', 40000)) throw new Error('渲染台未就绪');
    const built = await evalJson(send, `window.__buildUnit(${JSON.stringify(UNIT)})`);
    if (built.cell) CELL = built.cell;
    await savePng(send, `${PREFIX}sheet.png`, built.sheet);
    await savePng(send, `${PREFIX}mask.png`, built.mask);
    await savePng(send, `${PREFIX}views.png`, await evalJson(send,
      `window.__makeViews(${JSON.stringify(built.sheet)}, ${JSON.stringify({ screenW: meta.screenW, screenH: meta.screenH, label: meta.name })})`));
    const shots = await evalJson(send, `window.__makeDirShots(${JSON.stringify(built.sheet)})`);
    for (const n of Object.keys(shots)) await savePng(send, `${PREFIX}${n}.png`, shots[n]);
    await savePng(send, `before_${UNIT}_E.png`, oldShots.E);
    await savePng(send, `before_${UNIT}_S.png`, oldShots.S);
    await savePng(send, `before_${PREFIX.slice(0, -1)}.png`, oldS);
    const cmp = await evalJson(send, `window.__makeCompare(${JSON.stringify({
      beforeHero: UNIT === 'hero' ? oldS : oldShots.E, afterSheet: built.sheet, screenW: meta.screenW, screenH: meta.screenH,
      label: meta.cmpLabel || meta.name, row: UNIT === 'hero' ? 2 : 0
    })})`);
    await savePng(send, `${PREFIX}compare.png`, cmp);
    /* 机械族另出一张正视 S 对照：0.55 的宽高比是老画法 1.625 的最大短板，
       不能只给"最好看的那一面对照"，短板也要摆出来 */
    if (UNIT === 'mech') {
      const cmpS = await evalJson(send, `window.__makeCompare(${JSON.stringify({
        beforeHero: oldS, afterSheet: built.sheet, screenW: meta.screenW, screenH: meta.screenH,
        label: '机械族 · 履带爬行者（正视 S 对照）', row: 2
      })})`);
      await savePng(send, `${PREFIX}compare_front.png`, cmpS);
    }

    /* 接触阴影会把"实心面积"和最低像素撑大，所以面积/k/锚点一律用
       noShadow 变体量测；带阴影的 sheet 只用于出图与实机观感判断。
       机械族这一轮也加了接触阴影，所以不再是主角专用分支。 */
    let shadowCheck = null;
    const noShadow = await evalJson(send, `window.__buildUnit(${JSON.stringify(UNIT)}, { noShadow: true })`);
    const measureSheet = noShadow.sheet;
    const withShadow = await measureNew(send, built.sheet);
    const without = await measureNew(send, noShadow.sheet);
    shadowCheck = withShadow.map((n, i) => ({
      dir: DIRS[i],
      bottomWith: n.bottom,
      bottomNoShadow: without[i] ? without[i].bottom : null,
      delta: without[i] ? n.bottom - without[i].bottom : null,
      areaWith: n.areaSolid,
      areaNoShadow: without[i] ? without[i].areaSolid : null
    }));
    const after = await measureNew(send, measureSheet);

    /* 无描边对照：三族三列图的中间列必须是"同一轮渲染、同一套灯"的无描边版本，
       不能拿历史 PNG 顶替（B-1 换过灯，旧图已经没有可比性）。
       面积口径同样用 noShadow，k 按 noRim 自己的格内面积反算。 */
    const noRimBuilt = await evalJson(send, `window.__buildUnit(${JSON.stringify(UNIT)}, { noShadow: true, noRim: true })`);
    await savePng(send, `${PREFIX}sheet_norim.png`, noRimBuilt.sheet);
    const noRimMeas = await measureNew(send, noRimBuilt.sheet);
    const noRimKs = noRimMeas.map((n, i) => (before.stats[i] && n
      ? +Math.sqrt(before.stats[i].areaSolid / n.areaSolid).toFixed(4) : null));

    /* 主角：脚底锚点用 noStaff 变体量 —— 法杖按设定"杖底探出脚底 12px"，
       斜向视角会落进中轴列，把 bottomMid 误判成脚（SE 实测差 23px@320） */
    let feetCheck = null;
    if (UNIT === 'hero') {
      const feetOnly = await evalJson(send, 'window.__buildUnit("hero", { noShadow: true, noStaff: true })');
      const fe = await measureNew(send, feetOnly.sheet);
      feetCheck = fe.map((n, i) => ({ dir: DIRS[i], bottomFeet: n.bottom, bottomMid: after[i] ? after[i].bottomMid : null }));
    }

    // ---------- 2.5) 锚点对照：隐藏展翼/尾刺再量一次 ----------
    // 若两次数值完全一致 → 最低点来自履带本体，展翼/尾刺没带偏锚点。
    let extrasCheck = null;
    if (UNIT === 'mech') {
      const noExtra = await evalJson(send, 'window.__buildUnit("mech", { noShadow: true, noExtras: true })');
      const afterNo = await measureNew(send, noExtra.sheet);
      extrasCheck = after.map((n, i) => ({
        dir: DIRS[i],
        bottom: n.bottom,
        bottomNoExtras: afterNo[i] ? afterNo[i].bottom : null,
        delta: afterNo[i] ? n.bottom - afterNo[i].bottom : null
      }));
    }

    // ---------- 3) 逐朝向算 k 与验收表 ----------
    const zoom = before.zoom || 0.85;
    const rows = [];
    for (let d = 0; d < 8; d += 1) {
      const o = before.stats[d];
      const n = after[d];
      if (!o || !n) { rows.push({ dir: DIRS[d], ok: false }); continue; }
      const k = Math.sqrt(o.areaSolid / n.areaSolid);
      const lowestY = n.bottom - d * CELL + 1;   // 全 bbox 最低（可能含展翼/尾刺投影）
      const footY = n.bottomMid - d * CELL + 1;  // 中间列带最低 = 本体的脚
      /* 主角：用"隐藏法杖后的最低点"当脚锚点（杖底本来就允许探出 12px）
         机械族：用"隐藏展翼/尾刺后的最低点"当脚锚点 */
      let footOnlyY = footY;
      if (UNIT === 'hero' && feetCheck && feetCheck[d] && feetCheck[d].bottomFeet != null) {
        footOnlyY = feetCheck[d].bottomFeet - d * CELL + 1;
      } else if (extrasCheck && extrasCheck[d] && extrasCheck[d].bottomNoExtras != null) {
        footOnlyY = extrasCheck[d].bottomNoExtras - d * CELL + 1;
      }
      rows.push({
        dir: DIRS[d],
        old: { bbox: [o.w, o.h], area: o.areaSolid, aspect: o.aspect, sat: o.sat },
        cell: { bbox: [n.w, n.h], area: n.areaSolid, aspect: n.aspect, sat: n.sat },
        k: +k.toFixed(4),
        draw: {
          bbox: [Math.round(n.w * k), Math.round(n.h * k)],
          area: Math.round(n.areaSolid * k * k),
          aspect: n.aspect,
          screenArea: Math.round(n.areaSolid * k * k * zoom * zoom)
        },
        anchorFoot: footY,
        anchorFootOnly: footOnlyY,
        anchorLowest: lowestY,
        footDelta: lowestY - footY,
        extrasDip: lowestY - footOnlyY
      });
    }

    const kList = rows.filter((r) => typeof r.k === 'number').map((r) => r.k);
    const kSpan = kList.length ? +(Math.max.apply(null, kList) / Math.min.apply(null, kList) - 1).toFixed(4) : null;
    /* 3.5) 1× 轮廓对比度（新 sprite）：与旧画法同一套边缘判据，必须在写报告前算完 */
    const newEdge = await evalJson(send, `window.__makeEdgeContrast(${JSON.stringify(built.sheet)}, ${JSON.stringify({
      ks: rows.map((r) => r.k),
      anchorY: Math.round(138 * CELL / 160),
      zoom: zoom,
      cell: CELL
    })})`);

    /* 机械族的"脚"是宽履带，不在中轴线上：锚点取"隐藏展翼/尾刺后的最低点"，
       用 noExtras 对照证明它来自履带本体；主角仍是中轴附近的双脚，沿用 bottomMid 口径 */
    const anchorKey = 'anchorFootOnly';
    const report = {
      generatedAt: new Date().toISOString(),
      unit: UNIT,
      enemyKey: UNIT === 'mech' ? ENEMY_KEY : null,
      game: (() => {
        const buf = fs.readFileSync(GAME);
        const st = fs.statSync(GAME);
        return {
          ref: path.relative(ROOT, GAME).replace(/\\/g, '/'),
          bytes: buf.length,
          md5: crypto.createHash('md5').update(buf).digest('hex'),
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          mtime: st.mtime.toISOString()
        };
      })(),
      cellPx: CELL,
      parts: built.parts,
      materials: built.materials,
      shadowCheck: shadowCheck,
      zoom: zoom,
      oldScreen: before.stats.map((s) => ({
        bbox: [Math.round(s.w * zoom), Math.round(s.h * zoom)],
        area: Math.round(s.areaSolid * zoom * zoom),
        aspect: s.aspect, sat: s.sat
      })),
      rows: rows,
      anchors: rows.map((r) => r[anchorKey]),
      anchorUsed: anchorKey,
      anchorFoot: rows.map((r) => r.anchorFoot),
      anchorFootOnly: rows.map((r) => r.anchorFootOnly),
      anchorLowest: rows.map((r) => r.anchorLowest),
      footDelta: rows.map((r) => r.footDelta),
      extrasDip: rows.map((r) => r.extrasDip),
      extrasCheck: extrasCheck,
      feetCheck: feetCheck,
      kSpan: kSpan,
      /* 无描边版本的逐朝向 k（三族三列图中间列用；与带描边 k 分开记） */
      noRimKs: noRimKs,
      /* 接入锚点：数字=8 朝向统一；数组=逐朝向（悬浮族，§3.10.4） */
      anchorY: ANCHOR_ROWS || CONTRACT_ANCHOR,
      cellBbox: [built.bboxW, built.bboxH],
      bottomMaxInCell: built.bottomMax,
      edge: {
        rule: '1× 合成后，剪影边缘像素与同位置地砖的 |ΔL|（Rec.709 亮度，0–255）；p25 = 最弱四分位',
        old: oldEdge.dirs,
        new: newEdge.dirs,
        T: newEdge.T
      }
    };
    fs.writeFileSync(path.join(OUT, `${PREFIX}accept.json`), JSON.stringify(report, null, 2), 'utf8');

    // ---------- 4) 1× 实机可读性图：带地砖，主角/机械族压契约锚点，符文族用独立 anchorY ----------
    const floorShot = await evalJson(send, `window.__makeFloorShot(${JSON.stringify(built.sheet)}, ${JSON.stringify({
      label: meta.name,
      zoom: zoom,
      anchorY: ANCHOR_ROWS || CONTRACT_ANCHOR,
      anchors: rows.map((r) => r[anchorKey]),
      ks: rows.map((r) => r.k),
      labels: rows.map((r) => r.draw.bbox[0] + 'x' + r.draw.bbox[1])
    })})`);
    await savePng(send, `${PREFIX}floor1x.png`, floorShot);

    /* 5) 改前/改后 逐条对照（只主角本轮做；机械族还没提质） */
    if (UNIT === 'hero') {
      const roundShot = await evalJson(send, `window.__makeRoundCompare(${JSON.stringify({
        aUrl: '/out/v8_' + PREFIX + 'sheet.png',
        bUrl: '/out/' + PREFIX + 'sheet.png',
        aKs: prevKs || rows.map((r) => r.k),
        bKs: rows.map((r) => r.k),
        anchorY: CONTRACT_ANCHOR,
        zoom: zoom,
        title: '主角 · 第 9 轮：四条最弱项 改前 / 改后（同机位、同相机）',
        items: [
          { mode: 'fit', row: 0, title: '① 侧视 E：帽檐前伸 / 帽背亮线 / 杖头离开身体轮廓', note: '看头部有没有"朝向"，杖与帽之间是否留出空隙' },
          { mode: 'fit', row: 4, title: '① 侧视 W：同一问题的另一侧', note: '另一侧要同样成立，不能只在 E 朝向修好' },
          { mode: 'fit', row: 2, title: '② 袍摆：整圈发光环 → 三段摆缘细边 + 前后错落', note: '1× 时这一圈曾是"地上的发光盆"' },
          { mode: 'fit', row: 6, title: '③ 背面 N：肩线提亮 + 后脑体积 + 披风三片', note: '原来是一整块深色梯形' },
          { mode: 'strip', rows: [2, 3, 1], title: '④ 鞋尖：S / SW / SE 在 1× 实机下', note: '同一锚点、同一 k 口径，只比模型' }
        ]
      })})`);
      await savePng(send, `${PREFIX}round9.png`, roundShot);
    }

    // 控制台表
    console.log(`单位：${UNIT}${ENEMY_KEY ? '（' + ENEMY_KEY + '）' : ''}`);
    console.log('dir |  旧 bbox / 面积 / 比 / 饱和  |  格内 bbox / 面积 / 比  |   k    |  落地 bbox / 面积(屏) / 比(Δ旧) | 脚锚点 / 最低 / Δ');
    rows.forEach((r) => {
      if (!r.ok && r.old === undefined) { console.log(r.dir, 'MISSING'); return; }
      const dAspect = ((r.draw.aspect / r.old.aspect - 1) * 100).toFixed(0);
      console.log(
        `${r.dir.padEnd(3)} | ${String(r.old.bbox[0]).padStart(3)}x${String(r.old.bbox[1]).padStart(3)} ${String(r.old.area).padStart(5)} ${String(r.old.aspect).padStart(5)} ${String(r.old.sat).padStart(5)} | ` +
        `${String(r.cell.bbox[0]).padStart(3)}x${String(r.cell.bbox[1]).padStart(3)} ${String(r.cell.area).padStart(5)} ${String(r.cell.aspect).padStart(5)} | ${String(r.k).padStart(6)} | ` +
        `${String(r.draw.bbox[0]).padStart(3)}x${String(r.draw.bbox[1]).padStart(3)} ${String(r.draw.screenArea).padStart(5)} ${String(r.draw.aspect).padStart(5)} (${dAspect}%) | ` +
        `${r.anchorFoot} / ${r.anchorLowest} / ${r.footDelta}`
      );
    });
    const avgOldSat = before.stats.reduce((a, s) => a + s.sat, 0) / 8;
    const avgNewSat = after.reduce((a, s) => a + s.sat, 0) / 8;
    console.log(`\n平均饱和度：旧 ${avgOldSat.toFixed(3)} / 新 ${avgNewSat.toFixed(3)}（目标 ≥ 旧×0.90 = ${(avgOldSat * 0.9).toFixed(3)}）`);
    console.log(`k 跨度：${kList.length ? Math.min.apply(null, kList) + '–' + Math.max.apply(null, kList) + `（${(kSpan * 100).toFixed(1)}%）` : 'N/A'}`);
    console.log(`无描边 k（三列对照中间列用）：${noRimKs.map((k, i) => `${DIRS[i]}:${k}`).join(' ')}`);
    console.log(`接入锚点：${ANCHOR_ROWS ? ANCHOR_ROWS.map((a, i) => `${DIRS[i]}:${a}`).join(' ') : CONTRACT_ANCHOR + '（8 朝向统一）'}`);
    console.log(`脚锚点（中间列带最低 y+1）：${rows.map((r) => `${r.dir}:${r.anchorFoot}`).join(' ')}`);
    console.log(`全 bbox 最低（含杖底/展翼/尾刺投影）：${rows.map((r) => `${r.dir}:${r.anchorLowest}`).join(' ')}`);
    console.log(`接入锚点（${anchorKey}，已排除法杖/展翼/尾刺）：${rows.map((r) => `${r.dir}:${r.anchorFootOnly}`).join(' ')}`);
    if (feetCheck) {
      console.log(`法杖对照（含杖最低 − 隐藏杖最低）：${feetCheck.map((e) => `${e.dir}:${e.bottomMid - e.bottomFeet}`).join(' ')}`);
    }
    if (extrasCheck) {
      console.log(`展翼/尾刺对照（正常最低 − 隐藏后最低）：${extrasCheck.map((e) => `${e.dir}:${e.delta}`).join(' ')}`);
      console.log(`  0 = 锚点完全来自履带本体；非 0 = 该朝向有展翼/尾刺探到履带下方，已在 extrasDip 单列`);
    }
    if (shadowCheck) {
      console.log(`接触阴影对照（带阴影最低 − 无阴影最低，面积差）：${shadowCheck.map((e) => `${e.dir}:${e.delta}px/${e.areaWith - e.areaNoShadow}`).join(' ')}`);
    }
    console.log(`格内分辨率：${CELL}×${CELL}　部件数：${built.parts}　独立材质数：${built.materials}`);
    /* 1× 轮廓对比度：逐朝向把新值贴在旧值后面，一眼看哪一向不达标 */
    const eOld = oldEdge.dirs;
    const eNew = newEdge.dirs;
    console.log(`\n1× 轮廓对比度（灰阶 0–255，边缘 |ΔL| vs 地砖；门槛 = 旧画法）`);
    console.log(`诊断：T=${newEdge.T} zoom=${newEdge.zoom}　旧 bbox: ${JSON.stringify(eOld.map((s) => s.box))}`);
    console.log('dir | 旧 mean / p25 | 新 mean / p25 | 判定(mean & p25 均≥旧)');
    eOld.forEach((o, i) => {
      const n = eNew[i];
      const pass = n.mean >= o.mean && n.p25 >= o.p25;
      console.log(`${o.dir.padEnd(3)} | ${String(o.mean).padStart(5)} / ${String(o.p25).padStart(5)} | ` +
        `${String(n.mean).padStart(5)} / ${String(n.p25).padStart(5)} | ${pass ? 'PASS' : 'FAIL'} (Δmean ${(n.mean - o.mean).toFixed(1)}, Δp25 ${(n.p25 - o.p25).toFixed(1)})`);
    });
    const avgOldEdge = eOld.reduce((a, s) => a + s.mean, 0) / 8;
    const avgNewEdge = eNew.reduce((a, s) => a + s.mean, 0) / 8;
    const avgOldP25 = eOld.reduce((a, s) => a + s.p25, 0) / 8;
    const avgNewP25 = eNew.reduce((a, s) => a + s.p25, 0) / 8;
    console.log(`平均：旧 mean ${avgOldEdge.toFixed(1)} / p25 ${avgOldP25.toFixed(1)}　→　新 mean ${avgNewEdge.toFixed(1)} / p25 ${avgNewP25.toFixed(1)}`);
  } finally {
    await close();
    server.close();
  }
}

if (process.argv[2] === 'trio') {
  runTrio().catch((e) => { console.error('TRIO FAIL:', e.message); process.exit(1); });
} else {
  main().catch((e) => { console.error(`${UNIT.toUpperCase()} ACCEPT FAIL:`, e.message); process.exit(1); });
}
