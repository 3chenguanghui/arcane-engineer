/**
 * 剪影参数扫描（只读，运行时改内存里的美术配置，不落盘）
 * ------------------------------------------------------------------
 * 目的：在不动文件的前提下，先扫出"下摆尖刺多短 / 头冠多高"能让四族可辨
 * 距离保持在基线 90% 以上，再把选中的参数真正写进文件。
 * 读数口径与 tools/arcane_identity.js 相同：__roamDebug.identity.readOne(key,60)。
 * 用法：node _probe/sil_sweep_probe.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const BASELINE = path.join(ROOT, '.screenshots', 'art', 'identity-baseline-player.html.json');
const OUT = path.join(ROOT, 'shots', 'audit');
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-sweep-${process.pid}-${Date.now()}`);
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
const PORT = 9500 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge */
function findEdge() { for (const p of EDGE) if (fs.existsSync(p)) return p; throw new Error('找不到 msedge.exe'); }

/** 启动 headless Edge 并连 CDP */
async function boot() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  spawn(findEdge(), [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
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
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };
  /** 截画面（scale>1 放大，用来看清剪影与主体层次） */
  const shot = async (name, clip, scale) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.w), height: Math.round(clip.h), scale: scale || 1 };
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return name;
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进入战斗（选角色 → 确认 → 等 playing），再传送到战斗房正中并清场 */
async function enterPlaying(t) {
  const { ev } = t;
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  /* 必须等页面初始化完成：标题按钮在脚本监听绑定前就有宽度，点早了等于没点 */
  await sleep(1400);
  await ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return 1; })()`);
  let cards = 0;
  for (let i = 0; i < 80; i += 1) {
    cards = await ev(`(() => document.querySelectorAll('.char-card').length)()`);
    if (cards > 0) break;
    await sleep(200);
  }
  if (!cards) throw new Error('选角卡没有出现（btnStart 点击可能没生效）');
  await ev(`(() => { document.querySelector('.char-card').click(); return 1; })()`);
  for (let i = 0; i < 20; i += 1) {
    if (await ev(`(() => !!window.__charArmed)()`) === true) break;
    await sleep(100);
  }
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return 1; })()`);
  for (let i = 0; i < 150; i += 1) {
    const st = await ev(`(() => { const d = window.__roamDebug; if (!d || !d.getState) return null; return { mode: d.getState().mode }; })()`);
    if (st && st.mode === 'playing') break;
    if (i > 0 && i % 40 === 0) await ev(`(() => { document.getElementById('btnCharConfirm').click(); return 1; })()`);
    await sleep(200);
  }
  const mode = await ev(`(() => window.__roamDebug.getState().mode)()`);
  if (mode !== 'playing') throw new Error('没能进入 playing（当前 mode=' + mode + '）');
  const room = await ev(`(() => { const r = (state.rooms || []).find((x) => x.type === 'battle') || state.rooms[1]; window.__roamDebug.teleport(r.cx, r.cy); return { id: r.id }; })()`);
  await sleep(900);
  await ev(`(() => { try { window.__roamDebug.clearEnemies(); } catch (e) {} const p = state.player; p.vx = 0; p.vy = 0; p.facingAngle = 0; p.walkBlend = 0; p.castAnim = 0; p.squash = 0; return 1; })()`);
  await sleep(500);
  return room;
}

/** 剪影距离（与可辨测试同一公式） */
function silDist(a, b) {
  return Math.abs(a.aspect - b.aspect) + Math.abs(a.complexity - b.complexity) / 3 + Math.abs(a.fill - b.fill);
}

/** 主流程 */
(async () => {
  const t = await boot();
  try {
    const room = await enterPlaying(t);
    console.log('room=' + JSON.stringify(room));
    const unitsRaw = await t.ev('__roamDebug.identity.units()');
    // 敌人读数（不改剪影参数，固定不变）
    const enemy = {};
    for (const u of unitsRaw) enemy[u.id] = await t.ev(`__roamDebug.identity.readOne(${JSON.stringify(u.id)}, 60)`);
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).after.metrics;
    const repOf = (art) => unitsRaw.find((u) => u.art === art);
    const reps = ['mech', 'rune', 'void'].map((r) => repOf(r)).filter(Boolean);
    /* 候选参数：hemDrop = 下摆尖刺长度；crownLift = 头冠高度；hemSpread = 下摆半宽 */
    const cands = [
      { tag: 'now', hemDrop: 34, hemSpread: 13, crownLift: 9.5 },
      { tag: 'h26c12', hemDrop: 26, hemSpread: 13, crownLift: 12 },
      { tag: 'h22c15', hemDrop: 22, hemSpread: 13, crownLift: 15 },
      { tag: 'h20c18', hemDrop: 20, hemSpread: 13, crownLift: 18 },
      { tag: 'h20c9', hemDrop: 20, hemSpread: 13, crownLift: 9.5 },
      { tag: 'h24c14w15', hemDrop: 24, hemSpread: 15, crownLift: 14 },
      { tag: 'h26c16w15', hemDrop: 26, hemSpread: 15, crownLift: 16 }
    ];
    const rows = [];
    /* 同机位裁剪框（角色不动，整轮共用） */
    const clip = await t.ev(`(() => {
      const z = cameraZoom(); const dpr = ctx.canvas.width / state.viewW;
      return { x: Math.max(0, (state.player.x - state.cam.x) * z * dpr - 60), y: Math.max(0, (state.player.y - state.cam.y) * z * dpr - 70), w: 120, h: 145 };
    })()`);
    for (const c of cands) {
      await t.ev(`(() => {
        CHARACTER_SILHOUETTE2.player.hemDrop = ${c.hemDrop};
        CHARACTER_SILHOUETTE2.player.hemSpread = ${c.hemSpread};
        PLAYER_ART_CONFIG.crownLift = ${c.crownLift};
        return 1;
      })()`);
      const pm = await t.ev('__roamDebug.identity.readOne("player", 60)');
      const P = { key: 'player', aspect: pm.aspect, complexity: pm.complexity, fill: pm.fill };
      /* 7 条判据：6 个跨族代表对 + 玩家 vs 任意敌人最小 */
      const pairs = reps.map((u) => [P, { key: u.id, aspect: enemy[u.id].aspect, complexity: enemy[u.id].complexity, fill: enemy[u.id].fill }]);
      const names = reps.map((u) => 'player-' + u.id);
      const trio = [[0, 1], [0, 2], [1, 2]].map(([i, j]) => {
        const A = { aspect: enemy[reps[i].id].aspect, complexity: enemy[reps[i].id].complexity, fill: enemy[reps[i].id].fill };
        const B = { aspect: enemy[reps[j].id].aspect, complexity: enemy[reps[j].id].complexity, fill: enemy[reps[j].id].fill };
        return { pair: reps[i].id + '-' + reps[j].id, d: silDist(A, B), before: silDist(base[reps[i].id], base[reps[j].id]) };
      });
      const allPairs = pairs.map(([A, B], i) => ({ pair: names[i], d: silDist(A, B), before: silDist(base.player, base[B.key]) }))
        .concat(trio);
      let pMin = Infinity; let pWorst = null;
      unitsRaw.forEach((u) => { const d = silDist(P, enemy[u.id]); if (d < pMin) { pMin = d; pWorst = u.id; } });
      allPairs.push({ pair: 'player-vs-any', d: pMin, before: Object.keys(base).reduce((m, k) => (k === 'player' ? m : Math.min(m, silDist(base.player, base[k]))), Infinity) });
      const worstRatio = Math.min(...allPairs.map((p) => p.d / p.before));
      rows.push({ tag: c.tag, cfg: c, player: { aspect: pm.aspect, complexity: pm.complexity, fill: pm.fill, bbox: pm.bbox }, pWorst, worstRatio: Number(worstRatio.toFixed(3)), pairs: allPairs.map((p) => ({ pair: p.pair, now: Number(p.d.toFixed(3)), before: Number(p.before.toFixed(3)), ratio: Number((p.d / p.before).toFixed(3)) })) });
      console.log(c.tag + ' · aspect=' + pm.aspect + ' cx=' + pm.complexity + ' fill=' + pm.fill + ' bbox=' + pm.bbox.w + 'x' + pm.bbox.h + ' · 最差比=' + Math.round(worstRatio * 100) + '% (' + pWorst + (worstRatio >= 0.9 ? ' PASS' : ' FAIL') + ')');
      /* 同机位 3 倍特写：用来判断"尖刺 vs 法袍/兜帽/头冠"谁更抢眼 */
      await t.ev(`(() => { const p = state.player; p.facingAngle = 0; p.walkBlend = 0; p.castAnim = 0; p.squash = 0; return 1; })()`);
      await sleep(220);
      await t.shot(`sil-${c.tag}.png`, clip, 3);
    }
    fs.writeFileSync(path.join(OUT, 'sil-sweep.json'), JSON.stringify(rows, null, 2));
    console.log('\n明细已写 shots/audit/sil-sweep.json');
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exitCode = 2;
  } finally {
    t.close();
    process.exit(process.exitCode || 0);
  }
})();
