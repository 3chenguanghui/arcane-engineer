/**
 * M2 专项验收：故事线（塔灵常驻旁白 / 环境铭文 / 死因第二句 / 通关后日谈 / A-B 开关）
 * 用法：node tools/arcane_m2story.js
 * 端口：9509
 * 输出：.screenshots/art/m2-spirit.png、m2-epilogue.png、m2-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9509;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
    } catch (e) { /* 等 Edge 起来 */ }
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
  await sleep(2000);

  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1500);
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);
  await shot('m2-spirit.png');

  // ---------- M2-1 开局旁白真的出现在 HUD ----------
  const first = await ev(`(function(){
    var d = window.__roamDebug;
    var dom = document.getElementById('spiritLine');
    return {
      story: d.story(),
      cls: dom ? dom.className : '',
      text: dom ? dom.textContent.trim() : '',
      theme: state.themeId
    };
  })()`);
  ok('M2-1 开局旁白出现在 #spiritLine（is-on + 有文本 + shown ≥ 1）',
    first.story.shown >= 1 && first.cls.indexOf('is-on') >= 0 && first.text.length >= 8,
    first);

  // ---------- M2-2 环境铭文 ----------
  ok('M2-2 开局按主题入队一段「铭文」（loreIndex ≥ 1、同局已入队 ≥2 句）',
    first.story.loreIndex >= 1 && first.story.seenCount >= 2 && first.story.lorePool.length === 3,
    { loreIndex: first.story.loreIndex, seenCount: first.story.seenCount, pools: first.story.lorePool });

  // ---------- M2-3 首领台词（真正登场时播报） ----------
  const boss = await ev(`(function(){
    var d = window.__roamDebug;
    var seenBefore = d.story().seenCount;
    var room = state.rooms[state.boss.roomId];
    var intro = startBossIntro(room);
    var seenAfter = d.story().seenCount;
    return { theme: state.themeId, kind: state.boss.kind, seenBefore: seenBefore, seenAfter: seenAfter,
      again: d.storySay('boss', state.boss.kind), introStarted: !!(state.boss && state.boss.started) };
  })()`);
  ok('M2-3 首领真正登场时入队主题台词（再次强制同一句被去重）',
    boss.introStarted === true && boss.kind === 'mech' && boss.seenAfter > boss.seenBefore && boss.again === false,
    boss);

  // ---------- M2-4 真实下楼：楼层 +1 且入队第 2 层台词 ----------
  const descend = await ev(`(function(){
    var d = window.__roamDebug;
    var before = state.floor;
    var okDown = descendFloor();
    var again = d.storySay('descend', state.floor);
    return { okDown: !!okDown, before: before, after: state.floor, again: again, story: d.story() };
  })()`);
  await sleep(400);
  ok('M2-4 真实 descendFloor：楼层 1 → 2，且第 2 层台词已入队（再点被去重）',
    descend.okDown === true && descend.before === 1 && descend.after === 2 && descend.again === false,
    descend);

  // ---------- M2-5 低血旁白 ----------
  const low = await ev(`(function(){
    var d = window.__roamDebug;
    var seenBefore = d.story().seenCount;
    state.player.hpMax = 100;
    state.player.hp = 100;
    state.player.invuln = 0;
    d.damagePlayer(75);
    var after = d.story();
    return {
      hp: state.player.hp,
      seenBefore: seenBefore,
      seenAfter: after.seenCount,
      again: d.storySay('lowHp')
    };
  })()`);
  ok('M2-5 血量跌破 30% 入队低血旁白（再次强制被去重）',
    low.hp <= 30 && low.seenAfter > low.seenBefore && low.again === false,
    low);

  // ---------- M2-6 真实融合旁白 ----------
  const fuse = await ev(`(function(){
    var d = window.__roamDebug;
    var seenBefore = d.story().seenCount;
    state.player.invuln = 9999;
    state.player.hp = state.player.hpMax;
    state.ownedMagic = ['fireball'];
    state.ownedTech = ['concentrator'];
    state.activeMagicId = 'fireball';
    var okFuse = tryFuse();
    var after = d.story();
    return { okFuse: !!okFuse, seenBefore: seenBefore, seenAfter: after.seenCount, fusions: state.fusions.slice() };
  })()`);
  ok('M2-6 真实 tryFuse 成功后入队融合旁白',
    fuse.okFuse === true && fuse.seenAfter > fuse.seenBefore && fuse.fusions.length >= 1,
    fuse);

  // ---------- M2-7 死亡面板第二句（0 融合 + 第 4 层 → 选「一次都没融合」） ----------
  const deathPanel = await ev(`(function(){
    state.floor = 4;
    state.lastHit = { kind: 'bullet', amount: 20, name: '射手傀儡' };
    state.fusions = [];
    showResult();
    var ctx = document.querySelector('.tower-context');
    var quote = document.querySelector('.tower-quote');
    return {
      ctx: ctx ? ctx.textContent : '',
      quote: quote ? quote.textContent : '',
      html: !!document.querySelector('.tower-voice')
    };
  })()`);
  ok('M2-7 死亡面板出现 .tower-context 第二句，且 0 融合时点明「一次都没融合」',
    deathPanel.html === true && deathPanel.ctx.length > 8 && deathPanel.ctx.indexOf('融合') >= 0,
    deathPanel);

  // ---------- M2-8 通关后日谈 ----------
  await ev(`window.__roamDebug.restart()`);
  await sleep(800);
  const epilogue = await ev(`(function(){
    state.status = 'won';
    state.mode = 'won';
    state.floor = 5;
    state.fusions = ['homingFireball'];
    state.pactBlessTaken = true;
    showVictory();
    var box = document.querySelector('.run-epilogue');
    var lines = box ? Array.prototype.map.call(box.querySelectorAll('.epi-line'), function(el){ return el.textContent; }) : [];
    return { lines: lines, text: box ? box.textContent : '' };
  })()`);
  await shot('m2-epilogue.png');
  ok('M2-8 通关面板出现 .run-epilogue（≥2 句、含融合句与契约句）',
    epilogue.lines.length >= 2 && epilogue.text.indexOf('契约') >= 0 && epilogue.text.indexOf('融合') >= 0,
    { lines: epilogue.lines });

  // ---------- M2-9 A/B 开关 + 帧率 + 异常 ----------
  const gate = await ev(`(function(){
    var d = window.__roamDebug;
    state.m2V1 = false;
    var say = d.storySay('clear');
    var epi = buildEpilogueHtml();
    var ctx = deathContextLine({ kind: 'bullet' });
    state.m2V1 = true;
    return { say: say, epi: epi, ctx: ctx };
  })()`);
  ok('M2-9 m2V1=false 时旁白 / 后日谈 / 死因第二句全部静默',
    gate.say === false && gate.epi === '' && gate.ctx === '',
    gate);

  await ev(`window.__roamDebug.restart()`);
  await sleep(900);
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);
  const fps = await ev(`(function(){
    return new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
  })()`);
  const errors = await ev(`(window.__errors || []).length`);
  const sizes = ['m2-spirit.png', 'm2-epilogue.png'].map((n) => {
    try { return fs.statSync(path.join(OUT_DIR, n)).size; } catch (e) { return 0; }
  });
  ok('M2-9b 帧率 ≥ 90 / 无脚本错误 / 2 张截图 > 10KB / 仍在游戏中',
    fps >= 90 && errors === 0 && sizes.every((s) => s > 10240) && (await ev(`state.mode`)) === 'playing',
    { fps, errors, sizes });

  fs.writeFileSync(path.join(OUT_DIR, 'm2-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== m2 ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
