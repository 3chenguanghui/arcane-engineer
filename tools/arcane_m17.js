// M1 收口专项：① 跑 10 局统计"一局平均能凑出几条融合" ② 卡面 UI 前后对比截图 + 悬停详情截图
// 用法：node arcane_m17.js <html绝对路径> <截图输出目录>
// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9466;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm17');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const RUNS = 10;       // 统计局数
const FLOORS = 6;      // 每局模拟到第 6 层（正常一局的长度）

/**
 * 记录一条断言并即时打印
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 */
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
    } catch (e) { /* 端口还没起来，继续等 */ }
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
  const shotClip = async (name, x, y, w, h, scale = 2) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale } });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到元素 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await send('Page.navigate', { url });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(700);

  // ==================== 1) 页内：一局自动流程（清层 → 三选一 → 被动 → 下楼） ====================
  await ev(`window.__m17 = (function () {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    /** 轮询等待条件成立（不要写死 sleep，避免机器慢时误判） */
    async function waitFor(fn, timeout) {
      const t0 = performance.now();
      while (performance.now() - t0 < (timeout || 3000)) {
        if (fn()) return true;
        await sleep(16);
      }
      return false;
    }
    /**
     * 给每张候选卡打分：模拟"懂配方的玩家"——能立刻合体的最高分，其次是有搭档的半成品
     * @param {string} key 形如 magic:frost / tech:nanite
     * @param {Object} s 当前状态快照
     * @returns {number} 分数
     */
    function scoreCard(key, s) {
      const parts = key.split(':');
      const kind = parts[0];
      const id = parts[1];
      /* 奖励里直接出现的"融合成品"最值钱：立刻生效、且不占卡位 */
      if (kind === 'fusion') return s.fusions.includes(id) ? -500 : 200;
      if (kind !== 'magic' && kind !== 'tech') return -1000;   // 遗物 / 强化不是卡，优先级最低
      if (kind === 'magic' ? s.ownedMagic.includes(id) : s.ownedTech.includes(id)) return -500; // 已拥有
      const partnerKind = kind === 'magic' ? 'tech' : 'magic';
      const partners = partnerKind === 'magic' ? s.ownedMagic : s.ownedTech;
      let score = 0;
      FUSION_CONFIG.forEach((fusion) => {
        if (s.fusions.includes(fusion.id)) return;             // 已激活的配方不再算
        if (fusion[kind] !== id) return;
        score = partners.includes(fusion[partnerKind]) ? Math.max(score, 120) : Math.max(score, 30);
      });
      /* 稀有度做小权重：同分时优先拿史诗，避免"只认融合、错过强卡" */
      const rarity = (s.rarities || [])[s.options.indexOf(key)] || 'common';
      score += rarity === 'epic' ? 6 : (rarity === 'rare' ? 3 : 1);
      return score;
    }
    /** 从当前奖励三选一里挑最优的一张并选中 */
    function pickBest() {
      const s = d.getState();
      if (!s.options.length) return null;
      let bestKey = s.options[0];
      let bestScore = -Infinity;
      s.options.forEach((key) => {
        const sc = scoreCard(key, s);
        if (sc > bestScore) { bestScore = sc; bestKey = key; }
      });
      d.chooseReward(bestKey);
      return bestKey;
    }
    /** 清空本层 → 吃技能三选一 → 吃被动 → 回 playing */
    async function clearAndReward() {
      d.killAllEnemies();
      await waitFor(() => d.getState().mode === 'reward', 2600);
      const skillKey = pickBest();
      /* 选完技能会立刻切到"被动段"，再选一个（真实玩家正常流程） */
      await waitFor(() => {
        const s = d.getState();
        return s.mode === 'playing' || (s.mode === 'reward' && s.rewardStage === 'passive');
      }, 1600);
      const s2 = d.getState();
      if (s2.mode === 'reward' && s2.rewardStage === 'passive' && s2.options.length) {
        d.chooseReward(s2.options[0]);
      }
      await waitFor(() => d.getState().mode === 'playing', 1600);
      return skillKey;
    }
    /** 跑完一局（固定 ${FLOORS} 层），返回本局牌组与融合结果 */
    async function runOne() {
      d.restart();
      await sleep(600);
      const picks = [];
      const floors = [];
      for (let f = 0; f < ${FLOORS}; f += 1) {
        const before = d.getState().floor;
        const key = await clearAndReward();
        if (key) picks.push(key);
        /* 融合是"手动按 F"触发的（设计如此）：每拿到一张卡就把能合的立刻合掉，
           模拟一个会用 F 的玩家；否则统计出来的永远是 0 */
        let fusedThisFloor = 0;
        for (let i = 0; i < 12; i += 1) {
          if (!d.fuse()) break;
          fusedThisFloor += 1;
          await sleep(120);
        }
        d.descend();
        const moved = await waitFor(() => d.getState().floor !== before, 4200);
        await sleep(650);   // 等楼层转场动画结束，避免下一层开局被暂停
        const s = d.getState();
        floors.push({ floor: s.floor, fusions: s.fusions.length, cards: s.ownedMagic.length + s.ownedTech.length });
        if (!moved) break;
      }
      const s = d.getState();
      return {
        floor: s.floor,
        picks: picks,
        ownedMagic: s.ownedMagic.slice(),
        ownedTech: s.ownedTech.slice(),
        fusions: s.fusions.slice(),
        fusionCount: s.fusions.length,
        floors: floors
      };
    }
    return { runOne: runOne, clearAndReward: clearAndReward };
  })(); true`);

  // ==================== 2) 连跑 10 局 ====================
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const r = await ev('window.__m17.runOne()');
    runs.push(r);
    console.log(`第 ${i + 1} 局：${r.floor} 层 · ${r.picks.length} 张卡 · 融合 ${r.fusionCount} 条 [${r.fusions.join(', ')}]`);
  }
  const avgFusion = runs.reduce((a, r) => a + r.fusionCount, 0) / runs.length;
  const runsWithFusion = runs.filter((r) => r.fusionCount > 0).length;
  const fusionTally = {};
  runs.forEach((r) => r.fusions.forEach((id) => { fusionTally[id] = (fusionTally[id] || 0) + 1; }));
  const stats = {
    generatedAt: new Date().toISOString(),
    floorsPerRun: FLOORS,
    runs: RUNS,
    avgFusion: Number(avgFusion.toFixed(2)),
    runsWithFusion,
    distribution: runs.map((r) => r.fusionCount),
    tally: fusionTally,
    data: runs
  };
  fs.writeFileSync(path.join(OUT, 'm17-fusion-10runs.json'), JSON.stringify(stats, null, 2));

  check('10 局全部跑完（每局至少到 5 层）',
    runs.length === 10 && runs.every((r) => r.floor >= 5),
    runs.map((r) => r.floor));
  check('每局至少拿到 5 次技能三选一',
    runs.every((r) => r.picks.length >= 5),
    runs.map((r) => r.picks.length));
  check('一局平均至少凑出 1 条融合',
    avgFusion >= 1,
    { avg: Number(avgFusion.toFixed(2)), perRun: runs.map((r) => r.fusionCount) });
  check('至少 7/10 局能凑出融合（不是少数幸运局）',
    runsWithFusion >= 7,
    { runsWithFusion, distribution: runs.map((r) => r.fusionCount) });

  // ==================== 3) 卡面 UI 前后对比截图 ====================
  // "前" = 用样式盖掉 M1-4 新增的三样东西（稀有度边框 / 角标 / 底部融合条），其余完全一致，
  // 这样前后是同一套 HUD、同一批卡，差异只来自 M1-4 本身。
  const deckInfo = await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.restart();
    await sleep(500);
    ['fireball', 'frost', 'bolt', 'heal', 'blade', 'mine'].forEach((id) => d.grantMagic(id));
    ['concentrator', 'field', 'capacitor', 'nanite', 'magnet', 'amp'].forEach((id) => d.grantTech(id));
    d.setFusions(['homingFireball', 'frostField']);
    await sleep(250);
    /* 注入"回到 M1-4 之前"的样式：只关掉新增的三件事，不改布局 */
    if (!document.getElementById('m14-off-style')) {
      const style = document.createElement('style');
      style.id = 'm14-off-style';
      style.textContent = [
        'body.m14-off .mini-card .m-meta { display: none !important; }',
        'body.m14-off #fusionBar { display: none !important; }',
        'body.m14-off .mini-card.r-common, body.m14-off .mini-card.r-rare, body.m14-off .mini-card.r-epic { border-color: rgba(126, 164, 214, 0.22) !important; box-shadow: none !important; }',
        'body.m14-off .mini-card.r-rare .m-glyph, body.m14-off .mini-card.r-epic .m-glyph { color: inherit !important; text-shadow: none !important; }'
      ].join('\\n');
      document.head.appendChild(style);
    }
    return {
      magic: state.ownedMagic.slice(),
      tech: state.ownedTech.slice(),
      bar: d.fusionBar(),
      rarityOf: state.ownedMagic.map((id) => (MAGIC_BY_ID[id] ? MAGIC_BY_ID[id].rarity : '?')),
      techRarity: state.ownedTech.map((id) => (TECH_BY_ID[id] ? TECH_BY_ID[id].rarity : '?'))
    };
  })()`);
  console.log('卡面样本：', JSON.stringify(deckInfo));

  await ev(`document.body.classList.add('m14-off'); true`);
  await sleep(300);
  await shot('m17-deck-before.png');
  await ev(`document.body.classList.remove('m14-off'); true`);
  await sleep(300);
  await shot('m17-deck-after.png');

  // 融合条内容与数据一致
  const bar = await ev('window.__roamDebug.fusionBar()');
  check('底部「已激活融合」条与数据一致',
    bar.chips === 2 && /2\s*\/\s*10/.test(bar.text),
    bar);

  // 悬停详情 + 可融合高亮
  const hover = await ev(`(function () { return window.__roamDebug.hoverCard('magic', 'fireball'); })()`);
  check('悬停详情弹出并高亮可融合搭档',
    hover.tipOn && hover.tipText.length > 10 && hover.partners.length >= 1,
    { tipOn: hover.tipOn, partners: hover.partners, text: hover.tipText.slice(0, 60) });
  const cardRect = await ev(`(() => { const el = document.querySelector('[data-magic-id="fireball"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  if (cardRect) {
    await shotClip('m17-card-tip.png',
      Math.max(0, Math.round(cardRect.x - 120)), Math.max(0, Math.round(cardRect.y - 260)),
      Math.round(cardRect.w + 90), Math.round(cardRect.h + 300), 2);
  }
  await ev('window.__roamDebug.hideCardTip(); true');

  // ==================== 4) 收尾：帧率 / 报错 ====================
  const finalState = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const d = window.__roamDebug;
    const t0 = performance.now();
    let frames = 0;
    await new Promise((resolve) => {
      const tick = () => { frames += 1; if (performance.now() - t0 > 1200) resolve(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const fps = frames / ((performance.now() - t0) / 1000);
    return { fps: Number(fps.toFixed(1)), errors: d.errors(), floor: d.getState().floor, mode: d.getState().mode };
  })()`);
  check('帧率 ≥ 60', finalState.fps >= 60, finalState.fps);
  check('运行期无报错', Array.isArray(finalState.errors) && finalState.errors.length === 0, finalState.errors);

  console.log(`\n==== 10 局融合统计（每局 ${FLOORS} 层）====`);
  console.log(`平均融合数 ${avgFusion.toFixed(2)} 条/局；有融合的局 ${runsWithFusion}/10；分布 [${runs.map((r) => r.fusionCount).join(', ')}]`);
  console.log('融合出现次数：' + JSON.stringify(fusionTally));
  console.log('样本 JSON：' + path.join(OUT, 'm17-fusion-10runs.json'));

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} ${pass === results.length ? 'PASS' : 'FAIL'}`);
  try { ws.close(); } catch (e) {}
  killEdge(edge);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => { console.error('FAILED', err); process.exit(1); });
