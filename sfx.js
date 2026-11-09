/**
 * 烬 · Emberfall —— 程序化音效与配乐模块（AshSFX）
 * ============================================================
 * 单文件、零外部请求、零音频文件：所有声音都由 Web Audio 实时合成。
 * 挂载点：window.AshSFX（与主文件里的 audioState / playSfx 完全不冲突）。
 *
 * 三条硬约束：
 *   1) AudioContext 必须由一次用户手势创建，模块用 arm() 自动挂一次性监听；
 *   2) 每帧必须调用一次 AshSFX.update(dt)：限流的"帧内发声预算"和配乐调度都靠它；
 *   3) ?sfx=off 关闭整个模块：不创建 AudioContext，play() 直接返回 false。
 *
 * 音量保护链：各音效 → sfxBus → master → 压缩器 → 扬声器。
 * 再叠加"同名并发上限 + 同名最小间隔 + 全局并发上限 + 帧内发声预算"四层限流。
 */
(function (root) {
  'use strict';

  // 重复粘贴保护：同一个页面里已经有实例就直接退出
  if (root.AshSFX) return;

  /** 模块版本 */
  const VERSION = '1.0.0';

  /**
   * 默认配置：所有可调参数集中在这里，后续调音只改这一块
   */
  const DEFAULT_CONFIG = {
    enabled: true,               // 总开关（false = 不创建 AudioContext）
    master: 0.9,                 // 总音量（进压缩器之前）
    sfxVolume: 0.85,             // 音效总线音量
    musicVolume: 0.3,            // 配乐总线音量
    maxVoices: 22,               // 全局同时存在的音效条数上限
    frameVoiceBudget: 5,         // 每帧最多新开 5 条音效（约 300 条/秒）
    budgetIdleResetMs: 25,       // 主循环忘了调 update 时，预算按此间隔自动复位
    voiceMaxLifeMs: 1800,        // 兜底：任何音效最多占位 1.8 秒
    compressor: {                // 总音量压缩器：防止多怪同帧命中爆音
      threshold: -14,            // 起压阈值（dB）
      knee: 12,                  // 拐点软硬度
      ratio: 6,                  // 压缩比
      attack: 0.004,             // 起压时间（秒）
      release: 0.22              // 释放时间（秒）
    },
    music: {
      loop: 24,                  // 循环长度（秒）
      lookahead: 1.2,            // 调度前瞻窗口（秒）
      droneFade: 2.5,            // 铺底淡入时长（秒）
      noteGain: 0.18,            // 单条点缀音的基准音量
      droneGain: 0.5,            // 铺底总线音量
      delayTime: 0.12,           // 点缀音延迟时间（秒）
      delayFeedback: 0.22,       // 延迟反馈量（0~1）
      delayWet: 0.45             // 延迟湿声比例
    }
  };

  /** 当前生效配置（deepCopy 自默认值，运行时可直接改） */
  let cfg = clone(DEFAULT_CONFIG);

  /**
   * 音效表：key → 中文名 / 时长 / 同名最小间隔（秒）/ 同名并发上限 / 优先级
   * 优先级 3 = 剧情级（升级 / 首领 / 通关 / 死亡），可突破"帧内发声预算"
   */
  const SFX_TABLE = {
    hit:          { label: '命中',     dur: 0.10, gap: 0.045, max: 3, prio: 1 },
    crit:         { label: '暴击',     dur: 0.22, gap: 0.100, max: 2, prio: 2 },
    'cast:fire':  { label: '施法·火',  dur: 0.24, gap: 0.080, max: 2, prio: 1 },
    'cast:ice':   { label: '施法·冰',  dur: 0.16, gap: 0.080, max: 2, prio: 1 },
    'cast:bolt':  { label: '施法·雷',  dur: 0.16, gap: 0.080, max: 2, prio: 1 },
    'cast:void':  { label: '施法·虚空', dur: 0.42, gap: 0.120, max: 2, prio: 1 },
    'cast:arcane':{ label: '施法·奥术', dur: 0.34, gap: 0.100, max: 2, prio: 1 },
    hurt:         { label: '受击',     dur: 0.16, gap: 0.160, max: 2, prio: 2 },
    guardBreak:   { label: '破防',     dur: 0.26, gap: 0.250, max: 1, prio: 2 },
    execute:      { label: '处决',     dur: 0.52, gap: 0.300, max: 1, prio: 3 },
    pickup:       { label: '拾取',     dur: 0.16, gap: 0.060, max: 3, prio: 0 },
    craft:        { label: '合成',     dur: 0.36, gap: 0.150, max: 2, prio: 1 },
    levelup:      { label: '升级',     dur: 0.55, gap: 1.000, max: 1, prio: 3 },
    boss:         { label: '首领登场', dur: 1.70, gap: 2.000, max: 1, prio: 3 },
    win:          { label: '通关',     dur: 1.50, gap: 2.000, max: 1, prio: 3 },
    death:        { label: '死亡',     dur: 1.40, gap: 2.000, max: 1, prio: 3 }
  };

  /**
   * 兼容别名：方便把主文件现有的 playSfx('fire' / 'fuse' / 'reward') 直接转发过来
   */
  const ALIASES = {
    fire: 'cast:fire', frost: 'cast:ice', ice: 'cast:ice', bolt: 'cast:bolt',
    void: 'cast:void', arcane: 'cast:arcane', heal: 'cast:arcane',
    fuse: 'craft', reward: 'pickup', pick: 'pickup', kill: 'crit'
  };

  /** 运行态：上下文、总线、声部表、统计计数 */
  const S = {
    ctx: null,
    master: null,
    comp: null,
    sfxBus: null,
    musicBus: null,
    enabled: cfg.enabled,
    unlocked: false,
    armed: false,
    voices: [],
    frameVoices: 0,
    budgetResetAt: 0,
    lastByKey: Object.create(null),
    buildAvg: 0,
    stats: {
      played: 0, missed: 0, dropRate: 0, dropVoice: 0, dropBudget: 0,
      lastBuildMs: 0, lastNodes: 0
    },
    music: {
      on: false, startTime: 0, cycle: 0, index: 0, progress: 0, gen: 0,
      seq: [], droneGain: null, nodes: []
    }
  };

  /** 高精度时钟：优先 performance.now，退回 Date.now */
  const clock = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  /** 取调度用的音频时钟：没有上下文时返回 0 */
  function audioNow() {
    return S.ctx ? S.ctx.currentTime : 0;
  }

  /**
   * 深拷贝（配置只有数字和对象，JSON 往返足够）
   * @param {Object} value 源对象
   * @returns {Object} 拷贝
   */
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * 递归合并配置（用于 configure）
   * @param {Object} target 目标
   * @param {Object} patch 补丁
   */
  function merge(target, patch) {
    Object.keys(patch).forEach(function (key) {
      const v = patch[key];
      if (v && typeof v === 'object' && !Array.isArray(v) && target[key] && typeof target[key] === 'object') {
        merge(target[key], v);
      } else if (v !== undefined) {
        target[key] = v;
      }
    });
  }

  /**
   * 读取 URL 参数：?sfx=off / 0 / false 关闭整个模块
   * @returns {boolean} 是否启用
   */
  function readUrlEnabled() {
    try {
      if (typeof location === 'undefined' || typeof URLSearchParams === 'undefined') return true;
      const v = (new URLSearchParams(location.search).get('sfx') || '').toLowerCase();
      return !(v === 'off' || v === '0' || v === 'false');
    } catch (error) {
      return true;
    }
  }

  // URL 关闭优先于默认值（此时连 arm 都不会挂）
  cfg.enabled = DEFAULT_CONFIG.enabled && readUrlEnabled();
  S.enabled = cfg.enabled;

  /**
   * 每个 AudioContext 只造一份 2 秒白噪声（确定性 xorshift，便于复测）
   * @param {AudioContext} ac 上下文
   * @returns {AudioBuffer} 噪声缓冲
   */
  const noiseCache = new WeakMap();
  function noiseBuffer(ac) {
    let buf = noiseCache.get(ac);
    if (buf) return buf;
    const len = Math.floor(ac.sampleRate * 2);
    buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 0x9E3779B9;
    for (let i = 0; i < len; i += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 2147483648 - 1) * 0.9;
    }
    noiseCache.set(ac, buf);
    return buf;
  }

  /**
   * 生成软限幅曲线：0.7 以下完全线性，0.7~1 之间用 tanh 饱和，输出永远 ≤1
   * @param {number} size 采样点数
   * @returns {Float32Array} WaveShaper 用的曲线
   */
  function limiterCurve(size) {
    const curve = new Float32Array(size);
    const knee = 0.7;
    for (let i = 0; i < size; i += 1) {
      const x = (i / (size - 1)) * 2 - 1;
      const a = Math.abs(x);
      const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
      curve[i] = x < 0 ? -y : y;
    }
    return curve;
  }

  /**
   * 建立一条母线：sfxBus / musicBus → master → 压缩器 → 软限幅 → destination
   * @param {AudioContext} ac 上下文
   * @returns {{master: AudioNode, comp: AudioNode|null, sfxBus: AudioNode, musicBus: AudioNode}}
   */
  function makeChain(ac) {
    const master = ac.createGain();
    master.gain.value = cfg.master;
    let tail = master;
    let comp = null;
    // 浏览器都支持 DynamicsCompressorNode，离线上下文同样支持
    if (typeof ac.createDynamicsCompressor === 'function') {
      comp = ac.createDynamicsCompressor();
      comp.threshold.value = cfg.compressor.threshold;
      comp.knee.value = cfg.compressor.knee;
      comp.ratio.value = cfg.compressor.ratio;
      comp.attack.value = cfg.compressor.attack;
      comp.release.value = cfg.compressor.release;
      master.connect(comp);
      tail = comp;
    }
    // 最后一道保险：软限幅，理论上压缩器之后仍可能 >1，这里保证绝不越界
    if (typeof ac.createWaveShaper === 'function') {
      const shaper = ac.createWaveShaper();
      shaper.curve = limiterCurve(2049);
      shaper.oversample = '2x';
      tail.connect(shaper);
      tail = shaper;
    }
    tail.connect(ac.destination);

    const sfxBus = ac.createGain();
    sfxBus.gain.value = cfg.sfxVolume;
    sfxBus.connect(master);

    const musicBus = ac.createGain();
    musicBus.gain.value = 0.0001;   // 配乐从 0 淡入，避免开关时"咔"一声
    musicBus.connect(master);

    return { master: master, comp: comp, sfxBus: sfxBus, musicBus: musicBus };
  }

  /**
   * 建立配乐用的"回声"支路：delay → 低通 → 反馈 → delay，末级接回 musicBus
   * @param {AudioContext} ac 上下文
   * @param {AudioNode} musicBus 配乐总线
   * @returns {AudioNode|null} 送音入延迟的入口节点
   */
  function makeDelaySend(ac, musicBus) {
    if (typeof ac.createDelay !== 'function') return null;
    const delay = ac.createDelay(0.5);
    delay.delayTime.value = cfg.music.delayTime;
    const damp = ac.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 900;
    damp.Q.value = 0.6;
    const feedback = ac.createGain();
    feedback.gain.value = cfg.music.delayFeedback;
    const wet = ac.createGain();
    wet.gain.value = cfg.music.delayWet;
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);     // 反馈环必须经过低通，否则高频越叠越亮
    delay.connect(wet);
    wet.connect(musicBus);
    return delay;
  }

  /**
   * 创建/复用 AudioContext 与总线（不做手势判断，内部用）
   * @returns {AudioContext|null} 上下文
   */
  function ensureContext() {
    if (!S.enabled) return null;
    if (S.ctx) return S.ctx;
    const Ctor = root.AudioContext || root.webkitAudioContext;
    if (!Ctor) return null;
    let ac = null;
    try {
      ac = new Ctor({ latencyHint: 'interactive' });
    } catch (error) {
      try { ac = new Ctor(); } catch (error2) { return null; }
    }
    try {
      const chain = makeChain(ac);
      S.ctx = ac;
      S.master = chain.master;
      S.comp = chain.comp;
      S.sfxBus = chain.sfxBus;
      S.musicBus = chain.musicBus;
      noiseBuffer(ac);                       // 预热噪声，避免第一声卡顿
      S.music.delay = makeDelaySend(ac, S.musicBus);
    } catch (error) {
      return null;
    }
    return ac;
  }

  /**
   * 首次手势解锁：创建或恢复 AudioContext
   * 必须在 pointerdown / keydown / touchstart 回调里调用，否则浏览器会拒绝出声
   * @returns {AudioContext|null} 上下文
   */
  function unlock() {
    if (!S.enabled) return null;
    const ac = ensureContext();
    if (!ac) return null;
    // state 可能是 suspended（自动播放策略）或 running（已解锁）
    if (ac.state === 'suspended' && typeof ac.resume === 'function') {
      try { ac.resume(); } catch (error) { /* 下次手势再试 */ }
    }
    S.unlocked = true;
    return ac;
  }

  /**
   * 挂一次性手势监听：第一次点击/按键自动解锁，成功后自动摘掉监听
   */
  function arm() {
    if (S.armed || !S.enabled) return;
    if (!root.addEventListener) return;
    S.armed = true;
    const onGesture = function () {
      unlock();
      if (S.unlocked) {
        root.removeEventListener('pointerdown', onGesture, true);
        root.removeEventListener('keydown', onGesture, true);
        root.removeEventListener('touchstart', onGesture, true);
      }
    };
    root.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
    root.addEventListener('keydown', onGesture, { capture: true, passive: true });
    root.addEventListener('touchstart', onGesture, { capture: true, passive: true });
  }

  // ------------------------------------------------------------
  // 合成零件：所有音效都由下面四个小函数拼出来
  // ------------------------------------------------------------

  /**
   * 合成一条"音高滑动 + 指数包络"的振荡器音
   * @param {AudioContext} ac 上下文
   * @param {AudioNode} dest 输出目标
   * @param {number} t0 起始绝对时间（AudioContext 秒）
   * @param {Object} o {type, freq, to, dur, gain, attack, pitch, lp}
   * @param {Function} [reg] 节点登记回调（限流占地/回收用）
   * @returns {OscillatorNode} 振荡器
   */
  function toneVoice(ac, dest, t0, o, reg) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const p = o.pitch || 1;
    const dur = Math.max(0.02, o.dur || 0.15);
    const f0 = Math.max(20, (o.freq || 440) * p);
    const f1 = Math.max(20, (o.to || o.freq || 440) * p);
    const atk = Math.min(o.attack == null ? 0.005 : o.attack, dur * 0.5);
    const peak = Math.max(0.0002, o.gain == null ? 0.3 : o.gain);

    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    if (o.lp) {
      // 需要"闷"的音（如虚空）串一级低通
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = o.lp;
      filter.Q.value = 0.7;
      osc.connect(filter);
      filter.connect(gain);
      if (reg) reg(filter);
    } else {
      osc.connect(gain);
    }
    gain.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    if (reg) { reg(osc); reg(gain); }
    return osc;
  }

  /**
   * 合成一段"滤波噪声爆"，用来做颗粒感与金属/风声
   * @param {AudioContext} ac 上下文
   * @param {AudioNode} dest 输出目标
   * @param {number} t0 起始绝对时间
   * @param {Object} o {filter, freq, to, q, dur, gain, attack, slide}
   * @param {Function} [reg] 节点登记回调
   * @returns {AudioBufferSourceNode} 噪声源
   */
  function noiseBurst(ac, dest, t0, o, reg) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac);
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    const dur = Math.max(0.02, o.dur || 0.1);
    const atk = Math.min(o.attack == null ? 0.006 : o.attack, dur * 0.5);
    const peak = Math.max(0.0002, o.gain == null ? 0.2 : o.gain);

    filter.type = o.filter || 'lowpass';
    filter.frequency.setValueAtTime(o.freq || 900, t0);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t0 + (o.slide || dur));
    filter.Q.value = o.q == null ? 0.8 : o.q;

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    // 随机起点：同帧多条噪声不会因同相位而叠成"啪"的一声
    src.start(t0, Math.random() * 1.2, Math.min(1.95, dur + 0.05));
    if (reg) { reg(src); reg(filter); reg(gain); }
    return src;
  }

  // ------------------------------------------------------------
  // 音效配方：每个函数只负责"排节点"，不管限流、不进统计
  // o.vol 是外部音量倍率，o.pitch 是音高倍率
  // ------------------------------------------------------------

  /** 命中：低频闷响 + 中频噪声 */
  function buildHit(ac, dest, t0, o, reg) {
    toneVoice(ac, dest, t0, { type: 'sine', freq: 170, to: 65, dur: 0.10, gain: 0.55 * o.vol, pitch: o.pitch }, reg);
    noiseBurst(ac, dest, t0, { filter: 'bandpass', freq: 1100, q: 1.1, dur: 0.055, gain: 0.28 * o.vol }, reg);
  }

  /** 暴击：更亮的金属扫弦 + 更重的低频 */
  function buildCrit(ac, dest, t0, o, reg) {
    toneVoice(ac, dest, t0, { type: 'sine', freq: 135, to: 48, dur: 0.17, gain: 0.5 * o.vol, pitch: o.pitch }, reg);
    toneVoice(ac, dest, t0 + 0.008, { type: 'triangle', freq: 1250, to: 520, dur: 0.10, gain: 0.26 * o.vol, pitch: o.pitch }, reg);
    noiseBurst(ac, dest, t0, { filter: 'highpass', freq: 2600, dur: 0.07, gain: 0.34 * o.vol }, reg);
  }

  /** 施法·火：低沉的"轰" + 三颗爆裂颗粒 */
  function buildCastFire(ac, dest, t0, o, reg) {
    noiseBurst(ac, dest, t0, { filter: 'lowpass', freq: 900, to: 280, dur: 0.22, gain: 0.30 * o.vol }, reg);
    toneVoice(ac, dest, t0, { type: 'triangle', freq: 320, to: 105, dur: 0.24, gain: 0.34 * o.vol, pitch: o.pitch }, reg);
    for (let i = 0; i < 3; i += 1) {
      noiseBurst(ac, dest, t0 + 0.045 + i * 0.055, { filter: 'bandpass', freq: 1800 + i * 400, q: 1.6, dur: 0.035, gain: 0.11 * o.vol }, reg);
    }
  }

  /** 施法·冰：两级上行晶体音 + 高频沙沙 */
  function buildCastIce(ac, dest, t0, o, reg) {
    toneVoice(ac, dest, t0, { type: 'sine', freq: 980, to: 1350, dur: 0.12, gain: 0.20 * o.vol, pitch: o.pitch }, reg);
    toneVoice(ac, dest, t0 + 0.03, { type: 'sine', freq: 1560, to: 2100, dur: 0.10, gain: 0.12 * o.vol, pitch: o.pitch }, reg);
    noiseBurst(ac, dest, t0, { filter: 'bandpass', freq: 5200, q: 2.0, dur: 0.12, gain: 0.22 * o.vol }, reg);
  }

  /** 施法·雷：四级瞬态电弧 + 短促下滑 */
  function buildCastBolt(ac, dest, t0, o, reg) {
    noiseBurst(ac, dest, t0, { filter: 'highpass', freq: 1800, dur: 0.15, gain: 0.18 * o.vol }, reg);
    toneVoice(ac, dest, t0, { type: 'triangle', freq: 900, to: 380, dur: 0.12, gain: 0.18 * o.vol, pitch: o.pitch }, reg);
    for (let i = 0; i < 4; i += 1) {
      noiseBurst(ac, dest, t0 + i * 0.019, { filter: 'bandpass', freq: 3000 + i * 500, q: 2.4, dur: 0.028, gain: 0.13 * o.vol }, reg);
    }
  }

  /** 施法·虚空：两支近频正弦"拍频" + 极低频噪声（听感像塌陷） */
  function buildCastVoid(ac, dest, t0, o, reg) {
    toneVoice(ac, dest, t0, { type: 'sine', freq: 120, dur: 0.42, gain: 0.18 * o.vol, attack: 0.06, pitch: o.pitch, lp: 400 }, reg);
    toneVoice(ac, dest, t0, { type: 'sine', freq: 123, dur: 0.42, gain: 0.16 * o.vol, attack: 0.06, pitch: o.pitch, lp: 400 }, reg);
    noiseBurst(ac, dest, t0, { filter: 'lowpass', freq: 240, dur: 0.40, gain: 0.16 * o.vol, attack: 0.10 }, reg);
  }

  /** 施法·奥术：钟片双音 + 一点空气声 */
  function buildCastArcane(ac, dest, t0, o, reg) {
    toneVoice(ac, dest, t0, { type: 'sine', freq: 660, dur: 0.30, gain: 0.20 * o.vol, attack: 0.008, pitch: o.pitch }, reg);
    toneVoice(ac, dest, t0 + 0.02, { type: 'sine', freq: 990, dur: 0.25, gain: 0.12 * o.vol, attack: 0.008, pitch: o.pitch }, reg);
    noiseBurst(ac, dest, t0, { filter: 'bandpass', freq: 3000, q: 1.5, dur: 0.12, gain: 0.10 * o.vol }, reg);
  }

  /** 受击：比命中更闷更低，尾巴略长 */
  function buildHurt(ac, dest, t0, o, reg) {
    toneVoice(ac, dest, t0, { type: 'sine', freq: 110, to: 52, dur: 0.16, gain: 0.55 * o.vol, pitch: o.pitch }, reg);
    noiseBurst(ac, dest, t0, { filter: 'lowpass', freq: 480, dur: 0.09, gain: 0.25 * o.vol }, reg);
  }

  /** 破防：金属拍频（两支三角波）+ 高频噪声，听感"硬物裂开" */
  function buildGuardBreak(ac, dest, t0, o, reg) {
    toneVoice(ac, dest, t0, { type: 'triangle', freq: 520, dur: 0.20, gain: 0.26 * o.vol, attack: 0.004, pitch: o.pitch }, reg);
    toneVoice(ac, dest, t0 + 0.010, { type: 'triangle', freq: 760, dur: 0.18, gain: 0.18 * o.vol, attack: 0.004, pitch: o.pitch }, reg);
    noiseBurst(ac, dest, t0, { filter: 'bandpass', freq: 2400, q: 3.0, dur: 0.13, gain: 0.30 * o.vol }, reg);
    toneVoice(ac, dest, t0, { type: 'sine', freq: 80, to: 50, dur: 0.10, gain: 0.20 * o.vol, pitch: o.pitch }, reg);
  }

  /** 处决：前半刀风（上扫噪声），后半重砸（低频下坠 + 噪声） */
  function buildExecute(ac, dest, t0, o, reg) {
    noiseBurst(ac, dest, t0, { filter: 'bandpass', freq: 260, to: 2800, slide: 0.16, dur: 0.18, gain: 0.18 * o.vol, q: 1.2 }, reg);
    toneVoice(ac, dest, t0 + 0.16, { type: 'triangle', freq: 1400, to: 300, dur: 0.08, gain: 0.12 * o.vol, pitch: o.pitch }, reg);
    toneVoice(ac, dest, t0 + 0.17, { type: 'sine', freq: 95, to: 32, dur: 0.30, gain: 0.70 * o.vol, pitch: o.pitch }, reg);
    noiseBurst(ac, dest, t0 + 0.17, { filter: 'lowpass', freq: 700, dur: 0.14, gain: 0.45 * o.vol }, reg);
  }

  /** 拾取：两粒短促上行音 */
  function buildPickup(ac, dest, t0, o, reg) {
    toneVoice(ac, dest, t0, { type: 'sine', freq: 880, to: 1320, dur: 0.09, gain: 0.20 * o.vol, attack: 0.004, pitch: o.pitch }, reg);
    toneVoice(ac, dest, t0 + 0.055, { type: 'sine', freq: 1320, to: 1760, dur: 0.09, gain: 0.14 * o.vol, attack: 0.004, pitch: o.pitch }, reg);
  }

  /** 合成：三音上行琶音 + 一点高频碎屑 */
  function buildCraft(ac, dest, t0, o, reg) {
    const notes = [523.25, 659.25, 783.99];
    for (let i = 0; i < notes.length; i += 1) {
      toneVoice(ac, dest, t0 + i * 0.07, { type: 'sine', freq: notes[i], dur: 0.18, gain: 0.16 * o.vol, attack: 0.006, pitch: o.pitch }, reg);
    }
    noiseBurst(ac, dest, t0 + 0.02, { filter: 'bandpass', freq: 3000, q: 1.8, dur: 0.10, gain: 0.07 * o.vol }, reg);
  }

  /** 升级：四个钟片音阶 + 一层低频托底 */
  function buildLevelUp(ac, dest, t0, o, reg) {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i += 1) {
      toneVoice(ac, dest, t0 + i * 0.09, { type: 'triangle', freq: notes[i], dur: 0.28, gain: 0.18 * o.vol, attack: 0.006, pitch: o.pitch }, reg);
    }
    toneVoice(ac, dest, t0, { type: 'sine', freq: 130, dur: 0.5, gain: 0.08 * o.vol, attack: 0.05, pitch: o.pitch }, reg);
  }

  /** 首领登场：低频锯齿上滑 + 三记闷鼓 + 一段抬升气声 */
  function buildBoss(ac, dest, t0, o, reg) {
    toneVoice(ac, dest, t0, { type: 'sawtooth', freq: 55, to: 80, dur: 1.5, gain: 0.30 * o.vol, attack: 0.12, pitch: o.pitch, lp: 500 }, reg);
    const beats = [0.02, 0.42, 0.82];
    for (let i = 0; i < beats.length; i += 1) {
      toneVoice(ac, dest, t0 + beats[i], { type: 'sine', freq: 70, to: 36, dur: 0.25, gain: 0.5 * o.vol, attack: 0.008, pitch: o.pitch }, reg);
    }
    noiseBurst(ac, dest, t0, { filter: 'bandpass', freq: 300, to: 2400, slide: 1.1, dur: 1.2, gain: 0.18 * o.vol, attack: 0.2, q: 0.8 }, reg);
  }

  /** 通关：五音上行 + 低频托底，比升级更"亮"更长 */
  function buildWin(ac, dest, t0, o, reg) {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (let i = 0; i < notes.length; i += 1) {
      toneVoice(ac, dest, t0 + i * 0.11, { type: 'triangle', freq: notes[i], dur: 0.36, gain: 0.18 * o.vol, attack: 0.006, pitch: o.pitch }, reg);
    }
    toneVoice(ac, dest, t0, { type: 'sine', freq: 262, dur: 0.9, gain: 0.08 * o.vol, attack: 0.08, pitch: o.pitch }, reg);
  }

  /** 死亡：慢速下坠 + 极低频托底 + 渐弱风噪 */
  function buildDeath(ac, dest, t0, o, reg) {
    toneVoice(ac, dest, t0, { type: 'sine', freq: 220, to: 55, dur: 1.25, gain: 0.45 * o.vol, attack: 0.04, pitch: o.pitch }, reg);
    toneVoice(ac, dest, t0, { type: 'sine', freq: 60, dur: 1.3, gain: 0.15 * o.vol, attack: 0.10, pitch: o.pitch, lp: 200 }, reg);
    noiseBurst(ac, dest, t0, { filter: 'lowpass', freq: 300, dur: 1.0, gain: 0.16 * o.vol, attack: 0.12 }, reg);
    toneVoice(ac, dest, t0 + 0.1, { type: 'sine', freq: 880, to: 300, dur: 0.8, gain: 0.06 * o.vol, attack: 0.05, pitch: o.pitch }, reg);
  }

  /** 配方表：key → 构造函数 */
  const BUILD = {
    hit: buildHit,
    crit: buildCrit,
    'cast:fire': buildCastFire,
    'cast:ice': buildCastIce,
    'cast:bolt': buildCastBolt,
    'cast:void': buildCastVoid,
    'cast:arcane': buildCastArcane,
    hurt: buildHurt,
    guardBreak: buildGuardBreak,
    execute: buildExecute,
    pickup: buildPickup,
    craft: buildCraft,
    levelup: buildLevelUp,
    boss: buildBoss,
    win: buildWin,
    death: buildDeath
  };

  /**
   * 把外部传入的音效名解析成表内 key
   * @param {string} name 音效名或别名
   * @param {Object} o 选项（cast 时读 o.element）
   * @returns {string|null} 表内 key，非法返回 null
   */
  function resolveKey(name, o) {
    if (name === 'cast') {
      const el = (o && o.element) || 'arcane';
      const k = 'cast:' + el;
      return SFX_TABLE[k] ? k : 'cast:arcane';
    }
    if (SFX_TABLE[name]) return name;
    const alias = ALIASES[name];
    return alias && SFX_TABLE[alias] ? alias : null;
  }

  /**
   * 立即停掉一条声部（限流抢占 / 关闭总开关时用）
   * @param {Object} voice 声部记录
   */
  function stopVoice(voice) {
    for (let i = 0; i < voice.stops.length; i += 1) {
      try { voice.stops[i].stop(0); } catch (error) { /* 已停止 */ }
    }
    for (let i = 0; i < voice.nodes.length; i += 1) {
      try { voice.nodes[i].disconnect(); } catch (error) { /* 已断开 */ }
    }
  }

  /**
   * 清理已经结束的声部，并把节点断开释放资源
   * @param {number} t 当前 perf 时钟（毫秒）
   */
  function pruneVoices(t) {
    if (!S.voices.length) return;
    const keep = [];
    for (let i = 0; i < S.voices.length; i += 1) {
      const v = S.voices[i];
      if (v.end > t) { keep.push(v); continue; }
      for (let k = 0; k < v.nodes.length; k += 1) {
        try { v.nodes[k].disconnect(); } catch (error) { /* 已断开 */ }
      }
    }
    S.voices = keep;
  }

  /**
   * 播放一个音效（含全部限流）
   * @param {string} name 音效名（hit / crit / cast / hurt / guardBreak / execute / ...）
   * @param {Object} [opts] {volume, pan, rate, element}
   * @returns {boolean} 是否真的排进了 AudioContext
   */
  function play(name, opts) {
    if (!S.enabled) return false;
    const o = opts || {};
    const key = resolveKey(name, o);
    if (!key) return false;
    const meta = SFX_TABLE[key];
    const ac = S.ctx;
    // 上下文还没解锁：直接丢弃，不排队（排队会在解锁瞬间雪崩）
    if (!ac || !S.sfxBus) { S.stats.missed += 1; return false; }

    const t = clock();
    // 主循环忘了调 update 时的自救：预算按 25ms 自动复位
    if (t - S.budgetResetAt > cfg.budgetIdleResetMs) {
      S.frameVoices = 0;
      S.budgetResetAt = t;
    }
    pruneVoices(t);

    // 第 1 层：同名最小间隔
    const gapMs = meta.gap * 1000;
    if (t - (S.lastByKey[key] || -1e9) < gapMs) { S.stats.dropRate += 1; return false; }

    // 第 2 层：同名并发上限（超出直接丢，不做抢占，避免声音被"切断"）
    let same = 0;
    for (let i = 0; i < S.voices.length; i += 1) {
      if (S.voices[i].key === key) same += 1;
    }
    if (same >= meta.max) { S.stats.dropVoice += 1; return false; }

    // 第 3 层：全局并发上限（只允许被"更高优先级"挤掉最老的一条）
    if (S.voices.length >= cfg.maxVoices) {
      let victim = -1;
      for (let i = 0; i < S.voices.length; i += 1) {
        if (S.voices[i].prio <= meta.prio - 1) { victim = i; break; }
      }
      if (victim < 0) { S.stats.dropVoice += 1; return false; }
      stopVoice(S.voices[victim]);
      S.voices.splice(victim, 1);
    }

    // 第 4 层：帧内发声预算（剧情级音效 prio=3 可突破）
    if (S.frameVoices >= cfg.frameVoiceBudget && meta.prio < 3) {
      S.stats.dropBudget += 1;
      return false;
    }
    S.frameVoices += 1;
    S.lastByKey[key] = t;

    const vol = o.volume == null ? 1 : Math.max(0, Math.min(2, o.volume));
    const pitch = o.rate == null ? 1 : Math.max(0.5, Math.min(2.5, o.rate));
    const t0 = ac.currentTime + 0.012;
    const voice = {
      key: key,
      prio: meta.prio,
      // 用 perf 时钟记结束点：不依赖音频时钟，headless 也能正确回收
      end: t + Math.min(meta.dur, cfg.voiceMaxLifeMs / 1000) * 1000 + 60,
      nodes: [],
      stops: []
    };
    const reg = function (node) {
      if (!node) return;
      voice.nodes.push(node);
      if (typeof node.start === 'function' && typeof node.stop === 'function') voice.stops.push(node);
    };

    let dest = S.sfxBus;
    if (o.pan && typeof ac.createStereoPanner === 'function') {
      const panner = ac.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, o.pan));
      panner.connect(S.sfxBus);
      dest = panner;
      reg(panner);
    }

    const b0 = clock();
    BUILD[key](ac, dest, t0, { vol: vol, pitch: pitch }, reg);
    S.stats.lastBuildMs = clock() - b0;
    S.buildAvg = S.buildAvg ? S.buildAvg * 0.9 + S.stats.lastBuildMs * 0.1 : S.stats.lastBuildMs;

    S.voices.push(voice);
    S.stats.played += 1;
    S.stats.lastNodes = voice.nodes.length;
    return true;
  }

  // ------------------------------------------------------------
  // 配乐：持续铺底（永不重启）+ 稀疏点缀（绝对时间排程）
  // ------------------------------------------------------------

  /**
   * 固定种子的伪随机数发生器（每圈音符完全一致）
   * @param {number} a 种子
   * @returns {Function} 返回 0~1 的函数
   */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 生成一圈的点缀音符：五声音阶、相邻跳跃、最后一个音至少提前 2.5 秒收尾
   * @param {number} loop 循环长度（秒）
   * @returns {Array<{t:number, f:number, g:number}>} 音符表
   */
  function buildSequence(loop) {
    const rnd = mulberry32(0x5EED26);
    const notes = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    const out = [];
    let at = 1.0;
    let idx = 2;
    while (at < loop - 2.5) {
      const step = (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2));
      idx = Math.max(0, Math.min(notes.length - 1, idx + step));
      out.push({ t: Math.round(at * 1000) / 1000, f: notes[idx], g: 0.75 + rnd() * 0.4 });
      at += 1.7 + rnd() * 2.1;
    }
    return out;
  }

  /**
   * 建立持续铺底：三支振荡器 + 慢速滤波 LFO + 幅度呼吸，全程只 start 一次
   * @param {AudioContext} ac 上下文
   * @param {number} t0 起始时间
   */
  function buildDrone(ac, t0) {
    const m = S.music;
    stopDrone();
    const bus = S.musicBus;
    if (!bus) return;

    const toneFilter = ac.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 900;
    toneFilter.Q.value = 0.6;

    const droneGain = ac.createGain();
    droneGain.gain.setValueAtTime(0.0001, ac.currentTime);
    droneGain.gain.exponentialRampToValueAtTime(cfg.music.droneGain, t0 + cfg.music.droneFade);
    toneFilter.connect(droneGain);
    droneGain.connect(bus);

    const parts = [
      { type: 'sine', f: 55, g: 0.55 },
      { type: 'sine', f: 82.5, g: 0.28 },
      { type: 'triangle', f: 110, g: 0.10 }
    ];
    parts.forEach(function (part) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = part.type;
      osc.frequency.value = part.f;
      gain.gain.value = part.g;
      osc.connect(gain);
      gain.connect(toneFilter);
      osc.start(t0);
      m.nodes.push(osc);
      m.nodes.push(gain);
    });

    // 滤波呼吸：0.05Hz，±260Hz，听感像"雾气在动"
    const lfo = ac.createOscillator();
    const lfoDepth = ac.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05;
    lfoDepth.gain.value = 260;
    lfo.connect(lfoDepth);
    lfoDepth.connect(toneFilter.frequency);
    lfo.start(t0);

    // 幅度呼吸：0.07Hz，±0.12（叠加在 0.5 的目标音量上）
    const breath = ac.createOscillator();
    const breathDepth = ac.createGain();
    breath.type = 'sine';
    breath.frequency.value = 0.07;
    breathDepth.gain.value = 0.12;
    breath.connect(breathDepth);
    breathDepth.connect(droneGain.gain);
    breath.start(t0);

    m.nodes.push(lfo); m.nodes.push(lfoDepth); m.nodes.push(breath); m.nodes.push(breathDepth);
    m.droneGain = droneGain;
    m.toneFilter = toneFilter;
  }

  /**
   * 停掉铺底的全部节点
   */
  function stopDrone() {
    const m = S.music;
    for (let i = 0; i < m.nodes.length; i += 1) {
      const n = m.nodes[i];
      try { if (typeof n.stop === 'function') n.stop(0); } catch (error) { /* 已停止 */ }
      try { n.disconnect(); } catch (error) { /* 已断开 */ }
    }
    m.nodes = [];
    m.droneGain = null;
    m.toneFilter = null;
  }

  /**
   * 排一条点缀音：三角波主音 + 五度副音，直连总线和延迟支路
   * @param {AudioContext} ac 上下文
   * @param {{f:number,g:number}} note 音符
   * @param {number} when 绝对时间
   */
  function scheduleMusicNote(ac, note, when) {
    const bus = S.musicBus;
    if (!bus) return;
    const baseGain = cfg.music.noteGain * note.g * 0.9;
    const pitches = [
      { f: note.f, g: 1.0 },
      { f: note.f * 1.5, g: 0.35 }
    ];
    pitches.forEach(function (p) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = p.f;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, baseGain * p.g), when + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.55);
      osc.connect(gain);
      gain.connect(bus);
      if (S.music.delay) gain.connect(S.music.delay);
      osc.start(when);
      osc.stop(when + 0.6);
    });
  }

  /**
   * 配乐调度：以 AudioContext.currentTime 为唯一时钟，前瞻窗口跨过循环点继续累加
   */
  function musicTick() {
    const ac = S.ctx;
    const m = S.music;
    if (!ac || !m.on || !m.seq.length) return;
    const loop = cfg.music.loop;
    const horizon = ac.currentTime + cfg.music.lookahead;
    let guard = 0;
    while (guard < 40) {
      guard += 1;
      const abs = m.startTime + m.cycle * loop + m.seq[m.index].t;
      if (abs >= horizon) break;
      scheduleMusicNote(ac, m.seq[m.index], abs);
      m.index += 1;
      if (m.index >= m.seq.length) { m.index = 0; m.cycle += 1; }
    }
    const elapsed = ac.currentTime - m.startTime;
    m.progress = ((elapsed % loop) + loop) % loop;
  }

  /**
   * 开始配乐（可重复调用，已在播就直接返回）
   * @returns {boolean} 是否在播
   */
  function musicOn() {
    if (!S.enabled) return false;
    const ac = unlock();
    if (!ac || !S.musicBus) return false;
    const m = S.music;
    if (m.on) return true;
    m.on = true;
    m.gen += 1;                        // 代数 +1：作废之前 musicOff 留下的延迟停铺底
    m.startTime = ac.currentTime + 0.15;
    m.cycle = 0;
    m.index = 0;
    m.progress = 0;
    m.seq = buildSequence(cfg.music.loop);
    buildDrone(ac, m.startTime);
    S.musicBus.gain.cancelScheduledValues(ac.currentTime);
    S.musicBus.gain.setTargetAtTime(cfg.musicVolume, ac.currentTime, cfg.music.droneFade / 3);
    return true;
  }

  /**
   * 停止配乐：总线淡出，0.65 秒后停掉铺底节点
   * @returns {boolean} 停止前是否在播
   */
  function musicOff() {
    const m = S.music;
    if (!m.on) return false;
    m.on = false;
    m.progress = 0;
    const gen = (m.gen += 1);
    const ac = S.ctx;
    if (ac && S.musicBus) {
      S.musicBus.gain.cancelScheduledValues(ac.currentTime);
      S.musicBus.gain.setTargetAtTime(0.0001, ac.currentTime, 0.15);
      // 650ms 后停铺底；若这期间又 musicOn（代数已变），就跳过，避免杀掉新铺底
      setTimeout(function () {
        if (S.music.gen === gen) stopDrone();
      }, 650);
    } else {
      stopDrone();
    }
    return true;
  }

  /**
   * 配乐状态快照（demo 进度条用）
   * @returns {Object} 状态
   */
  function musicInfo() {
    const m = S.music;
    return {
      on: m.on,
      loop: cfg.music.loop,
      progress: m.on ? m.progress : 0,
      cycle: m.cycle,
      index: m.index,
      notes: m.seq.length,
      drone: m.droneGain != null,
      volume: cfg.musicVolume
    };
  }

  // ------------------------------------------------------------
  // 对外接口
  // ------------------------------------------------------------

  /**
   * 每帧调用一次：清理结束声部 + 复位帧预算 + 推进配乐调度
   * @param {number} dt 帧间隔（秒），当前只作接口保留
   */
  function update(dt) {
    const t = clock();
    S.budgetResetAt = t;
    S.frameVoices = 0;
    if (!S.ctx) return;
    pruneVoices(t);
    if (S.music.on) musicTick();
  }

  /**
   * 开关总音效
   * @param {boolean} on 是否开启
   * @returns {boolean} 当前状态
   */
  function setEnabled(on) {
    S.enabled = !!on;
    if (!S.enabled) {
      musicOff();
      stopAll();
      if (S.master) S.master.gain.value = 0;
    } else if (S.master) {
      S.master.gain.value = cfg.master;
      if (S.unlocked) unlock();
      arm();
    }
    return S.enabled;
  }

  /**
   * 立即停掉所有音效声部（不影响配乐）
   */
  function stopAll() {
    for (let i = 0; i < S.voices.length; i += 1) stopVoice(S.voices[i]);
    S.voices.length = 0;
  }

  /**
   * 调整总线音量
   * @param {Object} v {sfx?, music?}
   */
  function setVolumes(v) {
    if (!v) return;
    if (v.sfx != null) {
      cfg.sfxVolume = Math.max(0, Math.min(2, v.sfx));
      if (S.sfxBus) S.sfxBus.gain.value = cfg.sfxVolume;
    }
    if (v.music != null) {
      cfg.musicVolume = Math.max(0, Math.min(2, v.music));
      if (S.musicBus && S.music.on) S.musicBus.gain.setTargetAtTime(cfg.musicVolume, audioNow(), 0.2);
    }
  }

  /**
   * 运行时修改配置（含总开关与音量热更新）
   * @param {Object} patch 补丁
   * @returns {Object} 合并后的配置
   */
  function configure(patch) {
    if (!patch) return cfg;
    const nextEnabled = patch.enabled != null ? !!patch.enabled : null;
    merge(cfg, patch);
    if (nextEnabled != null) setEnabled(nextEnabled);
    if (S.master) S.master.gain.value = cfg.master;
    if (S.sfxBus) S.sfxBus.gain.value = cfg.sfxVolume;
    return cfg;
  }

  /**
   * 清空统计与限频记忆（基准测试用）
   */
  function reset() {
    S.lastByKey = Object.create(null);
    S.stats.played = 0;
    S.stats.missed = 0;
    S.stats.dropRate = 0;
    S.stats.dropVoice = 0;
    S.stats.dropBudget = 0;
    S.stats.lastBuildMs = 0;
    S.stats.lastNodes = 0;
    S.buildAvg = 0;
    S.frameVoices = 0;
  }

  /**
   * 低层构造：只排节点，不经过任何限流与统计（基准/离线渲染用）
   * @param {AudioContext} ac 任意上下文（可离线）
   * @param {AudioNode} dest 输出目标
   * @param {string} key 表内 key
   * @param {number} t0 起始时间
   * @param {Object} [opts] {volume, rate}
   * @returns {number} 本次创建的节点数
   */
  function buildOn(ac, dest, key, t0, opts) {
    if (!ac || !dest || !BUILD[key]) return 0;
    let count = 0;
    const o = opts || {};
    BUILD[key](ac, dest, t0 == null ? ac.currentTime : t0, {
      vol: o.volume == null ? 1 : o.volume,
      pitch: o.rate || 1
    }, function () { count += 1; });
    return count;
  }

  /**
   * 离线自检：逐条音效与"20 条并发命中"各渲染一次，量出峰值与 RMS
   * 用来在无声环境下验证"合成真的出东西、且不会超过 0dBFS"
   * @returns {Promise<Object>} {ok, items, stress}
   */
  function offlineCheck() {
    const Ctor = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Ctor) return Promise.resolve({ ok: false, reason: '当前环境没有 OfflineAudioContext' });
    const keys = Object.keys(SFX_TABLE);
    const sr = 44100;
    const seconds = 2.4;
    const frames = Math.floor(sr * seconds);
    const items = [];

    /**
     * 渲染一次并把峰值/RMS 算出来
     * @param {string|null} onlyKey 单条音效 key（null 表示压力测试）
     * @returns {Promise<Object|null>} 结果
     */
    function renderOne(onlyKey) {
      return new Promise(function (resolve) {
        let ac = null;
        try { ac = new Ctor(1, frames, sr); } catch (error) { resolve(null); return; }
        const chain = makeChain(ac);
        try {
          if (onlyKey) {
            buildOn(ac, chain.sfxBus, onlyKey, 0.05, {});
          } else {
            // 故意绕过并发上限：同一时刻 20 条命中，验证压缩器是否压得住
            for (let i = 0; i < 20; i += 1) buildOn(ac, chain.sfxBus, 'hit', 0.05, {});
          }
        } catch (error) { resolve(null); return; }
        ac.startRendering().then(function (buffer) {
          const data = buffer.getChannelData(0);
          let peak = 0;
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            const v = data[i];
            const a = v < 0 ? -v : v;
            if (a > peak) peak = a;
            sum += v * v;
          }
          resolve({ peak: peak, rms: Math.sqrt(sum / data.length) });
        }).catch(function () { resolve(null); });
      });
    }

    // 串行渲染，避免同时开十几个上下文把主线程打满
    let chain = Promise.resolve();
    keys.forEach(function (key) {
      chain = chain.then(function () {
        return renderOne(key).then(function (r) {
          if (r) {
            items.push({
              key: key,
              label: SFX_TABLE[key].label,
              peak: r.peak,
              rms: r.rms,
              dur: SFX_TABLE[key].dur
            });
          }
        });
      });
    });
    return chain.then(function () {
      return renderOne(null);
    }).then(function (stress) {
      return { ok: true, sampleRate: sr, seconds: seconds, items: items, stress: stress || null };
    });
  }

  /**
   * 取可试听音效清单
   * @returns {Array<Object>} 列表
   */
  function list() {
    return Object.keys(SFX_TABLE).map(function (key) {
      const m = SFX_TABLE[key];
      return { key: key, label: m.label, dur: m.dur, gap: m.gap, max: m.max, prio: m.prio };
    });
  }

  /**
   * 统计快照
   * @returns {Object} 统计
   */
  function stats() {
    return {
      version: VERSION,
      enabled: S.enabled,
      unlocked: S.unlocked,
      ctxState: S.ctx ? S.ctx.state : 'none',
      active: S.voices.length,
      played: S.stats.played,
      missed: S.stats.missed,
      dropRate: S.stats.dropRate,
      dropVoice: S.stats.dropVoice,
      dropBudget: S.stats.dropBudget,
      frameVoices: S.frameVoices,
      lastBuildMs: S.stats.lastBuildMs,
      buildAvgMs: S.buildAvg,
      lastNodes: S.stats.lastNodes,
      music: musicInfo()
    };
  }

  /** 对外导出的接口对象 */
  const API = {
    version: VERSION,
    config: cfg,
    list: list,
    stats: stats,
    play: play,
    cast: function (element, opts) {
      const o = opts || {};
      o.element = element || 'arcane';
      return play('cast', o);
    },
    update: update,
    unlock: unlock,
    arm: arm,
    configure: configure,
    setEnabled: setEnabled,
    setVolumes: setVolumes,
    stopAll: stopAll,
    musicOn: musicOn,
    musicOff: musicOff,
    toggleMusic: function () { return S.music.on ? !musicOff() : musicOn(); },
    musicInfo: musicInfo,
    reset: reset,
    buildOn: buildOn,
    offlineCheck: offlineCheck
  };

  root.AshSFX = API;

  // 自动挂手势监听（?sfx=off 时 S.enabled 已是 false，arm 直接返回）
  if (S.enabled) arm();
}(typeof window !== 'undefined' ? window : globalThis));
