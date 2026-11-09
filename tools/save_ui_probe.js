/* ============================================================
   save_ui_probe.js · 存档界面专项验收
   ------------------------------------------------------------
   流程：启动无头 Edge → 打开预览页 → 走三条必测路径 →
        截图 + 记录对比度 / 网络请求 / 异常 → 输出 JSON。
   依赖：只用 Node 内置（fetch / WebSocket / child_process），零 npm。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PROJECT = 'D:\\其他\\TRAE宝\\奥术工程师';
const PAGE_URL = 'file:///D:/%E5%85%B6%E4%BB%96/TRAE%E5%AE%9D/%E5%A5%A5%E6%9C%AF%E5%B7%A5%E7%A8%8B%E5%B8%88/save-ui-preview.html';
const SHOT_DIR = path.join(PROJECT, '.screenshots', 'save-ui');
const RESULT_FILE = path.join(SHOT_DIR, 'save-ui-result.json');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9692;

const checks = [];
const shots = [];
const exceptions = [];
const consoleErrors = [];
const requests = [];

/** 断言：记录并通过 / 抛出 */
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail === undefined ? '' : detail });
  if (!pass) throw new Error('断言失败：' + name + (detail ? ' · ' + detail : ''));
}

/** 等待毫秒 */
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** 极简 CDP 客户端 */
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
      }
      const list = this.handlers.get(msg.method) || [];
      list.forEach((fn) => fn(msg.params));
    });
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
    });
  }
  send(method, params) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时：' + method));
        }
      }, 20000);
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

/** 等待调试端口就绪 */
async function waitPort() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (res.ok) return;
    } catch (error) { /* 继续等 */ }
    await sleep(250);
  }
  throw new Error('Edge 调试端口未启动');
}

/** 写截图 */
async function shot(cdp, name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(SHOT_DIR, name);
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  shots.push(name);
  return file;
}

/** 计算 WCAG 相对亮度 */
function luminance(rgb) {
  const parts = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

/** 计算对比度 */
function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** 解析 computed color 字符串（含 alpha） */
function parseColor(text) {
  const m = String(text || '').match(/rgba?\s*\(([^)]+)\)/i);
  if (!m) return null;
  const parts = m[1].split(',').map((v) => Number(v.trim()));
  return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
}

/** 把半透明色叠加到不透明底色上 */
function compositeOver(top, baseRgb) {
  if (!top) return baseRgb;
  return top.rgb.map((v, i) => Math.round(v * top.a + baseRgb[i] * (1 - top.a)));
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join('D:\\.temp\\browser-profiles\\arcane', 'jjsv-edge-'));
  const edge = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    await waitPort();
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const target = list.find((t) => t.type === 'page');
    if (!target) throw new Error('找不到页面目标');
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready();

    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p && p.exceptionDetails;
      if (d) exceptions.push(String(d.exception && d.exception.description || d.text || 'exception').slice(0, 240));
    });
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p && p.type === 'error') {
        consoleErrors.push((p.args || []).map((a) => String(a.value || a.description || '')).join(' ').slice(0, 240));
      }
    });
    cdp.on('Network.requestWillBeSent', (p) => {
      if (p && p.request) requests.push(p.request.url);
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    /** 页面内求值 */
    const evalJS = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true
      });
      if (res.exceptionDetails) throw new Error('页面异常：' + (res.exceptionDetails.text || 'eval'));
      return res.result ? res.result.value : undefined;
    };

    /** 导航并等待浮层自动打开 */
    const goto = async (url, wait) => {
      await cdp.send('Page.navigate', { url });
      await sleep(wait || 1000);
    };

    /* ---------------------------------------------------------------
       0. 正常三槽
       --------------------------------------------------------------- */
    await goto(PAGE_URL, 1100);
    await evalJS('window.__DEMO.seed("normal"); location.reload();');
    await sleep(1100);

    const boot = await evalJS('({enabled: !!(window.__JJSAVE_UI && __JJSAVE_UI.enabled), open: __JJSAVE_UI.isOpen(), mode: __JJSAVE_UI.api.adapterMode(), cards: document.querySelectorAll(".jjsv-card").length, cards3: document.querySelectorAll(".jjsv-card").length === 3})');
    check('模块加载且 ?saveui 未关闭', boot.enabled, JSON.stringify(boot));
    check('预览适配器被识别', boot.mode === 'preview', boot.mode);
    check('默认打开三槽界面', boot.open && boot.cards === 3, boot.cards);

    const slotState = await evalJS('(() => { const info = __JJSAVE_UI.api.slots(); return { store: info.store, latest: info.latest, slots: info.slots.map(s => ({slot:s.slot,state:s.state,floor:s.summary? s.summary.floor:null,tag:s.tag.label})) }; })()');
    check('槽 1 为自动档', slotState.slots[0].state === 'ok' && slotState.slots[0].tag.indexOf('自动档') === 0, JSON.stringify(slotState.slots[0]));
    check('槽 2 为手动档', slotState.slots[1].state === 'ok' && slotState.slots[1].tag === '手动档', JSON.stringify(slotState.slots[1]));
    check('槽 3 为空槽', slotState.slots[2].state === 'empty', slotState.slots[2].state);

    const cardText = await evalJS('document.querySelector(".jjsv-card[data-slot=\\"3\\"]").textContent');
    check('空槽显示「新局」', cardText.includes('新局'), cardText.slice(0, 60));
    await shot(cdp, '01-slots-overview.png');

    /* ---------------------------------------------------------------
       1. 必测路径一：存档 → 刷新 → 继续
       --------------------------------------------------------------- */
    const saveRes = await evalJS('__JJSAVE_UI.api.saveToSlot(1)');
    check('存档写入成功', saveRes && saveRes.ok, JSON.stringify(saveRes));
    const beforeReload = await evalJS('(() => { const s = __JJSAVE_UI.api.slots().slots[0]; return {floor: s.summary.floor, checksum: s.checksum, savedAt: s.savedAt}; })()');
    check('存档内容为当前对局（第 9 层）', beforeReload.floor === 9, JSON.stringify(beforeReload));

    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(1300);
    const afterReload = await evalJS('(() => { const s = __JJSAVE_UI.api.slots().slots[0]; return {floor: s.summary.floor, checksum: s.checksum, savedAt: s.savedAt, mode: __JJSAVE_UI.api.adapterMode()}; })()');
    check('刷新后存档仍在', afterReload.floor === 9, JSON.stringify(afterReload));
    check('刷新后校验和一致', afterReload.checksum === beforeReload.checksum, afterReload.checksum + ' vs ' + beforeReload.checksum);

    const continued = await evalJS('__JJSAVE_UI.api.continueSlot(1)');
    await sleep(350);
    const resumeState = await evalJS('(() => { let flag=null; try{flag=JSON.parse(localStorage.getItem("jjsv_preview_resumed"));}catch(e){} const banner=document.getElementById("resumeBanner"); return {closed: !__JJSAVE_UI.isOpen(), flag: flag, bannerVisible: !!(banner && banner.classList.contains("is-show")), bannerText: banner ? banner.textContent.trim() : ""}; })()');
    check('继续读取成功', continued === true, String(continued));
    check('界面已关闭并回到游戏', resumeState.closed === true, JSON.stringify(resumeState.closed));
    check('读档标记写入 localStorage', resumeState.flag && resumeState.flag.floor === 9, JSON.stringify(resumeState.flag));
    check('读档结果条可见且显示第 9 层', resumeState.bannerVisible && resumeState.bannerText.includes('第 9 层'), resumeState.bannerText);
    await shot(cdp, 'path1-save-refresh-continue.png');

    /* ---------------------------------------------------------------
       2. 必测路径二：导出 → 导入 → 校验通过
       --------------------------------------------------------------- */
    await evalJS('__JJSAVE_UI.open()');
    await sleep(300);
    await evalJS('__JJSAVE_UI.api.openExport(1)');
    await sleep(300);
    const exportState = await evalJS('(() => { const state=__JJSAVE_UI.api.getState(); const ta=document.getElementById("jjsvExportText"); return {view:state.view, len:ta?ta.value.length:0, head:ta?ta.value.slice(0,60):""}; })()');
    check('导出抽屉打开且有文本', exportState.view === 'export' && exportState.len > 100, JSON.stringify(exportState));
    const exportGeom = await evalJS('(() => { const p=document.querySelector(".jjsv-panel").getBoundingClientRect(); const d=document.querySelector(".jjsv-drawer").getBoundingClientRect(); return {panelH:Math.round(p.height),drawerH:Math.round(d.height),drawerW:Math.round(d.width)}; })()');
    check('导出抽屉完整显示（面板未被绝对定位压塌）', exportGeom.panelH > 500 && exportGeom.drawerH > 300, JSON.stringify(exportGeom));
    await shot(cdp, '02-export-drawer.png');

    const exportText = await evalJS('__JJSAVE_UI.api.exportText(1)');
    const parsed = JSON.parse(exportText);
    check('导出文本 kind 正确', parsed.kind === 'arcane-run-slot', parsed.kind);
    check('导出文本版本为 v2', parsed.version === 2, String(parsed.version));
    check('导出文本校验和已带出', typeof parsed.checksum === 'string' && parsed.checksum.length === 8, parsed.checksum);

    await evalJS('__JJSAVE_UI.api.openImport(3, ' + JSON.stringify(exportText) + ')');
    await sleep(350);
    const importView = await evalJS('(() => { const s=__JJSAVE_UI.api.getState(); const check=document.querySelector("#jjsvImportCheck"); return {view:s.view, slot:s.importSlot, ok:s.importOk, text:check?check.textContent.replace(/\\s+/g," ").trim().slice(0,160):""}; })()');
    check('导入视图打开且目标槽为 3', importView.view === 'import' && importView.slot === 3, JSON.stringify(importView));
    check('三项校验全部通过', importView.ok === true && importView.text.includes('校验通过'), importView.text);
    const importGeom = await evalJS('(() => { const p=document.querySelector(".jjsv-panel").getBoundingClientRect(); const d=document.querySelector(".jjsv-drawer").getBoundingClientRect(); const check=document.querySelector("#jjsvImportCheck").getBoundingClientRect(); return {panelH:Math.round(p.height),drawerH:Math.round(d.height),checkH:Math.round(check.height)}; })()');
    check('导入抽屉完整显示', importGeom.panelH > 500 && importGeom.drawerH > 380 && importGeom.checkH > 60, JSON.stringify(importGeom));
    await shot(cdp, 'path2-export-import-pass.png');

    const importRes = await evalJS('__JJSAVE_UI.api.importText(3, ' + JSON.stringify(exportText) + ')');
    check('导入写入成功', importRes && importRes.ok, JSON.stringify(importRes));
    const afterImport = await evalJS('(() => { const info=__JJSAVE_UI.api.slots(); const s=info.slots[2]; const one=info.slots[0]; return {state:s.state, floor:s.summary?s.summary.floor:null, checksum:s.checksum, sourceChecksum: one.checksum, latest:info.latest}; })()');
    check('槽 3 变为可用', afterImport.state === 'ok', JSON.stringify(afterImport));
    check('槽 3 楼层与来源一致', afterImport.floor === 9, String(afterImport.floor));
    check('槽 3 校验和与导出文本一致', afterImport.checksum === parsed.checksum, afterImport.checksum);
    await evalJS('__JJSAVE_UI.open()');
    await sleep(260);
    await shot(cdp, '03-imported-slot3.png');

    /* ---------------------------------------------------------------
       3. 必测路径三：手动改坏一个字符 → 提示不白屏
       --------------------------------------------------------------- */
    const mutated = exportText.replace(/("floor":\s*)9/, '$18');
    check('改坏一个字符只动一位', mutated !== exportText && Math.abs(mutated.length - exportText.length) === 0, mutated.length + '/' + exportText.length);
    await evalJS('__JJSAVE_UI.api.openImport(2, ' + JSON.stringify(mutated) + ')');
    await sleep(350);
    const failState = await evalJS('(() => { const s=__JJSAVE_UI.api.getState(); const check=document.querySelector("#jjsvImportCheck"); const btn=document.querySelector("[data-act=\\"confirm-import\\"]"); return {ok:s.importOk, btnDisabled: btn?btn.disabled:null, text:check?check.textContent.replace(/\\s+/g," ").trim():""}; })()');
    check('校验未通过（校验和）', failState.ok === false && failState.btnDisabled === true, JSON.stringify({ ok: failState.ok, disabled: failState.btnDisabled }));
    check('界面写明失败项=校验和', failState.text.includes('校验和') && failState.text.includes('期望') && failState.text.includes('实际'), failState.text.slice(0, 200));
    check('确认导入按钮被禁用', failState.btnDisabled === true, String(failState.btnDisabled));
    const alive = await evalJS('({bodyLen: document.body.innerText.length, root: !!document.querySelector(".jjsv-root"), slots: __JJSAVE_UI.api.slots().slots.length})');
    check('页面没有白屏', alive.bodyLen > 300 && alive.root && alive.slots === 3, JSON.stringify(alive));
    await shot(cdp, 'path3-corrupt-one-char.png');

    /* 存储层面损坏：槽 3 校验和被改坏 */
    const corrupted = await evalJS('window.__DEMO.corruptSlot(3)');
    check('槽 3 校验和已被改坏', corrupted === true, String(corrupted));
    await evalJS('__JJSAVE_UI.open()');
    await sleep(300);
    const brokenSlot = await evalJS('(() => { const s=__JJSAVE_UI.api.slots().slots[2]; const card=document.querySelector(".jjsv-card[data-slot=\\"3\\"]"); return {state:s.state, error:s.error, text:card?card.textContent.replace(/\\s+/g," ").trim().slice(0,180):""}; })()');
    check('槽 3 标记为损坏', brokenSlot.state === 'corrupt' && brokenSlot.error === 'checksum', JSON.stringify(brokenSlot));
    check('卡片显示「该槽不可用」和「仅清除该槽」', brokenSlot.text.includes('该槽不可用') && brokenSlot.text.includes('仅清除该槽'), brokenSlot.text);
    await shot(cdp, '04-corrupt-slot.png');

    const keepOthers = await evalJS('(() => { const r=__JJSAVE_UI.api.clearSlot(3); const info=__JJSAVE_UI.api.slots(); return {res:r, slots:info.slots.map(s=>s.state)}; })()');
    check('只清槽 3 成功', keepOthers.res && keepOthers.res.ok, JSON.stringify(keepOthers.res));
    check('其它两槽不受影响', keepOthers.slots[0] === 'ok' && keepOthers.slots[1] === 'ok' && keepOthers.slots[2] === 'empty', keepOthers.slots.join(','));

    /* ---------------------------------------------------------------
       4. 危险确认：取消默认焦点 + 对比度
       --------------------------------------------------------------- */
    await evalJS('__JJSAVE_UI.open()');
    await sleep(260);
    await evalJS('__JJSAVE_UI.api.requestDelete(1)');
    await sleep(220);
    const confirmState = await evalJS('(() => { const focus=__JJSAVE_UI.api.focusInfo(); const panel=document.querySelector(".jjsv-confirm__panel"); const yes=document.querySelector("[data-act=\\"confirm-yes\\"]"); return {focus:focus, title:panel?panel.querySelector(".jjsv-confirm__title").textContent:"", hasYes:!!yes, yesFocused: focus.act === "confirm-yes", cancelFocused: focus.act === "confirm-cancel"}; })()');
    check('删除弹出二次确认', confirmState.title.includes('删除槽 1'), confirmState.title);
    check('默认焦点在「取消」', confirmState.cancelFocused === true && confirmState.yesFocused === false, JSON.stringify(confirmState.focus));
    await shot(cdp, '05-danger-confirm.png');

    const colors = await evalJS('(() => { const btn=document.querySelector(".jjsv-btn--danger-solid"); const flag=document.querySelector(".jjsv-confirm__flag"); const cs=getComputedStyle(btn); const fs=getComputedStyle(flag); return {btnFg:cs.color,btnBg:cs.backgroundColor,flagFg:fs.color,flagBg:fs.backgroundColor}; })()');
    const panelBase = [29, 21, 38];
    const ratios = {};
    const dangerFg = parseColor(colors.btnFg);
    const dangerBg = parseColor(colors.btnBg);
    ratios.dangerSolid = Number(contrast(compositeOver(dangerFg, panelBase), compositeOver(dangerBg, panelBase)).toFixed(2));
    const flagBg = compositeOver(parseColor(colors.flagBg), panelBase);
    const flagFg = compositeOver(parseColor(colors.flagFg), flagBg);
    ratios.flag = Number(contrast(flagFg, flagBg).toFixed(2));
    check('危险实心按钮对比度 ≥ 4.5:1', ratios.dangerSolid >= 4.5, JSON.stringify({ ratio: ratios.dangerSolid, fg: colors.btnFg, bg: colors.btnBg }));
    check('危险提示条文字对比度 ≥ 4.5:1', ratios.flag >= 4.5, JSON.stringify({ ratio: ratios.flag, fg: colors.flagFg, bg: colors.flagBg }));

    /* 关闭确认框，再验证覆盖确认标题 */
    await evalJS('document.querySelector("[data-act=\\"confirm-cancel\\"]").click()');
    await sleep(150);
    await evalJS('__JJSAVE_UI.api.requestOverwrite(2)');
    await sleep(200);
    const overwriteTitle = await evalJS('document.querySelector(".jjsv-confirm__title").textContent');
    check('覆盖同样二次确认', overwriteTitle.includes('覆盖槽 2'), overwriteTitle);
    await evalJS('document.querySelector("[data-act=\\"confirm-cancel\\"]").click()');

    /* ---------------------------------------------------------------
       5. 整体存储不可读：不白屏，可复制原始文本 / 重建
       --------------------------------------------------------------- */
    await evalJS('window.__DEMO.seed("unreadable"); location.reload();');
    await sleep(1300);
    const unreadable = await evalJS('(() => { const info=__JJSAVE_UI.api.slots(); const bar=document.querySelector(".jjsv-alertbar"); const cards=[...document.querySelectorAll(".jjsv-card")]; return {store:info.store, states:info.slots.map(s=>s.state), bar:bar?bar.textContent.replace(/\\s+/g," ").trim().slice(0,120):"", cards:cards.map(c=>c.textContent.replace(/\\s+/g," ").trim().slice(0,30)), bodyLen:document.body.innerText.length}; })()');
    check('识别整体不可读', unreadable.store === 'unreadable', unreadable.store);
    check('三槽都标记损坏且不白屏', unreadable.states.every((s) => s === 'corrupt') && unreadable.bodyLen > 300, JSON.stringify(unreadable.states));
    check('提示条提供复制原始文本 / 重建空库', unreadable.bar.includes('不可读') && unreadable.bar.includes('重建空库'), unreadable.bar);
    await shot(cdp, '06-store-unreadable.png');

    const rebuilt = await evalJS('(async () => { document.querySelector("[data-act=\\"rebuild\\"]").click(); await new Promise(r=>setTimeout(r,120)); document.querySelector("[data-act=\\"confirm-yes\\"]").click(); await new Promise(r=>setTimeout(r,220)); const raw=localStorage.getItem(window.__DEMO.key); const parsed=JSON.parse(raw); const rawBackup=localStorage.getItem("jjsv_raw_backup_v1"); return {version:parsed.version, slots:Object.keys(parsed.slots).length, rawBackup: !!rawBackup}; })()');
    check('重建后为空库 v2', rebuilt.version === 2 && rebuilt.slots === 0, JSON.stringify(rebuilt));
    check('重建前保留原始文本备份', rebuilt.rawBackup === true, String(rebuilt.rawBackup));

    /* ---------------------------------------------------------------
       6. ?saveui=off 整体停用
       --------------------------------------------------------------- */
    await goto(PAGE_URL + '?saveui=off', 900);
    const off = await evalJS('(() => { const ui=window.JJSAVE; const notice=document.getElementById("offNotice"); return {enabled: ui?ui.enabled:null, root: !!document.querySelector(".jjsv-root"), launcher: !!document.querySelector(".jjsv-launcher"), notice: notice? !notice.classList.contains("jjsv-hidden"):false}; })()');
    check('?saveui=off 时模块停用', off.enabled === false, String(off.enabled));
    check('停用后无浮层 / 无悬浮入口', off.root === false && off.launcher === false, JSON.stringify(off));
    check('显示关闭态说明', off.notice === true, String(off.notice));
    await shot(cdp, '07-saveui-off.png');

    /* ---------------------------------------------------------------
       7. 网络与异常
       --------------------------------------------------------------- */
    const external = requests.filter((url) => !/^(file:|data:|about:|blob:)/i.test(url));
    check('零外部网络请求', external.length === 0, JSON.stringify(external.slice(0, 5)));
    check('运行期零未捕获异常', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 3)));
    check('零 console.error', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

    const report = {
      ok: checks.every((c) => c.pass),
      generatedAt: new Date().toISOString(),
      page: PAGE_URL,
      shots,
      checks,
      contrast: ratios,
      colors,
      requestCount: requests.length,
      externalRequests: external,
      exceptions,
      consoleErrors
    };
    fs.writeFileSync(RESULT_FILE, JSON.stringify(report, null, 2), 'utf8');

    console.log('PASS ' + checks.length + ' / ' + checks.length);
    console.log('SHOTS ' + shots.join(', '));
    console.log('CONTRAST dangerSolid=' + ratios.dangerSolid + ' flag=' + ratios.flag);
    console.log('EXTERNAL ' + external.length + ' EXCEPTIONS ' + exceptions.length);
  } finally {
    if (cdp) { try { cdp.ws.close(); } catch (error) { /* 忽略 */ } }
    edge.kill();
    await sleep(200);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (error) { /* 忽略 */ }
  }
}

main().catch((error) => {
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    error: String(error && error.stack || error),
    shots,
    checks,
    exceptions,
    consoleErrors,
    externalRequests: requests.filter((url) => !/^(file:|data:|about:|blob:)/i.test(url))
  };
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(RESULT_FILE, JSON.stringify(report, null, 2), 'utf8');
  } catch (writeError) { /* 忽略 */ }
  console.error('FAIL', error && error.message ? error.message : error);
  process.exitCode = 1;
});
