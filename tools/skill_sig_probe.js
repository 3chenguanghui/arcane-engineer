// skill-feel-v1 专项验收：施法签名环（形状语言 / 暗底描边 / 生命周期 / 零报错）
// 用法：node tools/skill_sig_probe.js [页面路径] [截图输出目录]
// 判据：
//   1) 20 条技能逐条走真实 castSlot 后，特效队列至少新增 2 枚环；
//   2) 新增环里存在该技能签名形状（SKILL_SIG[id].shape）且 casing = true；
//   3) 签名环 life ≤ 0.45 秒（不拖尾、不阻挡视野）；
//   4) 页面运行期 0 异常。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9549;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'skillsig');

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
 * 探针主流程：起浏览器 → 开局 → 逐条技能施法 → 断言签名环 → 截图
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
  /* 关键：headless Edge 默认把 prefers-reduced-motion 报告为 reduce，
     那样签名环会走"无障碍静态版"（只有 1 枚、life 0.22），
     本脚本前半段要验的是常规动画版，所以先强制 no-preference。 */
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  });
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
  /* 直接用 startGame() 进局：比模拟点击按钮稳定（标题层的按钮在 headless 下
     可能被入场动画/遮罩接住，导致"点了但没开局"）。
     首次开局会先弹角色选择（Esc 不可跳过），这里直接调 chooseCharacter 选第一个角色。 */
  const started = await ev(`(() => {
    startGame();
    chooseCharacter(CHARACTER_CONFIG.ids[0]);
    return { mode: state.mode, status: state.status };
  })()`);
  check('进入战斗局', started.mode === 'playing', started);
  await sleep(900);

  await ev(`(() => { const d = window.__roamDebug; d.enemies.floor(1); return true; })()`);
  await sleep(300);

  // ---- 1) 形状表自身：20 条技能都有签名，且形状键都在 SIG_SHAPES 内 ----
  const tableInfo = await ev(`(() => {
    const ids = Object.keys(SKILL_SIG);
    const missing = ids.filter((id) => !MAGIC_BY_ID[id]);
    const unknownShape = ids.filter((id) => !SIG_SHAPES[SKILL_SIG[id].shape]);
    const colors = ids.map((id) => SKILL_SIG[id].color.toLowerCase());
    const dupColors = colors.filter((c, i) => colors.indexOf(c) !== i);
    return { ids: ids.length, magic: MAGIC_CONFIG.length, missing, unknownShape, dupColors,
      shapes: ids.map((id) => id + ':' + SKILL_SIG[id].shape) };
  })()`);
  check('签名表覆盖全部技能', tableInfo.missing.length === 0 && tableInfo.ids === tableInfo.magic, {
    sig: tableInfo.ids, magic: tableInfo.magic, missing: tableInfo.missing
  });
  check('形状键全部已实现', tableInfo.unknownShape.length === 0, tableInfo.unknownShape);
  check('主色互不重复', tableInfo.dupColors.length === 0, tableInfo.dupColors);

  // ---- 2) 逐条技能真实施法，检查签名环 ----
  const perSkill = [];
  const ids = await ev('Object.keys(SKILL_SIG)');
  for (const id of ids) {
    const probe = await ev(`(() => {
      const before = state.rings.length;
      const r = __roamDebug.abatch.cast('${id}', 0);
      const added = state.rings.slice(before);
      const sig = SKILL_SIG['${id}'];
      const sigRings = added.filter((g) => g.shape === sig.shape);
      return {
        ok: !!r.ok,
        error: r.error || null,
        mode: state.mode,
        status: state.status,
        added: added.length,
        sigCount: sigRings.length,
        casing: added.filter((g) => g.casing).length,
        maxLife: sigRings.reduce((m, g) => Math.max(m, g.maxLife || 0), 0),
        shapes: Array.from(new Set(added.map((g) => g.shape)))
      };
    })()`);
    perSkill.push({ id, ...probe });
    await sleep(60);
  }
  const badAdd = perSkill.filter((p) => p.added < 2);
  const badSig = perSkill.filter((p) => p.sigCount < 1);
  const badLife = perSkill.filter((p) => p.maxLife > 0.45);
  const badCasing = perSkill.filter((p) => p.casing < 1);
  check('每次施法新增 ≥2 枚环', badAdd.length === 0, badAdd.map((p) => `${p.id}:${p.added}`));
  check('每次施法都有签名形状', badSig.length === 0, badSig.map((p) => `${p.id}:${p.sigCount}`));
  check('签名环 life ≤ 0.45s', badLife.length === 0, badLife.map((p) => `${p.id}:${p.maxLife}`));
  check('技能环带暗底描边', badCasing.length === 0, badCasing.map((p) => p.id));

  // ---- 2.5) 卡面左缘辨识色条（S2）----
  /* 未解锁卡也写 --mc，只是 CSS 把 opacity 压到 0.28；
     这里连"CSS 真的生效"一起验（读 ::before 计算样式）。 */
  const cardInfo = await ev(`(() => {
    return Array.from(document.querySelectorAll('.mini-card.magic')).map((c) => ({
      id: c.getAttribute('data-magic-id'),
      mc: c.style.getPropertyValue('--mc').trim().toLowerCase(),
      painted: getComputedStyle(c, '::before').backgroundColor
    }));
  })()`);
  check('20 张技能卡都写入 --mc', cardInfo.length === 20 && cardInfo.every((c) => !!c.mc),
    { count: cardInfo.length, missing: cardInfo.filter((c) => !c.mc).map((c) => c.id) });
  check('左缘色互不重复', new Set(cardInfo.map((c) => c.mc)).size === 20,
    { unique: new Set(cardInfo.map((c) => c.mc)).size });
  check('左缘色条 CSS 生效', cardInfo.every((c) => c.painted && c.painted !== 'rgba(0, 0, 0, 0)'),
    { sample: cardInfo.slice(0, 3) });

  // 卡组特写：目视确认 20 条颜色条纹能一眼分开
  const deckBox = await ev(`(() => {
    const el = document.querySelector('#deck .row, .deck-row, .mini-card.magic');
    const host = el && el.closest('.row') ? el.closest('.row') : el.parentElement;
    const r = host.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, scale: 1 };
  })()`);
  const deckShot = await send('Page.captureScreenshot', { format: 'png', clip: deckBox });
  fs.writeFileSync(path.join(OUT, 'deck-stripes.png'), Buffer.from(deckShot.data, 'base64'));

  // ---- 2.6) 性能护栏：光环软上限（S3-2）----
  const capProbe = await ev(`(() => {
    const saved = state.rings.slice();
    state.rings.length = 0;
    for (let i = 0; i < 300; i += 1) {
      state.rings.push({ x: 0, y: 0, radius: 10, grow: 0, color: '#ffffff',
        life: 5, maxLife: 5, shape: 'ring', spin: 0, dir: 0, casing: false });
    }
    updateEffects(0.016);
    const after = state.rings.length;
    // 还原现场，避免影响后面的截图
    state.rings.length = 0;
    saved.forEach((g) => state.rings.push(g));
    return { after: after, cap: RING_SOFT_CAP };
  })()`);
  check('光环软上限生效（300 → ≤120）', capProbe.after <= capProbe.cap && capProbe.after > 0, capProbe);

  // ---- 2.65) 连续施法压力：环数不随时间累积 ----
  const stormProbe = await ev(`(() => {
    let peak = 0;
    for (let i = 0; i < 60; i += 1) {
      __roamDebug.abatch.cast('flameCone', i * 6);
      updateEffects(0.016);
      peak = Math.max(peak, state.rings.length);
    }
    return { peak: peak, cap: RING_SOFT_CAP };
  })()`);
  check('连续 60 次施法环数不失控', stormProbe.peak <= stormProbe.cap, stormProbe);

  // ---- 2.7) 无障碍：prefers-reduced-motion 下签名环改为静态（S3-3）----
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  const rmProbe = await ev(`(() => {
    const before = state.rings.length;
    __roamDebug.abatch.cast('fireball', 0);
    const added = state.rings.slice(before).filter((g) => g.shape === SKILL_SIG.fireball.shape);
    return { count: added.length, grows: added.map((g) => g.grow), lifes: added.map((g) => g.maxLife) };
  })()`);
  check('reduced-motion 只留 1 枚静态签名环',
    rmProbe.count === 1 && rmProbe.grows.every((g) => g === 0), rmProbe);
  /* 恢复常规动画，避免影响后续截图与其它脚本习惯 */
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  });

  // ---- 2.8) 命中飘字归属色（S3 前 2 项之一）----
  const hitColor = await ev(`(() => {
    const sigColor = SKILL_SIG.fireball.color.toLowerCase();
    for (let i = 0; i < 14; i += 1) {
      const e = state.enemies[0];
      if (!e) return { skipped: 'no enemy' };
      e.hp = Math.max(e.hp, 120);
      damageEnemy(e, 1, 0, { abilityId: 'fireball' });
      const f = state.floats[state.floats.length - 1];
      if (f && String(f.color).toLowerCase() === sigColor) {
        return { matched: true, color: f.color, tries: i + 1 };
      }
    }
    return { matched: false };
  })()`);
  check('普通命中飘字用技能主色', hitColor.matched === true, hitColor);

  // ---- 3) 同屏三技能连发截图（可读性目视证据） ----
  await ev(`(() => {
    __roamDebug.abatch.cast('fireball', 0);
    __roamDebug.abatch.cast('frost', 90);
    __roamDebug.abatch.cast('flameCone', 180);
    return true;
  })()`);
  await sleep(90);
  await shot('same-screen-3skills.png');

  // ---- 4) 页面异常 ----
  const errs = await ev('window.__roamDebug.errors ? window.__roamDebug.errors() : []');
  check('运行期 0 异常', (errs.length === 0) && (runtimeErrors.length === 0), {
    debugErrors: errs.slice(0, 4), runtimeErrors: runtimeErrors.slice(0, 4)
  });

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nSUMMARY  ${passed}/${results.length} PASS`);
  console.log('SHAPES   ' + tableInfo.shapes.join(' | '));
  process.exitCode = passed === results.length ? 0 : 1;
  try { ws.close(); } catch (e) { /* ignore */ }
  if (EDGE_PROC) killEdge(EDGE_PROC);
}

main().catch((e) => {
  console.error('FATAL', e && e.message);
  if (EDGE_PROC) killEdge(EDGE_PROC);
  process.exit(1);
});
