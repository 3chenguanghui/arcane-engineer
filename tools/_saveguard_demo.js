// 临时：按 SAVE_GUARD_PATCH.md §五 真跑演示 A/B/C/D（浏览器级 CDP + 页面级 CDP）
// 用法：node tools\_saveguard_demo.js（建议先设 ARCANE_PROFILE_ROOT 独立目录）；跑完即删
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9413;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const URL_MAIN = 'file:///' + MAIN.replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let printed = false;

/**
 * 记录一条断言并即时打印
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {string} detail 证据摘要
 * @returns {void}
 */
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} · ${name} · ${detail}`);
}

/** 保证异常中断也能看到已跑出的进度（不吞掉失败） */
process.on('exit', () => {
  if (printed) return;
  const failed = results.filter((r) => !r.pass);
  process.stdout.write(`\nSUMMARY(interrupted) ${results.length - failed.length}/${results.length} PASS\n`);
});

/**
 * 极简 CDP 连接：一条 WebSocket 对应一个目标（浏览器级 / 页面级都复用）
 * @param {string} wsUrl 调试地址
 * @param {string} label 日志用标签
 */
class Conn {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label || 'page';
    this.seq = 0;
    this.pending = new Map();
    this.waiters = new Map();
    this.errors = [];
  }

  /** 建立连接 */
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p.rej(new Error('CDP ' + m.method + ' :: ' + JSON.stringify(m.error)));
        else p.res(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params && m.params.exceptionDetails;
        this.errors.push(String((d && (d.exception && d.exception.description)) || (d && d.text) || 'exception'));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') {
        this.errors.push((m.params.args || []).map((a) => a.value || a.description || '').join(' '));
      }
      const list = this.waiters.get(m.method);
      if (list && list.length) {
        this.waiters.set(m.method, []);
        list.forEach((fn) => fn(m.params));
      }
    };
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('WS 连接失败：' + this.wsUrl));
    });
  }

  /**
   * 发一条 CDP 命令（10s 超时兜底，避免脚本静默挂死）
   * @param {string} method 方法名
   * @param {object} params 参数
   * @returns {Promise<any>}
   */
  send(method, params = {}) {
    return new Promise((res, rej) => {
      this.seq += 1;
      const id = this.seq;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('CDP 超时：' + method));
        }
      }, 10000);
      this.pending.set(id, {
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); }
      });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { this.pending.delete(id); clearTimeout(timer); rej(e); }
    });
  }

  /**
   * 等一次页面事件（如 Page.loadEventFired）
   * @param {string} method 事件名
   * @param {number} timeoutMs 超时
   * @returns {Promise<any>}
   */
  once(method, timeoutMs = 15000) {
    return new Promise((res, rej) => {
      const list = this.waiters.get(method) || [];
      const fn = (p) => { clearTimeout(timer); res(p); };
      list.push(fn);
      this.waiters.set(method, list);
      const timer = setTimeout(() => {
        const cur = this.waiters.get(method) || [];
        this.waiters.set(method, cur.filter((x) => x !== fn));
        rej(new Error('等事件超时：' + method));
      }, timeoutMs);
    });
  }

  /**
   * 页面求值并取 JSON 值
   * @param {string} expression JS 表达式
   * @returns {Promise<any>}
   */
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面异常 :: ' + ((d.exception && d.exception.description) || d.text));
    }
    return r.result ? r.result.value : undefined;
  }

  /** 关闭 WS（不结束页面） */
  close() {
    try { this.ws.close(); } catch (e) { /* 已关闭 */ }
  }
}

/**
 * 轮询页面是否已完成脚本初始化
 * @param {Conn} p 页面连接
 * @param {number} timeoutMs 超时
 * @returns {Promise<void>}
 */
async function waitReady(p, timeoutMs = 12000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const ok = await p.ev('typeof state !== "undefined" && typeof SaveGuard !== "undefined"').catch(() => false);
    if (ok === true) {
      await sleep(250);   // 让 boot 后的首帧副作用落定
      return;
    }
    await sleep(200);
  }
  throw new Error('页面未就绪：' + p.label);
}

/**
 * 新开一个标签页（about:blank 先建，再导航，保证 WS 可连）
 * @param {Conn} browser 浏览器级连接
 * @param {string} url 目标地址
 * @returns {Promise<Conn>}
 */
async function openTab(browser, url) {
  const t = await browser.send('Target.createTarget', { url: 'about:blank' });
  let target = null;
  for (let i = 0; i < 60; i += 1) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((x) => x.id === t.targetId && x.webSocketDebuggerUrl);
    if (target) break;
    await sleep(150);
  }
  if (!target) throw new Error('新标签页未就绪');
  const p = new Conn(target.webSocketDebuggerUrl, t.targetId);
  p.id = t.targetId;              // 关标签页时要用
  await p.open();
  await p.send('Runtime.enable');
  await p.send('Page.enable');
  await p.send('Page.navigate', { url });
  await waitReady(p, 15000);
  return p;
}

/**
 * 刷新页面并等新一轮脚本初始化完成
 * @param {Conn} p 页面连接
 * @returns {Promise<void>}
 */
async function reloadTab(p) {
  const loaded = p.once('Page.loadEventFired', 15000).catch(() => null);
  await p.send('Page.reload');
  await loaded;
  await waitReady(p, 15000);
}

/**
 * 从标题页真正开一局（若弹出角色选择层，双击第一张卡确认）
 * 目的：设置面板只允许在非标题态打开，演示必须走进游戏
 * @param {Conn} p 页面连接
 * @returns {Promise<string>} 开局后的 state.mode
 */
async function startRun(p) {
  await p.ev(`document.getElementById('btnStart').click()`);
  await sleep(500);
  let mode = await p.ev(`state.mode`);
  if (mode === 'title') {
    await p.ev(`(function(){ var card = document.querySelector('.char-card'); if (!card) return false; card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()`);
    await sleep(900);
    mode = await p.ev(`state.mode`);
  }
  return mode;
}

/**
 * 主流程：A 坏档 / B 写前快照与回滚 / C 双标签页 / D 一键关闭
 * @returns {Promise<void>}
 */
async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  try {
    let base = null;
    for (let i = 0; i < 90; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        base = list.find((x) => x.type === 'page');
        if (base) break;
      } catch (e) { /* 等端口 */ }
      await sleep(250);
    }
    if (!base) throw new Error('调试端口未就绪');

    const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const browser = new Conn(ver.webSocketDebuggerUrl, 'browser');
    await browser.open();

    /* ================= 演示 A · 坏档不覆盖 ================= */
    const A = await openTab(browser, URL_MAIN);
    // 种一份好档：先写 5（留下 0 的备份），再写 6（留下 5 的备份）
    await A.ev(`(function(){ state.meta.crystals = 5; saveMeta(); state.meta.crystals = 6; saveMeta(); return localStorage.getItem('arcane_rogue_meta').length; })()`);
    await sleep(200);
    const trunc = await A.ev(`(function(){ var k='arcane_rogue_meta'; var t=localStorage.getItem(k); var half=t.slice(0, Math.floor(t.length/2)); localStorage.setItem(k, half); return { full: t.length, half: half.length }; })()`);
    await reloadTab(A);
    const a1 = await A.ev(`(function(){
      var broken = Object.keys(localStorage).filter(function(k){ return k.indexOf('arcane_rogue_meta.broken.') === 0; });
      var baks = Object.keys(localStorage).filter(function(k){ return k.indexOf('arcane_rogue_meta.bak.') === 0; });
      var goodLen = 0;
      for (var i = 0; i < baks.length; i += 1) { goodLen = Math.max(goodLen, (localStorage.getItem(baks[i]) || '').length); }
      var b = document.getElementById('saveGuardBanner');
      return { brokenCount: broken.length,
        brokenLen: broken.length ? localStorage.getItem(broken[0]).length : 0,
        goodLen: goodLen,
        diskLen: (localStorage.getItem('arcane_rogue_meta') || '').length,
        bannerShown: b ? getComputedStyle(b).display !== 'none' : false,
        crystals: state.meta.crystals, readOnly: SaveGuard.isReadOnly() };
    })()`);
    record('A1 坏档被留存 / 旧好档仍在 / 本次不写档 / 不误报只读',
      a1.brokenCount >= 1 && a1.brokenLen === trunc.half && a1.goodLen >= trunc.full
        && a1.diskLen === trunc.half && a1.crystals === 0 && a1.bannerShown === false && a1.readOnly === false,
      `broken=${a1.brokenCount}(${a1.brokenLen}/${trunc.half}) good=${a1.goodLen}/${trunc.full} disk=${a1.diskLen} crystals=${a1.crystals} banner=${a1.bannerShown} ro=${a1.readOnly}`);

    // 设置页只能在非标题态打开：先真正开一局，再点「设置」
    const startModeA = await startRun(A);
    await A.ev(`document.getElementById('btnSettings').click()`);
    await sleep(500);
    const a2 = await A.ev(`(function(){
      var list = document.getElementById('sgList');
      var panel = document.getElementById('settingsPanel');
      return { mode: state.mode, open: panel.classList.contains('is-open'),
        text: list ? list.textContent : '',
        copyBtns: document.querySelectorAll('[data-sg-copy]').length,
        banner: !!document.getElementById('saveGuardBanner') };
    })()`);
    record('A2 设置页能看到损坏原文并可复制',
      a2.open === true && a2.text.indexOf('损坏原文') >= 0 && a2.copyBtns >= 1,
      `open=${a2.open} mode=${a2.mode} 开局=${startModeA} copyBtns=${a2.copyBtns} text=${String(a2.text).slice(0, 60)}`);

    const a3pick = await A.ev(`(function(){
      var baks = SaveGuard.listBackups();
      for (var i = 0; i < baks.length; i += 1) {
        try { var o = JSON.parse(baks[i].text); if (o && o.crystals === 5) { localStorage.setItem('arcane_rogue_meta', baks[i].text); return baks[i].key; } } catch (e) { /* 跳过 */ }
      }
      return null;
    })()`);
    await reloadTab(A);
    const a4 = await A.ev(`(function(){ return state.meta.crystals; })()`);
    record('A3 用备份写回后结晶回到备份时刻', !!a3pick && a4 === 5, `pick=${a3pick} crystals=${a4}`);

    /* ================= 演示 B · 写前快照 + 回滚可撤销 ================= */
    const startModeB = await startRun(A);
    await A.ev(`document.getElementById('btnSettings').click()`);
    await sleep(500);
    const b0Key = await A.ev(`(function(){ var l=SaveGuard.listBackups(); return l.length ? l[0].key : null; })()`);

    // 升级写入：saveMeta 触发"写前自动留档"，最新副本应是升级之前的档
    await A.ev(`(function(){ state.meta.crystals += 10; state.meta.talents = state.meta.talents || {}; state.meta.talents.hp = 1; saveMeta(); return state.meta.crystals; })()`);
    await sleep(400);
    const b2 = await A.ev(`(function(){
      var list = SaveGuard.listBackups();
      var o = list.length ? JSON.parse(list[0].text) : null;
      return { key: list.length ? list[0].key : null, count: list.length,
        crystals: o ? o.crystals : null, hp: !!(o && o.talents && o.talents.hp) };
    })()`);
    const preUpgradeKey = b2.key;
    record('B1 写前自动留档：最新副本是升级之前的档',
      !!preUpgradeKey && preUpgradeKey !== b0Key && b2.crystals === 5 && b2.hp === false,
      `key ${b0Key} → ${preUpgradeKey} crystals=${b2.crystals} hp=${b2.hp} count=${b2.count}`);

    // 手动留档：列表有 3 份上限，用"顶部时间戳换新"判断，不看份数
    await A.ev(`document.getElementById('sgBackupNow').click()`);
    await sleep(400);
    const b1 = await A.ev(`(function(){
      var l = SaveGuard.listBackups();
      var o = l.length ? JSON.parse(l[0].text) : null;
      return { key: l.length ? l[0].key : null, count: l.length, crystals: o ? o.crystals : null };
    })()`);
    record('B2 手动留档成功（顶部换成新时间戳，份数受 3 份上限约束）',
      !!b1.key && b1.key !== preUpgradeKey && b1.crystals === 15,
      `key ${preUpgradeKey} → ${b1.key} crystals=${b1.crystals} count=${b1.count} (开局=${startModeB})`);

    // 回滚到"升级前"那份（指定 key，避免列表顶部换成手动留档后点错）
    const pre = await A.ev(`Object.keys(localStorage).filter(function(k){ return k.indexOf('arcane_rogue_meta.prerestore.') === 0; }).length`);
    const sel = '[data-sg-restore="' + preUpgradeKey + '"]';
    await A.ev(`document.querySelector('${sel}').click()`);
    await sleep(350);
    const confirmText = await A.ev(`(function(){ var b=document.querySelector('${sel}'); return b ? b.textContent : 'no-btn'; })()`);
    const loadAfterRestore = A.once('Page.loadEventFired', 15000).catch(() => null);
    await A.ev(`document.querySelector('${sel}').click()`);
    await loadAfterRestore;
    await waitReady(A, 15000);
    const b3 = await A.ev(`(function(){
      return { crystals: state.meta.crystals, hp: (state.meta.talents && state.meta.talents.hp) || 0,
        pre: Object.keys(localStorage).filter(function(k){ return k.indexOf('arcane_rogue_meta.prerestore.') === 0; }).length };
    })()`);
    record('B3 回滚回到升级前且留下 .prerestore',
      /再点/.test(confirmText) && b3.crystals === 5 && b3.hp === 0 && b3.pre > pre,
      `confirm="${confirmText}" crystals=${b3.crystals} hp=${b3.hp} pre ${pre}→${b3.pre}`);

    /* ================= 演示 C · 双标签页 ================= */
    const B = await openTab(browser, URL_MAIN);
    const c1 = await B.ev(`(function(){
      var b = document.getElementById('saveGuardBanner');
      var st = document.getElementById('sgState');
      return { banner: b ? getComputedStyle(b).display !== 'none' : false,
        text: b ? b.textContent : '', state: st ? st.textContent : '', ro: SaveGuard.isReadOnly() };
    })()`);
    record('C1 B 页只读 + 常驻横幅',
      c1.banner === true && c1.ro === true && /只读/.test(c1.state) && /本页的永久进度不会保存/.test(c1.text),
      JSON.stringify(c1).slice(0, 150));

    const beforeHp = await B.ev(`(state.meta.talents && state.meta.talents.hp) || 0`);
    await A.ev(`(function(){ state.meta.talents = state.meta.talents || {}; state.meta.talents.hp = 2; saveMeta(); return state.meta.talents.hp; })()`);
    await sleep(400);
    await browser.send('Target.closeTarget', { targetId: A.id });
    A.close();
    await sleep(900);
    await reloadTab(B);
    // A 关闭后锁可能晚一拍释放：最多等 3s 让 B 拿回写权
    let c2 = null;
    for (let i = 0; i < 8; i += 1) {
      c2 = await B.ev(`(function(){ return { hp: (state.meta.talents && state.meta.talents.hp) || 0, canWrite: SaveGuard.canWrite(), ro: SaveGuard.isReadOnly() }; })()`);
      if (c2.canWrite === true) break;
      await sleep(400);
    }
    record('C2 A 的写入没被 B 覆盖（B 接手后读到新等级）',
      c2.hp === 2 && beforeHp !== 2 && c2.canWrite === true,
      `${JSON.stringify(c2)} beforeHp=${beforeHp}`);

    const C = await openTab(browser, URL_MAIN);
    const c3 = await C.ev(`(function(){
      var b = document.getElementById('saveGuardBanner');
      return { ro: SaveGuard.isReadOnly(), banner: b ? getComputedStyle(b).display !== 'none' : false };
    })()`);
    record('C3 B 持锁时新标签页 C 也是只读', c3.ro === true && c3.banner === true, JSON.stringify(c3));

    await browser.send('Target.closeTarget', { targetId: B.id });
    B.close();
    await sleep(900);
    // 点「重试写入」；若锁尚未释放则每秒重试，最多 16s（覆盖 15s TTL 自愈）
    let c4 = null;
    let attempts = 0;
    for (let i = 0; i < 17; i += 1) {
      attempts += 1;
      await C.ev(`document.getElementById('sgRetry').click()`);
      await sleep(500);
      c4 = await C.ev(`(function(){
        var b = document.getElementById('saveGuardBanner');
        return { canWrite: SaveGuard.canWrite(), ro: SaveGuard.isReadOnly(), banner: b ? getComputedStyle(b).display !== 'none' : false };
      })()`);
      if (c4.canWrite === true) break;
      await sleep(1000);
    }
    record('C4 占用页关闭后「重试写入」拿回写权',
      !!c4 && c4.canWrite === true && c4.ro === false && c4.banner === false,
      `${JSON.stringify(c4)} attempts=${attempts}`);

    /* ================= 演示 D · ?saveguard=off ================= */
    const D = await openTab(browser, URL_MAIN + '?saveguard=off');
    const d1 = await D.ev(`(function(){
      var b = document.getElementById('saveGuardBanner');
      return { enabled: SaveGuard.cfg.enabled, banner: b ? getComputedStyle(b).display !== 'none' : false,
        panel: !!document.getElementById('saveGuardSection'), canWrite: SaveGuard.canWrite() };
    })()`);
    const d2 = await D.ev(`(function(){ var before=localStorage.getItem('arcane_rogue_meta'); state.meta.crystals += 1; saveMeta(); var after=localStorage.getItem('arcane_rogue_meta'); return { changed: before !== after, crystals: state.meta.crystals }; })()`);
    record('D1 ?saveguard=off 完全回退（无横幅/无设置区/仍能写档）',
      d1.enabled === false && d1.banner === false && d1.panel === false && d1.canWrite === true && d2.changed === true,
      JSON.stringify(d1) + ' ' + JSON.stringify(d2));

    const errs = [].concat(A.errors, B.errors, C.errors, D.errors);
    // 演示 A 故意制造坏档，全局兜底会打一条 save-corrupt 说明日志——属于预期，不算回归
    const intentional = errs.filter((e) => /save-corrupt|存档数据损坏/.test(String(e)));
    const unexpected = errs.filter((e) => !/save-corrupt|存档数据损坏/.test(String(e)));
    record('E1 全流程无非预期 console error（坏档演示的 1 条说明日志除外）', unexpected.length === 0,
      unexpected.length ? JSON.stringify(unexpected.slice(0, 3)) : `0（预期日志 ${intentional.length} 条）`);

    for (const p of [A, B, C, D]) p.close();
    browser.close();
  } finally {
    killEdge(edge);
  }

  printed = true;
  const failed = results.filter((r) => !r.pass);
  process.stdout.write(`\nSUMMARY ${results.length - failed.length}/${results.length} PASS\n`);
  if (failed.length) failed.forEach((f) => console.log('  - ' + f.name));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e && e.message ? e.message : e);
  process.exit(1);
});
