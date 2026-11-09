/**
 * U5「塔灵死因台词 + 结算自传」验收脚本（端口 9496）
 * ------------------------------------------------------------
 * 用法：node tools/arcane_u5.js
 * 断言见 .spec/u5-death/spec.md 第 6 节。
 *
 * 流程要点：
 *   1) 先验证「最锋利一击」记录链路（打 200 伤害）；
 *   2) 用 __roamDebug.killBy 逐类制造死亡（每类前 restart，保证状态干净）；
 *   3) A/B 关闭后确认面板回到纯数字版；
 *   4) 通关面板也要带自传；
 *   5) 最后跑 fps + 错误统计。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9496;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail == null ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---------- 0. 静态守卫：旧死亡路径必须还在 ----------
  const source = fs.readFileSync(FILE, 'utf8');
  ok('旧死亡路径保留（loseGame + 机体失效 + showResult）',
    source.includes('function loseGame(') && source.includes('机体失效') && source.includes('function showResult('),
    { loseGame: source.includes('function loseGame('), showResult: source.includes('function showResult(') });

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

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
  /**
   * 截一张整屏图
   * @param {string} name 文件名
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  const btn = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  await ev(`window.__roamDebug.setU5(true)`);
  await ev(`window.__roamDebug.setCritChance(0)`);

  // ============================================================
  // 1. 配置：7 类 × 2 句 + 3 条首领台词
  // ============================================================
  const audit = await ev(`window.__roamDebug.u5Audit()`);
  ok('配置：开关开启 + 7 类死因 × 每类 2 句 + 3 条首领台词',
    audit.enabled === true && audit.kinds.length === 7
    && audit.quotesPerKind.every((n) => n === 2) && audit.bossQuotes.length === 3,
    { enabled: audit.enabled, kinds: audit.kinds, quotesPerKind: audit.quotesPerKind, boss: audit.bossQuotes });

  // ============================================================
  // 2. 最锋利一击：打 200 伤害 → runBest 更新
  // ============================================================
  await ev(`window.__roamDebug.clearEnemies()`);
  await ev(`window.__roamDebug.spawnThreat('crawler', 60, 0)`);
  await sleep(120);
  await ev(`window.__roamDebug.hitEnemy('crawler', 200)`);
  const bestSnap = await ev(`window.__roamDebug.u5Audit().runBest`);
  ok('最锋利一击：200 伤害被记录为 runBest',
    bestSnap && bestSnap.amount >= 200 && typeof bestSnap.target === 'string',
    bestSnap);

  const bioNow = await ev(`window.__roamDebug.autobiography(false)`);
  ok('自传三要素：路线 / 战力 / 构筑句齐全',
    !!bioNow && bioNow.lines.length === 3
    && bioNow.route.indexOf('用了') >= 0
    && bioNow.power.indexOf('最锋利的一击') >= 0
    && bioNow.build.indexOf('从没碰过') >= 0,
    bioNow && { route: bioNow.route, power: bioNow.power, build: bioNow.build });

  const bioText = bioNow ? bioNow.lines.join(' ') : '';
  const tagNames = Object.keys(audit.labels).length ? ['火', '雷', '冰', '弹体', '区域', '连锁', '控制', '持续', '治疗'] : [];
  ok('自传里能读到「从没碰过的标签」的具体名字',
    tagNames.some((name) => bioText.indexOf(name) >= 0),
    { hit: tagNames.filter((name) => bioText.indexOf(name) >= 0) });

  /**
   * 制造一次指定死因的死亡，并读取面板证据
   * @param {string} kind 死因类型
   * @param {string} name 来源名
   * @param {string|null} bossKind 首领类型
   * @returns {Promise<Object>} { cause, tag, text, hasVoice, hasBio }
   */
  async function dieWith(kind, name, bossKind) {
    await ev(`window.__roamDebug.restart()`);
    await sleep(260);
    await ev(`window.__roamDebug.setU5(true)`);
    await ev(`window.__roamDebug.killBy('${kind}', '${name}'${bossKind ? `, '${bossKind}'` : ''})`);
    await sleep(320);
    const cause = await ev(`window.__roamDebug.deathCause()`);
    const dom = await ev(`(function(){
      var voice = document.querySelector('.tower-voice');
      var bio = document.querySelector('.run-autobiography');
      return {
        tag: voice ? voice.getAttribute('data-death-cause') : null,
        hasVoice: !!voice,
        hasBio: !!bio,
        modalCause: document.querySelector('.result-modal') ? document.querySelector('.result-modal').getAttribute('data-death-cause') : null
      };
    })()`);
    const text = await ev(`window.__roamDebug.resultText()`);
    return { cause, dom, text };
  }

  // ---------- 3. 接触死因 ----------
  const contact = await dieWith('contact', '履带爬行者');
  ok('接触死因：kind=contact + 面板 data-death-cause + 塔灵台词命中该句',
    contact.cause && contact.cause.kind === 'contact' && contact.dom.tag === 'contact'
    && audit.quotes.contact.indexOf(contact.cause.quote) >= 0,
    { kind: contact.cause && contact.cause.kind, tag: contact.dom.tag, quote: contact.cause && contact.cause.quote });

  // ---------- 4. 冲锋死因（台词必须和 contact 不同） ----------
  const charge = await dieWith('charge', '戍卫碑像');
  ok('冲锋死因：kind=charge + 台词与接触不同',
    charge.cause && charge.cause.kind === 'charge' && charge.dom.tag === 'charge'
    && audit.quotes.charge.indexOf(charge.cause.quote) >= 0 && charge.cause.quote !== contact.cause.quote,
    { kind: charge.cause && charge.cause.kind, quote: charge.cause && charge.cause.quote });

  // ---------- 5. 弹幕死因 ----------
  const bullet = await dieWith('bullet', '尖啸者');
  ok('弹幕死因：kind=bullet',
    bullet.cause && bullet.cause.kind === 'bullet' && bullet.dom.tag === 'bullet'
    && audit.quotes.bullet.indexOf(bullet.cause.quote) >= 0,
    { kind: bullet.cause && bullet.cause.kind, quote: bullet.cause && bullet.cause.quote });

  // ---------- 6. 自爆死因 ----------
  const selfd = await dieWith('selfdestruct', '裂隙残片');
  ok('自爆死因：kind=selfdestruct',
    selfd.cause && selfd.cause.kind === 'selfdestruct' && selfd.dom.tag === 'selfdestruct',
    { kind: selfd.cause && selfd.cause.kind, quote: selfd.cause && selfd.cause.quote });

  // ---------- 7. 危险区死因 ----------
  const hazard = await dieWith('hazard', '机械首领');
  ok('危险区死因：kind=hazard',
    hazard.cause && hazard.cause.kind === 'hazard' && hazard.dom.tag === 'hazard',
    { kind: hazard.cause && hazard.cause.kind, quote: hazard.cause && hazard.cause.quote });

  // ---------- 8. 首领优先 ----------
  const bossDeath = await dieWith('bullet', '机械首领', 'mech');
  ok('首领优先：带 bossKind 时用首领专属台词，不落回普通弹幕句',
    bossDeath.cause && bossDeath.cause.bossKind === 'mech'
    && bossDeath.cause.quote === audit.bossQuoteText.mech
    && audit.quotes.bullet.indexOf(bossDeath.cause.quote) < 0,
    { bossKind: bossDeath.cause && bossDeath.cause.bossKind, quote: bossDeath.cause && bossDeath.cause.quote });

  const shots = [];
  shots.push(await shot('u5-death-boss.png'));

  // ---------- 9. 覆盖率 ----------
  ok('至少 5 类死因有专属台词与专属标签',
    audit.covered >= 5 && Object.keys(audit.labels).length >= 7,
    { covered: audit.covered, labels: Object.keys(audit.labels) });

  // ---------- 10. 死亡面板确实渲染了台词 + 自传 ----------
  ok('死亡面板同时渲染塔灵台词块与本局自传',
    contact.dom.hasVoice === true && contact.dom.hasBio === true
    && contact.text.indexOf('塔灵记录') >= 0 && contact.text.indexOf('本局自传') >= 0,
    { voice: contact.dom.hasVoice, bio: contact.dom.hasBio, text: contact.text.replace(/\s+/g, ' ').slice(0, 80) });

  // ---------- 11. A/B 关闭 ----------
  await ev(`window.__roamDebug.restart()`);
  await sleep(260);
  await ev(`window.__roamDebug.setU5(false)`);
  await ev(`window.__roamDebug.killBy('contact', '履带爬行者')`);
  await sleep(320);
  const offDom = await ev(`(function(){
    var m = document.querySelector('.result-modal');
    return {
      voice: !!document.querySelector('.tower-voice'),
      bio: !!document.querySelector('.run-autobiography'),
      cause: m ? m.getAttribute('data-death-cause') : null,
      text: document.querySelector('.modal') ? document.querySelector('.modal').innerText : ''
    };
  })()`);
  ok('A/B 关闭：无台词块 / 无自传 / 无 data-death-cause，文案回旧版',
    offDom.voice === false && offDom.bio === false && offDom.cause === null
    && offDom.text.indexOf('塔灵记录') < 0 && offDom.text.indexOf('本局自传') < 0,
    { voice: offDom.voice, bio: offDom.bio, cause: offDom.cause });

  const offAuto = await ev(`window.__roamDebug.autobiography(false)`);
  ok('A/B 关闭时 autobiography 返回 null', offAuto === null, offAuto);

  // 恢复并留一张死亡面板截图
  await ev(`window.__roamDebug.restart()`);
  await sleep(260);
  await ev(`window.__roamDebug.setU5(true)`);
  await ev(`window.__roamDebug.killBy('charge', '履带爬行者')`);
  await sleep(320);
  shots.push(await shot('u5-death-charge.png'));

  // ---------- 12. 通关面板也带自传 ----------
  await ev(`window.__roamDebug.restart()`);
  await sleep(300);
  await ev(`window.__roamDebug.setU5(true)`);
  await ev(`window.__roamDebug.setFloor(3)`);
  await sleep(500);
  await ev(`window.__roamDebug.defeatBoss()`);
  await sleep(2900);
  const winState = await ev(`(function(){
    var bio = document.querySelector('.victory-modal .run-autobiography');
    return {
      status: window.__roamDebug.getState().status,
      hasBio: !!bio,
      text: bio ? bio.innerText : ''
    };
  })()`);
  ok('通关面板也渲染本局自传（同一段叙事，语气为「走完」）',
    winState.status === 'won' && winState.hasBio === true && winState.text.indexOf('走完') >= 0,
    { status: winState.status, hasBio: winState.hasBio, text: winState.text.replace(/\s+/g, ' ').slice(0, 80) });
  shots.push(await shot('u5-victory-bio.png'));

  // ---------- 13. 性能 ----------
  const perf = await ev(`new Promise(function(resolve){
    var frames = []; var last = performance.now(); var warm = 0;
    function tick(now){
      var dt = now - last; last = now;
      if (warm < 40) { warm += 1; } else { frames.push(dt); }
      if (frames.length >= 150) {
        var sum = 0; var max = 0;
        frames.forEach(function(d){ if (d > 0) { sum += d; if (d > max) max = d; } });
        var avg = sum / frames.length;
        resolve({ avgFps: Number((1000 / avg).toFixed(1)), minFps: Number((1000 / max).toFixed(1)),
          errors: window.__roamDebug.errors() });
      } else { requestAnimationFrame(tick); }
    }
    requestAnimationFrame(tick);
  })`);
  console.log('PERF · ' + JSON.stringify(perf));
  ok('avg fps ≥ 60（跳过首帧预热）', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
  ok('无运行时错误', perf.errors.length === 0, perf.errors);

  const missing = shots.filter((s) => !fs.existsSync(s) || fs.statSync(s).size < 10 * 1024);
  ok('截图齐全且 > 10KB', missing.length === 0, missing.map((s) => path.basename(s)));

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nU5 · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(path.join(OUT_DIR, 'u5-result.json'),
    JSON.stringify({ passed, total: asserts.length, asserts }, null, 2));

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 150);
});
