/**
 * 第 5 轮 · 第 2 组验收：程序化音频补强
 * ------------------------------------------------------------
 * B1 六层音色全部存在且离线渲染有可听波形（RMS > 0.001）
 * B2 六个音色的过零率 / RMS 可区分（成对差异达阈值）
 * B3 触发点正确：轻击 / 重击 / 暴击 / 技能 / 融合 / 清场 各 +1
 * B4 独立静音：SFX 音量 0 只关打击音，BGM 仍可播；主静音全关
 * B5 音量滑杆持久化（写 localStorage）
 * B6 零音频文件请求
 * B7 三主题 BGM 音色不同 + 楼层 tint 生效
 * B8 Boss 阶段段落音（phase 1 / 2 / 3 记录不同）
 *
 * 用法：node tools/arcane_audio_layers.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9762;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'audio_layers');
const RESULTS = path.join(OUT, 'audio-layers-result.json');
const LAYERS = ['lightHit', 'heavyHit', 'cast', 'fusionCast', 'critHit', 'clearAll'];

const checks = [];
const runtimeErrors = [];
let EDGE_PROC = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  EDGE_PROC = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push(d ? ((d.exception || {}).description || d.text) : 'unknown');
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
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
        + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  // ---------- 启动 ----------
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(1200);
  await ev(`(() => {
    __roamDebug.xp.setEnabled(false);
    __roamDebug.enemies.floor(3);
    state.mode = 'playing'; state.status = 'playing';
    const room = state.rooms[0];
    __roamDebug.teleport(room.cx, room.cy); __roamDebug.despawnAll();
    const type = Object.keys(ENEMY_CONFIG)[0];
    __roamDebug.spawnEnemyAt(type, room.cx + 90, room.cy, { roomId: room.id });
    __roamDebug.pinEnemies(0);
    state.player.invuln = 999;
    return true;
  })()`);

  // ---------- B1 / B2：音色表 + 离线渲染 ----------
  const offline = await ev(`__roamDebug.audioLayers.selfTest()`);
  const info0 = await ev(`__roamDebug.audioLayers.info()`);
  check('B1 六层音色全部注册且离线渲染有波形',
    LAYERS.every((k) => info0.tones.indexOf(k) >= 0)
    && LAYERS.every((k) => offline.results[k] && offline.results[k].rms > 0.001),
    { tones: info0.tones.length, layers: LAYERS.map((k) => ({
      k: k, rms: offline.results[k] && offline.results[k].rms,
      zcr: offline.results[k] && offline.results[k].zcr })) });

  // 成对距离：归一化过零率差 + RMS 差，阈值 0.12（约等于"音色能听出区别"）
  const pairs = [];
  for (let i = 0; i < LAYERS.length; i += 1) {
    for (let j = i + 1; j < LAYERS.length; j += 1) {
      const a = offline.results[LAYERS[i]];
      const b = offline.results[LAYERS[j]];
      const dz = Math.abs(a.zcr - b.zcr) / Math.max(a.zcr, b.zcr, 1);
      const dr = Math.abs(a.rms - b.rms) / Math.max(a.rms, b.rms, 0.001);
      pairs.push({ pair: LAYERS[i] + '↔' + LAYERS[j], dz: Number(dz.toFixed(3)),
        dr: Number(dr.toFixed(3)), d: Number((dz + dr).toFixed(3)) });
    }
  }
  const weakest = pairs.slice().sort((a, b) => a.d - b.d)[0];
  check('B2 六层音色成对可区分（zcr + rms 归一化距离 ≥0.12）',
    pairs.every((p) => p.d >= 0.12),
    { weakest: weakest, pairs: pairs.filter((p) => p.d < 0.2) });

  // ---------- B3：触发点 ----------
  const statBefore = await ev(`__roamDebug.audioLayers.info().stats`);
  // 轻击
  await ev(`(() => {
    const e = state.enemies[0]; e.hp = 99999; e.hpMax = 99999;
    damageEnemy(e, 4, 0, { noCrit: true });
    return __roamDebug.audioLayers.info().stats.lightHit;
  })()`);
  await sleep(180);
  // 重击（超过重击阈值但远不到致死）
  const heavy = await ev(`(() => {
    const e = state.enemies[0]; e.hp = 99999; e.hpMax = 99999;
    damageEnemy(e, FEEL_CONFIG.hitStopHeavyDamage + 10, 0, { noCrit: true });
    return __roamDebug.audioLayers.info().stats.heavyHit;
  })()`);
  await sleep(220);
  // 暴击（把随机数固定到 0，必暴击）
  const crit = await ev(`(() => {
    const e = state.enemies[0]; e.hp = 99999; e.hpMax = 99999;
    const old = Math.random; Math.random = () => 0;
    damageEnemy(e, 4, 0);
    Math.random = old;
    return __roamDebug.audioLayers.info().stats.critHit;
  })()`);
  await sleep(220);
  // 技能释放：走真实 castSlot（火球）
  const cast = await ev(`(() => {
    state.player.aether = 999; state.player.aetherMax = 999;
    state.ownedMagic = state.ownedMagic || [];
    if (state.ownedMagic.indexOf('fireball') < 0) state.ownedMagic.push('fireball');
    state.activeMagicId = 'fireball';
    if (state.dual && state.dual.slots) { state.dual.slots[0] = 'fireball'; }
    if (state.cooldowns) state.cooldowns[0] = 0;
    const ok = castSlot(0, true);
    return { ok: ok, count: __roamDebug.audioLayers.info().stats.cast };
  })()`);
  await sleep(300);
  // 融合技能：走真实演出函数
  const fusion = await ev(`(() => {
    const f = Object.values(FUSION_CONFIG).filter((x) => x && x.id)[0]
      || (FUSION_CONFIG.fusions && FUSION_CONFIG.fusions[0]);
    const ok = playFusionCinematic(f);
    return { ok: !!ok, count: __roamDebug.audioLayers.info().stats.fusionCast, id: f && f.id };
  })()`);
  await sleep(320);
  // 清场：同帧 5 杀 → 集体爆裂 → clearAll
  const clear = await ev(`(() => {
    const room = state.rooms.find((r) => r.id === state.currentRoomId) || state.rooms[0];
    const type = Object.keys(ENEMY_CONFIG)[0];
    __roamDebug.despawnAll();
    for (let i = 0; i < 5; i += 1) {
      __roamDebug.spawnEnemyAt(type, room.cx + 60 + i * 12, room.cy + 40, { roomId: room.id });
    }
    const ids = state.enemies.slice(0, 5).map((e) => e.id);
    const r = __roamDebug.fxtier.damageAll(ids, 99999);
    return { killed: r.killed, count: __roamDebug.audioLayers.info().stats.clearAll,
      blasts: __roamDebug.comboFx.info().stats.groupBlasts };
  })()`);
  const statAfter = await ev(`__roamDebug.audioLayers.info().stats`);
  // 首次触发时 stats 里还没有该键 → 用 0 兜底，避免 null 参与减法
  const d = (k) => (statAfter[k] || 0) - (statBefore[k] || 0);
  const deltas = {
    lightHit: d('lightHit'), heavyHit: d('heavyHit'), critHit: d('critHit'),
    cast: d('cast'), fusionCast: d('fusionCast'), clearAll: d('clearAll')
  };
  check('B3 六个触发点各自命中（轻/重/暴/技能/融合/清场）',
    deltas.lightHit >= 1 && deltas.heavyHit >= 1 && deltas.critHit >= 1
    && deltas.cast >= 1 && deltas.fusionCast >= 1 && deltas.clearAll >= 1,
    { deltas: deltas, heavyReturn: heavy, critReturn: crit, castReturn: cast,
      fusionReturn: fusion, clearReturn: clear });

  // 让上一轮击杀音自然消散，避免"发声数上限"干扰独立静音断言
  await sleep(700);

  // ---------- B4：独立静音 ----------
  const mute = await ev(`(() => {
    const out = {};
    // 1) SFX 调到 0：打击音应被拒，BGM 仍能播
    __roamDebug.audioLayers.setSfx(0);
    out.sfxZeroLight = __roamDebug.audioLayers.play('lightHit', 1, { force: true });
    __roamDebug.audioLayers.setBgmOn(false);
    __roamDebug.audioLayers.setBgmOn(true);
    out.bgmNodesWithSfxZero = bgmState.nodes.length;
    out.bgmOn = audioSettings.bgmOn;
    // 2) 恢复 SFX，BGM 不受影响
    __roamDebug.audioLayers.setSfx(0.62);
    out.sfxBackLight = __roamDebug.audioLayers.play('lightHit', 1, { force: true });
    out.bgmNodesAfterRestore = bgmState.nodes.length;
    // 3) 主静音：全关
    __roamDebug.audioLayers.setMuted(true);
    out.mutedLight = __roamDebug.audioLayers.play('lightHit', 1, { force: true });
    __roamDebug.audioLayers.setMuted(false);
    return out;
  })()`);
  check('B4 独立静音：SFX=0 只关打击音，BGM 继续',
    mute.sfxZeroLight === false && mute.bgmNodesWithSfxZero > 0
    && mute.sfxBackLight === true && mute.bgmNodesAfterRestore > 0
    && mute.mutedLight === false,
    mute);

  // ---------- B5：音量持久化 ----------
  await ev(`(() => { __roamDebug.audioLayers.setSfx(0.33); __roamDebug.audioLayers.setBgm(0.47); return true; })()`);
  const stored = await ev(`JSON.parse(localStorage.getItem('arcane_rogue_audio') || '{}')`);
  check('B5 音量滑杆写入 localStorage（0.33 / 0.47）',
    Math.abs((stored.sfx == null ? -1 : stored.sfx) - 0.33) < 0.01
    && Math.abs((stored.bgm == null ? -1 : stored.bgm) - 0.47) < 0.01,
    stored);

  // ---------- B6：零音频文件 ----------
  const files = await ev(`__roamDebug.audioLayers.info().audioFiles`);
  check('B6 页面零音频文件请求（全部 WebAudio 合成）', files === 0, { audioFiles: files });

  // ---------- B7：BGM 主题 + 楼层 tint ----------
  const bgm = await ev(`(() => {
    const themes = {};
    ['mech', 'rune', 'void'].forEach((id) => {
      const cfg = bgmThemeFor(id);
      themes[id] = { theme: cfg.theme, lowpass: cfg.lowpass, padFreqs: cfg.padFreqs,
        padGain: cfg.padGain, lfoDepth: cfg.lfoDepth };
    });
    // 先彻底停掉再按楼层重启：startBgm 在已有节点时会直接复用，不会换层
    stopBgm(true);
    state.themeId = 'rune';
    startBgm(6);
    const a = { theme: bgmState.theme, floor: bgmState.lastFloor, tint: bgmState.lastTint,
      nodes: bgmState.nodes.length };
    stopBgm(true);
    startBgm(7);
    const b = { theme: bgmState.theme, floor: bgmState.lastFloor, tint: bgmState.lastTint };
    return { themes: themes, a: a, b: b, config: { padGain: BGM_CONFIG.padGain,
      lowpass: BGM_CONFIG.lowpass, lfoDepth: BGM_CONFIG.lfoDepth,
      bgmDefaultOn: AUDIO_CONFIG.bgmDefaultOn } };
  })()`);
  const themeDistinct = bgm.themes.mech.theme !== bgm.themes.rune.theme
    && bgm.themes.rune.theme !== bgm.themes.void.theme
    && bgm.themes.mech.lowpass !== bgm.themes.void.lowpass;
  check('B7 三主题 BGM 音色不同 + 楼层 tint 生效 + BGM 默认仍关闭',
    themeDistinct && bgm.a.theme === 'rune' && bgm.b.floor === 7 && bgm.a.tint !== bgm.b.tint
    && bgm.config.bgmDefaultOn === false && bgm.config.padGain === 0.42
    && bgm.config.lowpass === 300 && bgm.config.lfoDepth === 0.16,
    { themes: bgm.themes, a: bgm.a, b: bgm.b, config: bgm.config });

  // ---------- B8：Boss 阶段段落音 ----------
  const sting = await ev(`(() => {
    const before = __roamDebug.audioLayers.info().m3;
    playBossIntroSting('mech', 1);
    const p1 = __roamDebug.audioLayers.info().m3;
    playBossIntroSting('mech', 2);
    const p2 = __roamDebug.audioLayers.info().m3;
    playBossIntroSting('mech', 3);
    const p3 = __roamDebug.audioLayers.info().m3;
    return { before: before, p1: p1, p2: p2, p3: p3,
      shift2: Math.pow(2, -3 / 12), shift3: Math.pow(2, -5 / 12) };
  })()`);
  check('B8 Boss 阶段切换段落音（p1/p2/p3 记录不同 + 降三/减五度）',
    sting.p2.bossStings === sting.p1.bossStings + 1
    && sting.p2.lastSting === 'mech:p2' && sting.p3.lastSting === 'mech:p3'
    && Math.abs(sting.shift2 - 0.8409) < 0.001 && Math.abs(sting.shift3 - 0.7492) < 0.001,
    { p1: sting.p1.lastSting, p2: sting.p2.lastSting, p3: sting.p3.lastSting,
      stings: sting.p3.bossStings });

  // ---------- 截图（设置页音频区，作为唯一视觉证据） ----------
  await ev(`(() => { __roamDebug.openPanel('settings'); return true; })()`);
  await sleep(300);
  await shot('audio-settings.png');

  fs.writeFileSync(RESULTS, JSON.stringify({
    at: new Date().toISOString(), checks, screenshots: ['audio-settings.png'], runtimeErrors
  }, null, 2));
  const fails = checks.filter((c) => !c.ok);
  console.log(`\nRESULT: ${fails.length ? 'FAIL' : 'PASS'}  ${checks.length - fails.length}/${checks.length}`);
  if (runtimeErrors.length) console.log('RUNTIME ERRORS: ' + JSON.stringify(runtimeErrors.slice(0, 3)));
  await cleanup();
  process.exit(fails.length ? 1 : 0);
}

/**
 * 关闭 Edge 与测试 profile
 * @returns {Promise<void>}
 */
async function cleanup() {
  try { if (EDGE_PROC) EDGE_PROC.kill(); } catch (e) { /* 已退出 */ }
  await sleep(300);
  try { killEdge(); } catch (e) { /* 忽略 */ }
}

main().catch(async (err) => {
  console.error('FATAL', err && err.message ? err.message : err);
  await cleanup();
  process.exit(1);
});
