// P4 专项验收：融合推荐（卡面推荐 + 金边角标 + 技能树三态）
// 断言口径：推荐文案必须与 FUSION_CONFIG 的 name/desc 对得上；三种典型手牌各测一次
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9535;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p4fusion');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/** 记录一条断言并打印 */
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
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);

  // ================= 手牌 A：火球 + 力场 → 爆炸新星（可融合） =================
  const handA = await ev(`(() => {
    state.ownedMagic = ['fireball'];
    state.ownedTech = ['field'];
    state.fusions = [];
    const hint = __roamDebug.fusionHint.forOption({ kind: 'magic', id: 'fireball' });
    const conf = FUSION_CONFIG.find((f) => f.id === hint.fusionId);
    return { hint, conf: conf ? { id: conf.id, name: conf.name, magic: conf.magic, tech: conf.tech, desc: conf.desc } : null };
  })()`);
  check('手牌 A（火球+力场）：推荐为"可融合"，且融合名与配方表一致',
    handA.hint.state === 'can' && handA.conf && handA.conf.name === handA.hint.fusionName,
    { state: handA.hint.state, fusionName: handA.hint.fusionName, confName: handA.conf && handA.conf.name });
  check('手牌 A：推荐文案含"与当前"「搭档」"可融合成"，且点名配方里的科技/魔法',
    handA.hint.text.indexOf('与当前') === 0 && handA.hint.text.indexOf('可融合成「' + handA.conf.name + '」') > 0
    && handA.hint.text.indexOf(handA.hint.partnerName) > 0,
    { text: handA.hint.text, partner: handA.hint.partnerName });

  // ================= 手牌 B：只有火球，没有任何科技 → 写明缺什么 =================
  const handB = await ev(`(() => {
    state.ownedMagic = ['fireball'];
    state.ownedTech = [];
    const hint = __roamDebug.fusionHint.forOption({ kind: 'magic', id: 'fireball' });
    const conf = FUSION_CONFIG.find((f) => f.id === hint.fusionId);
    return { hint, confName: conf ? conf.name : null, confTech: conf ? conf.tech : null, techName: conf ? (TECH_BY_ID[conf.tech] || {}).name : null };
  })()`);
  check('手牌 B（只有火球）：推荐为"缺搭档"，并写明缺哪张科技',
    handB.hint.state === 'missing' && handB.hint.text.indexOf('还缺「' + handB.techName + '」') === 0
    && handB.hint.text.indexOf('可融合成「' + handB.confName + '」') > 0,
    { state: handB.hint.state, text: handB.hint.text, techName: handB.techName });

  // ================= 手牌 C：持有火球，抽到科技"力场" → 反向推荐 =================
  const handC = await ev(`(() => {
    state.ownedMagic = ['fireball'];
    state.ownedTech = ['concentrator'];
    const hint = __roamDebug.fusionHint.forOption({ kind: 'tech', id: 'field' });
    const conf = FUSION_CONFIG.find((f) => f.id === hint.fusionId);
    return { hint, confName: conf ? conf.name : null, confMagic: conf ? conf.magic : null };
  })()`);
  check('手牌 C（持有火球抽到力场）：科技卡也能反向推荐同一条融合',
    handC.hint.state === 'can' && handC.hint.fusionName === handC.confName && handC.confMagic === 'fireball',
    { state: handC.hint.state, fusionName: handC.hint.fusionName, confName: handC.confName });

  // ================= 卡片 DOM：金边 + 角标 + 不可融合卡写明缺口 =================
  await ev(`(() => {
    // 先把持有状态固定成"火球 + 力场"，再覆盖三张卡，保证金边/缺口两种形态都能出现
    state.ownedMagic = ['fireball'];
    state.ownedTech = ['field'];
    state.fusions = [];
    window.__roamDebug.openReward('skill');
    const M = MAGIC_BY_ID.fireball;
    const F = MAGIC_BY_ID.frost;
    const T = TECH_BY_ID.nanite;
    state.upgradeOptions = [
      { key: 'magic:fireball', kind: 'magic', id: 'fireball', name: M.name, glyph: M.glyph, desc: M.desc, result: '测试卡 A', rarity: 'rare' },
      { key: 'magic:frost', kind: 'magic', id: 'frost', name: F.name, glyph: F.glyph, desc: F.desc, result: '测试卡 B', rarity: 'rare' },
      { key: 'tech:nanite', kind: 'tech', id: 'nanite', name: T.name, glyph: T.glyph, desc: '测试科技', result: '测试卡 C', rarity: 'rare' }
    ];
    __roamDebug.fusionHint.set({});
    return true;
  })()`);
  await sleep(400);
  const dom = await ev(`(() => {
    const cards = Array.from(document.querySelectorAll('.reward-card'));
    return cards.map((card) => ({
      key: card.getAttribute('data-reward-key'),
      canFuse: card.classList.contains('can-fuse'),
      badge: !!card.querySelector('.r-fuse-badge'),
      fuseText: card.querySelector('.r-fuse') ? card.querySelector('.r-fuse').textContent.trim() : ''
    }));
  })()`);
  await shot('fusion-reward-on.png');
  check('卡片 DOM：可融合卡有金边 class + "可融合"角标',
    dom.filter((c) => c.canFuse).length === 2 && dom.filter((c) => c.badge).length === 2
    && dom.every((c) => !!c.fuseText),
    dom);
  check('卡片 DOM：不可融合的纳米修复卡写明"还缺"且不带金边',
    (() => { const c = dom.find((x) => x.key === 'tech:nanite'); return c && c.canFuse === false && c.fuseText.indexOf('还缺') === 0; })(),
    dom.find((x) => x.key === 'tech:nanite'));

  // ================= 技能树三态：已解锁 / 差一张可合 / 锁定 =================
  await ev(`openPanel('skilltree')`);
  await sleep(500);
  const treeBefore = await ev(`(() => {
    const labels = __roamDebug.fusionHint.tree();
    const domNodes = Array.from(document.querySelectorAll('.tree-node[data-tree-node^="fusion:"]')).map((n) => ({
      id: n.getAttribute('data-tree-node').split(':')[1],
      state: n.querySelector('.n-state').textContent.trim(),
      almost: n.classList.contains('is-almost')
    }));
    return { labels, domNodes };
  })()`);
  await shot('fusion-tree-states.png');
  const almostExpected = treeBefore.labels.filter((x) => x.label === '差一张可合').length;
  check('技能树：融合节点数量与 FUSION_CONFIG 一致',
    treeBefore.domNodes.length === treeBefore.labels.length, { dom: treeBefore.domNodes.length, config: treeBefore.labels.length });
  check('技能树：三态标签正确（已解锁 / 可凑出 / 差一张可合 / 锁定）',
    treeBefore.labels.every((x) => ['已解锁', '可凑出', '差一张可合', '锁定'].indexOf(x.label) >= 0),
    treeBefore.labels);
  check('技能树："差一张可合"数量与持有情况吻合，且只在这些节点上加 is-almost',
    almostExpected > 0 && treeBefore.domNodes.filter((n) => n.almost).length === almostExpected,
    { expected: almostExpected, domAlmost: treeBefore.domNodes.filter((n) => n.almost).length });

  // 已解锁态：把 novaBurst 记入 state.fusions，再开一次面板
  await ev(`(() => { state.fusions = ['novaBurst']; closePanel('skilltree'); openPanel('skilltree'); return true; })()`);
  await sleep(450);
  const ownedLabel = await ev(`(() => {
    const n = document.querySelector('.tree-node[data-tree-node="fusion:novaBurst"] .n-state');
    return n ? n.textContent.trim() : null;
  })()`);
  check('技能树：已融合的节点显示"已解锁"', ownedLabel === '已解锁', { label: ownedLabel });
  await ev(`closePanel('skilltree'); true`);

  // ================= A/B：关掉开关后不再出现推荐行/金边 =================
  await ev(`window.__roamDebug.openReward('skill'); true`);
  await ev(`(() => {
    const M = MAGIC_BY_ID.fireball;
    const T = TECH_BY_ID.field;
    state.upgradeOptions = [
      { key: 'magic:fireball', kind: 'magic', id: 'fireball', name: M.name, glyph: M.glyph, desc: M.desc, result: 'A/B', rarity: 'rare' },
      { key: 'tech:field', kind: 'tech', id: 'field', name: T.name, glyph: T.glyph, desc: 'A/B', result: 'A/B', rarity: 'rare' },
      { key: 'supply:skill:2', kind: 'supply', id: 'supply', name: '应急补给', glyph: '✚', desc: 'A/B', result: 'A/B', rarity: 'common' }
    ];
    __roamDebug.fusionHint.set({ enabled: false });
    return true;
  })()`);
  await sleep(350);
  const offCount = await ev(`document.querySelectorAll('.r-fuse').length + document.querySelectorAll('.can-fuse').length`);
  await shot('fusion-reward-off.png');
  check('A/B 关闭：卡面无推荐行、无金边（A/B 可逆）', offCount === 0, { count: offCount });
  const backOn = await ev(`__roamDebug.fusionHint.set({ enabled: true }).enabled`);
  await sleep(300);
  const onCount = await ev(`document.querySelectorAll('.r-fuse').length`);
  check('A/B 重新开启：推荐行恢复', backOn === true && onCount === 2, { enabled: backOn, hintRows: onCount });

  // ================= C1-5b：融合两处硬伤（换武器失效 / 槽位上限 6） =================
  const fuseHealth = await ev(`(() => {
    const catalog = FUSION_CONFIG.length;
    const weaponBound = FUSION_CONFIG.filter((f) => f.weaponTag).length;
    const limit = fusionSlotLimit();
    /* 换武器后已获融合是否还在：先塞 3 条已融合，再局内切武器 */
    state.fusions = FUSION_CONFIG.slice(0, 3).map((f) => f.id);
    const beforeLen = state.fusions.length;
    const ids = (WEAPON_CONFIG.weapons || []).map((w) => w.id);
    const cur = state.weapon && state.weapon.id;
    const other = ids.filter((id) => id !== cur)[0];
    if (other && cur) setWeaponMeta(other, true);
    const afterLen = state.fusions.length;
    const kept = state.fusions.slice();
    if (other && cur) setWeaponMeta(cur, true);
    return { catalog: catalog, weaponBound: weaponBound, limit: limit, beforeLen: beforeLen,
      afterLen: afterLen, swapped: !!(other && cur), kept: kept };
  })()`);
  check('融合不再依赖武器标签（13 条配方无一条绑定 weaponTag）',
    fuseHealth.weaponBound === 0 && fuseHealth.catalog === 13, fuseHealth);
  check('换武器后已获融合不失效（局内切换前后数量一致）',
    fuseHealth.swapped === true && fuseHealth.afterLen === fuseHealth.beforeLen && fuseHealth.beforeLen === 3, fuseHealth);
  check('融合槽上限按目录重算：ceil(13 × 0.6) = 8，不再是写死的 6',
    fuseHealth.limit === Math.ceil(13 * 0.6) && fuseHealth.limit === 8, fuseHealth);

  const errs = await ev('__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'p4-result.json'), JSON.stringify({ pass, total: results.length, results, handA, handB, handC, dom }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
