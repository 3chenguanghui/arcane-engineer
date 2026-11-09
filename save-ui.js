/* ============================================================
   烬 · 存档界面体验 v1.0 · save-ui.js
   ------------------------------------------------------------
   职责：
     1) 三槽存档管理：楼层 / 结晶 / 用时 / 保存时间 / 自动档标记；
     2) 导出（剪贴板 + 下载）与导入（粘贴 + 选文件 + 校验预览）；
     3) 覆盖 / 删除二次确认，确认按钮不抢默认焦点；
     4) 单槽损坏兜底：显示「该槽不可用」，允许只清该槽，不白屏；
     5) 覆盖 / 删除前自动留一份备份，可撤销一次。
   依赖：0（不引库、不请求网络）；可在 file:// 双击打开。
   关闭：URL 带 ?saveui=off 时本模块完全不挂载。
   ============================================================ */
(function (global) {
  'use strict';

  /* 防止同一页面被重复注入两次 */
  if (global.JJSAVE && global.JJSAVE.__loaded) return;

  var VERSION = '1.0.0';

  /* ------------------------------------------------------------
     配置区：需要调参时只改这里，不要在逻辑里散落裸值
     ------------------------------------------------------------ */
  var CFG = {
    storageKey: 'arcane_run_slots_v1', // 与主文件 SAVE_SLOTS_CONFIG.key 一致
    saveVersion: 2,                    // 与主文件 SAVE_SLOTS_CONFIG.version 一致
    slotCount: 3,
    backupKey: 'jjsv_last_backup_v1',  // 覆盖 / 删除前的单次备份键
    toastMs: 2600,
    timeTickMs: 30000,
    launcher: true,                    // 是否显示游戏内悬浮入口
    hotkey: 'F8'                       // 全局开关热键
  };

  /* 外部可选配置：只在明确传参时覆盖，避免默认值被误改 */
  var userCfg = global.JJSAVE_CONFIG;
  if (userCfg && typeof userCfg === 'object') {
    if (userCfg.launcher !== undefined) CFG.launcher = !!userCfg.launcher;
    if (userCfg.toastMs !== undefined) CFG.toastMs = Math.max(800, Number(userCfg.toastMs) || CFG.toastMs);
    if (userCfg.timeTickMs !== undefined) CFG.timeTickMs = Math.max(5000, Number(userCfg.timeTickMs) || CFG.timeTickMs);
    if (typeof userCfg.hotkey === 'string' && userCfg.hotkey) CFG.hotkey = userCfg.hotkey;
  }

  /* ?saveui=off：整模块静默退出，只留一个 enabled=false 的空壳供页面判断 */
  var QUERY_OFF = /(?:^|[?&])saveui=(?:off|0)(?:&|$)/i.test(global.location.search);
  if (QUERY_OFF) {
    global.JJSAVE = {
      __loaded: true,
      version: VERSION,
      enabled: false,
      open: function () { return false; },
      close: function () { return false; },
      isOpen: function () { return false; },
      api: {}
    };
    return;
  }

  /* ------------------------------------------------------------
     通用工具：转义 / 校验和 / 时间 / 体积
     ------------------------------------------------------------ */

  /**
   * 把任意值转成可安全拼进 innerHTML 的文本
   * @param {*} value 任意值
   * @returns {string} 转义后的字符串
   */
  function esc(value) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) { return map[ch]; });
  }

  /**
   * 两位数补零
   * @param {number} n 数字
   * @returns {string}
   */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * 与主文件 hashSeedString 完全一致的 FNV-1a 32 位校验和
   * @param {string} text 待校验文本
   * @returns {string} 8 位十六进制
   */
  function fnvChecksum(text) {
    var h = 2166136261 >>> 0;
    var str = String(text);
    for (var i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * 字节数转可读文案
   * @param {number} n 字节
   * @returns {string} 例：12.4 KB
   */
  function fmtBytes(n) {
    var v = Math.max(0, Number(n) || 0);
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / 1024 / 1024).toFixed(2) + ' MB';
  }

  /**
   * 秒数格式化为 m:ss（超过 1 小时为 h:mm:ss）
   * @param {number} seconds 秒
   * @returns {string}
   */
  function fmtDuration(seconds) {
    var total = Math.max(0, Math.round(Number(seconds) || 0));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }

  /**
   * 相对时间（配合 30 秒自动刷新）
   * @param {number} ts 时间戳
   * @returns {string} 例：3 分钟前
   */
  function fmtRel(ts) {
    var t = Number(ts) || 0;
    if (!t) return '尚未保存';
    var diff = Math.max(0, Date.now() - t);
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    return Math.floor(diff / 604800000) + ' 周前';
  }

  /**
   * 绝对时间：今天 14:32 / 昨天 14:32 / 2026-11-01 14:32
   * @param {number} ts 时间戳
   * @returns {string}
   */
  function fmtAbs(ts) {
    var t = Number(ts) || 0;
    if (!t) return '';
    var d = new Date(t);
    var now = new Date();
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    var yst = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (sameDay) return '今天 ' + hm;
    if (d.getFullYear() === yst.getFullYear() && d.getMonth() === yst.getMonth() && d.getDate() === yst.getDate()) {
      return '昨天 ' + hm;
    }
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + hm;
  }

  /**
   * 难度 id 转中文标签
   * @param {string} id easy / normal / nightmare
   * @returns {string}
   */
  function diffLabel(id) {
    var map = { easy: '简单', normal: '普通', nightmare: '噩梦' };
    return map[id] || (id ? String(id) : '普通');
  }

  /**
   * 保存原因分类：自动档 / 手动档 / 导入
   * @param {string} reason 主文件写入的 reason
   * @returns {{type:string, label:string}}
   */
  function reasonMeta(reason) {
    var key = String(reason || '');
    if (key === 'import') return { type: 'import', label: '导入档' };
    if (key === 'manual' || key === 'copy') return { type: 'manual', label: '手动档' };
    if (key === 'floor') return { type: 'auto', label: '自动档 · 换层' };
    if (key === 'loot') return { type: 'auto', label: '自动档 · 拾取' };
    if (key === 'event') return { type: 'auto', label: '自动档 · 事件' };
    if (key === 'exit') return { type: 'auto', label: '自动档 · 退出' };
    if (key === 'ascend') return { type: 'auto', label: '自动档 · 进阶' };
    if (!key) return { type: 'manual', label: '手动档' };
    return { type: 'auto', label: '自动档 · ' + key };
  }

  /* ------------------------------------------------------------
     内联图标：24×24 视口，零外部请求、无 emoji
     ------------------------------------------------------------ */
  var ICONS = {
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 2"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8.4" y="4" width="11.6" height="14" rx="2"/><path d="M15.6 20H6a2 2 0 0 1-2-2V8.4"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v10.4M8 11l4 4 4-4"/><path d="M4 18.4h16"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M12 20V9.6M8 13.4l4-4 4 4"/><path d="M4 5.6h16"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8.4 4v5.2h6.2V4M8.4 20v-5.6h7.2V20"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 3.6l8.4 15.8H3.6z"/><path d="M12 9v4.6M12 16.8v.2"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M4.8 12.6l4.6 4.6L19.2 7.4"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M6 3.6h8l4 4v12.8H6z"/><path d="M14 3.6v4h4"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9.4 6.4L5 10.8l4.4 4.4"/><path d="M5 10.8h8.4a5.4 5.4 0 0 1 0 10.8H8"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M19.4 9.2A7.8 7.8 0 1 0 20 14"/><path d="M19.6 4.6v4.8h-4.8"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3.4L19 6v5.6c0 4.4-3 7.3-7 9-4-1.7-7-4.6-7-9V6z"/><path d="M9 12.2l2 2 4-4.4"/></svg>'
  };

  /**
   * 生成一个带尺寸的内联图标
   * @param {string} name ICONS 里的键
   * @param {number} [size] 像素尺寸，默认 14
   * @returns {string} HTML 字符串
   */
  function icon(name, size) {
    var s = Number(size) || 14;
    return '<span class="jjsv-icon" style="width:' + s + 'px;height:' + s + 'px" aria-hidden="true">'
      + (ICONS[name] || '') + '</span>';
  }

  /* ------------------------------------------------------------
     存储解析：完全复刻主文件 v2 槽位结构
     ------------------------------------------------------------ */
  var runtime = {
    adapter: null,
    open: false,
    view: 'slots',      // slots / export / import
    exportSlot: 0,
    importSlot: 0,
    importText: '',
    importResult: null,
    confirm: null,
    lastFocus: null,
    root: null,
    toastTimer: null,
    tickTimer: null,
    bound: false
  };

  /**
   * 读原始存储文本（优先走适配器，失败一律返回空串，不抛异常）
   * @returns {string}
   */
  function readRawText() {
    try {
      return String(runtime.adapter ? runtime.adapter.raw() : '') || '';
    } catch (error) {
      return '';
    }
  }

  /**
   * 写原始存储文本
   * @param {string} text JSON 文本
   * @returns {{ok:boolean, error?:string}}
   */
  function writeRawText(text) {
    try {
      var ok = runtime.adapter ? runtime.adapter.writeRaw(String(text)) : false;
      return ok ? { ok: true } : { ok: false, error: 'write' };
    } catch (error) {
      return { ok: false, error: 'write' };
    }
  }

  /**
   * 解析槽位存储：空 / 正常 / 版本不符 / 整体不可读四种状态
   * @param {string} raw 原始文本
   * @returns {{state:string, version?:number, slots:Object, error?:string}}
   */
  function parseStore(raw) {
    if (!raw) return { state: 'empty', slots: {} };
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { state: 'unreadable', slots: {}, error: error && error.message ? error.message : 'json' };
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.slots || typeof parsed.slots !== 'object') {
      return { state: 'unreadable', slots: {} };
    }
    if (Number(parsed.version) !== CFG.saveVersion) {
      return { state: 'version', version: Number(parsed.version) || 0, slots: parsed.slots };
    }
    return { state: 'ok', slots: parsed.slots };
  }

  /**
   * 从存档 data 里抽出一屏可读摘要（缺字段全部兜底，不因坏档报错）
   * @param {Object} data 存档 data
   * @returns {Object} floor / crystals / elapsed / hp / difficulty / ascension / seed / rooms / bytes
   */
  function summarize(data) {
    var src = (data && typeof data === 'object') ? data : {};
    var player = src.player && typeof src.player === 'object' ? src.player : {};
    var hp = Math.max(0, Math.round(Number(player.hp) || 0));
    var hpMax = Math.max(0, Math.round(Number(player.hpMax) || 0));
    return {
      floor: Math.max(1, Math.floor(Number(src.floor) || 1)),
      crystals: Math.max(0, Math.floor(Number(src.crystalsEarned) || 0)),
      elapsed: Math.max(0, Number(src.elapsed) || 0),
      hp: hp,
      hpMax: hpMax,
      difficulty: diffLabel(src.difficulty),
      ascension: Math.max(0, Math.floor(Number(src.ascension) || 0)),
      seed: src.seedInfo && src.seedInfo.value ? String(src.seedInfo.value) : '',
      rooms: Array.isArray(src.rooms) ? src.rooms.length : 0,
      bytes: (function () {
        try { return JSON.stringify(src).length; } catch (error) { return 0; }
      })()
    };
  }

  /**
   * 检查单个槽：空 / 正常 / 损坏（版本、结构、校验和）
   * @param {number} slot 槽号 1–3
   * @param {Object} entry 槽条目
   * @param {string} storeState parseStore 的状态
   * @returns {Object} 槽视图模型
   */
  function inspectSlot(slot, entry, storeState) {
    var base = { slot: slot, state: 'empty', reason: '', tag: reasonMeta(''), savedAt: 0, checksum: '', summary: null, error: '', expect: '', actual: '' };
    if (storeState === 'unreadable') {
      base.state = 'corrupt';
      base.error = 'unreadable';
      return base;
    }
    if (!entry) return base;
    if (storeState === 'version') {
      base.state = 'corrupt';
      base.error = 'version';
      base.expect = 'v' + CFG.saveVersion;
      base.actual = 'v' + (Number(parseStore(readRawText()).version) || 0);
      return base;
    }
    if (typeof entry !== 'object' || !entry.data) {
      base.state = 'corrupt';
      base.error = 'structure';
      return base;
    }
    var dataText;
    try {
      dataText = JSON.stringify(entry.data);
    } catch (error) {
      base.state = 'corrupt';
      base.error = 'structure';
      return base;
    }
    if (!Array.isArray(entry.data.rooms) || !entry.data.rooms.length) {
      base.state = 'corrupt';
      base.error = 'structure';
      base.expect = 'rooms ≥ 1';
      base.actual = 'rooms = ' + (Array.isArray(entry.data.rooms) ? 0 : '缺失');
      return base;
    }
    var actualSum = fnvChecksum(dataText);
    var expectSum = String(entry.checksum || '');
    if (actualSum !== expectSum) {
      base.state = 'corrupt';
      base.error = 'checksum';
      base.expect = expectSum || '（缺失）';
      base.actual = actualSum;
      base.summary = summarize(entry.data);
      return base;
    }
    base.state = 'ok';
    base.reason = String(entry.reason || '');
    base.tag = reasonMeta(entry.reason);
    base.savedAt = Number(entry.savedAt) || 0;
    base.checksum = actualSum;
    base.summary = summarize(entry.data);
    base.entry = entry;
    return base;
  }

  /**
   * 读出三槽视图模型 + 存储整体状态
   * @returns {{store:string, version:number, slots:Array, raw:string, bytes:number, latest:number}}
   */
  function readSlots() {
    var raw = readRawText();
    var store = parseStore(raw);
    var slots = [];
    var latest = 0;
    var latestAt = -1;
    for (var i = 1; i <= CFG.slotCount; i += 1) {
      var item = inspectSlot(i, store.slots[String(i)], store.state);
      slots.push(item);
      if (item.state === 'ok' && item.savedAt > latestAt) {
        latestAt = item.savedAt;
        latest = i;
      }
    }
    return {
      store: store.state,
      version: Number(store.version) || 0,
      slots: slots,
      raw: raw,
      bytes: raw.length,
      latest: latest
    };
  }

  /**
   * 生成单槽导出文本（字段与主文件 exportRunSlot 完全一致）
   * @param {number} slot 槽号
   * @returns {{ok:boolean, text?:string, checksum?:string, summary?:Object, error?:string}}
   */
  function buildExportText(slot) {
    var info = readSlots();
    var item = info.slots[Math.max(0, Number(slot) - 1)];
    if (!item || item.state === 'empty') return { ok: false, error: 'empty' };
    if (item.state === 'corrupt') return { ok: false, error: item.error || 'corrupt', message: item.error };
    var entry = item.entry;
    var text = JSON.stringify({
      kind: 'arcane-run-slot',
      version: CFG.saveVersion,
      gameVersion: (entry.data && entry.data.gameVersion) || 'unknown',
      checksum: entry.checksum,
      savedAt: entry.savedAt,
      data: entry.data
    });
    return { ok: true, text: text, checksum: String(entry.checksum || ''), summary: item.summary };
  }

  /**
   * 导入前校验：把失败原因拆成 版本 / 结构 / 校验和 / JSON / 类型 五类
   * @param {string} input 用户粘贴或选文件的文本
   * @returns {{ok:boolean, code:string, title:string, hint:string, expect?:string, actual?:string, summary?:Object, parsed?:Object}}
   */
  function validateText(input) {
    var text = String(input == null ? '' : input).replace(/^\uFEFF/, '').trim();
    if (!text) {
      return { ok: false, code: 'empty', title: '没有内容', hint: '先粘贴导出的存档文本，或选择一个 .txt / .json 文件。' };
    }
    if (text.length > 4000000) {
      return { ok: false, code: 'too-big', title: '文本过大', hint: '这段文本超过 4 MB，不像单局存档；请确认复制完整且没有混入其它内容。' };
    }
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return {
        ok: false, code: 'parse', title: 'JSON 无法解析',
        hint: '文本不是合法 JSON：可能少复制了结尾的大括号或引号。',
        actual: error && error.message ? String(error.message).slice(0, 120) : 'parse error'
      };
    }
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'arcane-run-slot') {
      return { ok: false, code: 'kind', title: '不是本游戏存档', hint: '缺少 kind = arcane-run-slot；请从本游戏导出的文本里复制。', actual: String(parsed && parsed.kind || '（缺失）') };
    }
    if (Number(parsed.version) !== CFG.saveVersion) {
      return {
        ok: false, code: 'version', title: '版本不匹配',
        hint: '这份存档来自别的版本，直接导入会被主文件拒绝。',
        expect: 'v' + CFG.saveVersion, actual: 'v' + (Number(parsed.version) || 0)
      };
    }
    if (!parsed.data || typeof parsed.data !== 'object' || !Array.isArray(parsed.data.rooms) || !parsed.data.rooms.length) {
      return {
        ok: false, code: 'structure', title: '数据结构不完整',
        hint: '缺少楼层 / 房间数组；文本可能被截断，或不是完整的一局快照。',
        expect: 'rooms ≥ 1', actual: Array.isArray(parsed.data && parsed.data.rooms) ? 'rooms = 0' : 'rooms 缺失'
      };
    }
    var actualSum = fnvChecksum(JSON.stringify(parsed.data));
    var expectSum = String(parsed.checksum || '');
    if (actualSum !== expectSum) {
      return {
        ok: false, code: 'checksum', title: '校验和不对',
        hint: 'data 里至少有一个字符被改动过，或复制时漏掉了内容。校验和由游戏用同一套 FNV-1a 计算，改一个字符就会变。',
        expect: expectSum || '（缺失）', actual: actualSum,
        summary: summarize(parsed.data)
      };
    }
    return {
      ok: true,
      code: 'ok',
      title: '校验通过',
      hint: '版本、结构、校验和三项全部通过，可以导入。',
      expect: expectSum,
      actual: actualSum,
      summary: summarize(parsed.data),
      savedAt: Number(parsed.savedAt) || Date.now(),
      parsed: parsed
    };
  }

  /* ------------------------------------------------------------
     适配器：预览 / 游戏 / 独立 三种运行环境
     ------------------------------------------------------------ */

  /**
   * 把当前对局快照写到指定槽（游戏模式）
   * ------------------------------------------------------------
   * 主文件调试口只提供「存到当前槽」，这里用 snapshot + 原始存储写入，
   * 让「覆盖槽 2 / 槽 3」也能落在用户点的那个槽，且不改主文件。
   * @param {Object} p2 主文件调试口
   * @param {number} slot 目标槽
   * @returns {{ok:boolean, error?:string}}
   */
  function saveSnapshotToSlot(p2, slot) {
    var snap;
    try { snap = p2.snapshot(); } catch (error) { return { ok: false, error: 'no-run' }; }
    if (!snap || !Array.isArray(snap.rooms) || !snap.rooms.length) return { ok: false, error: 'no-run' };
    var store = parseStore(readRawText());
    if (store.state !== 'empty' && store.state !== 'ok') return { ok: false, error: 'store' };
    var text = JSON.stringify(snap);
    if (text.length > 4000000) return { ok: false, error: 'too-big' };
    var slots = cloneSlots(store.slots);
    slots[String(slot)] = {
      savedAt: Date.now(),
      reason: 'manual',
      checksum: fnvChecksum(text),
      data: snap
    };
    var out = JSON.stringify({ version: CFG.saveVersion, slots: slots });
    var written = writeRawText(out);
    return written.ok ? { ok: true } : { ok: false, error: written.error || 'write' };
  }

  /**
   * 浅拷贝槽位字典（只复制一层引用，写入时不会改动原对象）
   * @param {Object} slots 槽位字典
   * @returns {Object}
   */
  function cloneSlots(slots) {
    var out = {};
    if (slots && typeof slots === 'object') {
      Object.keys(slots).forEach(function (key) { out[key] = slots[key]; });
    }
    return out;
  }

  /**
   * 检测适配器：预览页 mock > 主文件调试口 > 纯本地
   * @returns {Object} 统一适配器
   */
  function detectAdapter() {
    var mock = global.JJ_SAVE_MOCK;
    if (mock && typeof mock === 'object') {
      var mockKey = String(mock.key || 'jjsv_preview_store_v1');
      return {
        mode: 'preview',
        key: mockKey,
        raw: function () {
          if (typeof mock.raw === 'function') return mock.raw();
          try { return global.localStorage.getItem(mockKey) || ''; } catch (error) { return ''; }
        },
        writeRaw: function (text) {
          if (typeof mock.writeRaw === 'function') return !!mock.writeRaw(text);
          try { global.localStorage.setItem(mockKey, String(text)); return true; } catch (error) { return false; }
        },
        saveToSlot: function (slot) {
          return typeof mock.saveToSlot === 'function' ? mock.saveToSlot(slot) : { ok: false, error: 'no-run' };
        },
        load: function (slot) {
          return typeof mock.load === 'function' ? mock.load(slot) : { ok: false, error: 'no-game' };
        },
        newGame: function () {
          return typeof mock.newGame === 'function' ? mock.newGame() : { ok: false, error: 'no-game' };
        }
      };
    }
    var p2 = global.__roamDebug && global.__roamDebug.p2;
    if (p2) {
      return {
        mode: 'game',
        key: CFG.storageKey,
        raw: function () { try { return p2.rawStore() || ''; } catch (error) { return ''; } },
        writeRaw: function (text) { try { return !!p2.writeRawStore(String(text)); } catch (error) { return false; } },
        saveToSlot: function (slot) { return saveSnapshotToSlot(p2, slot); },
        load: function (slot) {
          try { return p2.loadSlot(slot) || { ok: false, error: 'broken' }; } catch (error) { return { ok: false, error: 'broken' }; }
        },
        newGame: function () {
          var btn = global.document.getElementById('btnStart');
          if (btn) { btn.click(); return { ok: true }; }
          return { ok: false, error: 'no-game' };
        }
      };
    }
    return {
      mode: 'standalone',
      key: CFG.storageKey,
      raw: function () { try { return global.localStorage.getItem(CFG.storageKey) || ''; } catch (error) { return ''; } },
      writeRaw: function (text) {
        try { global.localStorage.setItem(CFG.storageKey, String(text)); return true; } catch (error) { return false; }
      },
      saveToSlot: function () { return { ok: false, error: 'no-run' }; },
      load: function () { return { ok: false, error: 'no-game' }; },
      newGame: function () { return { ok: false, error: 'no-game' }; }
    };
  }

  /**
   * 把错误码翻译成玩家能看懂的中文
   * @param {string} code 错误码
   * @returns {string}
   */
  function errorText(code) {
    var map = {
      'no-run': '当前没有进行中的一局，无法写入这个槽',
      'no-game': '当前页面没有游戏上下文，只有进入游戏后才能继续 / 开新局',
      'store': '存档存储不可读或版本不兼容，请先重建空库',
      'quota': '浏览器存储空间不足，本次没有写入',
      'write': '浏览器拒绝写入，本次没有改动原存档',
      'too-big': '单局数据超过 4 MB，主文件同样会拒绝保存',
      'empty': '这个槽没有可导出的存档',
      'checksum': '校验和不符，数据可能被改动',
      'structure': '数据结构不完整',
      'version': '存档版本不匹配',
      'parse': '文本不是合法 JSON',
      'kind': '不是本游戏的存档文本',
      'broken': '读取失败：数据不完整',
      'unreadable': '整个存储不是合法 JSON',
      'no-slot': '没有可读取的存档',
      'disabled': '存档功能已在主文件里关闭'
    };
    return map[code] || ('未知错误：' + code);
  }

  /* ------------------------------------------------------------
     备份：覆盖 / 删除前留一份，可撤销一次
     ------------------------------------------------------------ */

  /**
   * 备份单槽为导出文本（失败不阻塞主操作，只少一层保障）
   * @param {number} slot 槽号
   * @param {string} label 备份原因
   * @returns {boolean} 是否写入成功
   */
  function writeBackup(slot, label) {
    var exported = buildExportText(slot);
    if (!exported.ok) return false;
    try {
      global.localStorage.setItem(CFG.backupKey, JSON.stringify({
        slot: slot,
        at: Date.now(),
        label: label || '',
        checksum: exported.checksum,
        text: exported.text
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 读取最近一次备份
   * @returns {?Object} 无备份返回 null
   */
  function readBackup() {
    try {
      var raw = global.localStorage.getItem(CFG.backupKey);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.text || !parsed.slot) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  /**
   * 清除备份
   * @returns {void}
   */
  function clearBackup() {
    try { global.localStorage.removeItem(CFG.backupKey); } catch (error) { /* 忽略 */ }
  }

  /**
   * 重建空库前，把原始不可读文本另存一份（避免用户彻底丢数据）
   * @returns {boolean}
   */
  function backupRawStore() {
    try {
      var raw = readRawText();
      if (!raw) return false;
      global.localStorage.setItem('jjsv_raw_backup_v1', JSON.stringify({ at: Date.now(), raw: raw }));
      return true;
    } catch (error) {
      return false;
    }
  }

  /* ------------------------------------------------------------
     写操作：导入 / 删除 / 重建 / 立即存档
     ------------------------------------------------------------ */

  /**
   * 把已通过校验的文本写入指定槽
   * @param {number} slot 目标槽
   * @param {Object} validated validateText 的返回值
   * @param {Object} [opts] skipBackup=true 时不再重复备份（用于撤销备份）
   * @returns {{ok:boolean, error?:string}}
   */
  function importToSlot(slot, validated, opts) {
    var info = readSlots();
    if (info.store === 'unreadable' || info.store === 'version') return { ok: false, error: 'store' };
    if (!opts || !opts.skipBackup) {
      var old = info.slots[Math.max(0, slot - 1)];
      if (old && old.state === 'ok') writeBackup(slot, '导入覆盖');
    }
    var store = parseStore(readRawText());
    var slots = cloneSlots(store.slots);
    slots[String(slot)] = {
      savedAt: Number(validated.savedAt) || Date.now(),
      reason: 'import',
      checksum: String(validated.parsed.checksum || ''),
      data: validated.parsed.data
    };
    var out = JSON.stringify({ version: CFG.saveVersion, slots: slots });
    var written = writeRawText(out);
    if (!written.ok) return { ok: false, error: written.error || 'write' };
    return { ok: true };
  }

  /**
   * 只清除一个槽（不碰其它槽，不碰元进度）
   * @param {number} slot 槽号
   * @param {Object} [opts] skipBackup=true 时跳过备份
   * @returns {{ok:boolean, error?:string}}
   */
  function clearSlotData(slot, opts) {
    var info = readSlots();
    if (info.store === 'unreadable' || info.store === 'version') return { ok: false, error: 'store' };
    if (!opts || !opts.skipBackup) {
      var old = info.slots[Math.max(0, slot - 1)];
      if (old && old.state === 'ok') writeBackup(slot, '删除前备份');
    }
    var store = parseStore(readRawText());
    var slots = cloneSlots(store.slots);
    delete slots[String(slot)];
    var out = JSON.stringify({ version: CFG.saveVersion, slots: slots });
    var written = writeRawText(out);
    if (!written.ok) return { ok: false, error: written.error || 'write' };
    return { ok: true };
  }

  /**
   * 重建空库（存储整体不可读 / 版本不兼容时才允许）
   * @returns {{ok:boolean, error?:string}}
   */
  function rebuildStore() {
    backupRawStore();
    var written = writeRawText(JSON.stringify({ version: CFG.saveVersion, slots: {} }));
    if (!written.ok) return { ok: false, error: written.error || 'write' };
    clearBackup();
    return { ok: true };
  }

  /* ------------------------------------------------------------
     Toast：aria-live 播报，无 emoji
     ------------------------------------------------------------ */

  /**
   * 显示一条短提示（同屏只保留一条）
   * @param {string} message 纯文本提示
   * @param {string} [tone] info / success / warn / error
   * @returns {void}
   */
  function showToast(message, tone) {
    var body = global.document.body;
    if (!body) return;
    var old = body.querySelector('.jjsv-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (runtime.toastTimer) clearTimeout(runtime.toastTimer);
    var el = global.document.createElement('div');
    el.className = 'jjsv-toast is-' + (tone || 'info');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="jjsv-toast__text">' + esc(message) + '</div>';
    body.appendChild(el);
    global.requestAnimationFrame(function () { el.classList.add('is-show'); });
    runtime.toastTimer = setTimeout(function () {
      el.classList.remove('is-show');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 260);
    }, CFG.toastMs);
  }

  /* ------------------------------------------------------------
     挂载：悬浮入口 + 全局热键 + 焦点管理
     ------------------------------------------------------------ */

  /**
   * 创建游戏内悬浮入口（右下角，不挡卡组）
   * @returns {void}
   */
  function ensureLauncher() {
    if (!CFG.launcher || runtime.launcher || !global.document.body) return;
    var btn = global.document.createElement('button');
    btn.type = 'button';
    btn.className = 'jjsv-launcher';
    btn.setAttribute('aria-label', '打开存档管理');
    btn.innerHTML = icon('save', 16) + '<span>存档</span><kbd>' + esc(CFG.hotkey) + '</kbd>';
    btn.addEventListener('click', function () { openUI(); });
    global.document.body.appendChild(btn);
    runtime.launcher = btn;
  }

  /**
   * 创建全屏浮层骨架（只建一次，后续只替换面板内容）
   * @returns {void}
   */
  function ensureRoot() {
    if (runtime.root || !global.document.body) return;
    var root = global.document.createElement('div');
    root.className = 'jjsv-root jjsv-hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '存档管理');
    root.innerHTML = '<div class="jjsv-scrim" data-act="scrim"></div>'
      + '<div class="jjsv-panel" tabindex="-1"></div>';
    root.addEventListener('click', onRootClick);
    root.addEventListener('keydown', onRootKeydown);
    root.addEventListener('input', onRootInput);
    root.addEventListener('change', onRootChange);
    root.addEventListener('dragover', onRootDragOver);
    root.addEventListener('dragleave', onRootDragLeave);
    root.addEventListener('drop', onRootDrop);
    global.document.body.appendChild(root);
    runtime.root = root;
  }

  /**
   * 打开存档界面
   * @param {number} [wantedSlot] 可选：打开后聚焦的槽
   * @returns {void}
   */
  function openUI(wantedSlot) {
    if (!runtime.adapter) boot();
    ensureRoot();
    if (!runtime.root) return;
    runtime.lastFocus = global.document.activeElement;
    runtime.view = 'slots';
    runtime.confirm = null;
    runtime.open = true;
    runtime.root.classList.remove('jjsv-hidden');
    global.document.body.classList.add('jjsv-lock');
    render();
    global.requestAnimationFrame(function () {
      if (runtime.root) runtime.root.classList.add('is-open');
      focusSlot(wantedSlot || readSlots().latest || 1);
    });
    if (runtime.tickTimer) clearInterval(runtime.tickTimer);
    runtime.tickTimer = setInterval(refreshTimes, CFG.timeTickMs);
  }

  /**
   * 关闭存档界面（并收掉确认框 / 子视图）
   * @returns {void}
   */
  function closeUI() {
    if (runtime.confirm) closeConfirm(true);
    runtime.open = false;
    runtime.view = 'slots';
    global.document.body.classList.remove('jjsv-lock');
    if (runtime.tickTimer) { clearInterval(runtime.tickTimer); runtime.tickTimer = null; }
    if (runtime.root) {
      runtime.root.classList.remove('is-open');
      setTimeout(function () {
        if (!runtime.open && runtime.root) runtime.root.classList.add('jjsv-hidden');
      }, 220);
    }
    if (runtime.lastFocus && typeof runtime.lastFocus.focus === 'function') {
      try { runtime.lastFocus.focus(); } catch (error) { /* 忽略 */ }
    }
  }

  /**
   * 聚焦某个槽（键盘 1/2/3 与打开默认动作用）
   * @param {number} slot 槽号
   * @returns {void}
   */
  function focusSlot(slot) {
    if (!runtime.root) return;
    var card = runtime.root.querySelector('.jjsv-card[data-slot="' + slot + '"]');
    if (card && typeof card.focus === 'function') card.focus();
  }

  /**
   * 全局按键：热键开关 + Esc 逐层返回
   * @param {KeyboardEvent} event 键盘事件
   * @returns {void}
   */
  function onGlobalKeydown(event) {
    if (!event || !event.key) return;
    if (event.key === CFG.hotkey) {
      event.preventDefault();
      if (runtime.open) closeUI(); else openUI();
      return;
    }
    if (!runtime.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (runtime.confirm) closeConfirm();
      else if (runtime.view !== 'slots') { runtime.view = 'slots'; render(); focusSlot(readSlots().latest || 1); }
      else closeUI();
      return;
    }
    if (runtime.view === 'slots' && !runtime.confirm && /^[1-3]$/.test(event.key)) {
      var tag = event.target && event.target.tagName ? String(event.target.tagName).toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      focusSlot(Number(event.key));
    }
  }

  /* ------------------------------------------------------------
     视图渲染：主界面（三槽）
     ------------------------------------------------------------ */

  /**
   * 重新渲染当前视图
   * @returns {void}
   */
  function render() {
    if (!runtime.root) return;
    var panel = runtime.root.querySelector('.jjsv-panel');
    if (!panel) return;
    panel.classList.toggle('is-view', runtime.view !== 'slots');
    if (runtime.view === 'slots') {
      panel.innerHTML = renderHead() + renderAlerts() + renderSlotsBody() + renderFoot();
    } else {
      var drawer = runtime.view === 'export' ? renderExportDrawer() : renderImportDrawer();
      panel.innerHTML = '<div class="jjsv-layer" data-act="layer">' + drawer + '</div>';
      if (runtime.confirm) renderConfirm();
      focusView();
    }
  }

  /**
   * 面板头：标题 / 说明 / 当前模式 / 关闭
   * @returns {string} HTML
   */
  function renderHead() {
    var mode = runtime.adapter && runtime.adapter.mode;
    var modeLabel = mode === 'game' ? '游戏内' : (mode === 'preview' ? '预览' : '独立');
    return '<header class="jjsv-head">'
      + '<div class="jjsv-head__main">'
      + '<span class="jjsv-eyebrow">RUN SAVE · LOCAL ONLY</span>'
      + '<h2 class="jjsv-title" id="jjsvTitle">存档管理</h2>'
      + '<p class="jjsv-subtitle">三槽独立保存，只影响本局进度；覆盖与删除会先留一份可撤销备份。</p>'
      + '</div>'
      + '<div class="jjsv-head__meta">'
      + '<span class="jjsv-mode"><i></i>v' + CFG.saveVersion + ' · ' + esc(modeLabel) + '</span>'
      + '<button type="button" class="jjsv-close" data-act="close" aria-label="关闭存档管理" title="关闭（Esc）">'
      + ICONS.close + '</button>'
      + '</div>'
      + '</header>';
  }

  /**
   * 顶部提示条：备份可撤销 / 存储不可读 / 版本不兼容 / 预览模式
   * @returns {string} HTML
   */
  function renderAlerts() {
    var info = readSlots();
    var backup = readBackup();
    var out = '';
    if (info.store === 'unreadable') {
      out += '<div class="jjsv-alertbar">'
        + '<span class="jjsv-alertbar__text"><b>存档存储不可读。</b> 浏览器里的存档文本不是合法 JSON，三槽暂时都不能读。原始文本仍保留，可先复制再做重建。</span>'
        + '<button type="button" class="jjsv-btn jjsv-btn--sm" data-act="copy-raw">复制原始文本</button>'
        + '<button type="button" class="jjsv-btn jjsv-btn--sm jjsv-btn--danger" data-act="rebuild">重建空库</button>'
        + '</div>';
    } else if (info.store === 'version') {
      out += '<div class="jjsv-alertbar is-warn">'
        + '<span class="jjsv-alertbar__text"><b>存储版本 v' + esc(info.version) + ' 与当前 v' + CFG.saveVersion + ' 不兼容。</b> '
        + '主文件会忽略整库；这里不会静默清空，可先复制原始文本再重建。</span>'
        + '<button type="button" class="jjsv-btn jjsv-btn--sm" data-act="copy-raw">复制原始文本</button>'
        + '<button type="button" class="jjsv-btn jjsv-btn--sm jjsv-btn--danger" data-act="rebuild">重建空库</button>'
        + '</div>';
    }
    if (backup) {
      out += '<div class="jjsv-alertbar is-info">'
        + '<span class="jjsv-alertbar__text"><b>可撤销：</b>槽 ' + esc(backup.slot) + ' 的上一版已备份（' + esc(fmtRel(backup.at)) + '，'
        + esc(backup.label || '覆盖前自动备份') + '）。</span>'
        + '<button type="button" class="jjsv-btn jjsv-btn--sm jjsv-btn--primary" data-act="restore-backup">撤销</button>'
        + '<button type="button" class="jjsv-btn jjsv-btn--sm jjsv-btn--ghost" data-act="drop-backup">忽略</button>'
        + '</div>';
    }
    if (runtime.adapter && runtime.adapter.mode === 'preview') {
      out += '<div class="jjsv-alertbar is-info">'
        + '<span class="jjsv-alertbar__text"><b>预览模式：</b>数据写在独立键 <code>' + esc(runtime.adapter.key) + '</code>，'
        + '刷新生效、不影响游戏真实存档。</span>'
        + '</div>';
    }
    return out;
  }

  /**
   * 三槽网格主体
   * @returns {string} HTML
   */
  function renderSlotsBody() {
    var info = readSlots();
    var cards = info.slots.map(function (item) {
      return renderCard(item, info.latest === item.slot);
    }).join('');
    return '<div class="jjsv-body"><div class="jjsv-grid">' + cards + '</div></div>';
  }

  /**
   * 单槽卡片：空槽 / 正常 / 损坏三种形态
   * @param {Object} item inspectSlot 的返回值
   * @param {boolean} isLatest 是否为最近保存
   * @returns {string} HTML
   */
  function renderCard(item, isLatest) {
    var no = pad2(item.slot);
    if (item.state === 'empty') {
      return '<article class="jjsv-card is-empty" data-slot="' + item.slot + '" tabindex="0" aria-label="槽 ' + item.slot + '，空槽，可以开新局">'
        + '<span class="jjsv-card__bar"></span>'
        + '<header class="jjsv-card__head"><span class="jjsv-slotno">SLOT ' + no + '</span>'
        + '<div class="jjsv-tags"><span class="jjsv-tag">空槽</span></div></header>'
        + '<div class="jjsv-empty"><span class="jjsv-empty__plus">' + ICONS.plus + '</span>'
        + '<b>新局</b><span>从第 1 层开始；不会覆盖其它槽，也不消耗结晶</span></div>'
        + '<div class="jjsv-actions">'
        + '<button type="button" class="jjsv-btn jjsv-btn--primary" data-act="new-game" data-slot="' + item.slot + '">' + ICONS.plus + '新局</button>'
        + '<button type="button" class="jjsv-btn" data-act="open-import" data-slot="' + item.slot + '">导入到此槽</button>'
        + '</div></article>';
    }

    if (item.state === 'corrupt') {
      var why = '';
      if (item.error === 'checksum') {
        why = '校验和不符：期望 <code>' + esc(item.expect || '缺失') + '</code>，实际 <code>' + esc(item.actual) + '</code>。'
          + 'data 里至少有一个字符被改过，主文件也会拒绝读取。';
      } else if (item.error === 'version') {
        why = '存档版本 <code>' + esc(item.actual) + '</code> 与当前 <code>' + esc(item.expect) + '</code> 不匹配。';
      } else if (item.error === 'unreadable') {
        why = '整个存档存储不是合法 JSON，无法判断这一格属于谁。原始文本仍保留，可先复制再做重建。';
      } else {
        why = '缺少完整的房间数据（rooms），文本可能被截断或结构被改坏。';
      }
      return '<article class="jjsv-card is-broken" data-slot="' + item.slot + '" tabindex="0" aria-label="槽 ' + item.slot + '，该槽不可用">'
        + '<span class="jjsv-card__bar"></span>'
        + '<header class="jjsv-card__head"><span class="jjsv-slotno">SLOT ' + no + '</span>'
        + '<div class="jjsv-tags"><span class="jjsv-tag is-broken">该槽不可用</span></div></header>'
        + '<div class="jjsv-floor"><b>?</b><span>层</span><small>数据不可用</small></div>'
        + '<p class="jjsv-brokenmsg"><b>该槽不可用。</b>' + why + '<br>只影响这一格，其它槽与结晶 / 天赋进度不受影响。</p>'
        + '<div class="jjsv-actions">'
        + '<button type="button" class="jjsv-btn jjsv-btn--danger" data-act="delete" data-slot="' + item.slot + '">仅清除该槽</button>'
        + '<button type="button" class="jjsv-btn jjsv-btn--ghost" data-act="copy-slot" data-slot="' + item.slot + '">复制原始数据</button>'
        + '</div></article>';
    }

    var s = item.summary;
    var tags = '<span class="jjsv-tag is-' + item.tag.type + '">' + esc(item.tag.label) + '</span>';
    if (isLatest) tags += '<span class="jjsv-tag is-recent">最近</span>';
    tags += '<span class="jjsv-tag" title="FNV-1a 校验和">校验 ' + esc((item.checksum || '').slice(0, 6)) + '</span>';

    var floorSmall = s.ascension > 0 ? ('进阶 ' + s.ascension) : (s.seed ? ('种子 ' + esc(s.seed.slice(0, 10))) : '');
    var life = s.hpMax > 0 ? (s.hp + '/' + s.hpMax) : '—';

    return '<article class="jjsv-card is-ok" data-slot="' + item.slot + '" tabindex="0" aria-label="槽 ' + item.slot + '，第 ' + s.floor + ' 层，' + item.tag.label + '">'
      + '<span class="jjsv-card__bar"></span>'
      + '<header class="jjsv-card__head"><span class="jjsv-slotno">SLOT ' + no + '</span>'
      + '<div class="jjsv-tags">' + tags + '</div></header>'
      + '<div class="jjsv-floor"><b>' + esc(s.floor) + '</b><span>层</span><small>' + floorSmall + '</small></div>'
      + '<div class="jjsv-stats">'
      + '<div class="jjsv-stat is-gold"><span>结晶</span><b>' + esc(s.crystals) + '</b></div>'
      + '<div class="jjsv-stat"><span>用时</span><b>' + esc(fmtDuration(s.elapsed)) + '</b></div>'
      + '<div class="jjsv-stat is-good"><span>生命</span><b>' + esc(life) + '</b></div>'
      + '<div class="jjsv-stat"><span>难度</span><b>' + esc(s.difficulty) + '</b></div>'
      + '</div>'
      + '<div class="jjsv-time">' + icon('clock', 14)
      + '<span>最后保存</span><b data-rel-slot="' + item.slot + '">' + esc(fmtRel(item.savedAt)) + '</b>'
      + '<span class="jjsv-time__abs">' + esc(fmtAbs(item.savedAt)) + ' · ' + esc(fmtBytes(s.bytes)) + '</span></div>'
      + '<div class="jjsv-actions">'
      + '<button type="button" class="jjsv-btn jjsv-btn--primary" data-act="continue" data-slot="' + item.slot + '">继续</button>'
      + '<button type="button" class="jjsv-btn jjsv-btn--danger" data-act="overwrite" data-slot="' + item.slot + '">覆盖</button>'
      + '<button type="button" class="jjsv-btn jjsv-btn--danger" data-act="delete" data-slot="' + item.slot + '">删除</button>'
      + '<button type="button" class="jjsv-btn jjsv-btn--ghost" data-act="open-export" data-slot="' + item.slot + '">导出</button>'
      + '</div></article>';
  }

  /**
   * 底栏：立即存档 / 导入 / 刷新 / 撤销备份 / 快捷键提示
   * @returns {string} HTML
   */
  function renderFoot() {
    var info = readSlots();
    var backup = readBackup();
    var saveDisabled = runtime.adapter && runtime.adapter.mode === 'standalone';
    var target = info.latest || 1;
    return '<footer class="jjsv-foot">'
      + '<button type="button" class="jjsv-btn jjsv-btn--primary" data-act="save-now"' + (saveDisabled ? ' disabled title="' + esc(errorText('no-run')) + '"' : '') + '>'
      + ICONS.save + '立即存档</button>'
      + '<button type="button" class="jjsv-btn" data-act="open-export" data-slot="' + target + '">导出</button>'
      + '<button type="button" class="jjsv-btn" data-act="open-import">导入</button>'
      + '<button type="button" class="jjsv-btn jjsv-btn--ghost" data-act="refresh">' + ICONS.refresh + '刷新</button>'
      + (backup ? '<button type="button" class="jjsv-btn jjsv-btn--ghost" data-act="restore-backup">' + ICONS.undo + '撤销上次覆盖</button>' : '')
      + '<span class="jjsv-foot__hint">'
      + '<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> 选槽 · <kbd>Esc</kbd> 关闭 · <kbd>' + esc(CFG.hotkey) + '</kbd> 开关'
      + '<br>存储 ' + esc(fmtBytes(info.bytes)) + ' · 全部本地，无网络请求'
      + '</span>'
      + '</footer>';
  }

  /**
   * 30 秒刷新一次相对时间（不重建 DOM，避免打断焦点）
   * @returns {void}
   */
  function refreshTimes() {
    if (!runtime.open || runtime.view !== 'slots' || !runtime.root) return;
    var info = readSlots();
    var nodes = runtime.root.querySelectorAll('[data-rel-slot]');
    for (var i = 0; i < nodes.length; i += 1) {
      var slot = Number(nodes[i].getAttribute('data-rel-slot')) || 0;
      var item = info.slots[Math.max(0, slot - 1)];
      if (item) nodes[i].textContent = fmtRel(item.savedAt);
    }
  }

  /**
   * 读取某槽的原始 JSON（损坏槽「复制原始数据」用）
   * @param {number} slot 槽号
   * @returns {string} 格式化后的 JSON，失败返回空串
   */
  function rawSlotText(slot) {
    try {
      var store = JSON.parse(readRawText());
      if (store && store.slots && store.slots[String(slot)]) {
        return JSON.stringify(store.slots[String(slot)], null, 2);
      }
    } catch (error) { /* 不可读时返回空串 */ }
    return '';
  }

  /* ------------------------------------------------------------
     视图渲染：导出抽屉
     ------------------------------------------------------------ */

  /**
   * 导出抽屉：预览 4 项摘要 + 只读文本 + 复制 / 下载 / 全选
   * @returns {string} HTML
   */
  function renderExportDrawer() {
    var exported = buildExportText(runtime.exportSlot);
    var slot = runtime.exportSlot;
    var closeBtn = '<button type="button" class="jjsv-close" data-act="back" aria-label="返回三槽">' + ICONS.close + '</button>';
    if (!exported.ok) {
      return '<div class="jjsv-drawer" role="dialog" aria-label="导出失败">'
        + '<header class="jjsv-drawer__head"><div><h3>导出 · 槽 ' + esc(slot) + '</h3>'
        + '<p>这个槽现在不可导出。</p></div>' + closeBtn + '</header>'
        + '<div class="jjsv-drawer__body"><div class="jjsv-check is-bad">'
        + '<div class="jjsv-check__head"><span class="jjsv-check__badge">无法导出</span>'
        + '<span class="jjsv-check__title">' + esc(errorText(exported.error)) + '</span></div>'
        + '<p class="jjsv-check__hint">先回到三槽删除该槽，或从别处导入一份校验通过的存档来修复。</p>'
        + '</div></div>'
        + '<footer class="jjsv-drawer__foot"><span class="jjsv-spacer"></span>'
        + '<button type="button" class="jjsv-btn" data-act="back">返回三槽</button></footer></div>';
    }
    var s = exported.summary;
    var size = exported.text.length;
    return '<div class="jjsv-drawer" role="dialog" aria-labelledby="jjsvExportTitle">'
      + '<header class="jjsv-drawer__head"><div>'
      + '<h3 id="jjsvExportTitle">导出 · 槽 ' + esc(slot) + '</h3>'
      + '<p>两条路：复制到剪贴板 / 下载文件。file:// 下若下载被拦截，用复制即可。</p>'
      + '</div>' + closeBtn + '</header>'
      + '<div class="jjsv-drawer__body">'
      + '<div class="jjsv-preview">'
      + '<div class="jjsv-preview__cell"><span>楼层</span><b>第 ' + esc(s.floor) + ' 层</b></div>'
      + '<div class="jjsv-preview__cell is-gold"><span>结晶</span><b>' + esc(s.crystals) + '</b></div>'
      + '<div class="jjsv-preview__cell"><span>用时</span><b>' + esc(fmtDuration(s.elapsed)) + '</b></div>'
      + '<div class="jjsv-preview__cell"><span>校验和</span><b>' + esc(exported.checksum) + '</b></div>'
      + '</div>'
      + '<div class="jjsv-section">'
      + '<div class="jjsv-section__title">存档文本 <span>共 ' + esc(size) + ' 字符 · 含 kind / version / checksum / data</span></div>'
      + '<textarea class="jjsv-textarea" id="jjsvExportText" readonly spellcheck="false" aria-label="存档文本">'
      + esc(exported.text) + '</textarea>'
      + '</div>'
      + '<p class="jjsv-check__hint">下载文件名：<b>' + esc(exportFileName(slot, s, exported.checksum)) + '</b>。'
      + '浏览器若提示「已阻止下载」，说明当前文件协议限制了下载权限，请用左侧「复制到剪贴板」。</p>'
      + '</div>'
      + '<footer class="jjsv-drawer__foot">'
      + '<button type="button" class="jjsv-btn jjsv-btn--primary" data-act="copy-export">' + ICONS.copy + '复制到剪贴板</button>'
      + '<button type="button" class="jjsv-btn" data-act="download-export">' + ICONS.download + '下载文件</button>'
      + '<button type="button" class="jjsv-btn jjsv-btn--ghost" data-act="select-export">全选文本</button>'
      + '<button type="button" class="jjsv-btn jjsv-btn--ghost" data-act="open-import" data-slot="' + slot + '">去导入</button>'
      + '<span class="jjsv-spacer"></span>'
      + '<button type="button" class="jjsv-btn" data-act="back">返回</button>'
      + '</footer></div>';
  }

  /**
   * 生成下载文件名（只用 ASCII，避免不同系统对中文文件名的兼容问题）
   * @param {number} slot 槽号
   * @param {Object} summary 摘要
   * @param {string} checksum 校验和
   * @returns {string}
   */
  function exportFileName(slot, summary, checksum) {
    return 'arcane-save-slot' + slot + '-F' + (summary ? summary.floor : 0) + '-' + String(checksum || '').slice(0, 8) + '.txt';
  }

  /* ------------------------------------------------------------
     视图渲染：导入抽屉
     ------------------------------------------------------------ */

  /**
   * 目标槽一行文案
   * @param {Object} item 槽视图模型
   * @returns {string}
   */
  function pickText(item) {
    if (!item) return '空槽';
    if (item.state === 'empty') return '空槽 · 可直接写入';
    if (item.state === 'corrupt') return '该槽不可用 · 可覆盖修复';
    return '第 ' + item.summary.floor + ' 层 · 结晶 ' + item.summary.crystals;
  }

  /**
   * 导入抽屉：目标槽 / 文本 / 选文件 / 校验卡 / 确认
   * @returns {string} HTML
   */
  function renderImportDrawer() {
    var info = readSlots();
    var picks = '';
    for (var i = 1; i <= CFG.slotCount; i += 1) {
      var item = info.slots[i - 1];
      var cls = 'jjsv-pick' + (runtime.importSlot === i ? ' is-active' : '') + (item.state === 'corrupt' ? ' is-broken' : '');
      picks += '<button type="button" class="' + cls + '" data-act="pick-slot" data-slot="' + i + '" role="radio" aria-checked="' + (runtime.importSlot === i ? 'true' : 'false') + '">'
        + '<b>SLOT ' + pad2(i) + '</b><span>' + esc(pickText(item)) + '</span></button>';
    }
    return '<div class="jjsv-drawer" role="dialog" aria-labelledby="jjsvImportTitle">'
      + '<header class="jjsv-drawer__head"><div>'
      + '<h3 id="jjsvImportTitle">导入存档</h3>'
      + '<p>先校验、再选择目标槽。校验通过并确认后才会写入，写入前自动备份原槽。</p>'
      + '</div>'
      + '<button type="button" class="jjsv-close" data-act="back" aria-label="返回三槽">' + ICONS.close + '</button></header>'
      + '<div class="jjsv-drawer__body">'
      + '<div class="jjsv-section"><div class="jjsv-section__title">目标槽 <span>将覆盖的槽位信息</span></div>'
      + '<div class="jjsv-picks" role="radiogroup" aria-label="导入目标槽">' + picks + '</div></div>'
      + '<div class="jjsv-section"><div class="jjsv-section__title">存档文本 <span>支持粘贴、拖入 .txt / .json</span></div>'
      + '<textarea class="jjsv-textarea" id="jjsvImportText" spellcheck="false" aria-label="粘贴存档文本" placeholder="{&quot;kind&quot;:&quot;arcane-run-slot&quot;, ...}">'
      + esc(runtime.importText) + '</textarea>'
      + '</div>'
      + '<div class="jjsv-drop" id="jjsvDrop">' + icon('file', 20)
      + '<div><b>把存档文件拖到这里</b><small>也可以点右侧按钮选择文件；文件只在本地读取，不会上传</small></div>'
      + '<div class="jjsv-drop__actions">'
      + '<button type="button" class="jjsv-btn jjsv-btn--sm" data-act="choose-file">选择文件</button>'
      + '<button type="button" class="jjsv-btn jjsv-btn--sm jjsv-btn--ghost" data-act="clear-import">清空</button>'
      + '<input type="file" id="jjsvFile" class="jjsv-hidden" accept=".txt,.json,application/json,text/plain">'
      + '</div></div>'
      + '<div id="jjsvImportCheck">' + renderImportCheck() + '</div>'
      + '</div>'
      + '<footer class="jjsv-drawer__foot">'
      + '<button type="button" class="jjsv-btn" data-act="back">返回</button>'
      + '<span class="jjsv-spacer"></span>'
      + '<button type="button" class="jjsv-btn jjsv-btn--primary" data-act="confirm-import"' + (runtime.importResult && runtime.importResult.ok ? '' : ' disabled') + '>'
      + '确认导入</button>'
      + '</footer></div>';
  }

  /**
   * 校验结果卡：通过 / 失败（明确写出是哪一项没过）
   * @returns {string} HTML
   */
  function renderImportCheck() {
    var r = runtime.importResult;
    var text = String(runtime.importText || '').trim();
    if (!r && !text) {
      return '<div class="jjsv-check"><div class="jjsv-check__head">'
        + '<span class="jjsv-check__badge">等待输入</span>'
        + '<span class="jjsv-check__title">还没有存档文本</span></div>'
        + '<p class="jjsv-check__hint">粘贴导出的文本或选择文件后，这里会显示 <b>版本 / 结构 / 校验和</b> 三项结果；失败时说明具体哪一项没过。</p>'
        + '</div>';
    }
    if (!r) r = validateText(text);
    if (r.ok) {
      var s = r.summary;
      return '<div class="jjsv-check is-ok">'
        + '<div class="jjsv-check__head"><span class="jjsv-check__badge">校验通过</span>'
        + '<span class="jjsv-check__title">版本 / 结构 / 校验和全部通过</span></div>'
        + '<div class="jjsv-check__rows">'
        + '<div class="jjsv-check__row"><span>版本</span><b>v' + CFG.saveVersion + ' · 兼容</b></div>'
        + '<div class="jjsv-check__row"><span>结构</span><b>rooms = ' + esc(s.rooms) + ' · 第 ' + esc(s.floor) + ' 层</b></div>'
        + '<div class="jjsv-check__row"><span>校验和</span><b>' + esc(r.actual) + '</b></div>'
        + '<div class="jjsv-check__row"><span>内容</span><b>结晶 ' + esc(s.crystals) + ' · 用时 ' + esc(fmtDuration(s.elapsed)) + ' · 难度 ' + esc(s.difficulty) + '</b></div>'
        + '</div>'
        + '<p class="jjsv-check__hint">确认后会写入 <b>SLOT ' + pad2(runtime.importSlot) + '</b>；原槽若可读会自动备份，可撤销一次。</p>'
        + '</div>';
    }
    var itemText = {
      empty: '内容', 'too-big': '体积', parse: 'JSON 格式', kind: '存档类型',
      version: '版本', structure: '结构', checksum: '校验和'
    }[r.code] || '未知项';
    return '<div class="jjsv-check is-bad">'
      + '<div class="jjsv-check__head"><span class="jjsv-check__badge">校验未通过</span>'
      + '<span class="jjsv-check__title">' + esc(r.title) + '</span></div>'
      + '<div class="jjsv-check__rows">'
      + '<div class="jjsv-check__row"><span>失败项</span><em>' + esc(itemText) + '</em></div>'
      + (r.expect ? '<div class="jjsv-check__row"><span>期望</span><b>' + esc(r.expect) + '</b></div>' : '')
      + (r.actual ? '<div class="jjsv-check__row"><span>实际</span><em>' + esc(r.actual) + '</em></div>' : '')
      + (r.summary ? '<div class="jjsv-check__row"><span>可读出</span><b>第 ' + esc(r.summary.floor) + ' 层 · 结晶 ' + esc(r.summary.crystals) + '</b></div>' : '')
      + '</div>'
      + '<p class="jjsv-check__hint">' + esc(r.hint) + '</p>'
      + '</div>';
  }

  /**
   * 子视图打开后把焦点放到文本域
   * @returns {void}
   */
  function focusView() {
    setTimeout(function () {
      if (!runtime.root) return;
      var ta = runtime.root.querySelector(runtime.view === 'import' ? '#jjsvImportText' : '#jjsvExportText');
      if (ta && typeof ta.focus === 'function') {
        try { ta.focus(); } catch (error) { /* 忽略 */ }
      }
    }, 0);
  }

  /* ------------------------------------------------------------
     危险二次确认：取消在默认焦点，确认按钮不抢焦点
     ------------------------------------------------------------ */

  /**
   * 打开二次确认框
   * @param {Object} opts title / desc / facts / confirmText / onConfirm
   * @returns {void}
   */
  function openConfirm(opts) {
    if (!runtime.root) return;
    runtime.confirm = opts || {};
    runtime.confirmReturnFocus = global.document.activeElement;
    renderConfirm();
  }

  /**
   * 渲染确认框并强制把焦点放在「取消」
   * @returns {void}
   */
  function renderConfirm() {
    if (!runtime.confirm || !runtime.root) return;
    var panel = runtime.root.querySelector('.jjsv-panel');
    if (!panel) return;
    var old = panel.querySelector('.jjsv-confirm');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var c = runtime.confirm;
    var facts = '';
    if (Array.isArray(c.facts) && c.facts.length) {
      facts = '<div class="jjsv-confirm__facts">' + c.facts.map(function (f) {
        return '<div class="jjsv-confirm__fact"><span>' + esc(f.k) + '</span><b>' + esc(f.v) + '</b></div>';
      }).join('') + '</div>';
    }
    var layer = global.document.createElement('div');
    layer.className = 'jjsv-layer jjsv-confirm';
    layer.innerHTML = '<div class="jjsv-confirm__panel" role="alertdialog" aria-modal="true" aria-labelledby="jjsvConfirmTitle" aria-describedby="jjsvConfirmDesc">'
      + '<span class="jjsv-confirm__flag">' + ICONS.warn + '危险操作 · 需要二次确认</span>'
      + '<h3 class="jjsv-confirm__title" id="jjsvConfirmTitle">' + esc(c.title || '确认操作') + '</h3>'
      + '<p class="jjsv-confirm__desc" id="jjsvConfirmDesc">' + esc(c.desc || '') + '</p>'
      + facts
      + '<div class="jjsv-confirm__actions">'
      + '<button type="button" class="jjsv-btn" data-act="confirm-cancel">取消</button>'
      + '<button type="button" class="jjsv-btn jjsv-btn--danger-solid" data-act="confirm-yes">' + esc(c.confirmText || '确认') + '</button>'
      + '</div></div>';
    panel.appendChild(layer);
    setTimeout(function () {
      var cancel = layer.querySelector('[data-act="confirm-cancel"]');
      if (cancel && typeof cancel.focus === 'function') cancel.focus();
    }, 0);
  }

  /**
   * 关闭确认框
   * @param {boolean} [silent] 不还原焦点（界面整体关闭时用）
   * @returns {void}
   */
  function closeConfirm(silent) {
    var layer = runtime.root ? runtime.root.querySelector('.jjsv-confirm') : null;
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    runtime.confirm = null;
    if (!silent && runtime.confirmReturnFocus && typeof runtime.confirmReturnFocus.focus === 'function') {
      try { runtime.confirmReturnFocus.focus(); } catch (error) { /* 忽略 */ }
    }
    runtime.confirmReturnFocus = null;
  }

  /**
   * 执行确认框里挂着的操作
   * @returns {void}
   */
  function confirmYes() {
    if (!runtime.confirm) return;
    var action = runtime.confirm.onConfirm;
    closeConfirm(true);
    if (typeof action !== 'function') return;
    try {
      action();
    } catch (error) {
      showToast('操作失败：' + (error && error.message ? error.message : '未知错误'), 'error');
    }
  }

  /* ------------------------------------------------------------
     复制 / 下载：file:// 下仍保留手动兜底
     ------------------------------------------------------------ */

  /**
   * 复制文本：Clipboard API → execCommand → 全选手动
   * @param {string} text 要复制的文本
   * @param {?string} textareaId 可全选的文本域 id
   * @param {string} [okMessage] 成功提示
   * @returns {void}
   */
  function copyText(text, textareaId, okMessage) {
    var ta = textareaId ? global.document.getElementById(textareaId) : null;
    var payload = String(text || '');

    function manual() {
      if (ta) { ta.focus(); ta.select(); }
      showToast('无法自动复制：文本已全选，请按 Ctrl+C 手动复制', 'warn');
    }

    function legacy() {
      try {
        if (ta) { ta.focus(); ta.select(); }
        var ok = global.document.execCommand && global.document.execCommand('copy');
        if (ok) { showToast(okMessage || '已复制到剪贴板', 'success'); return; }
      } catch (error) { /* 继续走手动兜底 */ }
      manual();
    }

    if (!payload) { showToast('没有可复制的内容', 'warn'); return; }
    if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === 'function') {
      global.navigator.clipboard.writeText(payload).then(function () {
        showToast(okMessage || '已复制到剪贴板', 'success');
      }).catch(legacy);
    } else {
      legacy();
    }
  }

  /**
   * 下载文本：Blob + a[download]，失败时提示改用复制
   * @param {string} text 文件内容
   * @param {string} filename 文件名
   * @returns {void}
   */
  function downloadText(text, filename) {
    try {
      var blob = new Blob([String(text || '')], { type: 'application/json;charset=utf-8' });
      if (global.navigator && typeof global.navigator.msSaveBlob === 'function') {
        global.navigator.msSaveBlob(blob, filename);
        showToast('已请求下载：' + filename, 'success');
        return;
      }
      var url = global.URL.createObjectURL(blob);
      var a = global.document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      a.style.display = 'none';
      global.document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        global.URL.revokeObjectURL(url);
      }, 1200);
      showToast('已请求下载：' + filename + '（若被浏览器拦截，请改用复制）', 'success');
    } catch (error) {
      showToast('当前浏览器拒绝下载：请用「复制到剪贴板」', 'warn');
    }
  }

  /* ------------------------------------------------------------
     动作：继续 / 覆盖 / 删除 / 重建 / 撤销 / 存档
     ------------------------------------------------------------ */

  /**
   * 返回三槽视图
   * @returns {void}
   */
  function backToSlots() {
    runtime.view = 'slots';
    runtime.confirm = null;
    render();
    focusSlot(readSlots().latest || 1);
  }

  /**
   * 打开导出视图
   * @param {number} slot 槽号
   * @returns {void}
   */
  function openExport(slot) {
    if (!runtime.open) openUI(slot);
    var exported = buildExportText(slot);
    if (!exported.ok) {
      showToast('导出失败：' + errorText(exported.error), 'error');
      return;
    }
    runtime.exportSlot = Number(slot) || 1;
    runtime.view = 'export';
    runtime.confirm = null;
    render();
  }

  /**
   * 打开导入视图
   * @param {number} [slot] 目标槽，缺省为最近槽 / 第一个空槽
   * @param {string} [text] 预填文本
   * @returns {void}
   */
  function openImport(slot, text) {
    if (!runtime.open) openUI(slot || 1);
    var info = readSlots();
    var target = Number(slot) || info.latest;
    if (!target) {
      for (var i = 1; i <= CFG.slotCount; i += 1) {
        if (info.slots[i - 1].state === 'empty') { target = i; break; }
      }
    }
    runtime.importSlot = target || 1;
    if (text !== undefined) runtime.importText = String(text || '');
    runtime.importResult = validateText(runtime.importText);
    runtime.view = 'import';
    runtime.confirm = null;
    render();
  }

  /**
   * 继续某个槽（读取成功即关闭界面）
   * @param {number} slot 槽号
   * @returns {boolean} 是否读取成功
   */
  function continueSlot(slot) {
    var result = runtime.adapter.load(Number(slot));
    if (!result || !result.ok) {
      showToast('无法继续：' + errorText(result && result.error ? result.error : 'broken'), 'error');
      render();
      return false;
    }
    var item = readSlots().slots[Math.max(0, Number(slot) - 1)];
    var extra = item && item.summary ? (' · 第 ' + item.summary.floor + ' 层') : '';
    showToast('已继续槽 ' + slot + extra, 'success');
    closeUI();
    return true;
  }

  /**
   * 请求删除槽（二次确认 → 备份 → 只删该槽）
   * @param {number} slot 槽号
   * @returns {void}
   */
  function requestDelete(slot) {
    var item = readSlots().slots[Math.max(0, Number(slot) - 1)];
    var content = '空槽';
    if (item.state === 'ok') content = '第 ' + item.summary.floor + ' 层 · 结晶 ' + item.summary.crystals + ' · 用时 ' + fmtDuration(item.summary.elapsed);
    else if (item.state === 'corrupt') content = '该槽不可用（建议先复制原始数据）';
    openConfirm({
      title: '删除槽 ' + slot + '？',
      desc: '删除后这一局的楼层、房间与卡组都会消失。只影响这一格，结晶 / 天赋等元进度不受影响。',
      facts: [
        { k: '目标槽', v: 'SLOT ' + pad2(slot) },
        { k: '当前内容', v: content },
        { k: '保障', v: item.state === 'ok' ? '删除前自动备份，可在顶部撤销一次' : '损坏数据不会静默丢弃，可先复制原始数据' }
      ],
      confirmText: '确认删除',
      onConfirm: function () {
        var result = clearSlotData(Number(slot));
        if (result.ok) {
          showToast('已清除槽 ' + slot + (item.state === 'ok' ? '，可撤销一次' : ''), 'success');
          runtime.view = 'slots';
          render();
        } else {
          showToast('清除失败：' + errorText(result.error), 'error');
        }
      }
    });
  }

  /**
   * 请求覆盖槽（二次确认 → 备份 → 写入当前对局）
   * @param {number} slot 槽号
   * @returns {void}
   */
  function requestOverwrite(slot) {
    var item = readSlots().slots[Math.max(0, Number(slot) - 1)];
    var content = '空槽';
    if (item.state === 'ok') content = '第 ' + item.summary.floor + ' 层 · 结晶 ' + item.summary.crystals;
    else if (item.state === 'corrupt') content = '该槽不可用（将写入当前对局覆盖修复）';
    openConfirm({
      title: '覆盖槽 ' + slot + '？',
      desc: '将把当前对局写入这个槽，原有进度会被替换。覆盖前会自动备份上一版，可在顶部撤销一次。',
      facts: [
        { k: '目标槽', v: 'SLOT ' + pad2(slot) },
        { k: '原内容', v: content },
        { k: '写入内容', v: '当前对局 · 手动档' }
      ],
      confirmText: '确认覆盖',
      onConfirm: function () {
        var result = runtime.adapter.saveToSlot(Number(slot));
        if (result && result.ok) {
          showToast('已存档到槽 ' + slot + '，上一版可撤销', 'success');
          runtime.view = 'slots';
          render();
        } else {
          showToast('存档失败：' + errorText(result && result.error ? result.error : 'write'), 'error');
        }
      }
    });
  }

  /**
   * 请求重建空库（二次确认）
   * @returns {void}
   */
  function requestRebuild() {
    openConfirm({
      title: '重建空库？',
      desc: '三槽会全部清空并写回一个 v' + CFG.saveVersion + ' 空库。结晶、天赋等元进度不在这个存储里，不会被改动。',
      facts: [
        { k: '影响', v: '三槽全部清空' },
        { k: '保留', v: '元进度 / 原始文本另存一份' },
        { k: '位置', v: 'jjsv_raw_backup_v1' }
      ],
      confirmText: '确认重建',
      onConfirm: function () {
        var result = rebuildStore();
        if (result.ok) {
          showToast('已重建空库；原始文本已另存', 'success');
          runtime.view = 'slots';
          render();
        } else {
          showToast('重建失败：' + errorText(result.error), 'error');
        }
      }
    });
  }

  /**
   * 请求撤销最近一次覆盖 / 删除
   * @returns {void}
   */
  function requestRestoreBackup() {
    var backup = readBackup();
    if (!backup) { showToast('没有可撤销的备份', 'warn'); return; }
    var validated = validateText(backup.text);
    if (!validated.ok) {
      clearBackup();
      render();
      showToast('备份本身校验失败（' + validated.title + '），已移除这份备份', 'error');
      return;
    }
    openConfirm({
      title: '撤销到槽 ' + backup.slot + ' 的上一版？',
      desc: '当前内容会被替换回最近一次备份。这份备份已重新通过版本 / 结构 / 校验和三项检查。',
      facts: [
        { k: '目标槽', v: 'SLOT ' + pad2(backup.slot) },
        { k: '备份时间', v: fmtAbs(backup.at) },
        { k: '备份内容', v: '第 ' + validated.summary.floor + ' 层 · 结晶 ' + validated.summary.crystals }
      ],
      confirmText: '确认撤销',
      onConfirm: function () {
        var result = importToSlot(Number(backup.slot), validated, { skipBackup: true });
        if (result.ok) {
          clearBackup();
          showToast('已撤销到槽 ' + backup.slot + ' 的上一版', 'success');
          runtime.view = 'slots';
          render();
        } else {
          showToast('撤销失败：' + errorText(result.error), 'error');
        }
      }
    });
  }

  /**
   * 开始新局（空槽按钮）
   * @returns {void}
   */
  function newGameFlow() {
    var result = runtime.adapter.newGame();
    if (result && result.ok) {
      showToast('已开始新局', 'success');
      closeUI();
    } else {
      showToast('无法开始新局：' + errorText(result && result.error ? result.error : 'no-game'), 'error');
    }
  }

  /**
   * 底栏「立即存档」：有最近槽则二次确认覆盖，没有则直接写入第一个空槽
   * @returns {void}
   */
  function saveNowFlow() {
    var info = readSlots();
    if (info.latest) { requestOverwrite(info.latest); return; }
    var target = 0;
    for (var i = 1; i <= CFG.slotCount; i += 1) {
      if (info.slots[i - 1].state === 'empty') { target = i; break; }
    }
    if (!target) { requestOverwrite(1); return; }
    var result = runtime.adapter.saveToSlot(target);
    if (result && result.ok) {
      showToast('已存档到空槽 ' + target, 'success');
      render();
    } else {
      showToast('存档失败：' + errorText(result && result.error ? result.error : 'write'), 'error');
    }
  }

  /**
   * 请求导入（确认框 → 写入）
   * @returns {void}
   */
  function requestImportConfirm() {
    var validated = validateText(runtime.importText);
    runtime.importResult = validated;
    if (!validated.ok) { renderImportLive(); return; }
    var slot = Number(runtime.importSlot) || 1;
    var info = readSlots();
    var old = info.slots[slot - 1];
    var oldText = old.state === 'ok' ? ('第 ' + old.summary.floor + ' 层 · 结晶 ' + old.summary.crystals) : (old.state === 'corrupt' ? '该槽不可用（本次写入会修复）' : '空槽');
    openConfirm({
      title: '导入并覆盖槽 ' + slot + '？',
      desc: '文本已通过版本 / 结构 / 校验和三项检查。写入前会自动备份原槽，可撤销一次。',
      facts: [
        { k: '目标槽', v: 'SLOT ' + pad2(slot) + ' · 原内容 ' + oldText },
        { k: '新档', v: '第 ' + validated.summary.floor + ' 层 · 结晶 ' + validated.summary.crystals + ' · 用时 ' + fmtDuration(validated.summary.elapsed) },
        { k: '校验和', v: validated.actual }
      ],
      confirmText: '确认导入',
      onConfirm: function () {
        var result = importToSlot(slot, validated);
        if (result.ok) {
          showToast('已导入到槽 ' + slot + '，原档可撤销一次', 'success');
          runtime.view = 'slots';
          render();
        } else {
          showToast('导入失败：' + errorText(result.error), 'error');
        }
      }
    });
  }

  /* ------------------------------------------------------------
     事件：点击 / 输入 / 文件 / 拖拽 / 焦点陷阱
     ------------------------------------------------------------ */

  /**
   * 根节点点击委托（data-act 驱动所有按钮）
   * @param {MouseEvent} event 点击事件
   * @returns {void}
   */
  function onRootClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    /* 点确认框外的暗色层：等同于取消 */
    if (target.classList && target.classList.contains('jjsv-confirm')) { closeConfirm(); return; }

    var node = target.closest('[data-act]');
    if (!node) return;
    var act = node.getAttribute('data-act');
    var slot = Number(node.getAttribute('data-slot')) || 0;

    switch (act) {
      case 'scrim':
        if (runtime.confirm) closeConfirm();
        else if (runtime.view !== 'slots') backToSlots();
        else closeUI();
        break;
      case 'layer': backToSlots(); break;
      case 'close': closeUI(); break;
      case 'back': backToSlots(); break;
      case 'refresh': render(); showToast('已刷新三槽状态', 'info'); break;
      case 'open-export': openExport(slot || runtime.exportSlot || readSlots().latest || 1); break;
      case 'open-import': openImport(slot); break;
      case 'continue': continueSlot(slot); break;
      case 'overwrite': requestOverwrite(slot); break;
      case 'delete': requestDelete(slot); break;
      case 'new-game': newGameFlow(); break;
      case 'save-now': saveNowFlow(); break;
      case 'copy-export':
        var exported = buildExportText(runtime.exportSlot);
        if (exported.ok) copyText(exported.text, 'jjsvExportText', '已复制到剪贴板（校验和 ' + exported.checksum + '）');
        else showToast('导出失败：' + errorText(exported.error), 'error');
        break;
      case 'download-export':
        var ex2 = buildExportText(runtime.exportSlot);
        if (ex2.ok) downloadText(ex2.text, exportFileName(runtime.exportSlot, ex2.summary, ex2.checksum));
        else showToast('导出失败：' + errorText(ex2.error), 'error');
        break;
      case 'select-export':
        var taExport = global.document.getElementById('jjsvExportText');
        if (taExport) { taExport.focus(); taExport.select(); showToast('已全选，可直接按 Ctrl+C', 'info'); }
        break;
      case 'copy-slot': copyText(rawSlotText(slot), null, '已复制槽 ' + slot + ' 的原始数据'); break;
      case 'copy-raw': copyText(readRawText(), null, '已复制原始存储文本'); break;
      case 'rebuild': requestRebuild(); break;
      case 'restore-backup': requestRestoreBackup(); break;
      case 'drop-backup': clearBackup(); render(); showToast('已忽略这份备份', 'info'); break;
      case 'choose-file':
        var fileInput = global.document.getElementById('jjsvFile');
        if (fileInput) fileInput.click();
        break;
      case 'clear-import':
        runtime.importText = '';
        runtime.importResult = null;
        var taClear = global.document.getElementById('jjsvImportText');
        if (taClear) taClear.value = '';
        renderImportLive();
        showToast('已清空导入框', 'info');
        break;
      case 'pick-slot':
        runtime.importSlot = slot || 1;
        runtime.importResult = validateText(runtime.importText);
        renderImportLive();
        break;
      case 'confirm-import': requestImportConfirm(); break;
      case 'confirm-cancel': closeConfirm(); break;
      case 'confirm-yes': confirmYes(); break;
      default: break;
    }
  }

  /**
   * 导入文本域输入：防抖校验并刷新结果卡
   * @param {Event} event 输入事件
   * @returns {void}
   */
  function onRootInput(event) {
    var target = event.target;
    if (!target || target.id !== 'jjsvImportText') return;
    runtime.importText = String(target.value || '');
    if (runtime.validateTimer) clearTimeout(runtime.validateTimer);
    runtime.validateTimer = setTimeout(function () {
      runtime.importResult = validateText(runtime.importText);
      renderImportLive();
    }, 180);
  }

  /**
   * 只刷新导入视图的校验卡 / 目标槽 / 确认按钮（不重建文本域，避免丢焦点）
   * @returns {void}
   */
  function renderImportLive() {
    if (!runtime.root || runtime.view !== 'import') return;
    var check = runtime.root.querySelector('#jjsvImportCheck');
    if (check) check.innerHTML = renderImportCheck();
    var btn = runtime.root.querySelector('[data-act="confirm-import"]');
    if (btn) btn.disabled = !(runtime.importResult && runtime.importResult.ok);
    var picks = runtime.root.querySelectorAll('.jjsv-pick');
    for (var i = 0; i < picks.length; i += 1) {
      var isActive = Number(picks[i].getAttribute('data-slot')) === runtime.importSlot;
      picks[i].classList.toggle('is-active', isActive);
      picks[i].setAttribute('aria-checked', isActive ? 'true' : 'false');
    }
  }

  /**
   * 读取本地文件到导入框（FileReader，零网络）
   * @param {File} file 浏览器文件对象
   * @returns {void}
   */
  function readImportFile(file) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { showToast('文件超过 4 MB，拒绝读取', 'error'); return; }
    var reader = new global.FileReader();
    reader.onload = function () {
      runtime.importText = String(reader.result || '').replace(/^\uFEFF/, '');
      var ta = global.document.getElementById('jjsvImportText');
      if (ta) ta.value = runtime.importText;
      runtime.importResult = validateText(runtime.importText);
      renderImportLive();
      showToast('已读取：' + file.name + '（未上传）', 'success');
    };
    reader.onerror = function () { showToast('读取文件失败：' + file.name, 'error'); };
    reader.readAsText(file, 'utf-8');
  }

  /**
   * 文件选择变化
   * @param {Event} event change 事件
   * @returns {void}
   */
  function onRootChange(event) {
    var target = event.target;
    if (!target || target.id !== 'jjsvFile') return;
    var file = target.files && target.files[0];
    readImportFile(file);
    target.value = '';
  }

  /**
   * 拖拽进入
   * @param {DragEvent} event 拖拽事件
   * @returns {void}
   */
  function onRootDragOver(event) {
    var drop = event.target && event.target.closest ? event.target.closest('#jjsvDrop') : null;
    if (!drop) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    drop.classList.add('is-over');
  }

  /**
   * 拖拽离开
   * @param {DragEvent} event 拖拽事件
   * @returns {void}
   */
  function onRootDragLeave(event) {
    var drop = event.target && event.target.closest ? event.target.closest('#jjsvDrop') : null;
    if (drop) drop.classList.remove('is-over');
  }

  /**
   * 拖拽放下
   * @param {DragEvent} event 拖拽事件
   * @returns {void}
   */
  function onRootDrop(event) {
    var drop = event.target && event.target.closest ? event.target.closest('#jjsvDrop') : null;
    if (!drop) return;
    event.preventDefault();
    drop.classList.remove('is-over');
    var file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
    if (file) readImportFile(file);
  }

  /**
   * 根节点键盘：Tab 焦点陷阱 + 卡片上的 Enter 快捷操作
   * @param {KeyboardEvent} event 键盘事件
   * @returns {void}
   */
  function onRootKeydown(event) {
    if (!runtime.open) return;
    if (event.key === 'Tab' && runtime.root) {
      var nodes = runtime.root.querySelectorAll('button:not([disabled]),textarea:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]');
      var list = [];
      for (var i = 0; i < nodes.length; i += 1) {
        if (nodes[i].offsetParent !== null && !nodes[i].classList.contains('jjsv-hidden')) list.push(nodes[i]);
      }
      if (!list.length) return;
      var first = list[0];
      var last = list[list.length - 1];
      if (event.shiftKey && global.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && global.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === 'Enter') {
      var target = event.target;
      var isCard = target && target.classList && target.classList.contains('jjsv-card');
      if (!isCard) return;
      event.preventDefault();
      var slot = Number(target.getAttribute('data-slot')) || 1;
      var item = readSlots().slots[Math.max(0, slot - 1)];
      if (item.state === 'ok') continueSlot(slot);
      else if (item.state === 'empty') newGameFlow();
      else requestDelete(slot);
    }
  }

  /* ------------------------------------------------------------
     启动：探测适配器、挂载入口、绑定键盘
     ------------------------------------------------------------ */

  /**
   * 启动模块（DOM 就绪后执行一次）
   * @returns {void}
   */
  function boot() {
    if (runtime.booted) return;
    runtime.booted = true;
    runtime.adapter = detectAdapter();
    ensureLauncher();
    global.document.addEventListener('keydown', onGlobalKeydown);
  }

  if (global.document) {
    if (global.document.body) {
      boot();
    } else {
      global.document.addEventListener('DOMContentLoaded', boot);
    }
  }

  /* ------------------------------------------------------------
     对外接口：测试用 api + 预览页用 open/close
     ------------------------------------------------------------ */
  global.JJSAVE = {
    __loaded: true,
    version: VERSION,
    enabled: true,
    open: openUI,
    close: closeUI,
    isOpen: function () { return runtime.open; },
    api: {
      /** 适配器模式：preview / game / standalone */
      adapterMode: function () { return runtime.adapter ? runtime.adapter.mode : 'none'; },
      /** 当前存储键 */
      storageKey: function () { return runtime.adapter ? runtime.adapter.key : CFG.storageKey; },
      /** 三槽视图模型 + 存储状态 */
      slots: readSlots,
      /** 单槽导出文本（失败返回空串） */
      exportText: function (slot) {
        var result = buildExportText(Number(slot));
        return result.ok ? result.text : '';
      },
      /** 纯校验，不改任何数据 */
      validate: validateText,
      /** 测试 / 高级用法：跳过界面直接写入 */
      importText: function (slot, text) {
        var validated = validateText(text);
        if (!validated.ok) return { ok: false, error: validated.code, result: validated };
        var result = importToSlot(Number(slot), validated);
        if (result.ok && runtime.open) render();
        return result;
      },
      /** 把当前对局写到指定槽 */
      saveToSlot: function (slot) {
        var result = runtime.adapter.saveToSlot(Number(slot));
        if (result && result.ok && runtime.open) render();
        return result;
      },
      /** 继续某槽 */
      continueSlot: continueSlot,
      /** 只清某槽 */
      clearSlot: function (slot) {
        var result = clearSlotData(Number(slot));
        if (result.ok && runtime.open) render();
        return result;
      },
      openExport: openExport,
      openImport: openImport,
      requestDelete: requestDelete,
      requestOverwrite: requestOverwrite,
      /** 切换导入目标槽 */
      setImportSlot: function (slot) {
        runtime.importSlot = Number(slot) || 1;
        runtime.importResult = validateText(runtime.importText);
        if (runtime.view === 'import') render();
        return runtime.importSlot;
      },
      /** 当前视图 / 确认框 / 导入状态 */
      getState: function () {
        return {
          view: runtime.view,
          confirm: !!runtime.confirm,
          importSlot: runtime.importSlot,
          importOk: !!(runtime.importResult && runtime.importResult.ok),
          adapter: runtime.adapter ? runtime.adapter.mode : 'none'
        };
      },
      /** 最近一次备份 */
      backup: readBackup,
      /** 当前焦点元素（测试确认按钮不抢焦点） */
      focusInfo: function () {
        var active = global.document.activeElement;
        return {
          act: active && active.getAttribute ? active.getAttribute('data-act') : null,
          cls: active && active.className ? String(active.className) : '',
          text: active && active.textContent ? String(active.textContent).trim().slice(0, 40) : ''
        };
      }
    }
  };
  global.__JJSAVE_UI = global.JJSAVE;
})(typeof window !== 'undefined' ? window : this);
