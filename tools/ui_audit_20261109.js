/**
 * UI 美术调研 · 全界面截图 + DOM 度量（只读，不改主文件）
 * ------------------------------------------------------------
 * 产出：docs/ui-audit-20261109/shots/*.png + measure.json
 * 约束：
 *   · 只用 Edge headless + CDP，不用 puppeteer.launch；
 *   · 临时 profile 固定落 D:\.temp\browser-profiles\arcane-ui-<pid>-<ts>，结束时删除；
 *   · 每张图记录：视口、缩放倍率、文件 MD5、自上一张以来新增页面报错数。
 * 用法：node tools/ui_audit_20261109.js
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'docs', 'ui-audit-20261109');
const SHOTS = path.join(OUT, 'shots');
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-ui-${process.pid}-${Date.now()}`);
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const PORT = 9721;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 找一个存在的 Edge 可执行文件
 * @returns {string} Edge 路径
 */
function findEdge() {
  for (const p of EDGE_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('找不到 msedge.exe');
}

/**
 * 删除目录（Windows 上 Edge 可能短时占用，带重试）
 * @param {string} dir 目录
 * @returns {boolean} 是否删干净
 */
function rmDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 计算文件 MD5
 * @param {string} file 文件路径
 * @returns {string} 32 位小写 MD5
 */
function md5File(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 主流程：起浏览器 → 逐屏截图 → 度量 → 落盘 → 清理
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const edgePath = findEdge();
  const edge = spawn(edgePath, [
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
      errors.push({ kind: 'exception', text: ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').slice(0, 300) });
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push({ kind: 'console.error', text: m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300) });
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
   * 在页面里执行表达式并返回值
   * @param {string} expression JS 表达式
   * @returns {Promise<any>} 结果
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };

  const meta = await ev(`(() => ({
    innerW: window.innerWidth, innerH: window.innerHeight,
    dpr: window.devicePixelRatio,
    vvScale: window.visualViewport ? window.visualViewport.scale : null,
    ua: navigator.userAgent
  }))()`);

  const shots = [];
  /**
   * 截一张图并记账（视口 / DPR / MD5 / 新增报错数）
   * @param {string} name 文件名
   * @param {string} label 界面名
   * @returns {Promise<object>} 记账条目
   */
  const shot = async (name, label) => {
    const errBefore = errors.length;
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOTS, name);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    const info = await ev(`(() => ({
      innerW: window.innerWidth, innerH: window.innerHeight,
      dpr: window.devicePixelRatio,
      vvScale: window.visualViewport ? window.visualViewport.scale : null,
      title: document.title
    }))()`);
    const item = {
      label,
      file: 'shots/' + name,
      bytes: fs.statSync(file).size,
      md5: md5File(file),
      viewport: `${info.innerW}x${info.innerH}`,
      dpr: info.dpr,
      vvScale: info.vvScale,
      newErrors: errors.length - errBefore
    };
    shots.push(item);
    return item;
  };

  /**
   * 读取元素计算样式与盒模型（缺元素返回 null）
   * @param {string} selector CSS 选择器
   * @returns {Promise<object|null>} 度量
   */
  const boxOf = async (selector) => ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      selector: ${JSON.stringify(selector)},
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      padding: cs.padding,
      margin: cs.margin,
      border: cs.border,
      borderRadius: cs.borderRadius,
      background: cs.backgroundColor,
      backgroundImage: (cs.backgroundImage || '').slice(0, 180),
      color: cs.color,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      boxShadow: (cs.boxShadow || '').slice(0, 260),
      display: cs.display,
      gap: cs.gap,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120)
    };
  })()`);

  await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(2600);

  /* 1. 标题 */
  await sleep(700);
  const titleMetrics = {
    wordmark: await boxOf('#titleWordmark'),
    kicker: await boxOf('.title-kicker'),
    start: await boxOf('#btnStart'),
    startKbd: await boxOf('#btnStart kbd'),
    tagline: await boxOf('.title-tagline'),
    hero: await boxOf('.title-hero'),
    secondary: await boxOf('.title-secondary'),
    scroll: await ev(`(() => {
      const el = document.querySelector('.title-scroll');
      const card = document.querySelector('.title-card');
      const r = (el || card || document.querySelector('#titleLayer')).getBoundingClientRect();
      return {
        scrollHeight: (el || card || document.documentElement).scrollHeight,
        clientHeight: (el || card || document.documentElement).clientHeight,
        innerHeight: window.innerHeight,
        box: { x: r.x, y: r.y, w: r.width, h: r.height }
      };
    })()`),
    difficultyBtn: await boxOf('.difficulty-mode'),
    /* 找出标题页里所有出现内部滚动的元素：用于定位截图右侧那条原生滚动条 */
    overflowing: await ev(`(() => {
      const out = [];
      document.querySelectorAll('#titleLayer *').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) {
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) return;
          const cs = getComputedStyle(el);
          out.push({
            tag: el.tagName, cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '',
            rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
            sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth,
            overflowY: cs.overflowY, scrollbarWidth: cs.scrollbarWidth, scrollbarColor: cs.scrollbarColor
          });
        }
      });
      return out.slice(0, 12);
    })()`)
  };
  await shot('01-title.png', '标题页');

  /* 2. 选角（全新 profile → 首次开始会进角色选择） */
  await ev(`document.getElementById('btnStart').click(); true`);
  await sleep(900);
  const charOpen = await ev(`!document.getElementById('charLayer').classList.contains('hidden')`);
  const charMetrics = {
    sheet: await boxOf('#charLayer .sheet, #charLayer .char-sheet, #charLayer .codex-card'),
    card: await boxOf('.char-card'),
    name: await boxOf('.char-card .cc-name'),
    stat: await boxOf('.char-card .cc-stat'),
    confirm: await boxOf('#btnCharConfirm'),
    hint: await boxOf('.char-hint')
  };
  await shot('02-charselect.png', '选角');

  /* 进入游戏 */
  await ev(`document.getElementById('btnCharConfirm').click(); true`);
  await sleep(2000);

  /* 3. 战斗：双槽 + 冷却环
     先尽量把两张魔法装进双槽；拿不到第二张就保持默认。 */
  await ev(`(() => {
    const d = window.__roamDebug;
    try {
      const s = d.getState();
      const m = (s.ownedMagic || []).slice();
      if (m[0]) d.dual.equip(m[0]);
      if (m[1]) d.dual.equip(m[1]);
    } catch (e) {}
    d.spawnEnemy('wanderer', 120, -60);
    d.spawnEnemy('shooter', -130, 80);
    d.spawnEnemy('phaser', 160, 120);
    return true;
  })()`);
  await sleep(500);
  await ev(`(() => { try { window.__roamDebug.dual.cast(); } catch (e) {} return true; })()`);
  await sleep(120);
  await shot('03-battle.png', '战斗（双槽/冷却环）');

  /* 4. 路线图 / 全屏地图 */
  await ev(`window.__roamDebug.openPanel('map'); true`);
  await sleep(550);
  await shot('04-map.png', '路线图');
  await ev(`window.__roamDebug.closePanel('map'); true`);
  await sleep(350);

  /* 5. 奖励三选一 */
  const rewardKeys = await ev(`window.__roamDebug.openReward('skill')`);
  await sleep(600);
  const rewardMetrics = {
    card: await boxOf('.reward-card'),
    name: await boxOf('.reward-card .r-name'),
    desc: await boxOf('.reward-card .r-desc'),
    tag: await boxOf('.reward-card .r-tag'),
    grid: await boxOf('.reward-grid'),
    modal: await boxOf('.modal')
  };
  await shot('05-reward.png', '奖励三选一');

  /* 6. 商店（局内 Canvas 房；第 2 层起有保底商店，逐层找）
     奖励流程有两段（技能 → 被动），必须选两次才会真正回到 playing。 */
  await ev(`(() => {
    const d = window.__roamDebug;
    const k = ${JSON.stringify(rewardKeys || [])};
    if (k && k[0]) d.chooseReward(k[0]);
    return true;
  })()`);
  await sleep(600);
  /* 技能段选完后会自动接被动段；用真实 DOM 点击把剩下的奖励段全部选完 */
  const rewardFlowClosed = await ev(`(async () => {
    const d = window.__roamDebug;
    for (let i = 0; i < 5; i += 1) {
      if (d.getState().mode !== 'reward') break;
      const card = document.querySelector('[data-reward-key]');
      if (!card) break;
      card.click();
      await new Promise((r) => setTimeout(r, 420));
    }
    return d.getState().mode;
  })()`);
  await sleep(700);
  const shopInfo = await ev(`(() => {
    const d = window.__roamDebug;
    d.setEmbers(40);
    for (let f = 2; f <= 15; f += 1) {
      d.setFloor(f);
      const a = d.shopAudit();
      if (a.roomId >= 0 && a.room) {
        const ped = a.pedestals[0];
        if (ped) d.teleport(ped.x - 52, ped.y + 42);
        else d.teleport(a.room.cx, a.room.cy);
        d.setEmbers(40);
        return { floor: f, room: a.room, pedestals: a.pedestals, embers: a.counts.embers };
      }
    }
    return null;
  })()`);
  await sleep(1400);
  await shot('06-shop.png', '商店（局内）');

  /* 7. 设置（音频页） */
  await ev(`document.getElementById('btnSettings').click(); true`);
  await sleep(550);
  const settingsMetrics = {
    card: await boxOf('#settingsPanel .codex-card'),
    tab: await boxOf('.settings-tab'),
    row: await boxOf('.setting-row'),
    switch: await boxOf('.switch'),
    note: await boxOf('.setting-note')
  };
  await shot('07-settings.png', '设置');

  /* 8. 成就 / 档案（设置 → 其他 → 档案分区） */
  await ev(`(() => {
    const t = document.querySelector('[data-settings-tab="other"]');
    if (t) t.click();
    const el = document.getElementById('archiveSection');
    if (el) el.scrollIntoView({ block: 'start' });
    return true;
  })()`);
  await sleep(650);
  const archiveMetrics = {
    grid: await boxOf('.archive-grid'),
    cell: await boxOf('.archive-cell'),
    ach: await boxOf('.archive-ach'),
    achItem: await boxOf('.archive-ach > *')
  };
  await shot('08-achievements.png', '成就 / 档案');
  await ev(`document.getElementById('settingsClose').click(); true`);
  await sleep(400);

  /* 9. 技能树 */
  await ev(`window.__roamDebug.openPanel('skilltree'); true`);
  await sleep(750);
  const treeMetrics = {
    card: await boxOf('.codex-card.is-tree'),
    node: await boxOf('[data-tree-node]'),
    wrap: await boxOf('.tree-wrap')
  };
  await shot('09-skilltree.png', '技能树');
  await ev(`window.__roamDebug.closePanel('skilltree'); true`);
  await sleep(400);

  /* 10. 图鉴 */
  await ev(`window.__roamDebug.openPanel('codex'); true`);
  await sleep(700);
  const codexMetrics = {
    card: await boxOf('#codexPanel .codex-card'),
    tab: await boxOf('#codexPanel .help-tab'),
    entry: await boxOf('#codexPanel .codex-entry'),
    row: await boxOf('#codexPanel .codex-entry:nth-child(2)')
  };
  await shot('10-codex.png', '图鉴');
  await ev(`window.__roamDebug.closePanel('codex'); true`);
  await sleep(400);

  /* 11. 结算 */
  await ev(`window.__roamDebug.forceDeath(); true`);
  await sleep(1100);
  const resultMetrics = {
    modal: await boxOf('.result-modal'),
    title: await boxOf('.result-modal h2'),
    btn: await boxOf('.result-modal .btn')
  };
  await shot('11-result.png', '结算');

  /* HUD / 通用控件度量（结算态下 HUD 仍在） */
  const commonMetrics = {
    hudTop: await boxOf('.hud-top'),
    brand: await boxOf('.brand .logo'),
    hudRecord: await boxOf('.hud-record'),
    btn: await boxOf('.btn'),
    btnStart: await boxOf('.btn-start'),
    deck: await boxOf('.hud-deck'),
    deckSlot: await boxOf('.deck-slot'),
    deckStats: await ev(`(() => {
      const deck = document.querySelector('.hud-deck');
      const slots = document.querySelectorAll('.deck-slot, .deck-card, [data-deck-slot]');
      const locked = Array.from(slots).filter((el) => (el.textContent || '').indexOf('未解锁') >= 0).length;
      const minimap = document.querySelector('.minimap-panel');
      const floorPanel = document.querySelector('.floor-panel');
      const r = deck ? deck.getBoundingClientRect() : null;
      const rm = minimap ? minimap.getBoundingClientRect() : null;
      const rf = floorPanel ? floorPanel.getBoundingClientRect() : null;
      return {
        deck: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
        deckHeightRatio: r ? +(r.height / window.innerHeight * 100).toFixed(1) : null,
        slotCount: document.querySelectorAll('#magicRow > *, #techRow > *').length,
        magicCardCount: document.querySelectorAll('#magicRow > *').length,
        techCardCount: document.querySelectorAll('#techRow > *').length,
        lockedSlotCount: document.querySelectorAll('#magicRow .is-locked, #techRow .is-locked').length,
        miniCard: (() => {
          const c = document.querySelector('#magicRow .mini-card');
          if (!c) return null;
          const r = c.getBoundingClientRect();
          const cs = getComputedStyle(c);
          return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), borderRadius: cs.borderRadius, border: cs.border, fontSize: cs.fontSize };
        })(),
        magicRow: (() => {
          const c = document.querySelector('#magicRow');
          if (!c) return null;
          const r = c.getBoundingClientRect();
          const cs = getComputedStyle(c);
          return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), gap: cs.gap, gridTemplateColumns: (cs.gridTemplateColumns || '').slice(0, 200) };
        })(),
        minimap: rm ? { x: rm.x, y: rm.y, w: rm.width, h: rm.height } : null,
        floorPanel: rf ? { x: rf.x, y: rf.y, w: rf.width, h: rf.height } : null
      };
    })()`)
  };

  const report = {
    project: 'D:\\\\其他\\\\TRAE宝\\\\奥术工程师\\\\index_arcane_v2.html',
    mainBytes: fs.statSync(MAIN).size,
    mainMd5: md5File(MAIN),
    capturedAt: new Date().toISOString(),
    env: meta,
    charOpen,
    rewardFlowClosed,
    shopInfo,
    shots,
    errors,
    tokens: await ev(`(() => {
      const out = {};
      const root = getComputedStyle(document.documentElement);
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const rule of Array.from(rules || [])) {
          if (rule.selectorText === ':root' && rule.style) {
            for (const name of Array.from(rule.style)) {
              if (name.indexOf('--') === 0 && !(name in out)) out[name] = root.getPropertyValue(name).trim();
            }
          }
        }
      }
      return out;
    })()`),
    metrics: { title: titleMetrics, char: charMetrics, reward: rewardMetrics, settings: settingsMetrics, archive: archiveMetrics, tree: treeMetrics, codex: codexMetrics, result: resultMetrics, common: commonMetrics }
  };
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ out: OUT, shots: shots.length, errors: errors.length, shopInfo, charOpen }, null, 2));

  ws.close();
  try {
    if (process.platform === 'win32' && edge.pid) spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
    else edge.kill('SIGKILL');
  } catch (e) { /* 已退出 */ }
  for (let i = 0; i < 10; i += 1) {
    if (rmDir(PROFILE)) break;
    await sleep(250);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e && e.stack ? e.stack : e);
  rmDir(PROFILE);
  process.exit(1);
});
