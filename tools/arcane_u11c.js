/**
 * U11c「变量事件 · 改写能力标签」验收脚本（端口 9503）
 * 用法：node tools/arcane_u11c.js
 * 输出：.screenshots/art/u11c-*.png + u11c-result.json
 *
 * 思路：三条事件会互相当成前置状态（改调之后再植入会看到"已有标签"），
 *      所以每个事件用例前都走 __roamDebug.restart() 重置本局，
 *      保证每条断言都从"火球 = [fire, projectile]"这个干净基线出发。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9503;
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
  /**
   * 整屏截图
   * @param {string} name 文件名
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };
  /** 读左侧 HUD 标签条的文案与 pip 数 */
  const readTagBar = () => ev(`(function(){
    var el = document.querySelector('#hudTags');
    return el ? { text: el.innerText.replace(/\\s+/g, ' ').trim(), pips: el.querySelectorAll('.tag-pip').length } : null;
  })()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2000);

  // ---------- 1. 进游戏 ----------
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1200);
  const mode = await ev(`(function(){ var l = document.querySelector('#titleLayer'); return l && l.classList.contains('hidden') ? 'playing' : 'title'; })()`);
  ok('进入游戏', mode === 'playing', mode);

  // ---------- 2. 事件池（全开 = 6 旧数值 + 6 变量，D2 扩容后为 12） ----------
  // D2 把事件表从 6 条扩到 12 条：6 条数值/代价 + 6 条能力/标签。
  const pool = await ev(`window.__roamDebug.u11cPool()`);
  ok('事件池 12 条（6 旧数值/代价 + 6 变量）',
    pool.length === 12 && ['retune', 'graft', 'swap', 'purge', 'graft2', 'retune2']
      .every((id) => pool.indexOf(id) >= 0), pool);

  // ---------- 3. U11c 关闭 → 只剩 6 条非变量事件 ----------
  await ev(`window.__roamDebug.setU11c(false)`);
  const poolOff = await ev(`window.__roamDebug.u11cPool()`);
  await ev(`window.__roamDebug.setU11c(true)`);
  const poolOn = await ev(`window.__roamDebug.u11cPool()`);
  ok('U11c 关闭后事件池退回 6 条非变量事件，重开恢复 12 条',
    poolOff.length === 6 && poolOff.indexOf('retune') < 0 && poolOn.length === 12, { off: poolOff, on: poolOn.length });

  // ---------- 4. 标签系统关闭 → 变量事件自动静默 ----------
  await ev(`window.__roamDebug.setTagsV1(false)`);
  const poolTagsOff = await ev(`window.__roamDebug.u11cPool()`);
  await ev(`window.__roamDebug.setTagsV1(true)`);
  ok('标签系统关闭时不出变量事件（A/B 口径干净）',
    poolTagsOff.length === 6 && poolTagsOff.indexOf('graft') < 0, poolTagsOff);

  // ---------- 5. 符文改调：火 → 雷 ----------
  await ev(`window.__roamDebug.restart()`);
  await sleep(700);
  await ev(`window.__roamDebug.setRelic('ember', 1)`);
  await sleep(160);
  const barBefore = await readTagBar();
  await shot('u11c-before.png');
  const retuneBase = await ev(`(function(){
    return { tags: window.__roamDebug.tagsOf('fireball'), mul: window.__roamDebug.tagMul('fireball'),
             levels: window.__roamDebug.tagLevelsNow() };
  })()`);
  const retune = await ev(`window.__roamDebug.u11cApply('retune')`);
  await sleep(140);
  const retuneAfter = await ev(`(function(){
    return { tags: window.__roamDebug.tagsOf('fireball'), mul: window.__roamDebug.tagMul('fireball'),
             levels: window.__roamDebug.tagLevelsNow(), last: window.__roamDebug.u11cLast() };
  })()`);
  await shot('u11c-retune.png');
  ok('符文改调把火球的首个元素标签从「火」换成「雷」',
    retune.ok === true && retuneBase.tags.join(',') === 'fire,projectile'
    && retuneAfter.tags.join(',') === 'thunder,projectile',
    { before: retuneBase.tags, after: retuneAfter.tags, text: retune.text });
  ok('改调后乘算真的换轨（ember 1 层时火球 ×1.2 → ×1）',
    Math.abs(retuneBase.mul - 1.2) < 1e-6 && Math.abs(retuneAfter.mul - 1) < 1e-6,
    { before: retuneBase.mul, after: retuneAfter.mul });

  // ---------- 6. HUD 标签条同步（改调后出现「雷」） ----------
  await sleep(220);
  const barAfter = await readTagBar();
  ok('HUD 标签条跟随改写刷新（改调后出现「雷」）',
    !!barBefore && !!barAfter && !/雷/.test(barBefore.text) && /雷/.test(barAfter.text),
    { before: barBefore, after: barAfter });

  // ---------- 7. 标签植入：火球变 3 标签 ----------
  await ev(`window.__roamDebug.restart()`);
  await sleep(700);
  const graftBase = await ev(`(function(){
    return { tags: window.__roamDebug.tagsOf('fireball'), levels: window.__roamDebug.tagLevelsNow() };
  })()`);
  const graft = await ev(`window.__roamDebug.u11cApply('graft')`);
  const graftAfter = await ev(`(function(){
    return { tags: window.__roamDebug.tagsOf('fireball'), levels: window.__roamDebug.tagLevelsNow() };
  })()`);
  ok('标签植入给火球补一个它没有的元素标签（标签数 +1，雷层数 +1）',
    graft.ok === true && graftAfter.tags.length === graftBase.tags.length + 1
    && graftAfter.tags.indexOf('thunder') >= 0
    && Number(graftAfter.levels.thunder || 0) === Number(graftBase.levels.thunder || 0) + 1,
    { before: graftBase.tags, after: graftAfter.tags, levels: { before: graftBase.levels, after: graftAfter.levels }, text: graft.text });

  // ---------- 8. 植入后双元素 → 共鸣乘算（1.2 × 1.2 × 1.4 = 2.016） ----------
  await ev(`(function(){
    window.__roamDebug.setRelic('ember', 1);
    window.__roamDebug.setRelic('conductor', 1);
    window.__roamDebug.setRelic('resonance', 1);
    return true;
  })()`);
  await sleep(180);
  const graftMul = await ev(`window.__roamDebug.tagMul('fireball')`);
  ok('双元素 + 火雷遗物 + 共鸣 → 火球乘算 2.016',
    Math.abs(graftMul - 2.016) < 1e-3, { mul: graftMul });

  // ---------- 9. 元素易位：全场火雷互换 ----------
  await ev(`window.__roamDebug.restart()`);
  await sleep(700);
  await ev(`(function(){
    window.__roamDebug.setRelic('ember', 1);
    window.__roamDebug.setRelic('conductor', 1);
    return true;
  })()`);
  await sleep(180);
  const swapBase = await ev(`(function(){
    return { tags: window.__roamDebug.tagsOf('fireball'), levels: window.__roamDebug.tagLevelsNow() };
  })()`);
  const swap = await ev(`window.__roamDebug.u11cApply('swap')`);
  await sleep(140);
  const swapAfter = await ev(`(function(){
    return { tags: window.__roamDebug.tagsOf('fireball'), levels: window.__roamDebug.tagLevelsNow() };
  })()`);
  await shot('u11c-swap.png');
  ok('元素易位把火球「火」换成「雷」，且 fire/thunder 层数互换',
    swap.ok === true && swapAfter.tags.join(',') === 'thunder,projectile'
    && Number(swapAfter.levels.fire) === Number(swapBase.levels.thunder)
    && Number(swapAfter.levels.thunder) === Number(swapBase.levels.fire),
    { tags: { before: swapBase.tags, after: swapAfter.tags },
      levels: { before: swapBase.levels, after: swapAfter.levels }, changed: swap.changed });

  // ---------- 10. 事件房真实结算：走进事件房至少触发一次变量事件 ----------
  // 先重开一局：断言 9 的 u11cLast 还留着 swap，不能拿旧记录冒充"真实结算"。
  await ev(`window.__roamDebug.restart()`);
  await sleep(700);
  // D2 事件池扩到 12 条后，随机命中变量事件的概率被摊薄；
  // 这里只在"进事件房"这一段临时把抽签固定为 retune，确保结算链路本身被验证，
  // 抽签概率另由 A9（D2 套件）覆盖。进房后立刻恢复原函数。
  await ev(`(function(){
    window.__u11cOrigPick = u11cPickEvent;
    u11cPickEvent = function(){ return { id: 'retune', effect: 'retune', text: '事件 · 符文改调' }; };
    return true;
  })()`);
  let variableHit = null;
  let legacyHits = 0;
  const tries = [];
  for (let f = 2; f <= 12 && !variableHit; f += 1) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    await sleep(260);
    // 布局是随机的，某些层可能一间事件房都没有；把一间普通房改成事件房，
    // 保证"事件房真实结算"这条断言每次都跑到（改写走真实的 onRoomEnter → applyRoomReward）。
    await ev(`(function(){
      var hasEvent = state.rooms.some(function(r){ return r.type === 'event'; });
      if (!hasEvent) {
        var room = state.rooms.find(function(r){ return r.id !== state.spawnRoomId && r.type !== 'boss'; });
        if (room) { room.type = 'event'; room.rewarded = false; }
      }
      return true;
    })()`);
    const rooms = await ev(`state.rooms.filter(function(r){ return r.type === 'event'; })
      .map(function(r){ return { id: r.id, cx: Math.round(r.cx), cy: Math.round(r.cy) }; })`);
    for (let i = 0; i < rooms.length && !variableHit; i += 1) {
      const room = rooms[i];
      await ev(`window.__roamDebug.teleport(${room.cx}, ${room.cy})`);
      await sleep(620);
      const snap = await ev(`(function(){
        var r = state.rooms.find(function(x){ return x.id === ${room.id}; });
        var t = document.querySelector('#toast');
        return {
          rewarded: !!r.rewarded,
          toast: t ? t.innerText : '',
          last: state.u11cLast ? JSON.parse(JSON.stringify(state.u11cLast)) : null
        };
      })()`);
      tries.push({ f: f, roomId: room.id, rewarded: snap.rewarded, kind: snap.last ? snap.last.kind : null });
      if (snap.rewarded) {
        if (snap.last) variableHit = { kind: snap.last.kind, text: snap.last.text, toast: snap.toast, f: f };
        else legacyHits += 1;
      }
    }
  }
  await ev(`(function(){ if (window.__u11cOrigPick) { u11cPickEvent = window.__u11cOrigPick; } return true; })()`);
  ok('事件房真实结算里至少触发一次变量事件（toast 与记录同一条）',
    !!variableHit && new RegExp('retune|graft|swap|purge|graft2|retune2').test(variableHit.kind)
    && /事件/.test(variableHit.text) && variableHit.toast.indexOf(variableHit.text) >= 0,
    { hit: variableHit, legacyHits: legacyHits, tries: tries.slice(-6) });

  // ---------- 11. 重开归零 ----------
  await ev(`window.__roamDebug.restart()`);
  await sleep(700);
  const reset = await ev(`(function(){
    return { patches: window.__roamDebug.u11cPatches(), seq: state.tagPatchSeq, last: window.__roamDebug.u11cLast() };
  })()`);
  const patchKeys = Object.keys(reset.patches || {});
  ok('重开后改写板归零（patches 为空 / seq 0 / 上次结果清空）',
    patchKeys.length === 0 && Number(reset.seq) === 0 && reset.last === null,
    { patches: patchKeys, seq: reset.seq, last: reset.last });

  // ---------- 12. 帧率 / 异常 / 截图 ----------
  const perf = await ev(`(function(){
    return new Promise(function(resolve){
      var frames = 0;
      var t0 = performance.now();
      function tick(){
        frames += 1;
        if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
        else resolve({ fps: frames / ((performance.now() - t0) / 1000), errors: (window.__errors || []).slice(0, 6) });
      }
      requestAnimationFrame(tick);
    });
  })()`);
  const names = ['u11c-before.png', 'u11c-retune.png', 'u11c-swap.png'];
  const sizes = names.map((n) => {
    const p = path.join(OUT_DIR, n);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  });
  ok('帧率 ≥60 / 无脚本错误 / 3 张截图 >10KB',
    perf.fps >= 60 && (perf.errors || []).length === 0 && sizes.every((s) => s > 10240),
    { fps: Math.round(perf.fps * 10) / 10, errors: (perf.errors || []).length, sizes: sizes });

  const passed = asserts.filter((a) => a.pass).length;
  console.log('----------------------------------------');
  console.log('U11c · ' + passed + '/' + asserts.length + ' PASS');
  console.log('PERF ' + JSON.stringify({ avgFps: Math.round(perf.fps * 10) / 10, errors: (perf.errors || []).length }));
  fs.writeFileSync(path.join(OUT_DIR, 'u11c-result.json'),
    JSON.stringify({ passed: passed, total: asserts.length, asserts: asserts, perf: perf }, null, 2));

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (passed < asserts.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 200);
});
