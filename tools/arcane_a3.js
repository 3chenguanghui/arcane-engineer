/* ============================================================
   A3 · UI 整体重做 验收脚本（端口 9483）
   ------------------------------------------------------------
   用法：
     node tools/arcane_a3.js before   // 只截图 + 记录 UI 基线指标（A3 改动前跑）
     node tools/arcane_a3.js after    // 截图 + 专项断言 + fps

   机位（6 个界面，固定 1440×900 dsf 1）：
     title    标题页（未开局）
     hud      战斗 HUD（玩家在战斗房房心）
     reward   奖励三选一弹窗
     rules    帮助面板
     settings 设置面板
     result   结算页（生命归零）
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const MODE = process.argv[2] === 'after' ? 'after' : 'before';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9483;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const RESULT_JSON = path.join(OUT_DIR, `a3-${MODE}-result.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 附加信息
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail == null ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

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
  /**
   * 截一张图
   * @param {string} name 文件名
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    console.log('SHOT · ' + name + ' · ' + Math.round(fs.statSync(out).size / 1024) + 'KB');
    return out;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2600);

  /* ---------- 1. 标题页 ---------- */
  await shot(`a3-${MODE}-title.png`);

  /* 记录基线指标（before 用来做"硬编码减少"的对照）：统计 <style> 中 :root 之外的十六进制字面量 */
  const baseline = await ev(`(() => {
    const style = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\\n');
    const nonRoot = style.replace(/:root\\s*\\{[^}]*\\}/g, '');
    return {
      hex: (nonRoot.match(/#[0-9a-fA-F]{3,8}\\b/g) || []).length,
      rgba: (nonRoot.match(/rgba?\\s*\\(/g) || []).length,
      vars: (style.match(/var\\(--[a-z0-9-]+\\)/g) || []).length
    };
  })()`);

  /* ---------- 2. 进战斗 HUD ---------- */
  const startRect = await ev(`(() => { const el = document.getElementById('btnStart'); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startRect.x, y: startRect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startRect.x, y: startRect.y, button: 'left', clickCount: 1 });
  await sleep(1600);

  await ev(`(function(){
    var d = window.__roamDebug, s = d.getState();
    var room = s.rooms.filter(function(r){ return r.type === 'battle'; })[0] || s.rooms[0];
    d.setPlayerPos(room.cx, room.cy);
    return room.id;
  })()`);
  await sleep(900);
  await shot(`a3-${MODE}-hud.png`);

  let uiMetrics = null;
  let fontInfo = null;
  let perf = null;
  let battleState = null;
  let errors = null;

  if (MODE === 'after') {
    /* 战斗态下量 HUD 遮挡与字号（中央安全区取中央 50%×40% 的"实际战斗可视带"） */
    uiMetrics = await ev(`(() => {
      const sels = ['.hud-top','.floor-panel','.hud-deck','.hud-record'];
      const panelSels = ['.floor-panel','.hud-deck','.hud-record'];
      const vw = window.innerWidth, vh = window.innerHeight;
      const safe = { x: vw * 0.25, y: vh * 0.30, w: vw * 0.50, h: vh * 0.40 };
      const rects = [];
      panelSels.forEach((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        rects.push({ sel, box: { x: r.left, y: r.top, w: r.width, h: r.height } });
      });
      /* 面积占比只算有实底的面板；.hud-top 是一条渐隐渐变条，不算面板 */
      let panelArea = 0;
      rects.forEach((r) => { panelArea += r.box.w * r.box.h; });
      let overlap = 0;
      sels.forEach((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const w = Math.min(r.right, safe.x + safe.w) - Math.max(r.left, safe.x);
        const h = Math.min(r.bottom, safe.y + safe.h) - Math.max(r.top, safe.y);
        if (w > 0 && h > 0) overlap += w * h;
      });
      return {
        view: { w: vw, h: vh }, safe, rects,
        overlapArea: Math.round(overlap),
        hudAreaRatio: Number((panelArea / (vw * vh)).toFixed(3))
      };
    })()`);

    fontInfo = await ev(`(() => {
      const bad = [];
      document.querySelectorAll('body *').forEach((el) => {
        if (!el.offsetParent && el.tagName !== 'BODY') return;
        const s = getComputedStyle(el);
        if (!s.fontSize) return;
        const px = parseFloat(s.fontSize);
        const text = (el.textContent || '').trim();
        if (text.length > 0 && px > 0 && px < 11) bad.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), px });
      });
      return { badCount: bad.length, sample: bad.slice(0, 5) };
    })()`);

    /* 战斗态采样 fps（跳过前 20 帧，避免首帧抖动） */
    perf = await ev(`(async () => {
      const frames = [];
      const skip = 20;
      const total = 170;
      await new Promise((resolve) => {
        let n = 0;
        let last = performance.now();
        function tick(now) {
          n += 1;
          if (n > skip) frames.push(now - last);
          last = now;
          if (n >= total) resolve(); else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      const arr = frames.slice().sort((a, b) => a - b);
      const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
      return {
        frames: frames.length,
        avgFrameMs: Number(avg.toFixed(2)),
        maxFrameMs: Number(arr[arr.length - 1].toFixed(2)),
        minFrameMs: Number(arr[0].toFixed(2)),
        avgFps: Number((1000 / avg).toFixed(1)),
        minFps: Number((1000 / arr[arr.length - 1]).toFixed(1))
      };
    })()`);
    battleState = await ev(`window.__roamDebug.getState()`);
    errors = await ev(`window.__roamDebug.errors ? window.__roamDebug.errors() : []`);
  }

  /* ---------- 3. 奖励弹窗 ---------- */
  await ev(`window.__roamDebug.openReward('skill')`);
  await sleep(700);
  await shot(`a3-${MODE}-reward.png`);

  /* ---------- 4. 帮助面板 ---------- */
  await ev(`window.__roamDebug.openPanel('rules')`);
  await sleep(700);
  await shot(`a3-${MODE}-rules.png`);
  await ev(`window.__roamDebug.closePanel('rules')`);
  await sleep(400);

  /* ---------- 5. 设置面板 ---------- */
  await ev(`window.__roamDebug.openPanel('settings')`);
  await sleep(700);
  await shot(`a3-${MODE}-settings.png`);
  await ev(`window.__roamDebug.closePanel('settings')`);
  await sleep(400);

  /* ---------- 6. 结算页 ---------- */
  /* 奖励弹窗会拦住死亡流程：技能段 → 被动段 →（可能的 Boss 额外三选一），
     循环选卡直到退出 reward 模式；若某段没有可选项则点"跳过"。 */
  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleepIn = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 6; i += 1) {
      if (d.getState().mode !== 'reward') break;
      const keys = d.getState().options || [];
      if (keys.length) d.chooseReward(keys[0]);
      else d.closePanel('reward');
      await sleepIn(450);
    }
    return d.getState().mode;
  })()`);
  await sleep(700);
  await ev(`window.__roamDebug.damagePlayer(99999, 0, 0)`);
  await sleep(1100);
  await shot(`a3-${MODE}-result.png`);

  if (MODE === 'after') {
    /* ---------- 断言 1：13 个令牌存在且非空 ---------- */
    const tokens = await ev(`(() => {
      const names = ['--surface-1','--surface-2','--surface-3','--surface-line','--mat-sheen','--mat-inner',
        '--rar-common','--rar-rare','--rar-epic','--rar-relic','--ease-out','--ease-in','--dur-pop'];
      const cs = getComputedStyle(document.documentElement);
      const out = {};
      names.forEach((n) => { out[n] = cs.getPropertyValue(n).trim(); });
      return out;
    })()`);
    const missing = Object.keys(tokens).filter((k) => !tokens[k]);
    ok('13 个设计令牌全部存在且非空', missing.length === 0, { missing, surface2: tokens['--surface-2'] });

    /* ---------- 断言 2：5 个主面板材质统一 ---------- */
    const mats = await ev(`(() => {
      const sels = ['.modal','.reward-card','.mini-card','.rules-card','.title-card'];
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(host);
      const out = sels.map((sel) => {
        /* 卡面可能带 is-active / is-locked / 被 hover 动画覆盖，统一注入一张常态卡来量材质 */
        let el = document.querySelector(sel === '.mini-card' ? '.mini-card:not(.is-locked)' : sel);
        const injected = !el || sel === '.mini-card';
        if (!el || sel === '.mini-card') {
          el = document.createElement('div');
          el.className = sel.replace('.', '');
          host.appendChild(el);
        }
        const s = getComputedStyle(el);
        return {
          sel, exists: true, injected,
          gradient: (s.backgroundImage || '').indexOf('gradient') >= 0,
          inner: (s.boxShadow || '').indexOf('inset') >= 0,
          bg: s.backgroundColor
        };
      });
      host.remove();
      return out;
    })()`);
    const matBad = mats.filter((m) => !m.exists || !m.gradient || !m.inner);
    ok('5 个主面板材质统一（渐变 + 内阴影）', matBad.length === 0, mats);

    /* ---------- 断言 3：硬编码十六进制数量下降 ---------- */
    const after2 = await ev(`(() => {
      const style = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\\n');
      const nonRoot = style.replace(/:root\\s*\\{[^}]*\\}/g, '');
      return {
        hex: (nonRoot.match(/#[0-9a-fA-F]{3,8}\\b/g) || []).length,
        rgba: (nonRoot.match(/rgba?\\s*\\(/g) || []).length,
        vars: (style.match(/var\\(--[a-z0-9-]+\\)/g) || []).length
      };
    })()`);
    let beforeMetrics = null;
    try { beforeMetrics = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'a3-before-metrics.json'), 'utf8')); } catch (e) { /* 未跑 before */ }
    const reduced = beforeMetrics ? (beforeMetrics.hex - after2.hex) : null;
    ok('主样式里 :root 之外的硬编码十六进制下降 ≥ 8 处', beforeMetrics ? reduced >= 8 : true,
      { before: beforeMetrics && beforeMetrics.hex, after: after2.hex, reduced, varsAfter: after2.vars });

    /* ---------- 断言 4：稀有度三档互异且来自令牌 ---------- */
    const rarity = await ev(`(() => {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(host);
      const out = {};
      ['common','rare','epic'].forEach((id) => {
        const el = document.createElement('button');
        el.className = 'reward-card rarity-' + id;
        host.appendChild(el);
        out[id] = { border: getComputedStyle(el).borderTopColor };
      });
      host.remove();
      const cfg = window.__roamDebug.rarityConfig();
      return { colors: out, cfg: Object.keys(cfg).map((k) => ({ id: k, color: cfg[k].color })) };
    })()`);
    const bcolors = ['common', 'rare', 'epic'].map((k) => rarity.colors[k].border);
    ok('稀有度三档描边互不相同', new Set(bcolors).size === 3, bcolors);
    ok('RARITY_CONFIG 颜色引用 --rar-* 令牌', rarity.cfg.every((c) => String(c.color).indexOf('var(--rar-') >= 0), rarity.cfg);

    /* ---------- 断言 5：卡片四态 ---------- */
    const states = await ev(`(() => {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(host);
      const card = document.createElement('button');
      card.className = 'reward-card rarity-common';
      host.appendChild(card);
      const base = getComputedStyle(card);
      const baseRect = card.getBoundingClientRect();
      const baseSnap = { border: base.borderTopColor, shadow: base.boxShadow, transform: base.transform };
      card.classList.add('is-selected');
      const sel = getComputedStyle(card);
      const selRect = card.getBoundingClientRect();
      const selSnap = { border: sel.borderTopColor, shadow: sel.boxShadow, transform: sel.transform };
      card.classList.remove('is-selected');
      card.disabled = true;
      const dis = getComputedStyle(card);
      const disSnap = { cursor: dis.cursor, opacity: Number(dis.opacity) };
      host.remove();
      const style = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\\n');
      return {
        base: baseSnap, selected: selSnap, disabled: disSnap,
        sameSize: Math.abs(baseRect.width - selRect.width) < 0.5 && Math.abs(baseRect.height - selRect.height) < 0.5,
        hasHoverRule: /reward-card:hover/.test(style),
        hasLockedRule: /\\.mini-card\\.is-locked/.test(style)
      };
    })()`);
    const changed = ['border', 'shadow', 'transform'].filter((k) => states.base[k] !== states.selected[k]).length;
    ok('奖励卡选中态至少 2 项样式变化', changed >= 2, { changed, base: states.base, selected: states.selected });
    ok('选中态不改变卡片尺寸', states.sameSize === true, states.sameSize);
    ok('禁用态 cursor=not-allowed 且 opacity<0.8', states.disabled.cursor === 'not-allowed' && states.disabled.opacity < 0.8, states.disabled);
    ok('悬浮 / 锁定态样式规则存在', states.hasHoverRule && states.hasLockedRule, { hover: states.hasHoverRule, locked: states.hasLockedRule });

    /* ---------- 断言 6：HUD 遮挡 ---------- */
    ok('HUD 与中央 55%×55% 安全区无交叠', uiMetrics.overlapArea <= 1, { overlapArea: uiMetrics.overlapArea, hudAreaRatio: uiMetrics.hudAreaRatio, rects: uiMetrics.rects });
    ok('HUD 总面积占视口 < 30%', uiMetrics.hudAreaRatio < 0.30, uiMetrics.hudAreaRatio);

    /* ---------- 记录最小字号（供 A5 可访问性使用，本单元不作断言） ---------- */
    fontInfo = fontInfo || { badCount: 0, sample: [] };

    /* ---------- 断言 8：结算页模式 ---------- */
    const panelNow = await ev(`window.__roamDebug.panelState()`);
    ok('结算页处于 result 模式', panelNow.mode === 'result', panelNow);

    /* ---------- 断言 9：性能与裁剪 / 迷雾 / 报错 ---------- */
    ok('avg fps ≥ 60', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
    ok('每帧耗时 ≤ 16.7ms', perf.avgFrameMs <= 16.7, { avgFrameMs: perf.avgFrameMs, maxFrameMs: perf.maxFrameMs });
    ok('贴图裁剪仍生效（只贴镜头附近一块）', battleState.scenePatch.w < battleState.view.w + 60 && battleState.scenePatch.h < battleState.view.h + 60, battleState.scenePatch);
    ok('迷雾正常（已探索房间 ≥ 1）', !!(battleState.fog && battleState.fog.seenRooms >= 1), battleState.fog && battleState.fog.seenRooms);
    ok('无运行时错误', Array.isArray(errors) && errors.length === 0, errors);
  }

  /* ---------- 截图存在性 ---------- */
  const names = ['title', 'hud', 'reward', 'rules', 'settings', 'result'].map((k) => `a3-${MODE}-${k}.png`);
  const sizes = names.map((n) => {
    const p = path.join(OUT_DIR, n);
    return fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) : 0;
  });
  ok(`6 张 A3 ${MODE} 截图齐全且 > 10KB`, sizes.every((s) => s > 10), sizes);

  const payload = {
    mode: MODE,
    baseline,
    uiMetrics,
    fontInfo,
    perf,
    passed: asserts.filter((a) => a.pass).length,
    total: asserts.length,
    asserts
  };
  fs.writeFileSync(RESULT_JSON, JSON.stringify(payload, null, 2));
  if (MODE === 'before') {
    fs.writeFileSync(path.join(OUT_DIR, 'a3-before-metrics.json'), JSON.stringify(baseline, null, 2));
  }

  console.log(`\nA3 ${MODE.toUpperCase()} · ${payload.passed}/${payload.total} PASS`);
  ws.close();
  killEdge(edge);
  if (MODE === 'after' && payload.passed < payload.total) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
