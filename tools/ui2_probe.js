/**
 * UI 批次 2 / 3 · 战斗 HUD 度量与截图探针（只读运行，不写主文件）
 * ------------------------------------------------------------
 * 用法：node tools/ui2_probe.js <html路径> <输出目录> <标签>
 *   node tools/ui2_probe.js index_arcane_v2.html .screenshots/ui2 before
 * 产出：
 *   <输出目录>/<标签>-battle.png   1440×900 全屏
 *   <输出目录>/<标签>-deck.png     卡组栏 1:1 裁切
 *   <输出目录>/<标签>.json         度量结果
 * 约束：
 *   · 只用 Edge headless + CDP；
 *   · 临时 profile 固定落 D:\.temp\browser-profiles\arcane-ui2-<pid>-<ts>，结束即删；
 *   · 视口 1440×900、DPR=1，与 ui-audit-20261109 保持一致，读数可直接对比。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = path.resolve(ROOT, process.argv[2] || 'index_arcane_v2.html');
const OUT = path.resolve(ROOT, process.argv[3] || '.screenshots/ui2');
const TAG = process.argv[4] || 'probe';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-ui2-${process.pid}-${Date.now()}`);
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9731;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 找到本机 Edge 可执行文件路径
 * @returns {string} Edge 绝对路径
 */
function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 msedge.exe');
}

/**
 * 计算文件 MD5（大写，便于和既有台账对齐）
 * @param {string} file 文件路径
 * @returns {string} 32 位大写 MD5
 */
function md5File(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 主流程：起浏览器 → 进战斗 → 度量 → 截图 → 清理
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });

  const edge = spawn(findEdge(), [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').slice(0, 240));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 240));
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /**
   * 在页面里执行表达式并取回值
   * @param {string} expression JS 表达式
   * @returns {Promise<any>} 执行结果
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };

  /**
   * 截一张整页图
   * @param {string} name 文件名
   * @returns {Promise<number>} 字节数
   */
  const shotFull = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return fs.statSync(file).size;
  };

  /**
   * 按 CSS 像素 1:1 裁切截图（用于改动处对比）
   * @param {string} name 文件名
   * @param {{x:number,y:number,w:number,h:number}} rect 裁切区域
   * @returns {Promise<number>} 字节数
   */
  const shotClip = async (name, rect) => {
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 }
    });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return fs.statSync(file).size;
  };

  await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(2800);

  // 进游戏：标题 → 选角 → 确认
  await ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1000);
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return true; })()`);
  await sleep(2200);

  // 可选：给本局补 N 张魔法卡，验证"解锁变多"时折叠横条不会挤坏排版
  const GRANT = Number(process.argv[5] || 0);
  if (GRANT > 0) {
    const grantRes = await ev(`(() => {
      const ids = ['fireball', 'frost', 'bolt', 'heal', 'blade', 'mine', 'lavaFissure'];
      const dbg = window.__roamDebug || {};
      let fn = null;
      for (const k in dbg) {
        const v = dbg[k];
        if (v && typeof v.grantMagic === 'function') { fn = v.grantMagic.bind(v); break; }
      }
      if (!fn) return 'NO_GRANT_API';
      for (let i = 0; i < ${GRANT} && i < ids.length; i += 1) fn(ids[i]);
      if (typeof renderDeck === 'function') renderDeck();
      return 'OK';
    })()`);
    console.log('GRANT=' + GRANT + ' -> ' + grantRes);
    await sleep(500);
  }

  // 度量：卡组栏 / 两行卡 / 锁定统计 / 视口
  const metrics = await ev(`(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
    const deck = q('.hud-deck');
    const mRow = q('#magicRow');
    const tRow = q('#techRow');
    const cards = (row) => row ? Array.from(row.querySelectorAll('.mini-card')) : [];
    const mc = cards(mRow), tc = cards(tRow);
    const lockedOf = (arr) => arr.filter((c) => c.classList.contains('is-locked')).length;
    const summary = q('#magicRow .deck-locked, #techRow .deck-locked');
    const st = (window.__roamDebug && window.__roamDebug.getState) ? window.__roamDebug.getState() : null;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      bodyClass: document.body.className,
      deck: box(deck),
      deckRatio: deck ? +(deck.getBoundingClientRect().height / window.innerHeight * 100).toFixed(1) : null,
      magicRow: box(mRow),
      techRow: box(tRow),
      magicCards: mc.length,
      magicLocked: lockedOf(mc),
      magicOwned: mc.length - lockedOf(mc),
      techCards: tc.length,
      techLocked: lockedOf(tc),
      techOwned: tc.length - lockedOf(tc),
      lockedSummary: summary ? summary.textContent.trim().replace(/\\s+/g, ' ') : null,
      cardHeights: mc.slice(0, 4).map((c) => +c.getBoundingClientRect().height.toFixed(1)),
      ownedMagic: st ? st.ownedMagic.slice(0) : null,
      ownedTech: st ? st.ownedTech.slice(0) : null
    };
  })()`);

  const deckRect = metrics.deck;
  const clip = deckRect ? { x: Math.max(0, deckRect.x - 6), y: Math.max(0, deckRect.y - 6), w: Math.min(1440 - Math.max(0, deckRect.x - 6), deckRect.w + 12), h: Math.min(900 - Math.max(0, deckRect.y - 6), deckRect.h + 12) } : { x: 0, y: 600, w: 1440, h: 300 };

  const fullBytes = await shotFull(`${TAG}-battle.png`);
  const clipBytes = await shotClip(`${TAG}-deck.png`, clip);

  // 可选：焚稿面板代价行验证（argv[6]=ash，argv[7]=灰烬层数）
  let ashMetrics = null;
  let ashShots = null;
  if (process.argv[6] === 'ash') {
    const ashStacksWanted = Number(process.argv[7] || 0);
    await ev(`(() => {
      state.ash = ${ashStacksWanted};
      if (typeof ashSyncUI === 'function') ashSyncUI();
      if (typeof ashOpenPanel === 'function') ashOpenPanel();
      return true;
    })()`);
    await sleep(500);
    ashMetrics = await ev(`(() => {
      const card = document.querySelector('#ashBurnPanel .ash-card');
      const cost = document.querySelector('#ashCost');
      const sub = document.querySelector('#ashBurnPanel .ash-sub');
      const r = card ? card.getBoundingClientRect() : null;
      return {
        stacks: (window.__roamDebug && window.__roamDebug.getState) ? window.__roamDebug.getState().ash : null,
        subText: sub ? sub.textContent.trim() : null,
        costText: cost ? cost.textContent.trim() : null,
        costHidden: cost ? cost.hidden : null,
        costHeight: cost ? +cost.getBoundingClientRect().height.toFixed(1) : null,
        /* 焚稿卡列表的「伤害 / 耗能」文案（#1 对账：必须是按层数现算的值） */
        cardMeta: Array.from(document.querySelectorAll('#ashBurnPanel .ash-card-row')).map((row) => {
          const name = row.querySelector('.ash-card-name');
          const meta = row.querySelector('.ash-card-meta');
          return (name ? name.textContent.trim() : '?') + ' | ' + (meta ? meta.textContent.trim() : '?');
        }),
        cardRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null
      };
    })()`);
    const cr = ashMetrics.cardRect;
    const af = await shotFull(`ash-${ashStacksWanted}layers-full.png`);
    const ac = cr ? await shotClip(`ash-${ashStacksWanted}layers-panel.png`, { x: Math.max(0, cr.x - 8), y: Math.max(0, cr.y - 8), w: Math.min(1440, cr.w + 16), h: Math.min(900, cr.h + 16) }) : null;
    ashShots = { full: { file: `ash-${ashStacksWanted}layers-full.png`, bytes: af }, panel: ac ? { file: `ash-${ashStacksWanted}layers-panel.png`, bytes: ac } : null };
  }

  // 可选：面板对账验证（argv[6]=verify）——档案成就文案 + 图鉴卡牌行 stats
  let panelVerify = null;
  if (process.argv[6] === 'verify') {
    panelVerify = await ev(`(() => {
      if (typeof renderArchivePanel === 'function') renderArchivePanel();
      const ach = document.getElementById('archiveAchText');
      const wanted = ['fireball', 'heal', 'ward', 'bolt'];
      const cardStats = codexSourceEntries('cards')
        .filter((e) => wanted.indexOf(e.id) >= 0)
        .map((e) => ({ id: e.id, stats: e.stats }));
      return {
        archiveAchText: ach ? ach.textContent.trim() : null,
        achTotal: (typeof META_PROGRESS_CONFIG !== 'undefined' && META_PROGRESS_CONFIG.achievements)
          ? META_PROGRESS_CONFIG.achievements.length : null,
        cardStats: cardStats
      };
    })()`);
  }

  // 可选：触发死亡结算页，量首屏可见内容与折叠区状态
  let resultMetrics = null;
  let resultShots = null;
  if (process.argv[6] === 'result') {
    await ev(`(() => { loseGame(state.player.x, state.player.y); return true; })()`);
    await sleep(600);
    resultMetrics = await ev(`(() => {
      const modal = document.querySelector('.result-modal');
      const sum = document.querySelector('.result-summary');
      const stats = document.querySelector('.result-stats');
      const more = document.querySelector('.result-more');
      const btn = document.querySelector('[data-action="restart"]');
      const h2 = modal ? modal.querySelector('h2') : null;
      const sub = modal ? modal.querySelector('.modal-sub') : null;
      const statCell = modal ? modal.querySelector('.result-stat span') : null;
      const rect = (el) => el ? el.getBoundingClientRect() : null;
      const mb = rect(modal);
      const bb = rect(btn);
      const sb = rect(stats);
      const scr = rect(sum);
      const h2cs = h2 ? getComputedStyle(h2) : null;
      return {
        h2Text: h2 ? h2.textContent.trim() : null,
        h2FontPx: h2cs ? parseFloat(h2cs.fontSize) : null,
        h2Lines: (h2 && h2cs) ? Math.round(h2.getBoundingClientRect().height / parseFloat(h2cs.lineHeight)) : null,
        modalWidthPx: mb ? +mb.width.toFixed(1) : null,
        modalHeightPx: mb ? +mb.height.toFixed(1) : null,
        modalScrollable: modal ? modal.scrollHeight > modal.clientHeight + 1 : null,
        scrollHeight: modal ? modal.scrollHeight : null,
        clientHeight: modal ? modal.clientHeight : null,
        summaryText: sum ? sum.textContent.replace(/\\s+/g, ' ').trim() : null,
        summaryBeforeStats: !!(sum && stats && (sum.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING)),
        summaryRect: scr ? { top: Math.round(scr.top), h: Math.round(scr.height) } : null,
        statsHeight: sb ? +sb.height.toFixed(1) : null,
        detailsExists: !!more,
        detailsOpen: more ? more.open : null,
        detailsSummaryText: more ? more.querySelector('summary').textContent.trim() : null,
        bodyFontPx: statCell ? parseFloat(getComputedStyle(statCell).fontSize) : null,
        subFontPx: sub ? parseFloat(getComputedStyle(sub).fontSize) : null,
        restartInViewport: bb ? (bb.top >= 0 && bb.bottom <= window.innerHeight + 1) : null,
        restartBox: bb ? { top: Math.round(bb.top), bottom: Math.round(bb.bottom), h: Math.round(bb.height) } : null,
        firstScreenContentPx: more && mb ? +(more.getBoundingClientRect().bottom - mb.top).toFixed(1) : null
      };
    })()`);
    const modalTop = await ev(`(() => { const m = document.querySelector('.result-modal'); const r = m.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), w: Math.min(1440, r.width), h: Math.min(900, r.height) }; })()`);
    const rf = await shotFull(`${TAG}-result-full.png`);
    const rc = await shotClip(`${TAG}-result-top.png`, { x: modalTop.x, y: modalTop.y, w: modalTop.w, h: Math.min(520, modalTop.h) });
    resultShots = {
      full: { file: `${TAG}-result-full.png`, bytes: rf },
      top: { file: `${TAG}-result-top.png`, bytes: rc }
    };
  }

  const report = {
    tag: TAG,
    source: path.relative(ROOT, MAIN).replace(/\\/g, '/'),
    sourceBytes: fs.statSync(MAIN).size,
    sourceMd5: md5File(MAIN),
    viewport: '1440x900 dpr=1',
    url: 'file:///' + MAIN.replace(/\\/g, '/'),
    deckHeightPx: deckRect ? deckRect.h : null,
    deckRatioPct: metrics.deckRatio,
    clip,
    shots: {
      full: { file: `${TAG}-battle.png`, bytes: fullBytes, md5: md5File(path.join(OUT, `${TAG}-battle.png`)) },
      deck: { file: `${TAG}-deck.png`, bytes: clipBytes, md5: md5File(path.join(OUT, `${TAG}-deck.png`)) }
    },
    errors,
    metrics,
    resultMetrics,
    resultShots,
    ashMetrics,
    ashShots,
    panelVerify
  };
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  try { ws.close(); } catch (e) { /* ignore */ }
  try { edge.kill(); } catch (e) { /* ignore */ }
  await sleep(600);
  try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); } catch (e) { console.log('PROFILE_CLEAN_FAIL ' + PROFILE); }
}

main().catch((e) => { console.error('PROBE_FAIL', e && e.stack || e); process.exitCode = 1; });
