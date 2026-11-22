// UI 第一批验收：DEV 徽章隐藏 + 飘字语义色统一
// 用法：node tools/ui_batch1_probe.js [页面路径] [输出目录]
// 判据：
//   1) devMode=false 时 #charDevBadge 计算样式 display = none；
//      去掉 hidden class 后又能显示（证明是 class 规则在起作用，不是整体隐藏）；
//   2) FX_SEM 语义常量存在，且关键值符合 tokens 提案；
//   3) 真实命中路径：普通伤害 / 暴击 / 护盾吸收 三条飘字分别等于 FX_SEM.damage / crit / shield；
//   4) 页面运行期 0 异常。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9553;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'ui1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/**
 * 记录一条断言并打印
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 附加信息
 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/**
 * 探针主流程：起浏览器 → 选角页取证 → 进战斗 → 逐语义取证 → 截图
 */
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
  const runtimeErrors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(m.params && m.params.exceptionDetails
        ? (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text
        : 'unknown');
    }
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
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);

  // ---- 1) DEV 徽章：devMode=false 时必须不可见 ----
  await ev('startGame()');
  await sleep(700);
  const badge = await ev(`(() => {
    const el = document.getElementById('charDevBadge');
    if (!el) return { missing: true };
    const before = {
      devMode: CHARACTER_CONFIG.devMode,
      cls: el.className,
      display: getComputedStyle(el).display,
      w: el.getBoundingClientRect().width,
      h: el.getBoundingClientRect().height
    };
    // 反证：临时去掉 hidden，徽章应当重新出现（说明是 .char-dev.hidden 在起作用）
    el.classList.remove('hidden');
    const shownDisplay = getComputedStyle(el).display;
    const shownW = el.getBoundingClientRect().width;
    el.classList.add('hidden');
    return { before: before, shownDisplay: shownDisplay, shownW: shownW };
  })()`);
  check('devMode=false 时 DEV 徽章不可见',
    badge && !badge.missing && badge.before.devMode === false
    && badge.before.display === 'none' && badge.before.w === 0,
    badge && badge.before);
  check('去掉 hidden 后徽章能恢复显示（规则确实由 class 驱动）',
    badge && badge.shownDisplay !== 'none' && badge.shownW > 0,
    badge && { shownDisplay: badge.shownDisplay, shownW: badge.shownW });

  // 选角页取证截图（含徽章区域）
  await shot('charselect-page.png');

  // ---- 2) 语义色常量 ----
  const sem = await ev(`(() => {
    if (typeof FX_SEM === 'undefined') return { missing: true };
    return { keys: Object.keys(FX_SEM), values: FX_SEM };
  })()`);
  check('FX_SEM 语义常量已定义',
    sem && !sem.missing && sem.keys.length >= 9
    && sem.values.damage === '#ff6b7f' && sem.values.shield === '#7fa8ff'
    && sem.values.aether === '#3ee6ff' && sem.values.crit === '#ffcd4d',
    sem && { keys: sem.keys, damage: sem.values.damage, shield: sem.values.shield, aether: sem.values.aether });

  // ---- 3) 真实命中路径取色 ----
  await ev(`(() => { chooseCharacter(CHARACTER_CONFIG.ids[0]); return true; })()`);
  await sleep(900);
  await ev(`(() => { const d = window.__roamDebug; d.enemies.floor(1); return true; })()`);
  await sleep(300);

  const plain = await ev(`(() => {
    const e = state.enemies[0];
    if (!e) return { skipped: 'no enemy' };
    e.hp = Math.max(e.hp, 400);
    state.floats.length = 0;
    damageEnemy(e, 7, 0, { noCrit: true });
    const f = state.floats[state.floats.length - 1];
    return { color: f && f.color, text: f && f.text, expected: FX_SEM.damage };
  })()`);
  check('普通伤害飘字 = FX_SEM.damage', plain && plain.color === plain.expected, plain);

  const crit = await ev(`(() => {
    const e = state.enemies[0];
    if (!e) return { skipped: 'no enemy' };
    const saved = FEEL_CONFIG.critChance;
    FEEL_CONFIG.critChance = 1;               // 临时必暴，不改任何数值平衡（测完还原）
    e.hp = Math.max(e.hp, 400);
    state.floats.length = 0;
    damageEnemy(e, 9, 0, {});
    FEEL_CONFIG.critChance = saved;
    const f = state.floats[state.floats.length - 1];
    return { color: f && f.color, text: f && f.text, expected: FX_SEM.crit };
  })()`);
  check('暴击飘字 = FX_SEM.crit', crit && crit.color === crit.expected, crit);

  const shield = await ev(`(() => {
    const p = state.player;
    const savedInvuln = p.invuln;
    p.invuln = 0;
    p.deepShield = 40;
    state.floats.length = 0;
    damagePlayer(10, p.x + 40, p.y, { kind: 'hazard' });
    p.invuln = savedInvuln;
    const f = state.floats[state.floats.length - 1];
    return { color: f && f.color, text: f && f.text, expected: FX_SEM.shield };
  })()`);
  check('护盾吸收飘字 = FX_SEM.shield', shield && shield.color === shield.expected, shield);

  // ---- 4) 同屏取证：三语义同时出现时颜色互不撞 ----
  await ev(`(() => {
    const e = state.enemies[0];
    const p = state.player;
    state.floats.length = 0;
    if (e) {
      e.hp = Math.max(e.hp, 400);
      damageEnemy(e, 7, 0, { noCrit: true });
      addFloat('+18 HP', p.x, p.y - 46, FX_SEM.heal, 14, { outline: 2 });
      addFloat('奥能 +30', p.x + 18, p.y - 56, FX_SEM.aether, 13, { outline: 2 });
      addFloat('护盾 -12', p.x - 18, p.y - 56, FX_SEM.shield, 13, { outline: 2 });
      addFloat('诅咒 · 上限 -1', p.x, p.y - 66, FX_SEM.debuff, 12, { outline: 2 });
      addFloat('暴击 -28', (e.x || 0) + 26, (e.y || 0) - 30, FX_SEM.crit, 18, { outline: 3 });
    }
    return true;
  })()`);
  await sleep(120);
  await shot('float-colors.png');

  // ---- 5) 页面异常 ----
  const errs = await ev('window.__roamDebug.errors ? window.__roamDebug.errors() : []');
  check('运行期 0 异常', (errs.length === 0) && (runtimeErrors.length === 0), {
    debugErrors: errs.slice(0, 4), runtimeErrors: runtimeErrors.slice(0, 4)
  });

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nSUMMARY  ${passed}/${results.length} PASS`);
  console.log('OUT  ' + OUT);
  process.exitCode = passed === results.length ? 0 : 1;
  try { ws.close(); } catch (e) { /* ignore */ }
  if (EDGE_PROC) killEdge(EDGE_PROC);
}

main().catch((e) => {
  console.error('FATAL', e && e.message);
  if (EDGE_PROC) killEdge(EDGE_PROC);
  process.exit(1);
});
