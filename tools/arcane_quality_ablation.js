/* ============================================================================
 * 自适应画质 · 第 2 步「降一半省多少」配对消融（2026-11-08）
 * ----------------------------------------------------------------------------
 * 口径（按用户要求）：
 *   1. 同一进程内交替跑 A / B，共 3 轮；每轮 A、B 各跑 N 帧；
 *   2. 只报 A→B 的差值（Δp50 / Δp95 / 超预算帧数），绝对值一律不可引用；
 *   3. |Δp95| < 2.2ms → 写「不可分辨」；
 *   4. 配对全部在同一个页面实例里完成：先 A 后 B（奇数轮）/ 先 B 后 A（偶数轮），
 *      互相抵消预热与 GC 漂移。
 *
 * 两条口径分开：
 *   CPU  —— update + render 的 JS 耗时（不做画布读回）；
 *   RASTER —— 每帧追加一次 1px getImageData 强制冲刷（做像素填充才看得见分辨率）。
 *
 * 消融维度（全部运行时开关，不改主文件任何字节）：
 *   particles  300 粒 → 150 粒（粒子上限砍一半）
 *   secondPass 迷雾第二遍 on → off（全屏 drawImage 2 遍 → 1 遍）
 *   parallax  三层视差 + 远景雾幕 + 地面延伸带 on → off（测「层次」的价格，仅作上限参考）
 *   bloom      背景泛光 on → off（预计低于分辨力，用来证伪）
 *   effects    drawEffects 整段 on → off（粒子/特效通道价格上限）
 *   dpr        2 → 1（像素总量降到 1/4；只有 RASTER 口径能看出来）
 *
 * 用法：node arcane_quality_ablation.js [--frames 120] [--rounds 3]
 * ============================================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.ARCANE_PORT || 9792);
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'perf');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 读命令行参数
 * @returns {{frames:number, rounds:number}} 参数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { frames: 120, rounds: 3 };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--frames') o.frames = Number(a[i + 1]);
    if (a[i] === '--rounds') o.rounds = Number(a[i + 1]);
  }
  return o;
}

/**
 * 分位数（线性插值）
 * @param {number[]} arr 数值
 * @param {number} q 0~1
 * @returns {number} 分位值
 */
function pct(arr, q) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/**
 * 把一组帧耗时压成三个指标
 * @param {number[]} arr 帧耗时（ms）
 * @returns {{p50:number,p95:number,over:number,n:number}} 指标
 */
function stats(arr) {
  return {
    p50: +pct(arr, 0.5).toFixed(2),
    p95: +pct(arr, 0.95).toFixed(2),
    over: arr.filter((v) => v > 16.7).length,
    n: arr.length
  };
}

(async () => {
  const args = parseArgs();
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1920,1080', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪（可能 profile 被占用）');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  ws.onclose = () => { console.error('!! WebSocket 关闭（浏览器进程可能崩溃）'); process.exit(2); };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  // 无头默认 dpr=1；这里不设 deviceScaleFactor，dpr 由页面内覆盖控制
  // 1280×720：软件光栅的固定开销更小，单帧≈数十毫秒，p95 不被读回抖动主导；
  // 档位结论只依赖「像素总量」的相对变化，不依赖这个视口大小。
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  /**
   * 轮询等待某个表达式为真（2.7MB 页面冷启动解析时间不稳定）
   * @param {string} expr 页面内表达式
   * @param {number} timeout 超时毫秒
   * @returns {Promise<boolean>} 是否等到
   */
  const waitFor = async (expr, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = await ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`);
      if (ok) return true;
      await sleep(200);
    }
    return false;
  };

  // -------- 载入 + 清档 + 开局（只做一次，后续全部同进程交替） --------
  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await send('Page.navigate', { url });
  if (!await waitFor('typeof state !== "undefined" && document.getElementById("btnStart")')) throw new Error('页面未就绪');
  await ev(`(() => { try { localStorage.clear(); } catch (e) {} return true; })()`);
  await send('Page.navigate', { url });
  if (!await waitFor('typeof state !== "undefined" && document.getElementById("btnStart")')) throw new Error('重载后页面未就绪');
  await ev(`(() => { const el = document.getElementById('btnStart'); if (el) el.click(); return true; })()`);
  if (!await waitFor('state.floor === 1', 8000)) throw new Error('开局失败');

  // -------- 装一套页面内探针：prep / run / cond（每次重载页面后都要重装） --------
  const INSTALL = `(() => {
    window.__Q = (function () {
      const P = { kind: 'S2', cap: 300 };

      /** 设置 devicePixelRatio（给分辨率消融用），并重算画布尺寸；值没变就不重分配画布 */
      function setDpr(v) {
        if (window.__forcedDpr === v) return;
        window.__forcedDpr = v;
        try {
          Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: function () { return v; } });
        } catch (e) { /* 忽略 */ }
        resizeCanvas();
      }

      /** 布置场景（每次换条件都重来一遍，保证 A/B 起始状态一致） */
      function prep(kind) {
        P.kind = kind;
        ENEMY_BUDGET_CONFIG.adaptive.enabled = false;
        window.requestAnimationFrame = function () { return 0; };
        // 每个格子都先恢复「高档基线」，避免上一格的消融残留污染下一格
        setDpr(2);
        P.cap = 300;
        FOG_CONFIG.secondPass = true;
        if (typeof setParallaxEnabled === 'function') setParallaxEnabled(true);
        if (typeof setPostFxItem === 'function') setPostFxItem('bloom', true);

        if (kind === 'S1') {
          /* S1 代理场景：第 1 层战斗房 + 5 只敌人。
             为什么要代理：同进程反复配对不能靠「重载页面」回到真实开局，
             否则 dpr 覆盖与预热都会重来。这里保证每次都是同一间房、同 5 只怪。 */
          if (state.floor !== 1) __roamDebug.setFloor(1);
          const r1 = state.rooms.filter(function (r) { return r.type === 'battle'; })[0] || state.rooms[0];
          __roamDebug.teleport(r1.cx, r1.cy);
          __roamDebug.despawnAll();
          const ids1 = Object.keys(ENEMY_CONFIG).slice(0, 5);
          for (let i = 0; i < 5; i += 1) {
            const a = (Math.PI * 2 * i) / 5;
            __roamDebug.spawnEnemyAt(ids1[i], r1.cx + Math.cos(a) * 150, r1.cy + Math.sin(a) * 150, {});
          }
          state.particles.length = 0;
          state.aoeZones = state.aoeZones || [];
          state.aoeZones.length = 0;
          state.shake.time = 0;
          state.mode = 'playing'; state.status = 'playing';
          return { floor: state.floor, roomType: r1.type, enemies: state.enemies.length, particles: 0,
            canvas: { w: canvas.width, h: canvas.height }, dpr: window.devicePixelRatio,
            room: { w: Math.round(r1.w), h: Math.round(r1.h) } };
        }
        if (state.floor !== 20) __roamDebug.setFloor(20);
        const room = state.rooms.filter(function (r) { return r.type === 'battle' || r.type === 'elite'; })
          .sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); })[0] || state.rooms[0];
        __roamDebug.teleport(room.cx, room.cy);
        __roamDebug.despawnAll();
        const ids = Object.keys(ENEMY_CONFIG).slice(0, 9);
        for (let i = 0; i < 9; i += 1) {
          const a = (Math.PI * 2 * i) / 9;
          __roamDebug.spawnEnemyAt(ids[i], room.cx + Math.cos(a) * 150, room.cy + Math.sin(a) * 150, {});
        }
        state.particles.length = 0;
        state.aoeZones = state.aoeZones || [];
        state.aoeZones.length = 0;
        if (kind === 'S3') {
          spawnAoeZone({ type: 'field', x: room.cx + 60, y: room.cy, radius: 120, color: '#8fe9ff',
            accent: '#8fe9ff', damage: 0, life: 999, tick: 0, tickInterval: 0.5 });
          spawnAoeZone({ type: 'lavaBand', x: room.cx - 60, y: room.cy, radius: 90, width: 60,
            from: { x: room.cx - 150, y: room.cy - 40 }, to: { x: room.cx + 40, y: room.cy + 60 },
            color: '#ff8a3d', accent: '#ff8a3d', damage: 0, life: 999, tick: 0, tickInterval: 0.5 });
          state.shake.time = 999; state.shake.power = 3.2; state.shake.dur = 1;
        }
        state.mode = 'playing'; state.status = 'playing';
        return { floor: state.floor, roomType: room.type, enemies: state.enemies.length,
          particles: state.particles.length, canvas: { w: canvas.width, h: canvas.height },
          dpr: window.devicePixelRatio, room: { w: Math.round(room.w), h: Math.round(room.h) } };
      }

      /** 切换某个消融维度（on=true 表示保持原样/开启） */
      function cond(name, on) {
        if (name === 'particles') { P.cap = on ? 300 : 150; return P.cap; }
        if (name === 'secondPass') { FOG_CONFIG.secondPass = !!on; return FOG_CONFIG.secondPass; }
        if (name === 'parallax') {
          if (typeof setParallaxEnabled === 'function') setParallaxEnabled(!!on);
          else PARALLAX_CONFIG.enabled = !!on;
          return PARALLAX_CONFIG.enabled;
        }
        if (name === 'bloom') { if (typeof setPostFxItem === 'function') setPostFxItem('bloom', !!on); return !!on; }
        if (name === 'dpr') { setDpr(on ? 2 : 1); return window.devicePixelRatio; }
        if (name === 'dpr15') { setDpr(on ? 2 : 1.5); return window.devicePixelRatio; }
        if (name === 'tier') {
          /* 组合档：on=高档（dpr2 / 300 粒）；off=低档（dpr1 / 120 粒）。
             迷雾第二遍不参与档位（它会露出未探索区"路的虚影"，玩家的原话是"不要为凑档位牺牲层次"）。 */
          if (on) { setDpr(2); P.cap = 300; }
          else { setDpr(1); P.cap = 120; }
          return { dpr: window.devicePixelRatio, cap: P.cap, secondPass: FOG_CONFIG.secondPass };
        }
        if (name === 'tierMid') {
          /* 组合档：on=高档；off=中档（dpr1.5 / 220 粒 / 迷雾仍两遍） */
          if (on) { setDpr(2); P.cap = 300; FOG_CONFIG.secondPass = true; }
          else { setDpr(1.5); P.cap = 220; FOG_CONFIG.secondPass = true; }
          return { dpr: window.devicePixelRatio, cap: P.cap, secondPass: FOG_CONFIG.secondPass };
        }
        return null;
      }

      /**
       * 跑 frames 帧，返回相对毫秒数数组（前 6 帧预热丢弃）
       * @param {number} frames 帧数
       * @param {boolean} sync true = 每帧追加 1px getImageData
       */
      function run(frames, sync) {
        const p = state.player;
        const room0 = state.rooms.find(function (r) { return r.id === state.currentRoomId; }) || state.rooms[0];
        const out = [];
        for (let i = 0; i < frames + 6; i += 1) {
          p.invuln = 9; p.hp = p.hpMax; p.aether = p.aetherMax;
          state.mode = 'playing'; state.status = 'playing';
          if (P.kind === 'S3') {
            if (state.particles.length > P.cap) state.particles.splice(0, state.particles.length - P.cap);
            if (state.particles.length < P.cap) {
              addBurst(room0.cx, room0.cy, '#8fe9ff', P.cap - state.particles.length, 220, null, Math.PI * 2, true);
            }
          }
          const t0 = performance.now();
          update(1 / 60);
          render();
          if (sync) { try { ctx.getImageData(0, 0, 1, 1); } catch (e) { /* 忽略 */ } }
          const t1 = performance.now();
          if (i >= 6) out.push(t1 - t0);
        }
        return { ms: out, particles: state.particles.length, enemies: state.enemies.length,
          canvas: { w: canvas.width, h: canvas.height }, dpr: window.devicePixelRatio,
          parallaxMs: +(state.parallax && state.parallax.drawMs || 0) };
      }

      return { prep: prep, cond: cond, run: run, P: P };
    })();
    return true;
  })()`;
  await ev(INSTALL);

  /**
   * 每个配对开始前重新载入页面
   * ------------------------------------------------------------
   * 为什么要重载：同进程连跑十来个格子会累积离屏画布与 GC 尖峰，
   * p95 会被 GC 拖到 80–120ms，读数不可用。配对本身仍然在「同一个页面实例内
   * 交替 A/B」，重载只发生在配对边界，不破坏配对口径。
   * @returns {Promise<void>}
   */
  const freshLoad = async () => {
    await send('Page.navigate', { url });
    if (!await waitFor('typeof state !== "undefined" && document.getElementById("btnStart")', 20000)) throw new Error('页面未就绪');
    await ev(`(() => { try { localStorage.clear(); } catch (e) {} return true; })()`);
    await send('Page.navigate', { url });
    if (!await waitFor('typeof state !== "undefined" && document.getElementById("btnStart")', 20000)) throw new Error('重载后页面未就绪');
    await ev(`(() => { const el = document.getElementById('btnStart'); if (el) el.click(); return true; })()`);
    if (!await waitFor('state.floor === 1', 8000)) throw new Error('开局失败');
    await ev(INSTALL);
  };

  const report = {
    when: new Date().toISOString(),
    viewport: { w: 1280, h: 720 },
    framesPerCell: args.frames,
    rounds: args.rounds,
    note: '同进程交替配对；只读差值，绝对值不可引用；|Δp95|<2.2ms 记不可分辨',
    pairs: {}
  };

  /**
   * 读取上一次的报告（分段补测时保留已测格子，不互相覆盖）
   * @returns {Object} 旧报告
   */
  const loadPrev = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(OUT, 'quality-ablation.json'), 'utf8'));
    } catch (e) { return { pairs: {} }; }
  };
  const prev = loadPrev();

  /**
   * 落盘（新旧格子合并；崩溃时已测到的数据不丢）
   * @returns {void}
   */
  const save = () => {
    try {
      const merged = Object.assign({}, prev.pairs, report.pairs);
      fs.writeFileSync(path.join(OUT, 'quality-ablation.json'),
        JSON.stringify(Object.assign({}, report, { pairs: merged }), null, 2), 'utf8');
    } catch (e) { /* 忽略 */ }
  };

  /**
   * 配对执行一个消融维度
   * @param {string} label 控制台标签
   * @param {string} kind 场景
   * @param {string} name 消融维度名
   * @param {boolean} sync 是否追加光栅同步
   * @param {number} [frames] 每格帧数（默认取 --frames）
   * @param {string} [key] 报告键名（默认与 label 相同；同维度不同口径需要区分）
   * @returns {Promise<Object>} 配对结果
   */
  const pair = async (label, kind, name, sync, frames, key) => {
    const N = frames || args.frames;
    const K = key || label;
    await freshLoad();   // 每个配对用干净页面，避免离屏画布/GC 累积污染 p95
    const aArr = [];
    const bArr = [];
    const rounds = [];
    for (let r = 0; r < args.rounds; r += 1) {
      const aFirst = (r % 2) === 0;
      const one = async (on) => {
        await ev(`__Q.prep('${kind}'); __Q.cond('${name}', ${on}); true`);
        const m = await ev(`__Q.run(${N}, ${sync})`);
        return m;
      };
      let a; let b;
      if (aFirst) {
        a = await one(true);
        b = await one(false);
      } else {
        b = await one(false);
        a = await one(true);
      }
      aArr.push(...a.ms);
      bArr.push(...b.ms);
      rounds.push({
        a: stats(a.ms),
        b: stats(b.ms),
        aInfo: { canvas: a.canvas, dpr: a.dpr, particles: a.particles, parallaxMs: a.parallaxMs },
        bInfo: { canvas: b.canvas, dpr: b.dpr, particles: b.particles, parallaxMs: b.parallaxMs }
      });
    }
    const sa = stats(aArr);
    const sb = stats(bArr);
    const d = { p50: +(sb.p50 - sa.p50).toFixed(2), p95: +(sb.p95 - sa.p95).toFixed(2), over: sb.over - sa.over };
    const undecidable = Math.abs(d.p95) < 2.2;
    report.pairs[K] = { kind, dim: name, caliber: sync ? 'RASTER' : 'CPU', framesPerCell: N,
      a: sa, b: sb, delta: d, undecidable, rounds };
    console.log(`  ${label.padEnd(26)} A(p50 ${sa.p50}/p95 ${sa.p95}) B(p50 ${sb.p50}/p95 ${sb.p95})`
      + ` Δp50 ${d.p50 > 0 ? '+' : ''}${d.p50} Δp95 ${d.p95 > 0 ? '+' : ''}${d.p95}`
      + ` 超预算 ${d.over > 0 ? '+' : ''}${d.over}${undecidable ? '  [不可分辨]' : ''}${sync ? '  [光栅]' : ''}`);
    save();
    return report.pairs[K];
  };

  console.log('【配对消融 · 轮次交替，只读差值】');
  const RF = 30;   // 光栅格子帧数（每帧强制冲刷，成本高）
  const only = args.only || '';
  /** 只跑标签里含 --only 关键字的配对（分段补测用） */
  const want = (label) => !only || label.indexOf(only) >= 0;

  // —— CPU 口径：命令录制 / 对象分配这一层 ——
  if (want('粒子上限')) await pair('S3 粒子上限 300→150', 'S3', 'particles', false);
  if (want('迷雾第二遍 on→off')) {
    await pair('S3 迷雾第二遍 on→off', 'S3', 'secondPass', false);
    await pair('S2 迷雾第二遍 on→off', 'S2', 'secondPass', false);
  }
  if (want('背景泛光')) {
    await pair('S3 背景泛光 on→off', 'S3', 'bloom', false);
    await pair('S2 背景泛光 on→off', 'S2', 'bloom', false);
  }
  if (want('视差整层')) await pair('S2 视差整层 on→off', 'S2', 'parallax', false);

  // —— RASTER 口径：像素填充这一层（分辨率 / 视差 / 组合档只能在这里看） ——
  if (want('粒子上限（光栅）')) await pair('S3 粒子上限 300→150（光栅）', 'S3', 'particles', true, RF, 'raster:S3 particles');
  if (want('分辨率 2→1')) {
    await pair('S1 分辨率 2→1（光栅）', 'S1', 'dpr', true, RF, 'raster:S1 dpr');
    await pair('S2 分辨率 2→1（光栅）', 'S2', 'dpr', true, RF, 'raster:S2 dpr');
    await pair('S3 分辨率 2→1（光栅）', 'S3', 'dpr', true, RF, 'raster:S3 dpr');
  }
  if (want('2→1.5')) {
    await pair('S2 分辨率 2→1.5（光栅）', 'S2', 'dpr15', true, RF, 'raster:S2 dpr15');
    await pair('S3 分辨率 2→1.5（光栅）', 'S3', 'dpr15', true, RF, 'raster:S3 dpr15');
  }
  if (want('视差整层 on→off（光栅）')) await pair('S2 视差整层 on→off（光栅）', 'S2', 'parallax', true, RF, 'raster:S2 parallax');
  if (want('迷雾第二遍 on→off（光栅）')) await pair('S3 迷雾第二遍 on→off（光栅）', 'S3', 'secondPass', true, RF, 'raster:S3 secondPass');
  if (want('高档→低档')) {
    await pair('S1 高档→低档组合（光栅）', 'S1', 'tier', true, RF, 'raster:S1 tier');
    await pair('S2 高档→低档组合（光栅）', 'S2', 'tier', true, RF, 'raster:S2 tier');
    await pair('S3 高档→低档组合（光栅）', 'S3', 'tier', true, RF, 'raster:S3 tier');
  }
  if (want('高档→中档')) {
    await pair('S1 高档→中档组合（光栅）', 'S1', 'tierMid', true, RF, 'raster:S1 tierMid');
    await pair('S2 高档→中档组合（光栅）', 'S2', 'tierMid', true, RF, 'raster:S2 tierMid');
    await pair('S3 高档→中档组合（光栅）', 'S3', 'tierMid', true, RF, 'raster:S3 tierMid');
  }

  save();
  console.log('\n已落盘 .screenshots/perf/quality-ablation.json');
  killEdge(edge);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
