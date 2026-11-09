/**
 * 音频节点审计（单实例串行，基线 + 临时补丁副本各跑一遍）
 * ------------------------------------------------------------
 * 为什么需要这个脚本：
 *   本项目历史上踩过"每次触发都新建 WebAudio 节点但从不 disconnect"的坑。
 *   光看代码只能数出纸面节点数，必须实测：
 *     1) BGM 常驻节点数
 *     2) 每次快捷键音效新增节点数
 *     3) BGM / 静音反复开关 5 次后是否累积
 *
 * 安全边界：
 *   · 绝不写主文件；只读主文件 → 生成 .audit_tmp 临时副本 → 打完补丁跑第二遍 → finally 删除副本。
 *   · 只开一个无头 Edge 实例，串行导航，不并发。
 *
 * 用法：
 *   node tools/arcane_audio_audit.js
 *   node tools/arcane_audio_audit.js --keep-tmp     保留临时副本用于人工检查
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9763;
const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const TMP_DIR = path.join(ROOT, '.audit_tmp');
const TMP = path.join(TMP_DIR, 'index_audio_patched.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'audio_nodes');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let EDGE_PROC = null;   // 只允许一个测试浏览器实例；finally / catch 都会杀掉
let WS = null;

/**
 * 计算文件 MD5（单快照：一次读入内存后再算哈希，避免撕裂读数）
 * @param {Buffer} buf 文件字节
 * @returns {string} 32 位大写 MD5
 */
function md5Of(buf) {
  return crypto.createHash('md5').update(buf).digest('hex').toUpperCase();
}

/**
 * 精确替换一次；找不到或重复都直接失败，避免"补丁打偏"静默通过
 * @param {string} src 源文本
 * @param {string} find 锚点原文
 * @param {string} repl 替换文本
 * @param {string} label 断言标签
 * @returns {string} 替换后的文本
 */
function replaceOnce(src, find, repl, label) {
  const first = src.indexOf(find);
  if (first < 0) throw new Error('锚点未找到: ' + label);
  if (src.indexOf(find, first + 1) >= 0) throw new Error('锚点不唯一: ' + label);
  return src.slice(0, first) + repl + src.slice(first + find.length);
}

/**
 * 用起止标记替换一整段（保留结束标记），用于整函数重写
 * @param {string} src 源文本
 * @param {string} startMarker 起始锚点
 * @param {string} endMarker 结束锚点（保留）
 * @param {string} repl 新文本
 * @param {string} label 断言标签
 * @returns {string} 替换后的文本
 */
function replaceRange(src, startMarker, endMarker, repl, label) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('起始锚点未找到: ' + label);
  if (src.indexOf(startMarker, start + 1) >= 0) throw new Error('起始锚点不唯一: ' + label);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error('结束锚点未找到: ' + label);
  return src.slice(0, start) + repl + src.slice(end);
}

/* ------------------------------------------------------------------
 * 补丁正文（与 AUDIO_AMBIENCE_PATCH.md 中的可粘贴块保持一致）
 * ------------------------------------------------------------------ */

const CONFIG_BLOCK = `
/* ============================================================
   战斗强度 → 音频密度（AUDIO DENSITY PATCH）
   ------------------------------------------------------------
   只读运行时状态，只改音频层参数；不碰玩法、不碰随机源、不加新音源。
   所有阈值/倍率集中在这张表，调参只改这里。
   ============================================================ */
const AUDIO_INTENSITY_CONFIG = {
  enabled: true,                     // 总开关：false = 完全回到补丁前行为
  dwell: 0.45,                       // 档位稳定时间（秒）：防止敌人数 4↔5 抖动导致音量抽气
  enemyScore: [0, 1, 2, 3],          // 房间活敌数 0 / 1–2 / 3–4 / ≥5 的权重
  hpBands: [                         // 血量比从高到低匹配（第一条满足的生效）
    { below: 0.25, score: 2, hb: { interval: 2.0, volume: 0.13, rate: 0.60 } },
    { below: 0.50, score: 1, hb: { interval: 3.2, volume: 0.11, rate: 0.62 } }
  ],
  bossScore: { phase1: 3.0, phase2: 4.0 },   // 首领已登场 / 二阶段
  bands: [                           // score 从低到高匹配（第一条 score <= max 的生效）
    { id: 'L0', max: 0.9, voiceLimit: 4, rateScale: 1.35, pingMul: 1.80, bgmGainMul: 1.00 },
    { id: 'L1', max: 2.4, voiceLimit: 6, rateScale: 1.00, pingMul: 1.00, bgmGainMul: 1.00 },
    { id: 'L2', max: 3.9, voiceLimit: 8, rateScale: 0.85, pingMul: 0.80, bgmGainMul: 1.05 },
    { id: 'L3', max: Infinity, voiceLimit: 10, rateScale: 0.70, pingMul: 0.65, bgmGainMul: 1.10 }
  ],
  lowPower: { threshold: 0.25, restore: 0.35, voiceLimit: 4, disableBgm: true, disablePing: true }
};

/** 运行态：当前已应用档位 / 目标档位 / 稳定计时 / 心跳计时 / 低电量标记 */
const audioIntensityState = {
  level: 1, target: 1, dwell: 0, score: 0,
  hpLow: false, heartbeatTimer: 0,
  lowPower: false, battery: null
};

/**
 * 当前房间活敌数（不含首领；首领单独计权，避免"首领房只有 1 个目标"被当成 L1）
 * @returns {number} 活敌数量
 */
function roomAliveEnemyCount() {
  if (!state || !Array.isArray(state.enemies)) return 0;
  const rid = state.currentRoomId;
  let n = 0;
  for (let i = 0; i < state.enemies.length; i += 1) {
    const e = state.enemies[i];
    if (!e || e.isBoss) continue;
    if (rid != null && e.roomId != null && e.roomId !== rid) continue;
    if (e.hp != null && e.hp <= 0) continue;
    n += 1;
  }
  return n;
}

/**
 * 只读计算当前强度分数（纯函数，验收可直接断言）
 * @returns {number} 0 ~ 6 的分数
 */
function audioIntensityScore() {
  const cfg = AUDIO_INTENSITY_CONFIG;
  if (!cfg.enabled || !state) return 0;
  const count = roomAliveEnemyCount();
  const enemyScore = count === 0 ? cfg.enemyScore[0]
    : (count <= 2 ? cfg.enemyScore[1] : (count <= 4 ? cfg.enemyScore[2] : cfg.enemyScore[3]));
  const hpMax = Number(state.player && state.player.hpMax) || 0;
  const hpRatio = hpMax > 0 ? clamp(state.player.hp / hpMax, 0, 1) : 1;
  let hpScore = 0;
  for (let i = 0; i < cfg.hpBands.length; i += 1) {
    if (hpRatio < cfg.hpBands[i].below) { hpScore = cfg.hpBands[i].score; break; }
  }
  let bossScore = 0;
  const b = state.boss;
  if (b && b.started && !b.defeated) {
    bossScore = (b.phase >= 2 || b.phase2) ? cfg.bossScore.phase2 : cfg.bossScore.phase1;
  }
  return enemyScore + hpScore + bossScore;
}

/**
 * 分数 → 档位参数
 * @param {number} score 强度分数
 * @returns {Object} 档位配置
 */
function audioIntensityBand(score) {
  const bands = AUDIO_INTENSITY_CONFIG.bands;
  for (let i = 0; i < bands.length; i += 1) if (score <= bands[i].max) return bands[i];
  return bands[bands.length - 1];
}

/**
 * 当前允许的同类音效并发上限
 * @returns {number} 2 ~ AUDIO_CONFIG.voiceLimit + 4
 */
function audioIntensityVoiceLimit() {
  if (!AUDIO_INTENSITY_CONFIG.enabled) return AUDIO_CONFIG.voiceLimit;
  const band = AUDIO_INTENSITY_CONFIG.bands[audioIntensityState.level] || AUDIO_INTENSITY_CONFIG.bands[1];
  const cap = audioIntensityState.lowPower
    ? AUDIO_INTENSITY_CONFIG.lowPower.voiceLimit : band.voiceLimit;
  return Math.max(2, Math.min(cap, AUDIO_CONFIG.voiceLimit + 4));
}

/**
 * 当前同名声效冷却倍率（越小越密）
 * @returns {number} 0.70 ~ 1.35
 */
function audioIntensityRateScale() {
  if (!AUDIO_INTENSITY_CONFIG.enabled) return 1;
  const band = AUDIO_INTENSITY_CONFIG.bands[audioIntensityState.level] || AUDIO_INTENSITY_CONFIG.bands[1];
  return band.rateScale;
}

/**
 * 当前 BGM 点缀间隔倍率（越大越稀疏）
 * @returns {number} 0.65 ~ 1.80
 */
function audioIntensityPingMul() {
  if (!AUDIO_INTENSITY_CONFIG.enabled) return 1;
  if (audioIntensityState.lowPower && AUDIO_INTENSITY_CONFIG.lowPower.disablePing) return 99;
  const band = AUDIO_INTENSITY_CONFIG.bands[audioIntensityState.level] || AUDIO_INTENSITY_CONFIG.bands[1];
  return band.pingMul;
}

/**
 * 每帧推进：档位防抖 + BGM 总线呼吸 + 低血心跳（心跳复用现有 heavy 低频音，不新增音源）
 * @param {number} dt 帧间隔（秒）
 * @returns {void}
 */
function updateAudioIntensity(dt) {
  const cfg = AUDIO_INTENSITY_CONFIG;
  if (!cfg.enabled) return;
  const playing = state && state.mode === 'playing' && state.status === 'playing';
  if (!playing) { audioIntensityState.heartbeatTimer = 0; return; }
  const score = audioIntensityScore();
  audioIntensityState.score = score;
  const target = audioIntensityBand(score);
  const targetId = cfg.bands.indexOf(target);
  if (targetId !== audioIntensityState.target) {
    audioIntensityState.target = targetId;
    audioIntensityState.dwell = 0;
  }
  audioIntensityState.dwell += dt;
  if (audioIntensityState.dwell >= cfg.dwell && audioIntensityState.level !== targetId) {
    audioIntensityState.level = targetId;
    if (audioState.bgmBus && audioSettings.bgmOn && !audioSettings.muted) {
      audioState.bgmBus.gain.setTargetAtTime(
        audioSettings.bgm * target.bgmGainMul, audioState.ctx.currentTime, 0.5);
    }
  }
  const hpMax = Number(state.player && state.player.hpMax) || 0;
  const hpRatio = hpMax > 0 ? state.player.hp / hpMax : 1;
  let hb = null;
  for (let i = 0; i < cfg.hpBands.length; i += 1) {
    if (hpRatio < cfg.hpBands[i].below) { hb = cfg.hpBands[i].hb; break; }
  }
  audioIntensityState.hpLow = !!hb;
  if (hb) {
    audioIntensityState.heartbeatTimer -= dt;
    if (audioIntensityState.heartbeatTimer <= 0) {
      playSfx('heavy', hb.volume, { rate: hb.rate, force: true });
      audioIntensityState.heartbeatTimer = hb.interval;
    }
  } else {
    audioIntensityState.heartbeatTimer = 0;
  }
}

/**
 * 低电量模式：Battery API 可用时监听电量；低于 25% 且未充电 → 关 BGM、禁点缀、压并发
 * （无 Battery API 的浏览器静默跳过，不影响正常玩法）
 * @returns {void}
 */
function initLowPowerAudio() {
  const cfg = AUDIO_INTENSITY_CONFIG.lowPower;
  if (!navigator.getBattery) return;
  navigator.getBattery().then((battery) => {
    audioIntensityState.battery = battery;
    const sync = () => {
      const low = !battery.charging && battery.level < cfg.threshold;
      audioIntensityState.lowPower = low;
      if (low && cfg.disableBgm && audioSettings.bgmOn) setBgmEnabled(false);
    };
    battery.addEventListener('levelchange', sync);
    battery.addEventListener('chargingchange', sync);
    sync();
  }).catch(() => { /* 权限/环境不支持时忽略 */ });
}

/**
 * 页面不可见或静音时挂起 AudioContext，避免音频线程空转
 * @param {string} [reason] 挂起原因（hidden / muted）
 * @returns {boolean} 是否执行了挂起
 */
function suspendAudioForIdle(reason) {
  const ac = audioState.ctx;
  if (!ac || typeof ac.suspend !== 'function') return false;
  audioState.idleReason = reason || 'hidden';
  ac.suspend().catch(() => {});
  return true;
}

/**
 * 页面恢复可见且未静音时恢复 AudioContext
 * @returns {boolean} 是否执行了恢复
 */
function resumeAudioFromIdle() {
  const ac = audioState.ctx;
  audioState.idleReason = null;
  if (!ac || audioSettings.muted) return false;
  if (ac.state === 'suspended' && typeof ac.resume === 'function') ac.resume().catch(() => {});
  return true;
}
`;

const BOSS_FUNC = `function playBossIntroSting(kindOrTheme, phase, acIn) {
  const cfg = AUDIO_M3_CONFIG;
  if (!cfg.enabled) return false;
  const p = Math.max(1, Number(phase) || 1);
  let kind = kindOrTheme;
  if (!(cfg.bossTimbres && cfg.bossTimbres[kind])) {
    kind = (state && state.boss && cfg.bossTimbres && cfg.bossTimbres[state.boss.kind])
      ? state.boss.kind : 'mech';
  }
  audioM3Stats.bossStings += 1;
  audioM3Stats.lastSting = kind + ':p' + p;
  const ac = acIn || ensureAudio();
  if (!ac) return false;
  const dest = acIn ? ac.destination : audioState.sfxBus;
  if (!dest) return false;
  const t0 = ac.currentTime + 0.05;
  const timbre = cfg.bossTimbres[kind] || cfg.bossTimbres.mech;
  const semis = p >= 3 ? -5 : (p === 2 ? -3 : 0);
  const shift = Math.pow(2, semis / 12);
  const durScale = p > 1 ? 0.7 : 1;
  const cleanup = [];
  const push = (node) => { if (node) cleanup.push(node); };
  const addOsc = (type, from, to, at, dur, gainValue, detuneCents) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const attack = Math.min(0.08, dur * 0.45);
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from * shift), t0 + at);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to * shift), t0 + at + dur);
    if (detuneCents) osc.detune.value = detuneCents;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(gainValue, t0 + at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(gain); gain.connect(dest);
    osc.start(t0 + at); osc.stop(t0 + at + dur + 0.04);
    push(osc); push(gain);
  };
  const addNoise = (gainValue, cutoff, dur, at, attack) => {
    try {
      const frames = Math.floor(ac.sampleRate * Math.min(0.7, dur));
      const buf = ac.createBuffer(1, frames, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * 0.6;
      const noise = ac.createBufferSource();
      noise.buffer = buf;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.0001, t0 + at);
      ng.gain.exponentialRampToValueAtTime(gainValue, t0 + at + (attack || 0.16));
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      noise.connect(filter); filter.connect(ng); ng.connect(dest);
      noise.start(t0 + at); noise.stop(t0 + at + dur + 0.03);
      push(noise); push(filter); push(ng);
    } catch (error) { /* 不支持 buffer 时静默跳过噪声层 */ }
  };

  if (kind === 'rune') {
    (timbre.arp || []).forEach((n) => {
      addOsc('sine', n.freq, 0, n.at * durScale, n.dur * durScale, n.gain * (p > 1 ? 0.9 : 1), 0);
    });
    if (timbre.shimmer) addOsc('sine', timbre.shimmer.freq, 0, 0.16 * durScale, timbre.shimmer.dur * durScale, timbre.shimmer.gain, 0);
  } else if (kind === 'void') {
    addOsc('sawtooth', timbre.osc.from, timbre.osc.to, 0, timbre.osc.dur * durScale, timbre.osc.gain, 0);
    if (timbre.detune) addOsc('sawtooth', timbre.detune.freq, timbre.detune.freq - 28, 0, timbre.osc.dur * durScale, timbre.detune.gain, 7);
    if (timbre.sub) addOsc('sine', timbre.sub.freq, 0, 0, timbre.sub.dur * durScale, timbre.sub.gain, 0);
    if (timbre.noise) addNoise(timbre.noise.gain, timbre.noise.cutoff, timbre.noise.dur * durScale, 0, 0.35);
  } else {
    addOsc('sawtooth', timbre.osc.from, timbre.osc.to, 0, timbre.osc.dur * durScale, timbre.osc.gain, 0);
    (timbre.clicks || []).forEach((c) => {
      addOsc(c.type || 'square', c.freq, 0, c.at * durScale, c.dur * durScale, c.gain, 0);
    });
    if (timbre.noise) addNoise(timbre.noise.gain, timbre.noise.cutoff, timbre.noise.dur * durScale, 0.02, 0.18);
  }

  window.setTimeout(() => {
    cleanup.forEach((n) => { try { n.disconnect(); } catch (error) { /* 已断开 */ } });
  }, 1800);
  return true;
}`;

const BOSS_SELFTEST = `
/**
 * 首领三档音色离线自检：分别渲染 mech / rune / void 并统计 peak / rms / zcr
 * 目的：用客观数字证明三档不是"同一段音换了个名字"。
 * @returns {Promise<Object>} 每档结果 + zcr 极差
 */
async function renderBossStingSelfTest() {
  const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctor) return { ok: false, reason: '当前浏览器不支持 OfflineAudioContext' };
  const results = {};
  const kinds = ['mech', 'rune', 'void'];
  for (let i = 0; i < kinds.length; i += 1) {
    const kind = kinds[i];
    const ac = new Ctor(1, Math.floor(44100 * 1.8), 44100);
    playBossIntroSting(kind, 1, ac);
    const buffer = await ac.startRendering();
    const data = buffer.getChannelData(0);
    let peak = 0; let sum = 0; let crossings = 0;
    let lpLow = 0; let lpHigh = 0; let lowSum = 0; let highSum = 0;
    const aLow = 1 - Math.exp(-2 * Math.PI * 120 / 44100);
    const aHigh = 1 - Math.exp(-2 * Math.PI * 1500 / 44100);
    for (let s = 0; s < data.length; s += 1) {
      const raw = data[s];
      const v = Math.abs(raw);
      if (v > peak) peak = v;
      sum += raw * raw;
      if (s > 0 && ((data[s] > 0) !== (data[s - 1] > 0))) crossings += 1;
      lpLow += aLow * (raw - lpLow);
      lowSum += lpLow * lpLow;
      lpHigh += aHigh * (raw - lpHigh);
      const high = raw - lpHigh;
      highSum += high * high;
    }
    results[kind] = {
      peak: Number(peak.toFixed(4)),
      rms: Number(Math.sqrt(sum / data.length).toFixed(4)),
      zcr: Number((crossings / data.length * 44100).toFixed(1)),
      lowRms: Number(Math.sqrt(lowSum / data.length).toFixed(4)),
      highRms: Number(Math.sqrt(highSum / data.length).toFixed(4))
    };
  }
  const tiers = kinds.map((k) => results[k]);
  const zcrSpread = Math.max.apply(null, tiers.map((t) => t.zcr))
    - Math.min.apply(null, tiers.map((t) => t.zcr));
  const ok = results.rune.zcr > 1.8 * Math.max(results.mech.zcr, results.void.zcr)
    && results.void.lowRms > results.mech.lowRms
    && results.mech.highRms > results.void.highRms;
  return { ok: ok, results: results, zcrSpread: Number(zcrSpread.toFixed(1)) };
}
`;

/**
 * 给源码打上 A/B/C 三段补丁；任何锚点缺失都会抛错，不会产出半成品
 * @param {string} src 主文件源码
 * @returns {string} 补丁后的源码
 */
function applyAudioPatch(src) {
  let out = src;

  // A. 配置 + 运行态 + 函数块
  out = replaceOnce(out, '/**\n * 机械层专属场景配置', CONFIG_BLOCK + '\n/**\n * 机械层专属场景配置', 'A-config');

  // A. playSfx 接强度倍率
  out = replaceOnce(out,
    '  const limit = AUDIO_CONFIG.rateLimit[name] || AUDIO_CONFIG.rateLimit.default;',
    '  const limit = (AUDIO_CONFIG.rateLimit[name] || AUDIO_CONFIG.rateLimit.default) * audioIntensityRateScale();',
    'A-rate');
  out = replaceOnce(out,
    '  if (!o.priority && audioState.voices >= AUDIO_CONFIG.voiceLimit) return false;',
    '  if (!o.priority && audioState.voices >= audioIntensityVoiceLimit()) return false;',
    'A-voice');

  // A. BGM 点缀间隔
  out = replaceOnce(out,
    '  bgmState.nextPing = BGM_CONFIG.pingInterval[0] + Math.random() * 3;',
    '  bgmState.nextPing = (BGM_CONFIG.pingInterval[0] + Math.random() * 3) * audioIntensityPingMul();',
    'A-ping-init');
  out = replaceOnce(out,
    '    bgmState.nextPing = BGM_CONFIG.pingInterval[0]\n      + Math.random() * (BGM_CONFIG.pingInterval[1] - BGM_CONFIG.pingInterval[0]);',
    '    bgmState.nextPing = (BGM_CONFIG.pingInterval[0]\n      + Math.random() * (BGM_CONFIG.pingInterval[1] - BGM_CONFIG.pingInterval[0])) * audioIntensityPingMul();',
    'A-ping-loop');
  out = replaceOnce(out,
    '  if (!audioSettings.bgmOn || audioSettings.muted) return;',
    '  if (!audioSettings.bgmOn || audioSettings.muted) return;\n  if (audioIntensityState.lowPower && AUDIO_INTENSITY_CONFIG.lowPower.disablePing) return;',
    'A-lowpower-ping');

  // A. 每帧推进
  out = replaceOnce(out,
    '  // BGM 的稀疏点缀调度（真实时间；BGM 关闭时函数内部直接返回）\n  updateBgm(dt);',
    '  // 战斗强度 → 音频密度（只改音频层参数，不碰玩法与随机源）\n  updateAudioIntensity(dt);\n\n  // BGM 的稀疏点缀调度（真实时间；BGM 关闭时函数内部直接返回）\n  updateBgm(dt);',
    'A-tick');

  // A. 静音 / 可见性
  out = replaceOnce(out,
    '  applyAudioSettings();\n  saveAudioSettings();\n  renderAudioSettings();\n  playSfx(\'ui\');\n  return audioSettings.muted;',
    '  applyAudioSettings();\n  saveAudioSettings();\n  renderAudioSettings();\n  if (audioSettings.muted) suspendAudioForIdle(\'muted\');\n  else resumeAudioFromIdle();\n  playSfx(\'ui\');\n  return audioSettings.muted;',
    'A-mute');
  out = replaceOnce(out,
    '    if (document.hidden) weaponHoldFire = false;\n  });',
    '    if (document.hidden) weaponHoldFire = false;\n    /* 音频空转修补：页面不可见时挂起 AudioContext，回来再恢复（静音时保持挂起） */\n    if (document.hidden) suspendAudioForIdle(\'hidden\');\n    else if (!audioSettings.muted) resumeAudioFromIdle();\n  });',
    'A-visible');
  out = replaceOnce(out,
    '  if (ui.btnReturnTitle) ui.btnReturnTitle.addEventListener(\'click\', returnToTitleFromRun);',
    '  if (ui.btnReturnTitle) ui.btnReturnTitle.addEventListener(\'click\', returnToTitleFromRun);\n  // 低电量模式：首次绑定时读取电池状态（无 Battery API 时静默跳过）\n  initLowPowerAudio();',
    'A-lowpower-init');

  // C-1. buildSfx 全节点回收
  out = replaceOnce(out, '  const vol = Math.max(0.0001, (tone.gain || 0.8) * (volume == null ? 1 : volume));',
    '  const vol = Math.max(0.0001, (tone.gain || 0.8) * (volume == null ? 1 : volume));\n  const cleanupNodes = [];', 'C-buildsfx-decl');
  out = replaceOnce(out, '  osc.stop(t0 + dur + 0.01);',
    '  osc.stop(t0 + dur + 0.01);\n  cleanupNodes.push(osc, gain);', 'C-buildsfx-osc');
  out = replaceOnce(out, '    noise.stop(t0 + 0.05);',
    '    noise.stop(t0 + 0.05);\n    cleanupNodes.push(noise, filter, noiseGain);', 'C-buildsfx-hit');
  out = replaceOnce(out, '    noise.stop(t0 + Math.min(0.12, dur * 0.6));',
    '    noise.stop(t0 + Math.min(0.12, dur * 0.6));\n    cleanupNodes.push(noise, filter, noiseGain);', 'C-buildsfx-tone');
  out = replaceOnce(out, '    noise.start(t0);\n  }',
    '    noise.start(t0);\n    cleanupNodes.push(noise, filter, noiseGain);\n  }', 'C-buildsfx-steam');
  out = replaceOnce(out,
    '  }\n\n  return true;\n}\n\n/**\n * U8：本次音效的随机微抖参数',
    '  }\n\n  // 节点回收：音效播完后显式断开，避免增益节点常驻挂在总线上\n  window.setTimeout(() => {\n    cleanupNodes.forEach((n) => { try { n.disconnect(); } catch (error) { /* 已断开 */ } });\n  }, (dur + 0.3) * 1000);\n\n  return true;\n}\n\n/**\n * U8：本次音效的随机微抖参数',
    'C-buildsfx-cleanup');

  // C-2. BGM 混响节点登记（漏登记是 5 次开关累积的根因）
  out = replaceOnce(out,
    '  lowpass.Q.value = 0.6;\n\n  if (BGM_CONFIG.reverb) {\n    const reverb = ac.createConvolver();\n    reverb.buffer = buildImpulse(ac);\n    lowpass.connect(reverb);\n    const wet = ac.createGain();\n    wet.gain.value = 0.55;           // 混响占比：有空间感但不糊\n    reverb.connect(wet);\n    wet.connect(audioState.bgmBus);\n  }\n  lowpass.connect(audioState.bgmBus);\n  padGain.connect(lowpass);\n\n  const nodes = [padGain, lowpass];',
    '  lowpass.Q.value = 0.6;\n  /* 先把本轨所有节点登记进 nodes，混响分支的 convolver / wet 也必须进来，\n     否则 stopBgm 只停振荡器，混响节点会每次开关累积一份。 */\n  const nodes = [padGain, lowpass];\n\n  if (BGM_CONFIG.reverb) {\n    const reverb = ac.createConvolver();\n    reverb.buffer = buildImpulse(ac);\n    lowpass.connect(reverb);\n    const wet = ac.createGain();\n    wet.gain.value = 0.55;           // 混响占比：有空间感但不糊\n    reverb.connect(wet);\n    wet.connect(audioState.bgmBus);\n    nodes.push(reverb, wet);\n  }\n  lowpass.connect(audioState.bgmBus);\n  padGain.connect(lowpass);',
    'C-bgm-nodes');

  // C-3. ping 全节点回收
  out = replaceOnce(out,
    '  osc.start(t0);\n  osc.stop(t0 + dur + 0.05);\n  window.setTimeout(() => { try { gain.disconnect(); } catch (error) { /* 忽略 */ } }, (dur + 0.3) * 1000);',
    '  osc.start(t0);\n  osc.stop(t0 + dur + 0.05);\n  window.setTimeout(() => {\n    [osc, filter, gain].forEach((n) => { try { n.disconnect(); } catch (error) { /* 忽略 */ } });\n  }, (dur + 0.3) * 1000);',
    'C-ping-cleanup');

  // B-1. 三档音色配置
  out = replaceOnce(out,
    '  boss: { gain: 0.22, dur: 0.9, lowFreq: 74, highFreq: 132, noiseGain: 0.09 }',
    '  boss: { gain: 0.22, dur: 0.9, lowFreq: 74, highFreq: 132, noiseGain: 0.09 },\n' +
    '  /**\n' +
    '   * 三档首领音色（本轮新增：同一"登场"事件在三个大区必须闭眼可分）\n' +
    '   * mech = 铸造·金属撞击；rune = 刻印·空灵三音；void = 湮灭·下沉低频\n' +
    '   */\n' +
    '  bossTimbres: {\n' +
    '    mech: {\n' +
    '      osc: { type: \'sawtooth\', from: 68, to: 118, dur: 0.80, gain: 0.20 },\n' +
    '      clicks: [ { at: 0.10, freq: 220, dur: 0.06, gain: 0.20, type: \'square\' },\n' +
    '                { at: 0.16, freq: 330, dur: 0.05, gain: 0.16, type: \'square\' },\n' +
    '                { at: 0.22, freq: 440, dur: 0.05, gain: 0.10, type: \'square\' },\n' +
    '                { at: 0.28, freq: 1320, dur: 0.18, gain: 0.07, type: \'sine\' } ],\n' +
    '      noise: { gain: 0.12, cutoff: 1800, dur: 0.50 }\n' +
    '    },\n' +
    '    rune: {\n' +
    '      arp: [ { at: 0.00, freq: 196.00, dur: 0.55, gain: 0.10 },\n' +
    '             { at: 0.09, freq: 293.66, dur: 0.55, gain: 0.10 },\n' +
    '             { at: 0.18, freq: 392.00, dur: 0.55, gain: 0.10 } ],\n' +
    '      shimmer: { freq: 1046.5, dur: 0.65, gain: 0.05 },\n' +
    '      noise: null\n' +
    '    },\n' +
    '    void: {\n' +
    '      osc: { type: \'sawtooth\', from: 62, to: 34, dur: 1.20, gain: 0.20 },\n' +
    '      detune: { freq: 63.5, gain: 0.06 },\n' +
    '      sub: { freq: 31, dur: 1.20, gain: 0.10 },\n' +
    '      noise: { gain: 0.12, cutoff: 300, dur: 0.80 }\n' +
    '    }\n' +
    '  }',
    'B-config');

  // B-2. 整函数替换
  out = replaceRange(out, 'function playBossIntroSting(themeId, phase) {',
    '\n\n/**\n * 启动氛围 BGM', BOSS_FUNC, 'B-func');

  // B-3. 调用点改为真实 boss.kind（deep 层不会再被当成 mech）
  out = replaceOnce(out, '  playBossIntroSting(state.themeId);',
    '  playBossIntroSting((state.boss && state.boss.kind) || state.themeId);', 'B-call1');
  out = replaceOnce(out, '  playBossIntroSting(state.themeId, 2);',
    '  playBossIntroSting((state.boss && state.boss.kind) || state.themeId, 2);', 'B-call2');

  // B-4. 离线自检函数
  out = replaceOnce(out, '/* ============================================================\n   六、战斗与交互区',
    BOSS_SELFTEST + '\n/* ============================================================\n   六、战斗与交互区',
    'B-selftest');

  // B-5. 验收调试口
  out = replaceOnce(out,
    '      setBgmOn(on) { setBgmEnabled(!!on); return audioSettings.bgmOn; }\n    },',
    '      setBgmOn(on) { setBgmEnabled(!!on); return audioSettings.bgmOn; },\n' +
    '      /** 首领三档音色离线渲染（zcr / peak / rms 三列，证明三档可区分） */\n' +
    '      bossSelfTest() { return renderBossStingSelfTest(); },\n' +
    '      /** 当前战斗强度 → 音频密度快照（调参与验收直接读） */\n' +
    '      intensity() {\n' +
    '        const s = audioIntensityScore();\n' +
    '        const band = audioIntensityBand(s);\n' +
    '        const hpMax = Number(state && state.player && state.player.hpMax) || 0;\n' +
    '        return {\n' +
    '          enabled: AUDIO_INTENSITY_CONFIG.enabled,\n' +
    '          score: s, level: AUDIO_INTENSITY_CONFIG.bands.indexOf(band), id: band.id,\n' +
    '          appliedLevel: audioIntensityState.level,\n' +
    '          enemyCount: roomAliveEnemyCount(),\n' +
    '          hpRatio: hpMax > 0 ? Number((state.player.hp / hpMax).toFixed(3)) : 1,\n' +
    '          bossStarted: !!(state && state.boss && state.boss.started && !state.boss.defeated),\n' +
    '          voiceLimit: audioIntensityVoiceLimit(),\n' +
    '          rateScale: audioIntensityRateScale(),\n' +
    '          pingMul: audioIntensityPingMul(),\n' +
    '          heartbeat: audioIntensityState.hpLow,\n' +
    '          lowPower: audioIntensityState.lowPower\n' +
    '        };\n' +
    '      }\n    },',
    'B-debug');

  return out;
}

/* ------------------------------------------------------------------
 * 浏览器注入钩子：统计 AudioContext 创建次数 / 各节点创建与断开
 * ------------------------------------------------------------------ */
const HOOK_SOURCE = `(() => {
  const H = window.__audioHook = {
    ctxCreated: 0, created: {}, disconnected: {}, live: 0, liveByType: {},
    buffers: 0, bufferBytes: 0
  };
  // 低电量路径的测试替身：真实 Battery API 在无头/file:// 下通常不可用
  const fakeBattery = {
    charging: true, level: 0.9, _ls: {},
    addEventListener(type, fn) { (this._ls[type] = this._ls[type] || []).push(fn); },
    removeEventListener(type, fn) { this._ls[type] = (this._ls[type] || []).filter((f) => f !== fn); },
    fire(type) { (this._ls[type] || []).forEach((fn) => { try { fn(); } catch (e) { /* 忽略 */ } }); }
  };
  window.__fakeBattery = fakeBattery;
  try {
    Object.defineProperty(navigator, 'getBattery', {
      configurable: true,
      value: () => Promise.resolve(fakeBattery)
    });
  } catch (e) { /* 不可覆盖时保持原样 */ }
  const ids = new WeakMap();
  const mark = (rec) => { if (rec && !rec.live) { rec.live = true; H.live += 1; H.liveByType[rec.type] = (H.liveByType[rec.type] || 0) + 1; } };
  const unmark = (rec) => { if (rec && rec.live) { rec.live = false; H.live -= 1; H.liveByType[rec.type] = (H.liveByType[rec.type] || 0) - 1; } };
  const reg = (node, type) => {
    if (!node) return;
    const rec = { type: type, live: false };
    ids.set(node, rec);
    H.created[type] = (H.created[type] || 0) + 1;
  };
  const factories = {
    createGain: 'gain', createOscillator: 'oscillator', createBufferSource: 'bufferSource',
    createBiquadFilter: 'biquad', createConvolver: 'convolver', createDelay: 'delay',
    createStereoPanner: 'panner', createDynamicsCompressor: 'compressor'
  };
  const patchProto = (proto) => {
    if (!proto) return;
    Object.keys(factories).forEach((fn) => {
      if (typeof proto[fn] !== 'function') return;
      const orig = proto[fn];
      proto[fn] = function () {
        const node = orig.apply(this, arguments);
        reg(node, factories[fn]);
        return node;
      };
    });
    if (typeof proto.createBuffer === 'function') {
      const origBuf = proto.createBuffer;
      proto.createBuffer = function (channels, length, rate) {
        const buf = origBuf.apply(this, arguments);
        H.buffers += 1;
        H.bufferBytes += Number(channels) * Number(length) * 4;
        return buf;
      };
    }
  };
  patchProto(window.AudioContext && window.AudioContext.prototype);
  patchProto(window.OfflineAudioContext && window.OfflineAudioContext.prototype);
  const Orig = window.AudioContext;
  if (Orig) {
    const Wrapped = function () {
      H.ctxCreated += 1;
      return new Orig(...arguments);
    };
    Wrapped.prototype = Orig.prototype;
    window.AudioContext = Wrapped;
  }
  const np = window.AudioNode && window.AudioNode.prototype;
  if (np) {
    const oConnect = np.connect;
    const oDisconnect = np.disconnect;
    np.connect = function () {
      const rec = ids.get(this);
      if (rec) mark(rec);
      return oConnect.apply(this, arguments);
    };
    np.disconnect = function () {
      const rec = ids.get(this);
      if (rec) {
        unmark(rec);
        H.disconnected[rec.type] = (H.disconnected[rec.type] || 0) + 1;
      }
      return oDisconnect.apply(this, arguments);
    };
  }
  window.__audioHookSnapshot = () => JSON.parse(JSON.stringify({
    ctxCreated: H.ctxCreated, created: H.created, disconnected: H.disconnected,
    live: H.live, liveByType: H.liveByType, buffers: H.buffers, bufferBytes: H.bufferBytes
  }));
})();`;

/**
 * 跑一遍页面：启动 → BGM 稳态 → 单次音效 → BGM 5 次开关 → 静音 5 次开关 → 强度矩阵
 * @param {CDP} cdp CDP 客户端
 * @param {string} url 页面地址
 * @param {string} tag 基线 / 补丁标识
 * @param {boolean} patched 是否有本轮调试口
 * @returns {Promise<Object>} 实测结果
 */
async function runScenario(cdp, url, tag, patched) {
  await cdp.send('Page.navigate', { url: url });
  await sleep(2600);

  const startPos = await cdp.eval(`(() => {
    const el = document.getElementById('btnStart');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!startPos) throw new Error('找不到开始按钮');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(1200);
  await cdp.eval(`(() => {
    __roamDebug.xp.setEnabled(false);
    __roamDebug.enemies.floor(3);
    state.mode = 'playing'; state.status = 'playing';
    const room = state.rooms[0];
    __roamDebug.teleport(room.cx, room.cy);
    __roamDebug.despawnAll();
    state.player.invuln = 999;
    return { mode: state.mode, status: state.status, room: state.currentRoomId };
  })()`);
  await sleep(700);

  // 确保 AudioContext 已创建；产生的 ui 音效在基线里也会留下 2 个未断开节点
  await cdp.eval(`(() => {
    if (window.__roamDebug && window.__roamDebug.audioLayers && window.__roamDebug.audioLayers.play) {
      window.__roamDebug.audioLayers.play('ui', 1, { force: true });
    } else if (typeof playSfx === 'function') {
      playSfx('ui', 1, { force: true });
    }
    return audioState && audioState.ctx ? audioState.ctx.state : 'none';
  })()`);
  await sleep(500);
  const baseHook = await cdp.eval(`window.__audioHookSnapshot()`);
  const ctxState0 = await cdp.eval(`audioState && audioState.ctx ? audioState.ctx.state : 'none'`);

  const results = {
    tag: tag, patched: patched, baseHook: baseHook, ctxState0: ctxState0,
    bgm: null, perTrigger: {}, toggles: {}, mute: {}, hidden: null, lowPower: null,
    intensity: [], boss: null, bossTrigger: {}
  };

  /**
   * 单次音效增量：创建数 / 断数 / 300ms 后仍连接数
   * @param {string} name 音效名
   * @param {string} [extra] 额外参数（如 force）
   * @returns {Promise<Object>} 增量
   */
  async function measureTrigger(name, extra) {
    const before = await cdp.eval(`window.__audioHookSnapshot()`);
    await cdp.eval(`(() => { playSfx(${JSON.stringify(name)}, 1, ${extra || '{}'}); return true; })()`);
    await sleep(1000);
    const after = await cdp.eval(`window.__audioHookSnapshot()`);
    const delta = {};
    Object.keys(after.created).forEach((type) => {
      const c = (after.created[type] || 0) - (before.created[type] || 0);
      const d = (after.disconnected[type] || 0) - (before.disconnected[type] || 0);
      if (c !== 0 || d !== 0) delta[type] = { created: c, disconnected: d, open: c - d };
    });
    return { delta: delta, liveDelta: after.live - before.live, ctxCreated: after.ctxCreated };
  }

  // 先关掉 BGM 再测单次音效，避免 BGM 的稀疏 ping 混进增量
  await cdp.eval(`(() => { window.__roamDebug.audioLayers.setBgmOn(false); return true; })()`);
  await sleep(1400);
  results.perTrigger.ui = await measureTrigger('ui');
  results.perTrigger.lightHit = await measureTrigger('lightHit');
  results.perTrigger.heavyHit = await measureTrigger('heavyHit');
  await sleep(900);
  results.perTrigger.afterWait = { hook: await cdp.eval(`window.__audioHookSnapshot()`) };

  // BGM 打开并等到淡入完成（此时快照 = BGM 常驻节点基线）
  const preBgmHook = await cdp.eval(`window.__audioHookSnapshot()`);
  await cdp.eval(`(() => { window.__roamDebug.audioLayers.setBgmOn(true); return true; })()`);
  await sleep(1800);
  const bgmSnapshot = await cdp.eval(`(() => ({
    hook: window.__audioHookSnapshot(),
    bgmNodesLen: bgmState.nodes.length,
    bgmOn: !!audioSettings.bgmOn,
    ctxState: audioState.ctx ? audioState.ctx.state : 'none',
    theme: bgmState.themeId
  }))()`);
  results.bgm = Object.assign(bgmSnapshot, {
    preHook: preBgmHook,
    liveDelta: bgmSnapshot.hook.live - preBgmHook.live
  });

  // 切标签页路径：把 document.hidden 改 true 并派发事件，看 AudioContext 是否挂起
  results.hidden = await cdp.eval(`(async () => {
    const before = audioState.ctx.state;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 600));
    const hidden = audioState.ctx.state;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 800));
    const restored = audioState.ctx.state;
    return { before: before, hidden: hidden, restored: restored };
  })()`);

  // BGM 反复开关 5 次
  const beforeToggle = await cdp.eval(`window.__audioHookSnapshot()`);
  for (let i = 0; i < 5; i += 1) {
    await cdp.eval(`(() => { window.__roamDebug.audioLayers.setBgmOn(false); return true; })()`);
    await sleep(1300);
    await cdp.eval(`(() => { window.__roamDebug.audioLayers.setBgmOn(true); return true; })()`);
    await sleep(1700);
  }
  await cdp.eval(`(() => { window.__roamDebug.audioLayers.setBgmOn(false); return true; })()`);
  await sleep(1400);
  const afterToggle = await cdp.eval(`window.__audioHookSnapshot()`);
  const residualByType = {};
  const beforeOpenByType = {};
  const afterOpenByType = {};
  ['gain', 'oscillator', 'biquad', 'convolver', 'bufferSource'].forEach((type) => {
    beforeOpenByType[type] = (preBgmHook.created[type] || 0) - (preBgmHook.disconnected[type] || 0);
    afterOpenByType[type] = (afterToggle.created[type] || 0) - (afterToggle.disconnected[type] || 0);
    residualByType[type] = afterOpenByType[type] - beforeOpenByType[type];
  });
  results.toggles.bgm = {
    before: beforeToggle, after: afterToggle,
    preOpenByType: beforeOpenByType,
    afterOpenByType: afterOpenByType,
    residualByType: residualByType,
    residualTotal: Object.keys(residualByType).reduce((s, k) => s + residualByType[k], 0),
    addedLive: afterToggle.live - beforeToggle.live,
    addedConvolver: (afterToggle.created.convolver || 0) - (beforeToggle.created.convolver || 0),
    addedWetGain: (afterToggle.created.gain || 0) - (beforeToggle.created.gain || 0),
    addedBufferBytes: afterToggle.bufferBytes - beforeToggle.bufferBytes,
    ctxCreated: afterToggle.ctxCreated
  };

  // 静音 5 次：观察 Context / 节点是否变化，以及静音时音频是否仍在跑
  await cdp.eval(`(() => { window.__roamDebug.audioLayers.setBgmOn(true); return true; })()`);
  await sleep(1800);
  const beforeMute = await cdp.eval(`window.__audioHookSnapshot()`);
  const muteIdle = [];
  for (let i = 0; i < 5; i += 1) {
    await cdp.eval(`(() => { if (!audioSettings.muted) toggleMute(); return audioSettings.muted; })()`);
    await sleep(250);
    muteIdle.push(await cdp.eval(`(() => ({
      ctxState: audioState.ctx ? audioState.ctx.state : 'none',
      live: window.__audioHookSnapshot().live,
      bgmNodesLen: bgmState.nodes.length,
      bgmOn: !!audioSettings.bgmOn,
      muted: !!audioSettings.muted
    }))()`));
    await cdp.eval(`(() => { if (audioSettings.muted) toggleMute(); return audioSettings.muted; })()`);
    await sleep(250);
  }
  await sleep(1200);   // 等 buildSfx 的延迟 disconnect 全部落地，再取最终值
  const afterMute = await cdp.eval(`window.__audioHookSnapshot()`);
  results.mute = {
    before: beforeMute, after: afterMute,
    ctxCreatedDelta: afterMute.ctxCreated - beforeMute.ctxCreated,
    liveDelta: afterMute.live - beforeMute.live,
    during: muteIdle
  };

  // 强度矩阵（仅补丁副本有调试口）
  if (patched) {
    const snap = async () => {
      await sleep(700);
      return cdp.eval(`(() => (window.__roamDebug.audioLayers.intensity
        ? window.__roamDebug.audioLayers.intensity() : null))()`);
    };
    await cdp.eval(`(() => { __roamDebug.despawnAll(); state.player.hp = state.player.hpMax; if (state.boss) state.boss = null; return true; })()`);
    results.intensity.push(Object.assign({ case: '探索·0敌·满血' }, await snap()));
    await cdp.eval(`(() => { state.player.hp = state.player.hpMax * 0.2; return state.player.hp; })()`);
    results.intensity.push(Object.assign({ case: '探索·0敌·20%血' }, await snap()));
    await cdp.eval(`(() => { state.player.hp = state.player.hpMax; return state.player.hp; })()`);
    await cdp.eval(`(() => { const p = state.player; __roamDebug.spawnEnemyAt('chanter', p.x + 80, p.y); __roamDebug.spawnEnemyAt('chanter', p.x - 80, p.y); return state.enemies.length; })()`);
    results.intensity.push(Object.assign({ case: '2敌·满血' }, await snap()));
    await cdp.eval(`(() => { const p = state.player; for (let i = 0; i < 3; i += 1) __roamDebug.spawnEnemyAt('chanter', p.x + 60 + i * 30, p.y + 60); return state.enemies.length; })()`);
    results.intensity.push(Object.assign({ case: '5敌·满血' }, await snap()));
    await cdp.eval(`(() => { state.player.hp = state.player.hpMax * 0.2; return state.player.hp; })()`);
    results.intensity.push(Object.assign({ case: '5敌·20%血' }, await snap()));
    await cdp.eval(`(() => {
      state.player.hp = state.player.hpMax;
      const r = __roamDebug.execute.spawn('boss');
      if (state.boss) { state.boss.started = true; state.boss.introDone = true; state.boss.phase = 1; state.boss.phase2 = false; }
      return r;
    })()`);
    results.intensity.push(Object.assign({ case: '首领P1·满血' }, await snap()));
    await cdp.eval(`(() => { if (state.boss) { state.boss.phase = 2; state.boss.phase2 = true; } return true; })()`);
    results.intensity.push(Object.assign({ case: '首领P2·满血' }, await snap()));

    // 三档首领音色离线渲染
    results.boss = await cdp.eval(`window.__roamDebug.audioLayers.bossSelfTest()`);
    // 三档首领"每次触发"新增节点数：先清场、关 BGM、满血，避免心跳/ping 混入
    await cdp.eval(`(() => { window.__roamDebug.audioLayers.setBgmOn(false); return true; })()`);
    await sleep(1400);
    await cdp.eval(`(() => { __roamDebug.despawnAll(); state.player.hp = state.player.hpMax; if (state.boss) state.boss = null; return true; })()`);
    await sleep(3000);   // 等上一轮低血心跳 / 音效的延迟断开全部落地，保证本次基线为 0
    results.bossTrigger = {};
    for (const kind of ['mech', 'rune', 'void']) {
      const before = await cdp.eval(`window.__audioHookSnapshot()`);
      await cdp.eval(`(() => { playBossIntroSting(${JSON.stringify(kind)}, 1); return true; })()`);
      await sleep(2400);
      const after = await cdp.eval(`window.__audioHookSnapshot()`);
      const delta = {};
      Object.keys(after.created).forEach((type) => {
        const c = (after.created[type] || 0) - (before.created[type] || 0);
        const d = (after.disconnected[type] || 0) - (before.disconnected[type] || 0);
        if (c !== 0 || d !== 0) delta[type] = { created: c, disconnected: d, open: c - d };
      });
      results.bossTrigger[kind] = { delta: delta, liveDelta: after.live - before.live };
    }

    // 低电量路径：伪造电量 20% 且未充电，确认自动关 BGM 且节点回落
    results.lowPower = await cdp.eval(`(async () => {
      const b = window.__fakeBattery;
      if (!b) return { supported: false };
      b.charging = false; b.level = 0.2; b.fire('levelchange');
      await new Promise((r) => setTimeout(r, 1800));
      const low = {
        lowPower: audioIntensityState.lowPower,
        bgmOn: !!audioSettings.bgmOn,
        bgmNodesLen: bgmState.nodes.length,
        voiceLimit: audioIntensityVoiceLimit(),
        pingMul: audioIntensityPingMul()
      };
      b.charging = true; b.level = 0.9; b.fire('chargingchange');
      await new Promise((r) => setTimeout(r, 300));
      return { supported: true, low: low, restoredLowPower: audioIntensityState.lowPower, bgmOnAfterCharge: !!audioSettings.bgmOn };
    })()`);
  }

  return results;
}

/* ------------------------------------------------------------------
 * 主流程
 * ------------------------------------------------------------------ */
(async () => {
  // --check-anchors：只做静态锚点校验，不启动浏览器（主文件仍在冻结期时用这个）
  if (process.argv.includes('--check-anchors')) {
    const buf = fs.readFileSync(MAIN);
    const src = buf.toString('utf8');
    console.log('主文件 MD5（现场读取）=', md5Of(buf), ' 大小=', buf.length, ' 行数=', src.split('\n').length);
    try {
      const patched = applyAudioPatch(src);
      console.log('锚点校验：全部命中且唯一 ✓  补丁后大小=', Buffer.byteLength(patched),
        ' 行数=', patched.split('\n').length, ' 净增字节=', Buffer.byteLength(patched) - buf.length);
      return;
    } catch (error) {
      console.error('锚点校验失败：', error.message);
      process.exitCode = 1;
      return;
    }
  }

  const keepTmp = process.argv.includes('--keep-tmp');
  const mainBuf = fs.readFileSync(MAIN);
  const mainMd5 = md5Of(mainBuf);
  const mainSrc = mainBuf.toString('utf8');
  console.log('主文件 MD5（现场读取）=', mainMd5, ' 大小=', mainBuf.length, ' 行数=', mainSrc.split('\n').length);

  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const patchedSrc = applyAudioPatch(mainSrc);
  fs.writeFileSync(TMP, patchedSrc, 'utf8');
  console.log('临时补丁副本已生成:', TMP, ' 大小=', Buffer.byteLength(patchedSrc), ' 行数=', patchedSrc.split('\n').length);

  const profile = prepareProfile();
  EDGE_PROC = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (error) { /* 端口还没起 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  WS = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const runtimeErrors = [];
  WS.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push(d ? ((d.exception || {}).description || d.text) : 'unknown');
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((resolve) => { WS.onopen = resolve; });

  const cdp = {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        seq += 1;
        pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
        WS.send(JSON.stringify({ id: seq, method, params }));
      });
    },
    async eval(expression) {
      const r = await this.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true
      });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails.exception || {};
        throw new Error('EVAL: ' + r.exceptionDetails.text + ' ' + (d.description || ''));
      }
      return r.result.value;
    }
  };
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK_SOURCE });

  const report = {
    mainMd5: mainMd5, mainBytes: mainBuf.length, tmpBytes: Buffer.byteLength(patchedSrc),
    runtimeErrors: runtimeErrors, results: {}
  };
  try {
    report.results.baseline = await runScenario(cdp, 'file:///' + MAIN.replace(/\\/g, '/').replace(/^\/+/, ''), 'baseline', false);
    report.results.patched = await runScenario(cdp, 'file:///' + TMP.replace(/\\/g, '/').replace(/^\/+/, ''), 'patched', true);
  } finally {
    if (WS) { try { WS.close(); } catch (error) { /* 忽略 */ } }
    killEdge(EDGE_PROC);
    EDGE_PROC = null;
    if (!keepTmp) fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }

  const outFile = path.join(OUT_DIR, 'audio-node-audit.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

  // 控制台摘要（数字全部来自实测，不做推算）
  const fmt = (r) => ({
    ctxCreated: r.baseHook.ctxCreated + '（启动后）',
    bgmSteadyNodes: r.bgm.bgmNodesLen + ' 登记 / 启用后 +' + r.bgm.liveDelta + ' 仍连接（含 ui 瞬时）',
    bgmBufferMB: (r.bgm.hook.bufferBytes / 1048576).toFixed(2),
    triggerOpen: {
      ui: r.perTrigger.ui.delta,
      lightHit: r.perTrigger.lightHit.delta,
      heavyHit: r.perTrigger.heavyHit.delta
    },
    hidden: r.hidden,
    bgm5Toggles: {
      residualTotal: r.toggles.bgm.residualTotal,
      residualByType: r.toggles.bgm.residualByType,
      addedConvolver: r.toggles.bgm.addedConvolver,
      addedBufferMB: (r.toggles.bgm.addedBufferBytes / 1048576).toFixed(2)
    },
    mute5Toggles: {
      ctxCreatedDelta: r.mute.ctxCreatedDelta,
      liveDelta: r.mute.liveDelta,
      during: r.mute.during
    },
    bossTrigger: r.bossTrigger,
    lowPower: r.lowPower
  });
  console.log('\n=== BASELINE ===');
  console.log(JSON.stringify(fmt(report.results.baseline), null, 2));
  console.log('\n=== PATCHED ===');
  console.log(JSON.stringify(fmt(report.results.patched), null, 2));
  console.log('\n=== INTENSITY (PATCHED) ===');
  console.log(JSON.stringify(report.results.patched.intensity, null, 2));
  console.log('\n=== BOSS TIMBRES (PATCHED) ===');
  console.log(JSON.stringify(report.results.patched.boss, null, 2));
  console.log('\nJSON →', outFile);
})().catch((err) => {
  if (WS) { try { WS.close(); } catch (error) { /* 忽略 */ } }
  killEdge(EDGE_PROC);
  EDGE_PROC = null;
  if (!process.argv.includes('--keep-tmp')) {
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
