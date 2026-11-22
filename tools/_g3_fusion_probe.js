/**
 * 第三组·技能融合 只读探针
 * ------------------------------------------------------------
 * 目的：按真实 F 键与解锁条件，走通 3 组融合，并验证战斗中确实生效：
 *   1. 未解锁按 F → 明确提示，融合列表不变；
 *   2. 解锁后按 F 触发三条配方：连锁闪电 / 爆炸新星 / 护盾爆轰；
 *   3. 每组记录卡面、技能栏（底部融合条）、HUD 变化；
 *   4. 战斗实测：雷击连锁目标数、火球二目标溅射、治疗变护盾+范围伤害；
 *   5. 技能详情说明包含「怎么融 / 和谁融 / 融出什么 / 有什么用」。
 * 只读：不改游戏文件，只在页面内存构造测试卡组，不写存档（meta 解锁也是内存态）。
 * 用法：node tools/_g3_fusion_probe.js
 * 产物：.screenshots/g3/fusion_probe.json + fusion_detail.png
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9792;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'g3');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并连接 CDP
 * @param {string} file 被测 HTML 绝对路径
 * @returns {Promise<{ev:Function, shot:Function, close:Function}>} 探针句柄
 */
async function boot(file) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(proc); throw new Error('Edge 调试端口未就绪'); }
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
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  for (let i = 0; i < 200; i += 1) {
    await sleep(250);
    try { if (await ev(`typeof state !== 'undefined' && typeof tryFuse === 'function'`)) break; } catch (e) { /* 解析中 */ }
  }
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, shot, close };
}

/**
 * 主流程：解锁边界 → 三组配方 → 战斗实测 → 详情文案断言
 * @returns {Promise<void>}
 */
async function main() {
  const { ev, shot, close } = await boot(FILE);
  const result = { recipes: [] };
  try {
    await ev(`(function(){
      window.__charSkipPick = true;
      var b = document.getElementById('btnStart');
      if (b) b.click();
      return true;
    })()`);
    await sleep(1200);

    /* 基底：进入 playing、关自动施法、清空战斗对象 */
    await ev(`(function(){
      state.mode = 'playing'; state.status = 'playing';
      state.meta.autoCast = false;
      state.overdrive = null;
      state.player.x = 400; state.player.y = 400;
      state.player.hp = state.player.hpMax;
      state.player.aether = state.player.aetherMax;
      state.player.shield = 0;
      state.enemies.length = 0;
      state.projectiles.length = 0;
      state.castQueue = [];
      state.drones = [];
      state.fusions = [];
      state.meta.unlocks.fusion = false;
      /* 关掉教学占屏，保证 F 的即时提示能真正显示出来 */
      if (state.tutorial) state.tutorial.done = true;
      if (state.onboard) { state.onboard.hint = null; state.onboard.modalHint = null; }
      if (typeof toastQueue !== 'undefined') toastQueue.length = 0;
      if (typeof toastBusyUntil !== 'undefined') toastBusyUntil = 0;
      renderDeck(); updateHUD();
      return true;
    })()`);

    /* 0) 未解锁按 F：只提示，不融合 */
    await ev(`state.cooldowns = {}; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true })); true`);
    await sleep(120);
    result.locked = await ev(`({ fusions: state.fusions.slice(), toast: (document.getElementById('toast')||{}).textContent || '' })`);

    /* 解锁（内存态），后续全部走真实 F 键 */
    await ev(`state.meta.unlocks.fusion = true; true`);

    /**
     * 在页面里执行一组配方：装卡 → 按 F → 记录卡面/技能栏/HUD
     * @param {string} magic 魔法 id
     * @param {string} tech 科技 id
     * @returns {Object} 触发结果
     */
    const fuseRecipe = async (magic, tech) => {
      await ev(`(function(){
        state.ownedMagic = ['${magic}'];
        state.ownedTech = ['${tech}'];
        state.activeMagicId = '${magic}';
        state.activeTechId = '${tech}';
        state.fusions = [];
        state.cooldowns = {};
        state.enemies.length = 0;
        state.projectiles.length = 0;
        state.drones = [];
        state.hints.fusion = true;
        renderDeck(); updateHUD();
        return true;
      })()`);
      const before = await ev(`({
        deckFused: !!document.querySelector('[data-magic-id="${magic}"].is-fused'),
        hud: (document.getElementById('hudFusion')||{}).textContent || '',
        bar: (document.getElementById('fusionBar')||{}).textContent || ''
      })`);
      await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true })); true`);
      await sleep(250);
      const after = await ev(`({
        fusions: state.fusions.slice(),
        deckFused: !!document.querySelector('[data-magic-id="${magic}"].is-fused'),
        badge: (document.querySelector('[data-magic-id="${magic}"] .m-fused')||{}).textContent || '',
        hud: (document.getElementById('hudFusion')||{}).textContent || '',
        bar: (document.getElementById('fusionBar')||{}).textContent || '',
        toast: (document.getElementById('toast')||{}).textContent || ''
      })`);
      return { before, after };
    };

    /* 1) 连锁闪电：bolt + capacitor */
    result.recipes.push({ id: 'chainBolt', magic: 'bolt', tech: 'capacitor', ...(await fuseRecipe('bolt', 'capacitor')) });
    result.chainCombat = await ev(`(function(){
      state.enemies.length = 0; state.projectiles.length = 0;
      var ids = [];
      [[150,0],[300,0],[450,0],[600,0]].forEach(function(p){
        ids.push(spawnEnemy(ENEMY_CONFIG[0].id, state.player.x + p[0], state.player.y + p[1], state.floor, { summoned: true }).id);
      });
      state.aim.angle = 0;
      var f = getFusionForMagic('bolt');
      castBolt(MAGIC_BY_ID.bolt, f);
      return state.enemies.map(function(e){ return { id: e.id, hp: e.hp, max: e.hpMax }; });
    })()`);
    await sleep(150);
    result.chainCombatAfter = await ev(`state.enemies.map(function(e){ return { id: e.id, hp: e.hp, max: e.hpMax }; })`);
    result.chainHits = result.chainCombat.filter((e) => e.hp < e.max).length;

    /* 2) 爆炸新星：fireball + field，副目标在 105px，普通火球 82px 炸不到 */
    result.recipes.push({ id: 'novaBurst', magic: 'fireball', tech: 'field', ...(await fuseRecipe('fireball', 'field')) });
    result.novaCombat = await ev(`(function(){
      state.enemies.length = 0; state.projectiles.length = 0;
      var px = state.player.x, py = state.player.y;
      /* 固定坐标可能贴墙：沿 8 个方向找一条主目标与副目标都可走的方向 */
      var angle = 0, found = false;
      for (var k = 0; k < 8; k += 1) {
        angle = k * Math.PI / 4;
        var ax = px + Math.cos(angle) * 160, ay = py + Math.sin(angle) * 160;
        var bx = ax + Math.cos(angle + Math.PI / 2) * 105;
        var by = ay + Math.sin(angle + Math.PI / 2) * 105;
        if (isPointWalkable(ax, ay) && isPointWalkable(bx, by)) { found = true; break; }
      }
      if (!found) {
        /* 全被墙挡住就退到脚下：把主目标放在离玩家 150 的开放点 */
        for (var k2 = 0; k2 < 16 && !found; k2 += 1) {
          angle = k2 * Math.PI / 8;
          var ax2 = px + Math.cos(angle) * 150, ay2 = py + Math.sin(angle) * 150;
          var bx2 = ax2 + Math.cos(angle + Math.PI / 2) * 105;
          var by2 = ay2 + Math.sin(angle + Math.PI / 2) * 105;
          if (isPointWalkable(ax2, ay2) && isPointWalkable(bx2, by2)) {
            px = state.player.x; py = state.player.y; found = true;
          }
        }
      }
      var ax = px + Math.cos(angle) * 160, ay = py + Math.sin(angle) * 160;
      var bx = ax + Math.cos(angle + Math.PI / 2) * 105;
      var by = ay + Math.sin(angle + Math.PI / 2) * 105;
      spawnEnemy(ENEMY_CONFIG[0].id, ax, ay, state.floor, { summoned: true });
      spawnEnemy(ENEMY_CONFIG[0].id, bx, by, state.floor, { summoned: true });
      state.aim.angle = angle;
      castFireball(MAGIC_BY_ID.fireball, getFusionForMagic('fireball'));
      for (var i = 0; i < 40; i += 1) updateProjectiles(0.016);
      return state.enemies.map(function(e){ return { id: e.id, hp: Math.round(e.hp), max: e.hpMax }; });
    })()`);

    /* 3) 护盾爆轰：heal + field，护盾 8s + 半径 132 伤害 */
    result.recipes.push({ id: 'shieldNova', magic: 'heal', tech: 'field', ...(await fuseRecipe('heal', 'field')) });
    result.shieldCombat = await ev(`(function(){
      state.enemies.length = 0; state.projectiles.length = 0;
      state.player.shield = 0;
      var e = spawnEnemy(ENEMY_CONFIG[0].id, state.player.x + 60, state.player.y, state.floor, { summoned: true });
      castHeal(MAGIC_BY_ID.heal, getFusionForMagic('heal'));
      return { shield: state.player.shield, enemy: { hp: Math.round(e.hp), max: e.hpMax } };
    })()`);

    /* 4) 详情文案：能读到怎么融 / 和谁融 / 融出什么 / 有什么用 */
    result.detail = await ev(`(function(){
      state.ownedMagic = ['bolt', 'fireball'];
      state.ownedTech = ['capacitor', 'field'];
      state.fusions = ['chainBolt'];
      openPanel('skilltree');
      var n = document.querySelector('[data-tree-node="magic:bolt"]');
      if (n) n.click();
      var text = (document.getElementById('treeInspector')||{}).textContent || '';
      return { text: text.replace(/\\s+/g, ' ').trim(),
        hasHow: text.indexOf('怎么融') >= 0,
        hasPartner: text.indexOf('电容') >= 0,
        hasName: text.indexOf('连锁闪电') >= 0,
        hasUse: text.indexOf('额外跳跃') >= 0 };
    })()`);
    await shot('fusion_detail.png');

    result.apiPresence = await ev(`({ tryFuse: typeof tryFuse, getFusionForMagic: typeof getFusionForMagic, getAvailableFusions: typeof getAvailableFusions })`);
  } finally {
    fs.writeFileSync(path.join(OUT_DIR, 'fusion_probe.json'), JSON.stringify(result, null, 2));
    close();
  }

  /* ---------------- 汇总判定 ---------------- */
  const checks = [];
  checks.push(['未解锁 F 不融合', result.locked.fusions.length === 0]);
  checks.push(['未解锁有提示', /融合未解锁/.test(result.locked.toast)]);
  const r1 = result.recipes[0];
  checks.push(['连锁闪电已触发', r1.after.fusions.indexOf('chainBolt') >= 0]);
  checks.push(['卡面出现融合标记', r1.after.deckFused === true && r1.after.badge === '融合']);
  checks.push(['HUD 融合计数变化', /1 \/ \d+/.test(r1.after.hud)]);
  const chainHits = result.chainHits || 0;
  checks.push(['连锁闪电命中 ≥3 只', chainHits >= 3]);
  const r2 = result.recipes[1];
  checks.push(['爆炸新星已触发', r2.after.fusions.indexOf('novaBurst') >= 0]);
  const nova = result.novaCombat || [];
  const splash = nova.length === 2 && nova.every((e) => e.hp < e.max);
  checks.push(['爆炸新星副目标也吃伤害', splash]);
  const r3 = result.recipes[2];
  checks.push(['护盾爆轰已触发', r3.after.fusions.indexOf('shieldNova') >= 0]);
  checks.push(['护盾爆轰给盾并伤敌', (result.shieldCombat.shield || 0) >= 8 && result.shieldCombat.enemy.hp < result.shieldCombat.enemy.max]);
  checks.push(['详情含怎么融', result.detail.hasHow]);
  checks.push(['详情含和谁融', result.detail.hasPartner]);
  checks.push(['详情含融出什么', result.detail.hasName]);
  checks.push(['详情含有什么用', result.detail.hasUse]);

  checks.forEach(([name, ok]) => console.log((ok ? 'PASS ' : 'FAIL ') + name));
  console.log('chainHits', chainHits, 'nova', JSON.stringify(result.novaCombat), 'shield', JSON.stringify(result.shieldCombat));
  console.log('RESULT: ' + (checks.every((x) => x[1]) ? 'PASS' : 'FAIL'));
  console.log('OUT:', path.join(OUT_DIR, 'fusion_probe.json'));
}

main().catch((error) => { console.error(error); process.exit(1); });
