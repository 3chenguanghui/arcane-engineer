/**
 * 首屏可交互时间（冷启动）基线探针
 * ----------------------------------------------------------------------------
 * 口径（接入精灵前后必须完全一致）：
 *   · 每次跑之前新建一个空 user-data-dir → 冷启动，无缓存；
 *   · file:// 直接打开主文件，无本地服务器；
 *   · 窗口固定 1600×900，headless=new；
 *   · TTI 定义：从导航开始，到 `startGame` 已定义、`#btnStart` 已存在、
 *     `#game` 画布已插入，并且再等 2 个 rAF（首帧已提交）的时间；
 *   · 同时记录 FCP、DOMContentLoaded、loadEventEnd，便于判断是解析慢还是渲染慢。
 *
 * 用法：node tools/boot_tti.js [页面] [次数]
 * 产物：tools/boot_out/tti_<tag>.json
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
process.env.ARCANE_PROFILE_ROOT = path.join(__dirname, '..', '.testprofile', 'tti-' + Date.now());
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : path.join(ROOT, 'index_arcane_v2.html');
const RUNS = Math.max(1, parseInt(process.argv[3], 10) || 5);
const OUT_DIR = path.join(ROOT, 'tools', 'boot_out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 跑一次冷启动，返回各项时间（毫秒）
 * @param {number} idx 第几次
 * @returns {Promise<Object>} 读数
 */
async function once(idx) {
  const PORT = 9860 + idx;
  const profile = prepareProfile();
  /* TTI_HEADED=1 时不加 headless：用真机渲染路径做对照（窗口移到屏幕外，不抢焦点），
     用来区分"双峰是无头软件光栅特有"还是"真机也这样"。默认仍是无头。 */
  const headed = process.env.TTI_HEADED === '1';
  /* TTI_NOOCCL=1：关掉 Windows 原生窗口遮挡检测。
     有头窗口若放在屏幕外（-32000），系统会判定窗口被遮挡，Chrome 会停发 BeginFrame，
     rAF 与定时器一起停摆 ~900ms——这不是页面慢，是测量环境。用这个开关做对照。 */
  const nooccl = process.env.TTI_NOOCCL === '1';
  /* TTI_ONSCREEN=1：窗口放屏幕内（0,0）。屏幕外的窗口拿不到真实 vsync，
     BeginFrame 会断档 ~1s，把 TTI 推高；这是测量环境问题。
     这个开关用来取"真实可见窗口"的读数做对照。 */
  const onscreen = process.env.TTI_ONSCREEN === '1';
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    ...(headed ? [`--window-position=${onscreen ? '0,0' : '-32000,-32000'}`] : ['--headless=new']),
    ...(nooccl ? ['--disable-features=CalculateNativeWinOcclusion'] : []),
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    /* 三个反节流开关：headless 下后台化会让 rAF 被降频，
       实测同一份文件 TTI 会在 410ms / 1530ms 两个峰之间跳，
       报警的是"测量环境"，不是页面本身。 */
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1600,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(200);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

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
  await send('Page.enable');
  await send('Runtime.enable');

  /* 文档开始就注入计时器：轮到可交互时打点，不依赖外部轮询精度。
     判据修订（2026-11-14）：
       · 旧口径只看"2 个 rAF"，但 rAF 回调跑在首绘提交之前，
         实测会出现 TTI(394.7ms) < DCL(382.3)+首绘(696ms) 的样本，
         且 FCP 条目还没写进 performance，读到 null。
       · 新口径 TTI = max(2×rAF, FCP)：FCP 用 PerformanceObserver(buffered) 取，
         没到就等到它到（上限 1.5s）。首绘没发生就不算可交互。
       · 出错/超时写 __bootDiag（startGame/按钮/画布三态 + 异常列表），
         不再只返回 null。 */
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__tti = null;
      window.__fcp = null;
      window.__ttiRaf = null;
      window.__errors = [];
      window.__bootDiag = null;
      try {
        const po = new PerformanceObserver((list) => {
          list.getEntries().forEach((e) => {
            if (e.name === 'first-contentful-paint' && window.__fcp == null) {
              window.__fcp = e.startTime;
            }
          });
        });
        po.observe({ type: 'paint', buffered: true });
      } catch (err) { window.__errors.push('paint-observer:' + err.message); }
      /* 长任务：慢档若伴随 ≥50ms 的长任务，是主线程被占用；若没有长任务却仍晚绘，
         则更可能是合成/光栅侧排队。用来区分"页面慢"和"环境慢"。 */
      window.__longs = [];
      try {
        new PerformanceObserver((list) => {
          list.getEntries().forEach((e) => {
            window.__longs.push([Math.round(e.startTime), Math.round(e.duration)]);
          });
        }).observe({ type: 'longtask', buffered: true });
      } catch (err) { window.__errors.push('longtask-observer:' + err.message); }
      window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error)));
      window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection:' + String(e.reason)));
      /* 帧间隔：连续记录 rAF 时间戳（取前 300 帧）。
         慢档若出现单帧间隔几百毫秒，说明是"每帧太贵"（合成/滤镜/阴影/贴图解码），
         而不是"主线程被 JS 占住"。 */
      window.__rafTs = [];
      (function tickRaf() {
        window.__rafTs.push(performance.now());
        if (window.__rafTs.length < 300) requestAnimationFrame(tickRaf);
      })();
      /* 心跳：每 10ms 一次的 setInterval，跑在主线程上。
         慢档若 rAF 断档而心跳照常 → 主线程空闲，是合成/出帧侧不产帧；
         若心跳也一起断 → 主线程被某个任务占住。这是区分两者的唯一硬证据。 */
      window.__hb = [];
      window.__hbT = setInterval(() => {
        window.__hb.push(performance.now());
        if (window.__hb.length >= 400) clearInterval(window.__hbT);
      }, 10);
      /* LoAF（long-animation-frame）：Edge 156 支持。一条 LoAF 就是一个超过 50ms 的帧，
         duration 是整帧耗时，renderStart/styleAndLayoutStart 能把这帧拆成
         "脚本 / 渲染"两段——用来点名到底是 JS 还是合成/光栅。 */
      window.__loaf = [];
      try {
        new PerformanceObserver((list) => {
          list.getEntries().forEach((e) => {
            window.__loaf.push({
              s: Math.round(e.startTime),
              d: Math.round(e.duration),
              r: Math.round(e.renderStart || 0),
              l: Math.round(e.styleAndLayoutStart || 0)
            });
          });
        }).observe({ type: 'long-animation-frame', buffered: true });
      } catch (err) { window.__errors.push('loaf:' + err.message); }
      function snap() {
        return {
          startGame: typeof startGame === 'function',
          btn: !!document.getElementById('btnStart'),
          canvas: !!document.getElementById('game'),
          fcp: window.__fcp,
          raf: window.__ttiRaf,
          errors: window.__errors.slice(0, 10),
          at: performance.now()
        };
      }
      function tick() {
        const btn = document.getElementById('btnStart');
        const cv = document.getElementById('game');
        if (typeof startGame === 'function' && btn && cv) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            window.__ttiRaf = performance.now();
            const settle = () => {
              window.__tti = Math.max(window.__ttiRaf, window.__fcp == null ? 0 : window.__fcp);
              window.__bootDiag = snap();
            };
            if (window.__fcp != null) { settle(); return; }
            const t0 = performance.now();
            const waitPaint = () => {
              if (window.__fcp != null || performance.now() - t0 > 1500) settle();
              else requestAnimationFrame(waitPaint);
            };
            requestAnimationFrame(waitPaint);
          }));
        } else {
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
      setTimeout(() => {
        if (window.__bootDiag == null) window.__bootDiag = snap();
      }, 3000);
    })();`
  });

  const t0 = Date.now();
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });

  let tti = null;
  for (let i = 0; i < 300; i += 1) {
    const r = await send('Runtime.evaluate', {
      expression: 'window.__tti', returnByValue: true
    }).catch(() => null);
    if (r && r.result && r.result.value != null) { tti = r.result.value; break; }
    await sleep(100);
  }
  /* 超时也要把诊断取回来：分清"页面没起来"和"注入失败 / 卡在首绘" */
  const timing = await send('Runtime.evaluate', {
    expression: `(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paints = performance.getEntriesByType('paint').map(p => ({ name: p.name, t: p.startTime }));
      return {
        dcl: nav.domContentLoadedEventEnd || 0,
        load: nav.loadEventEnd || 0,
        paints,
        fcp: window.__fcp == null ? null : window.__fcp,
        diag: window.__bootDiag || null,
        longs: (window.__longs || []).slice(0, 12),
        rafTs: (window.__rafTs || []).slice(0, 300),
        hb: (window.__hb || []).slice(0, 400),
        loaf: (window.__loaf || []).slice(0, 16),
        wall: performance.now()
      };
    })()`,
    returnByValue: true
  });
  const v = (timing.result && timing.result.value) || {};
  const paintFcp = (v.paints || []).find((p) => p.name === 'first-contentful-paint');
  const paintFp = (v.paints || []).find((p) => p.name === 'first-paint');
  const fcpMs = paintFcp ? paintFcp.t : v.fcp;
  const fpMs = paintFp ? paintFp.t : null;
  const diag = v.diag || {};
  /* 帧间隔统计：rAF 时间戳相邻差。
     · 若间隔稳定在 ~16.7ms → 帧在正常产出，晚的可交互是主线程/脚本侧；
     · 若出现 100ms+ 的空档 → 帧根本没产出，卡在合成/光栅（CSS 滤镜、阴影、
       backdrop-filter、大图层、贴图上传都属于这一侧）。
     只统计首 2000ms，避开收尾噪声。 */
  const rafTs = (v.rafTs || []).filter((t) => t <= 2000);
  const gaps = [];
  for (let i = 1; i < rafTs.length; i += 1) {
    gaps.push({ t: Math.round(rafTs[i - 1]), g: +(rafTs[i] - rafTs[i - 1]).toFixed(1) });
  }
  const gs = gaps.map((x) => x.g).sort((a, b) => a - b);
  const pct = (p) => (gs.length ? gs[Math.min(gs.length - 1, Math.floor(p * gs.length))] : null);
  const frameGap = {
    n: gs.length,
    p50: pct(0.5),
    p95: pct(0.95),
    max: gs.length ? gs[gs.length - 1] : null,
    over50: gs.filter((g) => g >= 50).length,
    over100: gs.filter((g) => g >= 100).length,
    top: gaps.slice().sort((a, b) => b.g - a.g).slice(0, 3)
  };
  const frames1s = rafTs.filter((t) => t <= 1000).length;
  /* 心跳间隔：主线程可用性。10ms 定时器在无节流时应稳定在 10–16ms；
     出现几百毫秒空档 = 主线程被占。与 rAF 断档对比即可判定卡在哪一侧。 */
  const hbTs = (v.hb || []).filter((t) => t <= 2000);
  const hbGaps = [];
  for (let i = 1; i < hbTs.length; i += 1) hbGaps.push(+(hbTs[i] - hbTs[i - 1]).toFixed(1));
  const hbGapsSorted = hbGaps.slice().sort((a, b) => a - b);
  const hbStat = {
    n: hbGaps.length,
    p50: hbGapsSorted.length ? hbGapsSorted[Math.floor(hbGapsSorted.length / 2)] : null,
    max: hbGapsSorted.length ? hbGapsSorted[hbGapsSorted.length - 1] : null,
    over300: hbGaps.filter((g) => g >= 300).length
  };
  const res = {
    run: idx,
    ttiMs: tti == null ? null : +tti.toFixed(1),
    dclMs: +((v.dcl || 0)).toFixed(1),
    loadMs: +((v.load || 0)).toFixed(1),
    fcpMs: fcpMs == null ? null : +fcpMs.toFixed(1),
    fpMs: fpMs == null ? null : +fpMs.toFixed(1),
    longs: v.longs || [],
    loaf: v.loaf || [],
    frameGap,
    hb: hbStat,
    frames1s,
    settleMs: (tti == null || fcpMs == null) ? null : +(tti - fcpMs).toFixed(1),
    errs: (diag.errors || []).length,
    diag: tti == null ? diag : undefined,
    wallMs: Date.now() - t0
  };
  try { ws.close(); } catch (e) { /* ignore */ }
  try { edge.kill(); } catch (e) { /* ignore */ }
  await sleep(400);
  return res;
}

/**
 * 汇总：中位数 / 最小 / 最大
 * @param {number[]} xs 数列
 * @returns {Object} 统计
 */
function stat(xs) {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return { n: 0, median: null, p95: null, min: null, max: null };
  return {
    n: a.length,
    median: a[Math.floor(a.length / 2)],
    p95: a[Math.min(a.length - 1, Math.ceil(0.95 * a.length) - 1)],
    min: a[0],
    max: a[a.length - 1]
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tag = path.basename(FILE, '.html').replace(/[^\w.-]+/g, '_');
  const rows = [];
  for (let i = 0; i < RUNS; i += 1) {
    const r = await once(i);
    rows.push(r);
    console.log(`run${i + 1}: TTI=${r.ttiMs}ms FCP=${r.fcpMs}ms FP=${r.fpMs}ms DCL=${r.dclMs}ms load=${r.loadMs}ms settle=${r.settleMs}ms errs=${r.errs}`
      + ` frames1s=${r.frames1s} gap[p50=${r.frameGap.p50} p95=${r.frameGap.p95} max=${r.frameGap.max} >50=${r.frameGap.over50} >100=${r.frameGap.over100}]`
      + ` gapTop=${JSON.stringify(r.frameGap.top)}`
      + ` hb[p50=${r.hb.p50} max=${r.hb.max} >300=${r.hb.over300}]`
      + ` longs=${JSON.stringify(r.longs)} loaf=${JSON.stringify(r.loaf)}`
      + (r.ttiMs == null ? ' DIAG=' + JSON.stringify(r.diag) : ''));
  }
  const out = {
    file: FILE,
    bytes: fs.statSync(FILE).size,
    runs: rows,
    tti: stat(rows.map((r) => r.ttiMs)),
    fcp: stat(rows.map((r) => r.fcpMs)),
    dcl: stat(rows.map((r) => r.dclMs)),
    load: stat(rows.map((r) => r.loadMs))
  };
  fs.writeFileSync(path.join(OUT_DIR, 'tti_' + tag + '.json'), JSON.stringify(out, null, 2));
  console.log('SUMMARY ' + JSON.stringify({ bytes: out.bytes, tti: out.tti, fcp: out.fcp, dcl: out.dcl, load: out.load }));
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
