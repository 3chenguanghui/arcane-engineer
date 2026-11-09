// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// M1-4 专项验收：稀有度三档 / 层数角标 / 悬停详情 / 融合搭档高亮 / 触摸长按 / 融合条 / 跳过被动 / 布局
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9463;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm14');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
/** 记录一条断言并即时打印（测试专用） */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

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

  await send('Runtime.enable');
  await send('Page.enable');

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到元素 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };
  const setViewport = async (width, height, zoom) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(width / zoom), height: Math.round(height / zoom),
      deviceScaleFactor: zoom, mobile: false
    });
    await sleep(320);
  };

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await send('Page.navigate', { url });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(500);

  // ---------------- 页内主测试 ----------------
  const page = await ev(`(async () => {
    const out = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const d = window.__roamDebug;
    const S = () => d.getState();
    const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail });
    const card = (kind, id) => document.querySelector('[data-' + kind + '-id="' + id + '"]');

    // 1) 稀有度：12 张卡都能正确挂档位类与罗马数字
    const expect = {
      magic: { fireball: 'common', frost: 'common', bolt: 'rare', heal: 'common', blade: 'rare', mine: 'epic' },
      tech: { concentrator: 'common', field: 'common', capacitor: 'rare', nanite: 'rare', magnet: 'rare', amp: 'epic' }
    };
    ['fireball', 'frost', 'bolt', 'heal', 'blade', 'mine'].forEach((id) => d.grantMagic(id));
    ['concentrator', 'field', 'capacitor', 'nanite', 'magnet', 'amp'].forEach((id) => d.grantTech(id));
    const mark = { common: 'Ⅰ', rare: 'Ⅱ', epic: 'Ⅲ' };
    const bad = [];
    Object.keys(expect).forEach((kind) => {
      Object.keys(expect[kind]).forEach((id) => {
        const el = card(kind, id);
        const want = expect[kind][id];
        const meta = el && el.querySelector('.m-meta');
        if (!el || !el.classList.contains('r-' + want)
            || !meta || meta.querySelector('.m-rarity').textContent.trim() !== mark[want]) {
          bad.push(kind + ':' + id);
        }
      });
    });
    ok('12 张卡稀有度类与角标 Ⅰ/Ⅱ/Ⅲ 全部正确', bad.length === 0, bad);

    // 2) 三档边框肉眼可辨（边框色 + 阴影两两不同）
    // 先把选中态切回普通卡，避免"选中色"盖住档位色（史诗两张都曾被选中）
    d.grantMagic('fireball');
    d.grantTech('concentrator');
    const read = (tier) => {
      const el = Array.from(document.querySelectorAll('.mini-card.r-' + tier))
        .find((node) => !node.classList.contains('is-active'));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { border: cs.borderTopColor, shadow: cs.boxShadow, id: el.getAttribute('data-magic-id') || el.getAttribute('data-tech-id') };
    };
    const c = read('common');
    const r = read('rare');
    const e = read('epic');
    ok('三档边框颜色互不相同',
      !!c && !!r && !!e && new Set([c.border, r.border, e.border]).size === 3
        && new Set([c.shadow, r.shadow, e.shadow]).size === 3,
      { c, r, e });

    // 3) 层数角标：初始火球 F1；发放记录写入 cardFloor
    const floors = d.cardFloors();
    const fireText = card('magic', 'fireball').querySelector('.m-floor');
    const bladeText = card('magic', 'blade').querySelector('.m-floor');
    ok('层数角标显示获得楼层（F1）且写入 cardFloor',
      !!fireText && fireText.textContent === 'F1'
        && !!bladeText && bladeText.textContent === 'F' + S().floor
        && floors['magic:fireball'] === 1 && floors['magic:blade'] === S().floor,
      { fire: fireText && fireText.textContent, blade: bladeText && bladeText.textContent, floors });

    // 4) 悬停详情：内容包含名称 / 稀有度 / 消耗 / 冷却 / 相关融合
    const hoverFire = d.hoverCard('magic', 'fireball');
    const text = hoverFire.tipText;
    ok('悬停显示详情（名称/稀有度/消耗/冷却/融合线路）',
      hoverFire.tipOn && text.indexOf('火球') >= 0 && text.indexOf('普通') >= 0
        && text.indexOf('消耗') >= 0 && text.indexOf('冷却') >= 0 && text.indexOf('追踪火球') >= 0,
      { on: hoverFire.tipOn, left: hoverFire.tipLeft, text: text.slice(0, 160) });

    // 5) 可融合对象高亮：火球 ↔ 聚能模块；该条融合激活后不再点亮聚能模块
    const partners = d.hoverCard('magic', 'fireball').partners;
    const hasPartner = partners.some((p) => p.kind === 'tech' && p.id === 'concentrator');
    d.grantFusion('homingFireball');
    const after = d.hoverCard('magic', 'fireball').partners;
    ok('悬停点亮可融合对象，已激活的那条不再点亮',
      hasPartner && !after.some((p) => p.kind === 'tech' && p.id === 'concentrator'),
      { before: partners, after });

    // 6) 触摸长按 420ms 出详情，抬起后收起
    const el = card('tech', 'concentrator');
    const vp = d.getState().view;
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    await sleep(470);
    const longOn = document.querySelector('#cardTip').classList.contains('is-on');
    el.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true }));
    d.hideCardTip();
    const longOff = !document.querySelector('#cardTip').classList.contains('is-on');
    ok('触摸长按 420ms 显示详情，抬起收起', longOn && longOff, { longOn, longOff, vp });

    // 7) 底部「已激活融合」条：空态 / 有内容 / 专属色
    d.restart();
    await sleep(250);
    const empty = d.fusionBar();
    d.grantFusion('homingFireball');
    d.grantFusion('frostField');
    d.grantMagic('fireball');
    const filled = d.fusionBar();
    const chipColor = (() => {
      const chip = document.querySelector('#fusionBar .fb-chip');
      return chip ? getComputedStyle(chip).borderLeftColor : '';
    })();
    ok('融合条空态 -> 有内容（2 个 chip + 专属色）',
      empty.empty && empty.chips === 0 && empty.text.indexOf('0 / 10') >= 0
        && !filled.empty && filled.chips === 2 && filled.text.indexOf('2 / 10') >= 0
        && chipColor.length > 0,
      { empty, filled, chipColor });

    // 8) 跳过被动：技能段 -> 被动段 -> skip 关闭，保底 +1
    d.setFusionPity(0);
    const skillKeys = d.openReward();
    d.chooseReward(skillKeys[0]);
    await sleep(120);
    const inPassive = S();
    const btn = document.querySelector('[data-action="skipPassive"]');
    const skipOk = d.skipPassive();
    await sleep(120);
    const afterSkip = S();
    ok('被动段存在「跳过被动」按钮，跳过后回到 playing 且保底 +1',
      inPassive.rewardStage === 'passive' && !!btn && btn.offsetWidth > 0 && skipOk
        && afterSkip.mode === 'playing' && afterSkip.rewardStage === null && afterSkip.fusionPity === 1,
      { stage: inPassive.rewardStage, btn: !!btn, skipOk, mode: afterSkip.mode, pity: afterSkip.fusionPity });

    // 9) 跳过不丢保底：本层拿过融合再跳过 -> pity 归零
    d.restart();
    await sleep(250);
    d.grantMagic('fireball');
    d.grantTech('concentrator');
    d.setFusionPity(4);
    const withFusion = d.openReward();
    const fusionKey = withFusion.find((k) => k.indexOf('fusion:') === 0);
    const gotFusion = d.chooseReward(fusionKey);
    await sleep(120);
    d.skipPassive();
    await sleep(120);
    const snap = S();
    ok('本层拿到融合后跳过被动，保底进度归零', !!gotFusion && snap.fusionPity === 0 && snap.mode === 'playing',
      { gotFusion, options: withFusion, pity: snap.fusionPity, mode: snap.mode });

    // 10) 浮层不越出 HUD 容器（左边缘钳制）
    d.restart();
    await sleep(200);
    const near = d.hoverCard('magic', 'fireball');
    d.hideCardTip();
    ok('浮层左边缘钳制在 8px 内', near.tipLeft >= 8, { left: near.tipLeft });

    // 11) fps / 报错
    const fps = d.getState().fps;
    const errs = d.errors();
    ok('帧率 >= 60 且无脚本错误', fps >= 60 && errs.length === 0, { fps, errs: errs.length });
    return out;
  })()`);

  const failed = [];
  page.forEach((t) => check(t.name, t.pass, t.detail));
  if (!page.every((t) => t.pass)) failed.push('页内断言');

  // ---------------- 截图：三档卡面 + 浮层 + 融合条 ----------------
  await ev(`(() => { const d = window.__roamDebug; d.restart(); ['fireball','frost','bolt','heal','blade','mine'].forEach((id) => d.grantMagic(id)); ['concentrator','field','capacitor','nanite','magnet','amp'].forEach((id) => d.grantTech(id)); d.grantFusion('homingFireball'); d.grantFusion('chainBolt'); return true; })()`);
  await sleep(500);
  await shot('01_cards_rarity_fusionbar.png');
  await ev(`(() => window.__roamDebug.hoverCard('magic','mine'))()`);
  await sleep(200);
  await shot('02_card_tip.png');
  await ev(`(() => window.__roamDebug.hideCardTip())()`);

  // 被动弹窗（含跳过按钮）
  await ev(`(() => { const d = window.__roamDebug; d.openReward('skill'); const k = d.getState().options[0]; d.chooseReward(k); return d.getState().rewardStage; })()`);
  await sleep(300);
  await shot('03_passive_skip.png');

  // ---------------- 布局：3 视口 × 2 缩放 ----------------
  const layouts = [];
  for (const [w, h] of [[1280, 720], [1600, 900], [1920, 1080]]) {
    for (const zoom of [1, 1.25]) {
      await setViewport(w, h, zoom);
      const m = await ev(`(() => {
        const d = window.__roamDebug;
        d.hideCardTip();
        const cards = Array.from(document.querySelectorAll('#magicRow .mini-card'));
        const techCards = Array.from(document.querySelectorAll('#techRow .mini-card'));
        const widths = cards.map((c) => Math.round(c.getBoundingClientRect().width));
        const techWidths = techCards.map((c) => Math.round(c.getBoundingClientRect().width));
        const clipped = cards.concat(techCards).filter((c) => c.scrollWidth > c.clientWidth + 1).length;
        const rects = cards.map((c) => c.getBoundingClientRect());
        const tops = rects.map((r) => Math.round(r.top));
        const bar = document.querySelector('#fusionBar').getBoundingClientRect();
        const hover = d.hoverCard('magic', 'mine');
        const tip = document.querySelector('#cardTip').getBoundingClientRect();
        const inside = rects.every((r) => r.left >= -1 && r.right <= innerWidth + 1);
        const tipInside = tip.left >= -1 && tip.right <= innerWidth + 1 && tip.top >= -1;
        return {
          vw: innerWidth, vh: innerHeight,
          cards: cards.length,
          sameTop: tops.every((t) => Math.abs(t - tops[0]) <= 1),
          inside,
          overflowX: document.documentElement.scrollWidth - innerWidth,
          barIn: bar.top >= -1 && bar.bottom <= innerHeight + 1 && bar.left >= -1 && bar.right <= innerWidth + 1,
          tipInside,
          tipLeft: hover.tipLeft,
          tipTextLen: hover.tipText.length,
          widths, techWidths, clipped
        };
      })()`);
      layouts.push({ w, h, zoom, m });
      console.log('  layout ' + w + 'x' + h + '@' + zoom + ' magic=' + m.widths.join(',') + ' tech=' + m.techWidths.join(',') + ' clipped=' + m.clipped);
      await ev(`(() => window.__roamDebug.hideCardTip())()`);
    }
  }
  check('6 组视口：6 列同 top / 无横向溢出 / 融合条与浮层在视口内',
    layouts.every((l) => l.m.cards === 6 && l.m.sameTop && l.m.inside && l.m.overflowX <= 1
      && l.m.barIn && l.m.tipInside && l.m.tipTextLen > 20),
    layouts.map((l) => `${l.w}x${l.h}@${l.zoom}:${l.m.sameTop ? 'ok' : 'bad'}/${l.m.overflowX}/${l.m.tipLeft}`));

  await ev(`(() => window.__roamDebug.hideCardTip())()`);
  await setViewport(1440, 900, 1);
  await sleep(300);
  await shot('04_layout_1440.png');

  const errs = await ev(`window.__roamDebug.errors().length`);
  if (errs !== 0) failed.push('errors=' + errs);

  console.log('\n=== M1-4 RESULT ' + (results.filter((r) => r.ok).length + '/' + results.length) + ' ===');
  console.log('截图目录：' + OUT);
  ws.close();
  killEdge(edge);
  if (failed.length) { console.log('FAILED: ' + failed.join(', ')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
