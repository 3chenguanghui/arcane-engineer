/**
 * 第 19.5 项 · 改名基础设施验收（B0–B8）
 * 用法：node tools/arcane_brand.js
 * 端口：9545
 * 只验证"名字从 GAME_CONFIG 单一真源流到各展示位"，不判断名字本身好不好；
 * 改名时不需要改动本脚本。
 * 输出：.screenshots/art/brand-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9545;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录断言并输出证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} [detail] 证据
 * @returns {void}
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
  const runtimeErrors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push((d && d.exception && (d.exception.description || d.exception.value)) || (d && d.text) || 'unknown');
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  /**
   * 发送 CDP 命令
   * @param {string} method CDP 方法
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
   * 打开游戏页并等首屏
   * @returns {Promise<void>}
   */
  const boot = async () => {
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    await sleep(1700);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await boot();

  // ---------- B0 配置真源 ----------
  const info = await ev('__roamDebug.branding.info()');
  ok('B0 GAME_CONFIG 名字字段齐全且 slug 合法',
    !!info.title && !!info.titleEn && !!info.subtitle && /^[a-z0-9_]+$/.test(info.slug)
    && Array.isArray(info.legacyTitles),
  info);

  // ---------- B1 浏览器标签 ----------
  ok('B1 document.title 由配置生成', info.documentTitle === info.title + ' · ' + info.titleEn,
    { documentTitle: info.documentTitle, expect: info.title + ' · ' + info.titleEn });

  // ---------- B2 标题页 ----------
  const snap = await ev('__roamDebug.branding.snapshot()');
  ok('B2 标题页主标题 / HUD / aria 同步',
    snap.titlePage === info.title
    && snap.hud === info.title
    && snap.aria === info.title + '游戏画面',
  snap);

  // ---------- B3 关于页（说明页页头口径） ----------
  ok('B3 关于页页头由 title + subtitle 生成',
    snap.aboutHeader.indexOf(info.title + ' · ' + info.subtitle) === 0,
  { aboutHeader: snap.aboutHeader });

  // ---------- B5 运行时改名：三处同步 ----------
  const testName = '测试名·烬与齿轮';
  const renamed = await ev(`__roamDebug.branding.setTitle(${JSON.stringify(testName)})`);
  ok('B5a 改 GAME_CONFIG.title 后三处同步变化',
    renamed.documentTitle.indexOf(testName) === 0
    && renamed.titlePage === testName
    && renamed.aboutHeader.indexOf(testName) === 0,
  { documentTitle: renamed.documentTitle, titlePage: renamed.titlePage, aboutHeader: renamed.aboutHeader });

  // 改回原名（单字名如「烬」是测试名的子串，必须先恢复再查旧名残留）
  const restored = await ev(`__roamDebug.branding.setTitle(${JSON.stringify(info.title)})`);
  ok('B5b 改回后三处同步恢复',
    restored.titlePage === info.title && restored.documentTitle.indexOf(info.title) === 0,
  restored);

  // ---------- B7 改名后没有旧名残留 ----------
  // 口径修正：单字标题（如「烬」）会作为子串出现在任意测试名里，不能拿"当前名"当残留判据；
  // 这里改查 legacyTitles（真正的旧名清单），且先恢复到正名后再采样。
  const legacyNames = (info.legacyTitles || []).filter((n) => n && n !== info.title);
  const stale = await ev(`(function(){
    var ids = ['titleWordmark','titleTagline','brandLogo','brandSub','aboutBody'];
    var legacy = ${JSON.stringify(legacyNames)};
    var hit = [];
    ids.forEach(function(id){
      var el = document.getElementById(id);
      if (!el) return;
      legacy.forEach(function(n){ if (el.textContent.indexOf(n) >= 0) hit.push(id + ':' + n); });
    });
    legacy.forEach(function(n){ if (document.title.indexOf(n) >= 0) hit.push('document.title:' + n); });
    return hit;
  })()`);
  ok('B7 改名后品牌位无旧名残留', stale.length === 0, { checked: legacyNames, stale });

  // ---------- B6 存档迁移标记 ----------
  const metaKey = await ev('GAME_CONFIG.metaKey');
  const originalRaw = await ev(`window.localStorage.getItem(${JSON.stringify(metaKey)})`);
  const legacyName = '旧名·深炉回响';
  if (originalRaw) {
    await ev(`(function(){
      var raw = window.localStorage.getItem(${JSON.stringify(metaKey)});
      var m = JSON.parse(raw || '{}');
      m.gameTitle = ${JSON.stringify(legacyName)};
      m.gameSlug = '';
      m.legacyTitle = '';
      window.localStorage.setItem(${JSON.stringify(metaKey)}, JSON.stringify(m));
      return true;
    })()`);
  }
  await boot();
  const migrated = await ev(`(function(){
    return {
      gameTitle: state.meta.gameTitle,
      gameSlug: state.meta.gameSlug,
      legacyTitle: state.meta.legacyTitle,
      current: GAME_CONFIG.title,
      alive: Number(state.meta.version) === META_SCHEMA_VERSION
    };
  })()`);
  const persisted = await ev(`(function(){
    saveMeta();
    var raw = window.localStorage.getItem(${JSON.stringify(metaKey)});
    var m = JSON.parse(raw || '{}');
    return { gameTitle: m.gameTitle, gameSlug: m.gameSlug, legacyTitle: m.legacyTitle, bytes: raw ? raw.length : 0 };
  })()`);
  ok('B6 旧档保留旧名做迁移标记且照常可读',
    !!originalRaw && migrated.gameTitle === info.title && migrated.legacyTitle === legacyName
    && persisted.legacyTitle === legacyName && persisted.gameTitle === info.title
    && persisted.bytes > 0 && migrated.alive,
  { migrated, persisted });

  // 还原存档，避免测试污染玩家进度
  if (originalRaw) {
    await ev(`window.localStorage.setItem(${JSON.stringify(metaKey)}, ${JSON.stringify(originalRaw)})`);
  }

  // ---------- B8 运行时异常 ----------
  ok('B8 整个流程 0 运行时异常', runtimeErrors.length === 0, runtimeErrors.slice(0, 3));

  const summary = {
    at: new Date().toISOString(), checks: asserts,
    pass: asserts.filter((c) => c.pass).length, total: asserts.length,
    runtimeErrors, info, snapshot: snap, renamed, migrated, persisted
  };
  fs.writeFileSync(path.join(OUT_DIR, 'brand-result.json'), JSON.stringify(summary, null, 2));
  console.log('\nRESULT: ' + (asserts.filter((c) => !c.pass).length === 0 ? 'PASS' : 'FAIL') + '  ' + summary.pass + '/' + summary.total);
  ws.close();
  killEdge(edge);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
