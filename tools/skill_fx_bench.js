/**
 * 技能特效补丁 · 真实游戏内性能基准
 * ------------------------------------------------------------
 * 目的：在同一台机器、同一个页面、同一套连发负载下，分别测：
 *   baseline → 不加载补丁
 *   patched  → 动态插入 skill-fx.css / skill-fx.js 并 SKILLFX.apply()
 *
 * 计时方式：在页面加载前注入 rAF 包装器，记录每一帧回调（游戏逻辑 + 渲染 JS）
 * 的耗时；p95 由 Node 在这批原始样本上计算，不取浏览器自报的平均值。
 * 粒子峰值直接读 state.particles.length（游戏既有粒子数组）。
 *
 * 用法：node tools/skill_fx_bench.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9719;
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, '.testprofile', 'edge-bench');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** rAF 探针：包住每个回调，记录耗时与粒子数 */
const PROBE = `
(() => {
  if (window.__probeInstalled) return;
  window.__probeInstalled = true;
  window.__fjs = [];
  window.__peak = 0;
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return orig(function (t) {
      const t0 = performance.now();
      try { cb(t); } finally {
        if (window.__rec) {
          window.__fjs.push(performance.now() - t0);
          try {
            if (typeof state !== 'undefined' && state && state.particles) {
              if (state.particles.length > window.__peak) window.__peak = state.particles.length;
            }
          } catch (e) {}
        }
        if (window.__onFrame) { try { window.__onFrame(); } catch (e) {} }
      }
    });
  };
})();
`;

/**
 * 计算分位数
 * @param {number[]} arr 样本
 * @param {number} q 0~1
 * @returns {number}
 */
function pct(arr, q) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

async function main() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--no-sandbox', '--disable-gpu',
    '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
    '--mute-audio', '--window-size=1440,900', 'about:blank'
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
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    }
    return r.result.value;
  };

  const url = 'file:///' + path.join(ROOT, 'index_arcane_v2.html').replace(/\\/g, '/');

  /**
   * 跑一轮基准
   * @param {boolean} patched 是否注入补丁
   * @returns {Promise<Object>} 读数
   */
  async function run(patched) {
    await send('Page.navigate', { url: url + (patched ? '' : '') });
    // 等游戏状态就绪
    let ready = false;
    for (let i = 0; i < 120; i += 1) {
      ready = await ev("(typeof state !== 'undefined') && !!state && !!state.player");
      if (ready) break;
      await sleep(100);
    }
    if (!ready) return { error: 'game state not ready' };

    // 开局：标题页按钮
    await ev("(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return !!b; })()");
    await sleep(1500);

    // 给足靶子，避免技能因为没目标被跳过
    await ev(`(() => {
      if (typeof __roamDebug === 'undefined' || !__roamDebug.spawnEnemy) return 'no-debug';
      const types = ['shardling', 'chanter', 'geargrind'];
      for (let i = 0; i < 8; i += 1) {
        try { __roamDebug.spawnEnemy(types[i % types.length], 120 + i * 30, (i % 2 ? -1 : 1) * (90 + i * 20)); } catch (e) {}
      }
      if (state.enemies) state.enemies.forEach((e) => { e.hp = Math.max(e.hp || 0, 9999); });
      // 基准用：临时点亮全部 12 张卡（只影响本次测试进程，不改游戏配置）
      const deck = ['fireball','frost','bolt','heal','blade','mine','lavaFissure','arcanePool','runeOrbit','collapseHole','flameCone','frostRing'];
      state.ownedMagic = deck.slice();
      return 'spawned:' + (state.enemies ? state.enemies.length : 0);
    })()`);

    if (patched) {
      await ev(`(() => {
        if (window.SKILLFX) return 'exists';
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = 'skill-fx.css';
        document.head.appendChild(l);
        const s = document.createElement('script');
        s.src = 'skill-fx.js';
        document.head.appendChild(s);
        return 'injecting';
      })()`);
      for (let i = 0; i < 40; i += 1) {
        const ok = await ev("typeof window.SKILLFX !== 'undefined' && typeof window.SKILLFX.apply === 'function'");
        if (ok) break;
        await sleep(50);
      }
      await ev("window.SKILLFX.apply(); window.SKILLFX.isEnabled();");
    }

    // 清空探针，开始记录；先跑 0.8 秒热身，避免把地图生成的尖峰算进来
    await ev("window.__fjs = []; window.__peak = 0; window.__rec = true;");
    await sleep(800);
    await ev("window.__fjs = []; window.__peak = 0; 1");

    // 连发负载：按帧驱动（每 5 帧换一张卡），改前/改后每帧技能密度一致
    await ev(`(() => {
      window.__castIds = ['fireball','frost','bolt','heal','blade','mine','lavaFissure','arcanePool','runeOrbit','collapseHole','flameCone','frostRing'];
      window.__castIdx = 0;
      window.__castTries = 0;
      window.__castOk = 0;
      window.__frameNo = 0;
      window.__onFrame = function () {
        window.__frameNo += 1;
        if (window.__frameNo % 5 !== 0) return;
        try {
          const id = window.__castIds[window.__castIdx % window.__castIds.length];
          window.__castIdx += 1;
          window.__castTries += 1;
          if (typeof state === 'undefined' || !state || !state.mode || state.mode !== 'playing') return;
          state.cooldowns[id] = 0;
          state.player.aether = 1000;
          // 并联回路由双槽决定施法对象；基准里把主槽直接指到当前这张卡
          if (state.dual && state.dual.slots) state.dual.slots[0] = id;
          state.activeMagicId = id;
          if (typeof castSlot === 'function' && castSlot(0, false)) window.__castOk += 1;
        } catch (e) { (window.__castErr = window.__castErr || []).push(String(e)); }
      };
      return 'timing-start';
    })()`);
    await sleep(8000);
    await ev("window.__rec = false; window.__onFrame = null; 1");

    const raw = await ev(`(() => ({
      samples: window.__fjs.slice(),
      peak: window.__peak,
      castErr: window.__castErr || [],
      castTries: window.__castTries || 0,
      castOk: window.__castOk || 0,
      enabled: !!(window.SKILLFX && window.SKILLFX.isEnabled()),
      stats: window.SKILLFX ? window.SKILLFX.stats : null,
      particles: (typeof state !== 'undefined' && state && state.particles) ? state.particles.length : -1
    }))()`);

    return {
      samples: raw.samples.length,
      p50: Math.round(pct(raw.samples, 0.5) * 100) / 100,
      p95: Math.round(pct(raw.samples, 0.95) * 100) / 100,
      max: Math.round((raw.samples.length ? Math.max.apply(null, raw.samples) : 0) * 100) / 100,
      peakParticles: raw.peak,
      particlesNow: raw.particles,
      castErr: raw.castErr || [],
      castTries: raw.castTries,
      castOk: raw.castOk,
      enabled: raw.enabled,
      stats: raw.stats
    };
  }

  const baseline = await run(false);
  const patched = await run(true);
  console.log(JSON.stringify({ ok: errors.length === 0, errors: errors.slice(0, 4), baseline, patched }, null, 2));

  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
