// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// M1-3 专项验收：稀有度三档 / 技能段过滤 / 被动段独立 / 5 层融合保底 / 两段暂停 / 布局 / fps
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9462;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm13');

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
  /** 量三张奖励卡：是否同 top / 是否在视口内 / 是否被遮挡 */
  const measureReward = () => ev(`(() => {
    const cards = Array.from(document.querySelectorAll('#modal .reward-card'));
    if (!cards.length) return { n: 0 };
    const rects = cards.map((c) => c.getBoundingClientRect());
    const tops = rects.map((r) => Math.round(r.top));
    const inside = rects.every((r) => r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1);
    let covered = 0;
    cards.forEach((card, index) => {
      const r = rects[index];
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === card || card.contains(hit))) covered += 1;
    });
    return {
      n: cards.length,
      sameTop: tops.every((t) => Math.abs(t - tops[0]) <= 1),
      inside,
      covered,
      overflowX: document.documentElement.scrollWidth - innerWidth,
      vw: innerWidth,
      vh: innerHeight
    };
  })()`);

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
    const kindsOf = (keys) => keys.map((k) => k.split(':')[0]);
    const unique = (arr) => new Set(arr).size === arr.length;

    // 1) 稀有度三档配置
    const rc = d.rarityConfig();
    ok('稀有度三档：普通/稀有/史诗 权重 55/35/10',
      rc.common.weight === 55 && rc.rare.weight === 35 && rc.epic.weight === 10, rc);

    // 2) 技能段 200 次抽样：3 张 / 不重复 / 无遗物 / 三档都出现
    const raritySeen = {};
    let badLen = false;
    let dup = false;
    let relicInSkill = false;
    for (let i = 0; i < 200; i += 1) {
      const keys = d.openReward();
      const snap = S();
      if (keys.length !== 3) badLen = true;
      if (!unique(keys)) dup = true;
      if (kindsOf(keys).indexOf('relic') >= 0) relicInSkill = true;
      snap.rarities.forEach((r) => { raritySeen[r] = (raritySeen[r] || 0) + 1; });
    }
    ok('技能段永远 3 张、key 不重复', !badLen && !dup, { badLen, dup });
    ok('技能段不混入遗物', !relicInSkill, relicInSkill);
    ok('三档稀有度都能抽到', !!(raritySeen.common && raritySeen.rare && raritySeen.epic), raritySeen);

    // 3) 满栏：12 张全持有后，不再出现已持有魔法 / 科技
    ['fireball', 'frost', 'bolt', 'heal', 'blade', 'mine'].forEach((id) => d.grantMagic(id));
    ['concentrator', 'field', 'capacitor', 'nanite', 'magnet', 'amp'].forEach((id) => d.grantTech(id));
    let dupModule = false;
    let lenOk = true;
    for (let i = 0; i < 30; i += 1) {
      const keys = d.openReward();
      if (keys.length !== 3) lenOk = false;
      if (keys.some((k) => k.indexOf('magic:') === 0 || k.indexOf('tech:') === 0)) dupModule = true;
    }
    ok('满栏过滤：不再出现已持有魔法 / 科技', !dupModule && lenOk, { dupModule, lenOk });

    // 5) 融合保底：pity = 4 时技能段必现融合
    d.setFusionPity(4);
    const pityKeys = d.openReward();
    const pitySnap = S();
    ok('5 层保底：pity=4 时必现可融合件',
      kindsOf(pityKeys).indexOf('fusion') >= 0 && pitySnap.fusionPity === 4,
      pityKeys);

    // 6) 保底兜底：一条融合都没有时，补"只差一张"的模块
    d.restart();
    await sleep(200);
    d.grantMagic('fireball');
    d.setFusionPity(4);
    const enableKeys = d.openReward();
    const enableSnap = S();
    const forced = enableSnap.options.map((key, i) => ({ key, rarity: enableSnap.rarities[i] }));
    const hasEnabler = await (async () => {
      const modal = document.querySelector('#modal');
      return modal ? modal.innerHTML.indexOf('补上它即可凑出融合') >= 0 : false;
    })();
    ok('保底兜底：无融合时改为"只差一张"的模块', hasEnabler, forced);

    // 7) 两段式：技能段选完立即进被动段
    d.restart();
    await sleep(200);
    const skillKeys = d.openReward();
    d.chooseReward(skillKeys[0]);
    await sleep(120);
    const mid = S();
    ok('技能段选完 -> 被动段（仍在 reward）', mid.mode === 'reward' && mid.rewardStage === 'passive', { mode: mid.mode, stage: mid.rewardStage });
    ok('被动段池只有遗物 / 补给', mid.options.every((k) => k.indexOf('relic:') === 0 || k.indexOf('supply:') === 0), mid.options);
    ok('被动段重新抽卡，不复用技能段选项', unique(mid.options) && mid.options[0] !== skillKeys[0], mid.options);

    // 9) 被动生效：抽到符文增幅 -> damageMul 1.12 -> 回 playing
    let powerKey = null;
    for (let i = 0; i < 30; i += 1) {
      const snap = S();
      if (snap.mode !== 'reward' || snap.rewardStage !== 'passive') d.openPassiveReward();
      const now = S();
      if (now.options.indexOf('relic:power') >= 0) { powerKey = 'relic:power'; break; }
      d.openPassiveReward();
    }
    const damageBefore = S().mods.damageMul;
    if (powerKey) d.chooseReward(powerKey);
    await sleep(100);
    const afterRelic = S();
    ok('被动段生效：符文增幅使伤害 ×1.12 并回到 playing',
      !!powerKey && Math.abs(afterRelic.mods.damageMul / damageBefore - 1.12) < 0.01
        && afterRelic.mode === 'playing' && afterRelic.rewardStage === null,
      { powerKey, damageBefore, damageMul: afterRelic.mods.damageMul, mode: afterRelic.mode });

    // 11) 两段暂停：每段打开后 elapsed 连采两次不增长
    d.openReward();
    const a1 = S().elapsed;
    await sleep(400);
    const a2 = S().elapsed;
    const skillFrozen = Math.abs(a2 - a1) < 0.02;
    const sKeys = S().options;
    d.chooseReward(sKeys[0]);
    await sleep(120);
    const b1 = S().elapsed;
    await sleep(400);
    const b2 = S().elapsed;
    const passiveFrozen = Math.abs(b2 - b1) < 0.02;
    ok('技能段世界暂停', skillFrozen, { a1, a2 });
    ok('被动段世界暂停', passiveFrozen, { b1, b2 });

    // 12) 奖励中开技能树 -> 关闭后阶段与选项不变
    const beforeTree = S();
    document.querySelector('#modal [data-action="skilltree"]').click();
    await sleep(220);
    d.closePanel('skilltree');
    await sleep(220);
    const afterTree = S();
    ok('技能树往返：阶段与 3 张选项不变',
      afterTree.mode === 'reward' && afterTree.rewardStage === beforeTree.rewardStage
        && afterTree.options.join('|') === beforeTree.options.join('|'),
      { stage: afterTree.rewardStage, options: afterTree.options });

    // 10) 满栏 + 全融合：仍 3 张可点、无重复
    d.restart();
    await sleep(200);
    ['fireball', 'frost', 'bolt', 'heal', 'blade', 'mine'].forEach((id) => d.grantMagic(id));
    ['concentrator', 'field', 'capacitor', 'nanite', 'magnet', 'amp'].forEach((id) => d.grantTech(id));
    d.openPanel('skilltree');
    const tree = d.treeState();
    d.closePanel('skilltree');
    tree.nodes.filter((n) => n.kind === 'fusion').forEach((n) => d.grantFusion(n.id));
    const fullKeys = d.openReward();
    const fullSnap = S();
    ok('满栏 + 全融合：仍 3 张、无重复、无技能卡（只剩契约 / 补给）',
      fullKeys.length === 3 && unique(fullKeys)
        && fullKeys.every((k) => k.indexOf('supply:') === 0 || k.indexOf('relic:') === 0 || k.indexOf('pact:') === 0),
      fullKeys);
    ok('满栏时融合保底不报错且不重复', fullSnap.mode === 'reward', fullKeys);
    d.closePanel('reward');

    return out;
  })()`);
  page.forEach((item) => check(item.name, item.pass, item.detail));

  // ---------------- 视口布局 + 截图 ----------------
  await ev(`window.__roamDebug.restart(); true`);
  await sleep(900);
  const VIEWPORTS = [
    [1280, 720, 1], [1280, 720, 1.25], [1920, 1080, 1], [1920, 1080, 1.25]
  ];
  for (const [w, h, zoom] of VIEWPORTS) {
    await setViewport(w, h, zoom);
    const tag = `${w}x${h}_${Math.round(zoom * 100)}`;
    await ev(`window.__roamDebug.openReward(); true`);
    await sleep(350);
    const skill = await measureReward();
    check(`${tag} 技能段：3 卡同 top / 在视口内 / 无遮挡 / 无横向溢出`,
      skill.n === 3 && skill.sameTop && skill.inside && skill.covered === 0 && skill.overflowX <= 1,
      skill);
    if (zoom === 1) await shot(`01_skill_${w}.png`);
    await ev(`window.__roamDebug.openPassiveReward(); true`);
    await sleep(350);
    const passive = await measureReward();
    check(`${tag} 被动段：3 卡同 top / 在视口内 / 无遮挡 / 无横向溢出`,
      passive.n === 3 && passive.sameTop && passive.inside && passive.covered === 0 && passive.overflowX <= 1,
      passive);
    if (zoom === 1) await shot(`02_passive_${w}.png`);
    await ev(`window.__roamDebug.closePanel('reward'); true`);
    await sleep(200);
  }

  // ---------------- 性能 / 报错 ----------------
  await setViewport(1920, 1080, 1);
  await sleep(3500);
  const perf = await ev(`(() => ({ fps: window.__roamDebug.getState().fps, errors: window.__errors.slice() }))()`);
  check('战斗帧率 >= 55', perf.fps >= 55, perf.fps);
  check('全程 __errors 为空', perf.errors.length === 0, perf.errors);

  const passed = results.filter((r) => r.ok).length;
  console.log(`RESULT ${passed}/${results.length}`);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ passed, total: results.length, results }, null, 2));
  ws.close();
  killEdge(edge);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
