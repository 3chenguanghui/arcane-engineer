/**
 * C1-10 · UI kit 数值实测（只读，不改文件）
 * ------------------------------------------------------------
 * 目的：把"按 ui-kit.md 改"从"看着像"变成"量出来对"。
 * 逐项读取 CSSOM 计算值 / 元素盒模型，打印一份可直接贴进 C1_REPORT 的表。
 * 覆盖：卡条（高/圆角/稀有度条/图标砖/名称/说明）、HUD（顶栏/生命条/胶囊/卡格/
 *       楼层与地图宽）、结算（数据格圆角/数值字号）、设置（两列/行高/开关）、暗角。
 * 用法：node tools/ui_kit_measure.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9699;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'
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
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1600);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(700);
  await ev(`window.__roamDebug.openReward('skill'); true`);
  await sleep(500);

  const cards = await ev(`(() => {
    const cs = document.querySelectorAll('.reward-card');
    const out = [];
    cs.forEach((c, i) => {
      const s = getComputedStyle(c);
      const g = c.querySelector('.r-glyph');
      const gs = g ? getComputedStyle(g) : null;
      const svg = g ? g.querySelector('svg') : null;
      out.push({
        i: i + 1,
        h: Math.round(c.getBoundingClientRect().height),
        w: Math.round(c.getBoundingClientRect().width),
        radius: s.borderRadius,
        pad: s.padding,
        gap: s.gap,
        barW: getComputedStyle(c, '::before').width,
        glyph: gs ? gs.width + 'x' + gs.height + ' r' + gs.borderRadius : null,
        svg: svg ? svg.getAttribute('width') + 'x' + svg.getAttribute('height') : 'NONE',
        name: getComputedStyle(c.querySelector('.r-name')).fontSize,
        desc: getComputedStyle(c.querySelector('.r-desc')).fontSize,
        descLines: getComputedStyle(c.querySelector('.r-desc')).webkitLineClamp,
        rarity11: c.querySelector('.r-rarity') ? getComputedStyle(c.querySelector('.r-rarity')).fontSize : null,
        epicText: c.classList.contains('rarity-epic') && c.querySelector('.r-rarity')
          ? getComputedStyle(c.querySelector('.r-rarity')).color : 'n/a'
      });
    });
    return out;
  })()`);

  const hud = await ev(`(() => {
    const t = document.querySelector('.hud-top');
    const bar = document.querySelector('.bar');
    const chip = document.querySelector('.skill-chip');
    const mini = document.querySelector('.mini-card');
    const floor = document.querySelector('.hud-readouts');
    const map = document.querySelector('.minimap-panel') || document.querySelector('.map-panel');
    return {
      topH: Math.round(t.getBoundingClientRect().height),
      topPad: getComputedStyle(t).padding,
      brandW: Math.round(document.querySelector('.brand').getBoundingClientRect().width),
      barH: bar ? getComputedStyle(bar).height : null,
      barTicks: bar ? getComputedStyle(bar, '::after').backgroundImage.slice(0, 60) : null,
      chipH: chip ? getComputedStyle(chip).height : null,
      miniH: mini ? Math.round(mini.getBoundingClientRect().height) : null,
      floorW: floor ? Math.round(floor.getBoundingClientRect().width) : null,
      mapW: map ? Math.round(map.getBoundingClientRect().width) : null,
      btnH: Math.round(document.querySelector('.hud-actions .btn').getBoundingClientRect().height),
      btnPad: getComputedStyle(document.querySelector('.hud-actions .btn')).padding
    };
  })()`);

  const settings = await ev(`(() => {
    document.getElementById('btnSettings').click();
    const p = document.querySelector('.settings-panel');
    const cs = getComputedStyle(p);
    const row = document.querySelector('.setting-row');
    const sw = document.querySelector('.switch');
    const swAfter = sw ? getComputedStyle(sw, '::after') : null;
    return {
      cols: cs.gridTemplateColumns,
      display: cs.display,
      rowH: row ? Math.round(row.getBoundingClientRect().height) : null,
      switch: sw ? getComputedStyle(sw).width + 'x' + getComputedStyle(sw).height : null,
      knob: swAfter ? swAfter.width + 'x' + swAfter.height : null,
      knobMove: swAfter ? swAfter.transform : null,
      panelW: Math.round(document.querySelector('.codex-card').getBoundingClientRect().width)
    };
  })()`);

  const post = await ev(`(() => ({
    vignette: (typeof POSTFX_CONFIG !== 'undefined') ? POSTFX_CONFIG.vignette : null,
    artVignette: (typeof ART_DIRECTION_CONFIG !== 'undefined') ? ART_DIRECTION_CONFIG.vignette : null,
    cssVar: getComputedStyle(document.documentElement).getPropertyValue('--vignette').trim()
  }))()`);

  console.log(JSON.stringify({ cards, hud, settings, post }, null, 2));
  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
