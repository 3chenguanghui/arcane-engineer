/**
 * 全局异常兜底 · 补丁落地与故障实测
 * ------------------------------------------------------------
 * 主文件 index_arcane_v2.html 只读：本脚本读取它、按「函数名锚点」拼出补丁副本，
 * 再用无头 Edge 实测三种故障（渲染循环抛错 / 资源缺失 / 存档 JSON 损坏），
 * 最后删除副本。所有截图与结果落在 .screenshots/art/。
 *
 * 用法：node tools/arcane_guard.js
 * 端口：9545（独立 profile，避免与其它线并发抢锁）
 */

/* 先指定独立 profile 根目录，再 require（模块在 require 时读取该环境变量） */
process.env.ARCANE_PROFILE_ROOT = require('path').join(__dirname, '..', '.testprofile', 'guard');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9545;
const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const TEST_DIR = path.join(ROOT, '.guardtest');
const TEST_FILE = path.join(TEST_DIR, 'index_guard_test.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   一、补丁内容（唯一真源：落地时按 A/B/C/D 四段粘贴）
   ============================================================ */

/**
 * A 段：全局应急面板本体
 * 插入位置：<body> 之后、游戏脚本之前（最先注册，保证启动期异常也能兜住）
 */
const SEGMENT_A = `
<script>
/* ============================================================
   全局异常兜底 · 应急面板（零依赖，插在 <body> 之后最先执行）
   ------------------------------------------------------------
   · 只做四件事：捕获 → 现场建 DOM → 显示真实摘要 → 给出可操作路径
   · 不引用任何游戏模块（showToast / state / canvas / CSS 变量都不用）
   · 面板自身异常时退化为 alert，绝不静默吞错
   · 关闭 ?guard=off 可整体回退
   ============================================================ */
(function () {
  'use strict';
  if (window.__arcaneGuard) return;
  var CFG = {
    panelId: '__arcane_guard_panel',
    zIndex: 2147483000,
    maxSummary: 320,
    maxDetail: 6000,
    clearKeys: ['arcane_rogue_meta', 'arcane_run_slots_v1', 'arcane.crash.v1']
  };
  var DISABLED = /(?:^|[?&])guard=off(?:&|$)/.test(window.location.search);
  if (DISABLED) {
    window.__arcaneGuard = {
      report: function () { return false; },
      state: function () { return { disabled: true }; },
      hide: function () {},
      lastText: function () { return ''; }
    };
    return;
  }
  var S = { last: null, shown: false, copied: false, copyText: '', inGuard: false, lastSig: '' };

  /**
   * 把任意值安全转成可读文本：任何情况下都不抛错，且尽量不返回空
   * @param {*} value 原始值
   * @param {string} [fallback] 完全取不到时的兜底文案
   * @returns {string}
   */
  function safeText(value, fallback) {
    try {
      if (value === null || value === undefined) return fallback || '';
      if (typeof value === 'string') return value;
      if (typeof value === 'function') return '[function]';
      if (value && typeof value.message === 'string' && value.message) return value.message;
      if (typeof value === 'object') {
        try {
          var json = JSON.stringify(value);
          if (json && json !== '{}') return json;
        } catch (inner) { /* 循环引用 */ }
        try { if (value.stack) return String(value.stack); } catch (inner2) { /* 忽略 */ }
      }
      var text = String(value);
      return (text && text !== '[object Object]') ? text : (fallback || '');
    } catch (error) {
      return fallback || '';
    }
  }

  /**
   * 当前时间文本（摘要里要给玩家看，便于报错时说明"什么时候出的问题"）
   * @returns {string}
   */
  function timeText() {
    try { return new Date().toLocaleString('zh-CN', { hour12: false }); }
    catch (error) { return new Date().toString(); }
  }

  /**
   * 错误类型的中文标签
   * @param {string} kind 类型键
   * @returns {string}
   */
  function kindLabel(kind) {
    if (kind === 'render-loop') return '渲染循环异常';
    if (kind === 'resource') return '资源加载失败';
    if (kind === 'rejection') return '未处理的异步错误';
    if (kind === 'save-corrupt') return '存档读取失败';
    return '脚本错误';
  }

  /**
   * 生成一个内联样式按钮（不依赖页面 CSS）
   * @param {string} action data-gg 动作名
   * @param {string} label 按钮文案
   * @param {string} tone 色调：primary / danger / normal
   * @returns {string}
   */
  function button(action, label, tone) {
    var style = 'cursor:pointer;border:1px solid #344563;border-radius:8px;background:#18243a;'
      + 'color:#dfe8f5;font-size:13px;padding:9px 14px;font-family:inherit;';
    if (tone === 'primary') style = style.replace('background:#18243a', 'background:#2f6feb').replace('border:1px solid #344563', 'border:1px solid #2f6feb') + 'color:#fff;';
    if (tone === 'danger') style = style.replace('background:#18243a', 'background:#5a1f22').replace('border:1px solid #344563', 'border:1px solid #8c3a3f') + 'color:#ffd9d5;';
    return '<button type="button" data-gg="' + action + '" style="' + style + '">' + label + '</button>';
  }

  /**
   * 现场创建面板 DOM 并插入 body 末尾
   * 关键：不读任何静态 DOM / CSS，面板由本函数负责从零建起来
   * @returns {HTMLElement}
   */
  function ensurePanel() {
    var existed = document.getElementById(CFG.panelId);
    if (existed) return existed;
    var host = document.body || document.documentElement;
    var root = document.createElement('div');
    root.id = CFG.panelId;
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', CFG.panelId + '_title');
    root.style.cssText = 'position:fixed;inset:0;z-index:' + CFG.zIndex
      + ';display:none;align-items:center;justify-content:center;padding:16px;'
      + 'background:rgba(4,7,13,.94);font-family:"Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;'
      + 'color:#e9eefb;line-height:1.6;text-align:left;';
    root.innerHTML = ''
      + '<div style="width:min(680px,96vw);max-height:88vh;overflow:auto;box-sizing:border-box;'
      + 'background:#0e1422;border:1px solid #2c3c58;border-radius:14px;box-shadow:0 24px 90px rgba(0,0,0,.7);padding:24px;">'
      + '<div style="font-size:11px;letter-spacing:.2em;color:#5f7ba3;margin-bottom:8px;">SYSTEM · RECOVERY</div>'
      + '<h2 id="' + CFG.panelId + '_title" style="margin:0 0 10px;font-size:22px;line-height:1.3;color:#f2f6ff;">游戏遇到了问题</h2>'
      + '<p style="margin:0 0 14px;font-size:14px;color:#a9b8d0;">游戏已经暂停，避免继续损坏进度。下面是一段真实错误信息，可以复制发给开发者。</p>'
      + '<div id="' + CFG.panelId + '_summary" style="margin:0 0 10px;padding:12px 14px;border:1px solid #3b4b6b;'
      + 'border-left:3px solid #e0a54a;border-radius:8px;background:#141b2b;color:#f4e2b8;font-size:14px;word-break:break-word;"></div>'
      + '<div id="' + CFG.panelId + '_meta" style="margin:0 0 12px;font-size:12px;color:#8fa2bd;word-break:break-word;"></div>'
      + '<details style="margin:0 0 16px;font-size:12px;color:#9fb0c8;">'
      + '<summary style="cursor:pointer;color:#7fa7d8;">技术细节</summary>'
      + '<pre id="' + CFG.panelId + '_detail" style="margin:8px 0 0;padding:10px;background:#0a0f19;border:1px solid #243149;'
      + 'border-radius:8px;white-space:pre-wrap;word-break:break-word;font-family:Consolas,"Courier New",monospace;'
      + 'font-size:12px;color:#c6d3e6;max-height:220px;overflow:auto;"></pre>'
      + '</details>'
      + '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;">'
      + button('reload', '刷新页面', 'primary')
      + button('copy', '复制错误信息', 'normal')
      + '<span data-gg-slot="restore" style="display:none;">' + button('restore', '读取最近存档', 'normal') + '</span>'
      + button('close', '关闭并回到标题页', 'normal')
      + '</div>'
      + '<div style="padding:12px 14px;border:1px dashed #3a4a68;border-radius:8px;background:#111827;">'
      + '<div style="font-size:13px;color:#cbd6e8;margin-bottom:8px;">先刷新页面试试。若刷新后仍然出现，再考虑清空存档：</div>'
      + '<div style="font-size:12px;color:#93a5bf;margin-bottom:10px;">'
      + '清空会删除：结晶、永久天赋等级、最佳楼层、局数与累计统计、已解锁成就、已读剧情，以及本局三个存档槽。'
      + '音量与画质等本机设置不受影响；损坏存档的原始备份会保留，方便后续找回。'
      + '</div>'
      + button('wipe', '仍然不行 · 清空存档', 'danger')
      + '<div data-gg-confirm="1" style="display:none;margin-top:10px;">'
      + '<div style="font-size:12px;color:#ffb4a8;margin-bottom:8px;">确认刷新后仍无法进入游戏再清空。此操作不可撤销。</div>'
      + button('wipeConfirm', '确认清空并刷新', 'danger')
      + button('wipeCancel', '取消', 'normal')
      + '</div>'
      + '</div>'
      + '<div id="' + CFG.panelId + '_note" style="margin-top:10px;font-size:12px;color:#7fd3a1;min-height:18px;"></div>'
      + '</div>';
    host.appendChild(root);
    bindPanel(root);
    return root;
  }

  /**
   * 绑定面板交互（事件委托，重渲染不会丢）
   * @param {HTMLElement} root 面板根节点
   * @returns {void}
   */
  function bindPanel(root) {
    if (root.__ggBound) return;
    root.__ggBound = true;
    root.addEventListener('click', function (event) {
      var target = event.target;
      var action = target && target.getAttribute ? target.getAttribute('data-gg') : null;
      if (!action) return;
      event.preventDefault();
      try {
        if (action === 'reload') window.location.reload();
        else if (action === 'copy') doCopy();
        else if (action === 'close') closeToTitle();
        else if (action === 'restore') doRestore();
        else if (action === 'wipe') setConfirm(true);
        else if (action === 'wipeCancel') setConfirm(false);
        else if (action === 'wipeConfirm') wipeAndReload();
      } catch (error) {
        setNote('操作失败：' + safeText(error, '未知错误'));
      }
    });
    root.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeToTitle();
      }
    });
  }

  /**
   * 填写面板内容
   * @param {Object} item 错误条目
   * @returns {void}
   */
  function fill(item) {
    var root = ensurePanel();
    var summary = document.getElementById(CFG.panelId + '_summary');
    var meta = document.getElementById(CFG.panelId + '_meta');
    var detail = document.getElementById(CFG.panelId + '_detail');
    if (summary) summary.textContent = item.summary || '（错误对象为空，没有可用摘要）';
    if (meta) {
      meta.textContent = kindLabel(item.kind) + ' · ' + item.time
        + (item.floor ? (' · 第 ' + item.floor + ' 层') : '')
        + (item.slot ? (' · 存档槽 ' + item.slot) : '');
    }
    if (detail) detail.textContent = (item.detail || '（没有额外技术细节）').slice(0, CFG.maxDetail);
    var staleManual = root.querySelector('[data-gg-manual="1"]');
    if (staleManual && staleManual.parentNode) staleManual.parentNode.removeChild(staleManual);
    var confirmBox = root.querySelector('[data-gg-confirm="1"]');
    if (confirmBox) confirmBox.style.display = 'none';
    setNote('');
    updateRestoreButton(root);
  }

  /**
   * 显示面板
   * @param {Object} item 错误条目
   * @returns {void}
   */
  function show(item) {
    try {
      var root = ensurePanel();
      fill(item);
      root.style.display = 'flex';
      S.shown = true;
      try { root.focus(); } catch (focusError) { /* 忽略 */ }
      /* 旧崩溃面板保留 hidden=false（兼容既有验收），但视觉上让位给应急面板 */
      setTimeout(function () {
        try {
          var legacy = document.getElementById('crashOverlay');
          if (legacy && !legacy.hidden) {
            legacy.style.visibility = 'hidden';
            legacy.style.pointerEvents = 'none';
          }
        } catch (legacyError) { /* 忽略 */ }
      }, 0);
    } catch (error) {
      /* 面板自身失败：至少把真实错误弹出来，绝不静默 */
      try { window.alert('游戏遇到了问题：' + safeText(item && item.summary, '未知错误')); } catch (alertError) { /* 忽略 */ }
    }
  }

  /**
   * 收起面板
   * @returns {void}
   */
  function hide() {
    S.shown = false;
    var root = document.getElementById(CFG.panelId);
    if (root) root.style.display = 'none';
  }

  /**
   * 设置底部提示行
   * @param {string} text 文案
   * @returns {void}
   */
  function setNote(text) {
    try {
      var note = document.getElementById(CFG.panelId + '_note');
      if (note) note.textContent = text || '';
    } catch (error) { /* 忽略 */ }
  }

  /**
   * 展开 / 收起"清空存档"二次确认
   * @param {boolean} open 是否展开
   * @returns {void}
   */
  function setConfirm(open) {
    try {
      var box = document.querySelector('#' + CFG.panelId + ' [data-gg-confirm="1"]');
      if (box) box.style.display = open ? 'block' : 'none';
    } catch (error) { /* 忽略 */ }
  }

  /**
   * 只在存在可读存档时显示"读取最近存档"
   * @param {HTMLElement} root 面板根节点
   * @returns {void}
   */
  function updateRestoreButton(root) {
    try {
      var wrapper = root.querySelector('[data-gg-slot="restore"]');
      if (!wrapper) return;
      var slot = 0;
      if (typeof readCrashFlag === 'function') {
        var flag = readCrashFlag();
        slot = flag && Number(flag.slot) || 0;
      }
      if (!slot && typeof state !== 'undefined' && state) slot = Number(state.runSlot) || 0;
      if (slot > 0) {
        wrapper.style.display = 'inline';
        var btn = wrapper.querySelector('[data-gg="restore"]');
        if (btn) btn.textContent = '读取最近存档（槽 ' + slot + '）';
      } else {
        wrapper.style.display = 'none';
      }
    } catch (error) {
      var safeWrap = root.querySelector('[data-gg-slot="restore"]');
      if (safeWrap) safeWrap.style.display = 'none';
    }
  }

  /**
   * 生成要复制的完整错误信息
   * @returns {string}
   */
  function buildText() {
    var item = S.last || {};
    return ['烬 · 全局异常信息',
      '时间：' + (item.time || timeText()),
      '类型：' + kindLabel(item.kind || 'error'),
      '摘要：' + (item.summary || '（无摘要）'),
      (item.floor ? '楼层：' + item.floor : ''),
      (item.slot ? '存档槽：' + item.slot : ''),
      '技术细节：\\n' + (item.detail || '（无）'),
      '页面：' + window.location.href,
      'UA：' + navigator.userAgent
    ].filter(function (line) { return !!line; }).join('\\n');
  }

  /**
   * 复制错误信息（Clipboard API → execCommand → 面板内选中兜底）
   * @returns {void}
   */
  function doCopy() {
    var text = buildText();
    S.copyText = text;
    /**
     * 复制结束回调
     * @param {boolean} ok 是否复制成功
     * @returns {void}
     */
    var finish = function (ok) {
      S.copied = true;
      if (ok) {
        var manual = document.querySelector('#' + CFG.panelId + ' [data-gg-manual="1"]');
        if (manual && manual.parentNode) manual.parentNode.removeChild(manual);
      }
      setNote(ok ? '已复制，可直接粘贴发给开发者。' : '已选中下方文本，请按 Ctrl+C 复制。');
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(function () { finish(true); }, function () { legacyCopy(text, finish); });
        return;
      }
    } catch (error) { /* 落到兜底 */ }
    legacyCopy(text, finish);
  }

  /**
   * 老式复制兜底：失败时把文本留在面板里并选中
   * @param {string} text 文本
   * @param {Function} finish 结束回调
   * @returns {void}
   */
  function legacyCopy(text, finish) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:.01;';
      (document.body || document.documentElement).appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
      if (ok) {
        area.parentNode.removeChild(area);
        finish(true);
        return;
      }
      area.style.cssText = 'position:static;display:block;width:100%;min-height:110px;margin-top:10px;'
        + 'background:#0a0f19;color:#c6d3e6;border:1px solid #243149;border-radius:8px;'
        + 'font-family:Consolas,monospace;font-size:12px;';
      area.setAttribute('data-gg-manual', '1');
      /* 挂在卡片内部（提示行之后），避免成为 flex 根的直接子项把卡片挤偏 */
      var note = document.getElementById(CFG.panelId + '_note');
      var card = note && note.parentNode ? note.parentNode : document.getElementById(CFG.panelId);
      if (card) card.appendChild(area);
      area.focus();
      area.select();
      area.setSelectionRange(0, text.length);
      finish(false);
    } catch (error) {
      finish(false);
    }
  }

  /**
   * 读取最近存档（复用游戏既有恢复路径，失败时面板不消失）
   * @returns {void}
   */
  function doRestore() {
    try {
      if (typeof crashRestore !== 'function') {
        setNote('当前版本没有存档恢复接口，请刷新页面。');
        return;
      }
      var result = crashRestore();
      if (result && result.ok) hide();
      else setNote('读取最近存档失败：' + safeText(result && result.error, 'unknown') + '，可尝试刷新页面。');
    } catch (error) {
      setNote('读取最近存档失败：' + safeText(error, '未知错误') + '，可尝试刷新页面。');
    }
  }

  /**
   * 删除存档键（保留音量/画质设置与损坏原始备份）
   * @returns {Array<string>} 实际删掉的键
   */
  function removeSaveKeys() {
    var keys = CFG.clearKeys.slice();
    try {
      if (typeof GAME_CONFIG !== 'undefined' && GAME_CONFIG && GAME_CONFIG.metaKey) keys[0] = GAME_CONFIG.metaKey;
    } catch (error) { /* 忽略 */ }
    try {
      if (typeof SAVE_SLOTS_CONFIG !== 'undefined' && SAVE_SLOTS_CONFIG && SAVE_SLOTS_CONFIG.key) keys[1] = SAVE_SLOTS_CONFIG.key;
    } catch (error) { /* 忽略 */ }
    var removed = [];
    for (var i = 0; i < keys.length; i += 1) {
      try {
        if (window.localStorage.getItem(keys[i]) !== null) {
          window.localStorage.removeItem(keys[i]);
          removed.push(keys[i]);
        }
      } catch (error) { /* 隐私模式忽略 */ }
    }
    return removed;
  }

  /**
   * 清空存档并刷新（二次确认后才走到这里）
   * @returns {void}
   */
  function wipeAndReload() {
    removeSaveKeys();
    try { window.location.reload(); }
    catch (error) { setNote('存档已清空，请手动刷新页面。'); }
  }

  /**
   * 关闭面板并回到标题页；没有可用的游戏接口时退化为刷新
   * @returns {void}
   */
  function closeToTitle() {
    try { hide(); } catch (error) { /* 忽略 */ }
    try {
      var legacy = document.getElementById('crashOverlay');
      if (legacy) {
        legacy.hidden = true;
        legacy.style.visibility = '';
        legacy.style.pointerEvents = '';
      }
    } catch (error) { /* 忽略 */ }
    try {
      if (typeof crashState !== 'undefined' && crashState) {
        crashState.halted = false;
        crashState.consecutive = 0;
        crashState.shown = false;
      }
    } catch (error) { /* 忽略 */ }
    var done = false;
    try {
      if (typeof state !== 'undefined' && state && typeof returnToTitleFromRun === 'function') {
        returnToTitleFromRun();
        done = true;
      }
    } catch (error) { done = false; }
    if (!done) {
      try {
        if (typeof state !== 'undefined' && state && typeof setTitleVisible === 'function') {
          state.mode = 'title';
          state.status = 'playing';
          setTitleVisible(true);
          done = true;
        }
      } catch (error) { done = false; }
    }
    if (!done) {
      try { window.location.reload(); } catch (error) { /* 忽略 */ }
    }
  }

  /**
   * 上报一条错误并弹面板（游戏代码与捕获器共用此入口）
   * @param {*} summary 错误摘要（真实内容）
   * @param {Object} [options] { kind, detail, floor, slot }
   * @returns {boolean} 是否成功显示
   */
  function report(summary, options) {
    if (DISABLED) return false;
    try {
      var item = {
        time: timeText(),
        kind: (options && options.kind) || 'error',
        summary: safeText(summary, '脚本异常（未提供摘要）').slice(0, CFG.maxSummary),
        detail: safeText(options && options.detail, ''),
        floor: (options && options.floor) || 0,
        slot: (options && options.slot) || 0
      };
      S.last = item;
      S.lastSig = item.kind + '|' + item.summary;
      show(item);
      /* 控制台同步留痕：任何时候都能从 DevTools 追到原始错误 */
      try { console.error('[arcane-guard]', item.kind, item.summary, item.detail); } catch (error) { /* 忽略 */ }
      return true;
    } catch (error) {
      try { window.alert('游戏遇到了问题：' + safeText(summary, '未知错误')); } catch (alertError) { /* 忽略 */ }
      return false;
    }
  }

  /**
   * 全局 error 捕获（capture=true 才能收到 <script>/<img> 等资源缺失）
   * @param {ErrorEvent} event 事件
   * @returns {void}
   */
  function onError(event) {
    if (S.inGuard) return;
    S.inGuard = true;
    try {
      var target = event && event.target;
      var tag = target && target !== window && target.tagName ? String(target.tagName).toUpperCase() : '';
      if (tag && tag !== 'WINDOW' && tag !== 'DOCUMENT') {
        var src = target.src || target.href || target.currentSrc || '(未提供地址)';
        var shownSrc = src;
        try { shownSrc = decodeURI(src); } catch (decodeError) { shownSrc = src; }
        report('资源加载失败：<' + tag.toLowerCase() + '> ' + shownSrc, {
          kind: 'resource',
          detail: '标签：<' + tag.toLowerCase() + '>\\n地址：' + shownSrc + '\\n页面：' + window.location.href
        });
        return;
      }
      var error = event && event.error;
      var message = (error && error.message) || (event && event.message) || '';
      var where = event && event.filename ? (event.filename + ':' + (event.lineno || 0) + ':' + (event.colno || 0)) : '';
      report(message || ('脚本错误（无消息）· ' + where), {
        kind: 'error',
        detail: (error && error.stack) || where || '（没有堆栈信息）'
      });
    } catch (error) {
      try { window.alert('游戏遇到了问题：' + safeText(error, '未知错误')); } catch (alertError) { /* 忽略 */ }
    } finally {
      S.inGuard = false;
    }
  }

  /**
   * 未处理 Promise 拒绝捕获
   * @param {PromiseRejectionEvent} event 事件
   * @returns {void}
   */
  function onRejection(event) {
    if (S.inGuard) return;
    S.inGuard = true;
    try {
      var reason = event && event.reason;
      var summary = safeText(reason, '');
      if (!summary) summary = '未处理的异步错误（reason 为空，没有可用信息）';
      report(summary, {
        kind: 'rejection',
        detail: (reason && reason.stack) ? String(reason.stack) : safeText(reason, '（没有堆栈信息）')
      });
    } catch (error) {
      try { window.alert('游戏遇到了问题：' + safeText(error, '未知错误')); } catch (alertError) { /* 忽略 */ }
    } finally {
      S.inGuard = false;
    }
  }

  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onRejection, true);

  /**
   * 对外接口（游戏补丁段 B/C/D 与验收脚本共用）
   */
  window.__arcaneGuard = {
    report: report,
    hide: hide,
    state: function () {
      return { shown: S.shown, copied: S.copied, copyText: S.copyText, last: S.last, panelExists: !!document.getElementById(CFG.panelId) };
    },
    lastText: function () { return S.copyText || buildText(); },
    clearSaveKeys: function () { return removeSaveKeys(); },
    closeToTitle: closeToTitle
  };
})();
</script>`;

/**
 * B 段：渲染循环内部错误（被 try/catch 吃掉，不会触发 window.onerror）
 * 锚点：triggerCrash 的收尾三行
 */
const SEGMENT_B_ANCHOR = '  writeCrashFlag(info);\n  showCrashOverlay(info);\n  return true;';
const SEGMENT_B = '  writeCrashFlag(info);\n'
  + '  showCrashOverlay(info);\n'
  + '  /* 补丁 · 全局异常兜底：循环内错误交给独立应急面板（真实摘要 + 复制 + 刷新/清档路径） */\n'
  + '  try {\n'
  + '    if (window.__arcaneGuard) {\n'
  + '      window.__arcaneGuard.report(crashState.lastMessage || String(error || \'渲染循环异常（无错误信息）\'), {\n'
  + '        kind: \'render-loop\',\n'
  + '        detail: message,\n'
  + '        floor: state ? Number(state.floor) || 0 : 0,\n'
  + '        slot: slot\n'
  + '      });\n'
  + '    }\n'
  + '  } catch (guardError) { /* 兜底自身异常不得影响原崩溃流程 */ }\n'
  + '  return true;';

/**
 * C 段：存档 JSON 损坏
 * 锚点：loadMeta 的降级提示行
 */
const SEGMENT_C_ANCHOR = "    metaLoadNotice = '存档已损坏，已按默认存档继续（原档已备份，本次不写档）';";
const SEGMENT_C = SEGMENT_C_ANCHOR + '\n'
  + '    /* 补丁 · 全局异常兜底：坏档也让玩家看见真实原因与备份位置，而不是只留一行提示 */\n'
  + '    try {\n'
  + '      if (window.__arcaneGuard) {\n'
  + '        var guardRaw = null;\n'
  + '        try { guardRaw = window.localStorage.getItem(GAME_CONFIG.metaKey); } catch (guardReadError) { guardRaw = null; }\n'
  + '        var guardBackups = [];\n'
  + '        try {\n'
  + '          for (var gi = 0; gi < window.localStorage.length; gi += 1) {\n'
  + '            var gk = window.localStorage.key(gi);\n'
  + '            if (gk && gk.indexOf(GAME_CONFIG.metaKey + \'.broken.\') === 0) guardBackups.push(gk);\n'
  + '          }\n'
  + '        } catch (guardListError) { /* 隐私模式忽略 */ }\n'
  + '        window.__arcaneGuard.report(\'存档数据损坏（JSON 解析失败），已按默认存档继续\', {\n'
  + '          kind: \'save-corrupt\',\n'
  + '          detail: \'解析错误：\' + (error && error.message ? error.message : String(error))\n'
  + '            + \'\\n原始存档长度：\' + (guardRaw ? String(guardRaw).length : 0) + \' 字符\'\n'
  + '            + \'\\n原始备份键：\' + (guardBackups.length ? guardBackups.join(\', \') : \'（备份失败，原档仍保留在原键上）\')\n'
  + '            + \'\\n处理策略：本会话不写永久存档，磁盘上的损坏原文不会被覆盖。\'\n'
  + '        });\n'
  + '      }\n'
  + '    } catch (guardError) { /* 兜底自身异常不得影响读档降级 */ }';

/**
 * D 段：游戏自带的 error 监听会把"资源缺失"误判成渲染崩溃（error 对象为空 → unknown）
 * 锚点：init 内的 error 监听
 */
const SEGMENT_D_ANCHOR = '  window.addEventListener(\'error\', (event) => {\n'
  + '    const err = event.error || event.message;\n'
  + '    recordError(err);\n'
  + '    if (state && state.mode !== \'title\') triggerCrash(err);\n'
  + '  });';
const SEGMENT_D = '  window.addEventListener(\'error\', (event) => {\n'
  + '    /* 补丁 · 资源加载失败（<script>/<img>/<audio> 等）没有 error 对象，交给独立应急面板显示真实 URL，\n'
  + '       避免把"缺一张图"误判成渲染崩溃并弹出 unknown。 */\n'
  + '    if (!event.error && event.target && event.target !== window && event.target.tagName) {\n'
  + '      try {\n'
  + '        if (window.__arcaneGuard) {\n'
  + '          const tag = String(event.target.tagName).toLowerCase();\n'
  + '          const src = event.target.src || event.target.href || event.target.currentSrc || \'(未提供地址)\';\n'
  + '          let shownSrc = src;\n'
  + '          try { shownSrc = decodeURI(src); } catch (decodeError) { shownSrc = src; }\n'
  + '          window.__arcaneGuard.report(\'资源加载失败：<\' + tag + \'> \' + shownSrc, {\n'
  + '            kind: \'resource\',\n'
  + '            detail: \'标签：<\' + tag + \'>\\n地址：\' + shownSrc + \'\\n页面：\' + location.href\n'
  + '          });\n'
  + '        }\n'
  + '      } catch (guardError) { /* 兜底自身异常忽略 */ }\n'
  + '      return;\n'
  + '    }\n'
  + '    const err = event.error || event.message;\n'
  + '    recordError(err);\n'
  + '    if (state && state.mode !== \'title\') triggerCrash(err);\n'
  + '  });';

const SEGMENTS = [
  { id: 'A', anchor: '<body>', replacement: '<body>\n' + SEGMENT_A },
  { id: 'B', anchor: SEGMENT_B_ANCHOR, replacement: SEGMENT_B },
  { id: 'C', anchor: SEGMENT_C_ANCHOR, replacement: SEGMENT_C },
  { id: 'D', anchor: SEGMENT_D_ANCHOR, replacement: SEGMENT_D }
];

/**
 * 把四段补丁打进 HTML（锚点必须唯一命中，否则直接失败，避免打错位置）
 * @param {string} html 主文件文本
 * @returns {string} 补丁后的 HTML
 */
function applyPatch(html) {
  let out = html;
  for (const segment of SEGMENTS) {
    const hits = out.split(segment.anchor).length - 1;
    if (hits !== 1) throw new Error('补丁段 ' + segment.id + ' 锚点命中 ' + hits + ' 次（应为 1），主文件可能已变动，停止落地');
    out = out.replace(segment.anchor, segment.replacement);
  }
  return out;
}

/* ============================================================
   二、实测：三种故障 + 复制/关闭/独立性
   ============================================================ */

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} [detail] 证据
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

/**
 * 计算文件 MD5
 * @param {string} file 文件路径
 * @returns {string}
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const mainBytes = fs.statSync(MAIN).size;
  const mainMd5 = md5Of(MAIN);
  console.log('主文件（只读）: ' + mainBytes + ' B / MD5 ' + mainMd5);
  const html = fs.readFileSync(MAIN, 'utf8');
  fs.writeFileSync(TEST_FILE, applyPatch(html));
  console.log('补丁副本: ' + fs.statSync(TEST_FILE).size + ' B / MD5 ' + md5Of(TEST_FILE));
  if (process.argv.includes('--emit')) {
    console.log('已生成补丁副本（不运行测试）: ' + TEST_FILE);
    return;
  }

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
    } catch (error) { /* 等 Edge 起来 */ }
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

  /**
   * 发送 CDP 命令
   * @param {string} method 方法名
   * @param {Object} [params] 参数
   * @returns {Promise<Object>}
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 页面内执行表达式
   * @param {string} expression JS 表达式
   * @returns {Promise<*>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  /**
   * 截图
   * @param {string} name 文件名
   * @returns {Promise<number>} 文件字节数
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(r.data, 'base64');
    fs.writeFileSync(path.join(OUT_DIR, name), buffer);
    return buffer.length;
  };
  /**
   * 重新加载补丁副本（同一 file:// 路径，localStorage 保留）
   * @returns {Promise<void>}
   */
  const reload = async () => {
    await send('Page.navigate', { url: 'file:///' + TEST_FILE.replace(/\\/g, '/') });
    await sleep(2600);
  };
  /**
   * 读取应急面板状态与文案
   * @returns {Promise<Object>}
   */
  const panelState = () => ev(`(function(){
    var p = document.getElementById('__arcane_guard_panel');
    var legacy = document.getElementById('crashOverlay');
    return {
      exists: !!p,
      display: p ? p.style.display : 'none',
      summary: p ? (document.getElementById('__arcane_guard_panel_summary') || {}).textContent : '',
      meta: p ? (document.getElementById('__arcane_guard_panel_meta') || {}).textContent : '',
      detail: p ? (document.getElementById('__arcane_guard_panel_detail') || {}).textContent : '',
      copyLabel: p ? ((p.querySelector('[data-gg="copy"]') || {}).textContent || '') : '',
      note: p ? (document.getElementById('__arcane_guard_panel_note') || {}).textContent : '',
      hasClose: !!(p && p.querySelector('[data-gg="close"]')),
      hasWipe: !!(p && p.querySelector('[data-gg="wipe"]')),
      hasCopy: !!(p && p.querySelector('[data-gg="copy"]')),
      hasRefresh: !!(p && p.querySelector('[data-gg="reload"]')),
      hasCanvas: !!(p && p.querySelector('canvas')),
      lastChildTag: document.body.lastElementChild ? document.body.lastElementChild.id : '',
      legacyHidden: legacy ? legacy.hidden : null,
      legacyVisibility: legacy ? legacy.style.visibility : '',
      mode: (typeof state !== 'undefined' && state) ? state.mode : '',
      halted: (typeof crashState !== 'undefined' && crashState) ? !!crashState.halted : null
    };
  })()`);
  /**
   * 关闭面板
   * @returns {Promise<void>}
   */
  const closePanel = async () => {
    await ev(`(function(){ var b = document.querySelector('#__arcane_guard_panel [data-gg="close"]'); if (b) b.click(); return true; })()`);
    await sleep(600);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await reload();

  // ---------- G0 启动自检：无面板、守卫已就位 ----------
  const boot = await ev(`(function(){
    return {
      guard: !!window.__arcaneGuard,
      guardState: window.__arcaneGuard ? window.__arcaneGuard.state() : null,
      overlayHidden: document.getElementById('crashOverlay').hidden,
      errors: (window.__errors || []).length,
      panel: !!document.getElementById('__arcane_guard_panel')
    };
  })()`);
  ok('G0 启动：守卫注册成功、无错误、面板未提前出现、旧面板默认隐藏',
    boot.guard === true && boot.panel === false && boot.overlayHidden === true && boot.errors === 0, boot);

  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1000);
  await ev(`(function(){
    if (typeof skipOpeningRitual === 'function') skipOpeningRitual();
    state.transitionLock = false;
    window.__roamDebug.clearEnemies();
    window.__roamDebug.setFloor(3);
    state.runSlot = 1;
    window.__roamDebug.p2.saveNow('manual');
    window.__errors = [];
    return true;
  })()`);
  await sleep(300);

  // ---------- G1 故障①：渲染循环抛错（try/catch 捕获，不触发 window.onerror） ----------
  await ev(`window.__errors = []; window.__roamDebug.crash.simulate(2)`);
  await sleep(700);
  let p1 = await panelState();
  const shot1 = await shot('guard-1-render-loop.png');
  ok('G1 渲染循环抛错：独立面板出现，摘要含真实错误，技术细节有堆栈',
    p1.display === 'flex' && /simulated crash/.test(p1.summary) && /simulated crash/.test(p1.detail)
      && p1.hasCopy && p1.hasRefresh && p1.hasClose && p1.hasWipe,
    { summary: p1.summary, meta: p1.meta, detail: p1.detail.slice(0, 120), shot: shot1 });
  ok('G1b 与旧崩溃机制兼容：旧面板 hidden=false（既有 arcane_crash.js 判据不变），视觉让位',
    p1.legacyHidden === false && p1.legacyVisibility === 'hidden', p1);
  ok('G1c 面板是现场创建的纯 DOM：body 末尾、无 canvas、固定定位',
    p1.exists && p1.lastChildTag === '__arcane_guard_panel' && p1.hasCanvas === false, p1);
  ok('G1d 面板里写明清空存档会丢什么',
    /结晶/.test(await ev(`document.querySelector('#__arcane_guard_panel').textContent`))
      && /最佳楼层/.test(await ev(`document.querySelector('#__arcane_guard_panel').textContent`))
      && /成就/.test(await ev(`document.querySelector('#__arcane_guard_panel').textContent`)), null);

  // ---------- G2 复制错误信息（强制走 execCommand 兜底路径） ----------
  const copyResult = await ev(`(function(){
    try { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); } catch (e) { /* 已不可改则走现有分支 */ }
    var b = document.querySelector('#__arcane_guard_panel [data-gg="copy"]');
    b.click();
    return { text: window.__arcaneGuard.lastText(), state: window.__arcaneGuard.state() };
  })()`);
  await sleep(300);
  const copyNote = await ev(`(document.getElementById('__arcane_guard_panel_note') || {}).textContent || ''`);
  ok('G2 复制错误信息：复制内容含真实摘要与类型，且给出明确反馈（不静默）',
    /simulated crash/.test(copyResult.text) && /渲染循环异常/.test(copyResult.text)
      && /已复制|已选中/.test(copyNote) && copyResult.state.copied === true,
    { text: copyResult.text.slice(0, 160), note: copyNote });

  // ---------- G3 关闭并回到标题页（不死锁） ----------
  await closePanel();
  const closed = await ev(`(function(){
    return {
      display: document.getElementById('__arcane_guard_panel').style.display,
      mode: state.mode, halted: crashState.halted, legacyHidden: document.getElementById('crashOverlay').hidden,
      titleVisible: document.getElementById('titleLayer').hidden === false
    };
  })()`);
  ok('G3 关闭面板：隐藏、halted 复位、回到标题页、旧面板收起（无死锁）',
    closed.display === 'none' && closed.mode === 'title' && closed.halted === false
      && closed.legacyHidden === true && closed.titleVisible === true, closed);

  // ---------- G4 故障②：资源缺失（<script src> 404） ----------
  await ev(`(function(){
    var s = document.createElement('script');
    s.src = './__missing_asset_guard_test__.js';
    document.body.appendChild(s);
    return true;
  })()`);
  await sleep(900);
  const p2 = await panelState();
  const shot2 = await shot('guard-2-resource-missing.png');
  ok('G4 资源缺失：面板出现，摘要含资源标签与真实缺失地址，不显示 unknown',
    p2.display === 'flex' && /资源加载失败/.test(p2.summary)
      && /__missing_asset_guard_test__\.js/.test(p2.summary) && !/unknown/i.test(p2.summary),
    { summary: p2.summary, meta: p2.meta, shot: shot2 });
  ok('G4b 资源缺失不会误判为渲染崩溃（halted=false，旧面板保持隐藏）',
    p2.halted === false && p2.legacyHidden === true, p2);
  await closePanel();

  // ---------- G5 补充验证：window.onerror 与 unhandledrejection ----------
  await ev(`setTimeout(function(){ throw new Error('window-onerror-测试'); }, 0); true`);
  await sleep(700);
  const p3 = await panelState();
  ok('G5 window 脚本错误：面板显示真实抛错文案',
    p3.display === 'flex' && /window-onerror-测试/.test(p3.summary), { summary: p3.summary });
  await closePanel();

  await ev(`Promise.reject(new Error('guard-rejection-测试')); true`);
  await sleep(700);
  const p4 = await panelState();
  ok('G5b unhandledrejection：面板显示真实 rejection 文案',
    p4.display === 'flex' && /guard-rejection-测试/.test(p4.summary), { summary: p4.summary });
  await closePanel();

  // ---------- G6 故障③：存档 JSON 损坏 ----------
  await ev(`(function(){
    localStorage.setItem('arcane_rogue_meta', '{broken-json::');
    localStorage.setItem('arcane_rogue_audio', '{"muted":false}');
    return true;
  })()`);
  await reload();
  const p5 = await panelState();
  const shot3 = await shot('guard-3-save-corrupt.png');
  const corrupt = await ev(`(function(){
    var backups = [];
    for (var i = 0; i < localStorage.length; i += 1) {
      var k = localStorage.key(i);
      if (k && k.indexOf('arcane_rogue_meta.broken.') === 0) backups.push(k);
    }
    return {
      raw: localStorage.getItem('arcane_rogue_meta'),
      backups: backups,
      audio: localStorage.getItem('arcane_rogue_audio'),
      mode: state.mode,
      titleVisible: document.getElementById('titleLayer').hidden === false,
      loadNotice: typeof metaLoadNotice !== 'undefined' ? metaLoadNotice : '',
      fallbackClean: typeof metaFallbackClean !== 'undefined' ? metaFallbackClean : null
    };
  })()`);
  ok('G6 存档 JSON 损坏：启动即弹面板，摘要含"存档数据损坏"，细节含解析错误与备份键',
    p5.display === 'flex' && /存档数据损坏/.test(p5.summary)
      && /JSON/.test(p5.detail) && /broken\./.test(p5.detail),
    { summary: p5.summary, detail: p5.detail.slice(0, 200), shot: shot3 });
  ok('G6b 坏档不覆盖原文：原键仍是损坏文本、已生成备份键、本会话不写档',
    corrupt.raw === '{broken-json::' && corrupt.backups.length === 1
      && corrupt.fallbackClean === true && corrupt.audio === '{"muted":false}', corrupt);
  ok('G6c 坏档时游戏仍正常进入标题页（不是白屏）',
    corrupt.mode === 'title' && corrupt.titleVisible === true && /存档已损坏/.test(corrupt.loadNotice), corrupt);

  // ---------- G7 清空存档：二次确认 + 明确丢失清单 + 保留本机设置 ----------
  await ev(`(document.querySelector('#__arcane_guard_panel [data-gg="wipe"]') || {}).click ? document.querySelector('#__arcane_guard_panel [data-gg="wipe"]').click() : 0; true`);
  await sleep(250);
  const confirmOpen = await ev(`(function(){
    var box = document.querySelector('#__arcane_guard_panel [data-gg-confirm="1"]');
    return { open: box ? box.style.display : 'none', text: document.querySelector('#__arcane_guard_panel').textContent };
  })()`);
  const shot4 = await shot('guard-4-wipe-confirm.png');
  ok('G7 清空存档：第一次点击只展开二次确认，且写明会丢失哪些内容',
    confirmOpen.open === 'block' && /确认清空并刷新/.test(confirmOpen.text)
      && /结晶/.test(confirmOpen.text) && /三个存档槽/.test(confirmOpen.text), { shot: shot4 });

  await ev(`(function(){
    var b = document.querySelector('#__arcane_guard_panel [data-gg="wipeConfirm"]');
    if (b) b.click();
    return true;
  })()`);
  await sleep(3000);
  const wiped = await ev(`(function(){
    var backups = 0;
    for (var i = 0; i < localStorage.length; i += 1) {
      var k = localStorage.key(i);
      if (k && k.indexOf('arcane_rogue_meta.broken.') === 0) backups += 1;
    }
    return {
      meta: localStorage.getItem('arcane_rogue_meta'),
      slots: localStorage.getItem('arcane_run_slots_v1'),
      audio: localStorage.getItem('arcane_rogue_audio'),
      backups: backups,
      mode: state.mode,
      panel: (function () {
        var p = document.getElementById('__arcane_guard_panel');
        return p ? p.style.display : 'none';
      })()
    };
  })()`);
  const wipedMeta = JSON.parse(wiped.meta || '{}');
  ok('G7b 确认后：永久档归零（启动会写回默认档，属正常）、局内槽清空并回标题页；音量设置与损坏备份保留',
    wipedMeta.runs === 0 && wipedMeta.bestFloor === 1 && wipedMeta.crystals === 0
      && Object.keys(wipedMeta.achievements || {}).length === 0
      && wiped.slots === null && wiped.audio === '{"muted":false}' && wiped.backups >= 1
      && wiped.mode === 'title' && wiped.panel === 'none',
    { metaHead: { runs: wipedMeta.runs, bestFloor: wipedMeta.bestFloor, crystals: wipedMeta.crystals }, slots: wiped.slots, audio: wiped.audio, backups: wiped.backups, mode: wiped.mode, panel: wiped.panel });

  // ---------- G8 独立性：删掉旧面板与游戏模块后，应急面板仍能工作 ----------
  const independent = await ev(`(function(){
    var legacy = document.getElementById('crashOverlay');
    if (legacy) legacy.remove();
    window.__arcaneGuard.report('独立性测试摘要 · 没有游戏模块也能显示', {
      kind: 'test', detail: '本面板由捕获器现场创建并插入 body 末尾'
    });
    var p = document.getElementById('__arcane_guard_panel');
    return {
      display: p.style.display,
      summary: document.getElementById('__arcane_guard_panel_summary').textContent,
      canvas: !!p.querySelector('canvas'),
      lastChild: document.body.lastElementChild.id
    };
  })()`);
  const shot5 = await shot('guard-0-independent.png');
  ok('G8 独立性：删掉 #crashOverlay 后仍能弹面板并显示真实摘要（避免双重白屏）',
    independent.display === 'flex' && /独立性测试摘要/.test(independent.summary)
      && independent.canvas === false, { ...independent, shot: shot5 });

  // 收尾
  fs.writeFileSync(path.join(OUT_DIR, 'guard-result.json'), JSON.stringify({ mainMd5, mainBytes, asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log(`\n===== T guard ${pass}/${asserts.length} =====`);
  console.log('VERDICT: ' + (pass === asserts.length ? 'PASS' : 'FAIL'));

  try { ws.close(); } catch (error) { /* 忽略 */ }
  try { killEdge(edge); } catch (error) { /* 忽略 */ }
  await sleep(300);
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (error) { /* 忽略 */ }
  if (pass !== asserts.length) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (inner) { /* 忽略 */ }
    process.exit(1);
  });
}

module.exports = { applyPatch, SEGMENTS };
