/**
 * M3 音频批验收：融合三音和弦 / 首领登场音 / 楼层主题 BGM 变体
 * 用法：node tools/arcane_m3audio.js
 * 端口：9510
 * 输出：.screenshots/art/m3-audio.png、m3-audio-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9510;
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
    '--autoplay-policy=no-user-gesture-required',
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
  await sleep(1200);
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);
  await shot('m3-audio.png');

  // ---------- M3A-1 和弦配置齐全 + 三音递增 ----------
  const coverage = await ev(`(function(){
    var info = window.__roamDebug.audioInfo();
    var fusions = (typeof FUSION_CONFIG !== 'undefined') ? FUSION_CONFIG : [];
    var checks = fusions.map(function(f){
      var freqs = fusionChordFreqs(f);
      return { id: f.id, freqs: freqs, three: freqs.length === 3, ascending: freqs.length === 3 && freqs[0] < freqs[1] && freqs[1] < freqs[2] };
    });
    return { info: { chordCount: info.chordCount, missing: info.missingChords }, checks: checks };
  })()`);
  const allThree = coverage.checks.length === 10 && coverage.checks.every((c) => c.three && c.ascending);
  ok('M3A-1 10 条融合和弦配置齐全（无缺失），每条 3 个音且频率递增',
    coverage.info.chordCount === 10 && coverage.info.missing.length === 0 && allThree,
    { chordCount: coverage.info.chordCount, missing: coverage.info.missing, sample: coverage.checks.map((c) => c.freqs[0]) });

  // ---------- M3A-2 10 组和弦互不相同 ----------
  const uniq = new Set(coverage.checks.map((c) => c.freqs.join(',')));
  ok('M3A-2 10 组和弦频率互不相同（听感可按融合区分）', uniq.size >= 9, { unique: uniq.size });

  // ---------- M3A-3 真实融合 → 和弦统计 +1，且记录本次融合 ----------
  const fuse = await ev(`(function(){
    var d = window.__roamDebug;
    var before = d.audioInfo().stats.chords;
    state.ownedMagic = ['fireball'];
    state.ownedTech = ['concentrator'];
    state.activeMagicId = 'fireball';
    var okFuse = tryFuse();
    var after = d.audioInfo().stats;
    return { okFuse: !!okFuse, before: before, after: after, fusions: state.fusions.slice() };
  })()`);
  ok('M3A-3 真实 tryFuse 后融合和弦统计 +1，lastChord.id = 本次融合',
    fuse.okFuse === true && fuse.after.chords === fuse.before + 1
    && fuse.after.lastChord && fuse.after.lastChord.id === fuse.fusions[fuse.fusions.length - 1],
    { before: fuse.before, after: fuse.after, fusions: fuse.fusions });

  // ---------- M3A-4 首领登场音 ----------
  const sting = await ev(`(function(){
    var d = window.__roamDebug;
    var before = d.audioInfo().stats.stings;
    startBossIntro(state.rooms[state.boss.roomId]);
    var after = d.audioInfo().stats;
    return { theme: state.themeId, before: before, after: after };
  })()`);
  ok('M3A-4 真实 startBossIntro 后首领音统计 +1 且 lastSting = 当前主题',
    sting.after.stings === sting.before + 1 && sting.after.lastSting === sting.theme,
    sting);

  // ---------- M3A-5 三主题 BGM 参数不同 ----------
  const themes = await ev(`(function(){
    var d = window.__roamDebug;
    return { mech: d.bgmTheme('mech'), rune: d.bgmTheme('rune'), void: d.bgmTheme('void') };
  })()`);
  const diff = (a, b) => JSON.stringify(a.padFreqs) !== JSON.stringify(b.padFreqs)
    && JSON.stringify(a.pingNotes) !== JSON.stringify(b.pingNotes)
    && a.lowpass !== b.lowpass && a.lfoRate !== b.lfoRate;
  ok('M3A-5 三主题 BGM 参数（pad / ping / lowpass / lfo）互不相同',
    themes.mech.padFreqs.length === 3 && themes.rune.padFreqs.length === 3 && themes.void.padFreqs.length === 3
    && diff(themes.mech, themes.rune) && diff(themes.rune, themes.void) && diff(themes.mech, themes.void),
    themes);

  // ---------- M3A-6 真实下楼 → BGM 主题切到 rune ----------
  const bgm = await ev(`(function(){
    var d = window.__roamDebug;
    audioSettings.bgmOn = true;
    audioSettings.muted = false;
    applyAudioSettings();
    var started = startBgm(state.floor);
    var beforeTheme = d.audioInfo().bgm.theme;
    return { started: !!started, running: d.audioInfo().bgm.running, beforeTheme: beforeTheme, ctx: d.audioInfo().ctx };
  })()`);
  await ev(`descendFloor()`);
  await sleep(900);
  const bgmAfter = await ev(`(function(){
    var d = window.__roamDebug;
    return { theme: d.audioInfo().bgm.theme, expected: state.themeId, pingNotes: d.audioInfo().bgm.pingNotes, running: d.audioInfo().bgm.running };
  })()`);
  ok('M3A-6 真实下楼到第 2 层（rune）后 BGM 主题与点缀音切换（BGM 开启时）',
    bgmAfter.expected === 'rune' && bgmAfter.theme === 'rune'
    && JSON.stringify(bgmAfter.pingNotes) === JSON.stringify(themes.rune.pingNotes),
    { before: bgm, after: bgmAfter });

  // ---------- M3A-7 A/B 开关 ----------
  const gate = await ev(`(function(){
    var d = window.__roamDebug;
    var before = d.audioInfo().stats.chords;
    AUDIO_M3_CONFIG.enabled = false;
    var chord = playFusionChord(FUSION_CONFIG[0]);
    var sting = playBossIntroSting('mech');
    var after = d.audioInfo().stats.chords;
    AUDIO_M3_CONFIG.enabled = true;
    return { chord: chord, sting: sting, before: before, after: after };
  })()`);
  ok('M3A-7 AUDIO_M3_CONFIG.enabled=false → 和弦 / 首领音均不触发且计数不变',
    gate.chord === false && gate.sting === false && gate.after === gate.before,
    gate);

  // ---------- M3A-8 帧率 / 错误 / 截图 ----------
  const fps = await ev(`(function(){
    return new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
  })()`);
  const errors = await ev(`(window.__errors || []).length`);
  const mode = await ev(`state.mode`);
  const size = (() => { try { return fs.statSync(path.join(OUT_DIR, 'm3-audio.png')).size; } catch (e) { return 0; } })();
  ok('M3A-8 帧率 ≥ 90 / 无脚本错误 / 仍在游戏中 / 截图 > 10KB',
    fps >= 90 && errors === 0 && mode === 'playing' && size > 10240,
    { fps, errors, mode, size });

  fs.writeFileSync(path.join(OUT_DIR, 'm3-audio-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== m3-audio ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
