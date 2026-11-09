/**
 * C1-10 · UI kit 接入：四组「同机位」改前 / 改后对比截图
 * ------------------------------------------------------------
 * 为什么不用"运行时覆盖 CSS"做出改前：
 *   覆盖法要手抄几十条旧值，抄错一条就不是"改前"而是"第三种状态"。
 *   这里改成"文件级回退"——把主文件复制一份 `_before.html`，只做三处确定性的回退：
 *     ① 删掉 `</style>` 前的整段 `C1-10 · UI kit 接入` CSS；
 *     ② 把卡面图标从 `rewardGlyphHtml(option)` 换回 `option.glyph`（字符字形）；
 *     ③ 暗角从 0.35/0.52 换回 0.18/0.62。
 *   这样"改前"就是 v1.5.5 的真实产物，与"改后"只差这三处，机位/种子/随机完全相同。
 *
 * 四组场景（每组的 before / after 都走同一套脚本动作，保证同机位）：
 *   ① HUD      —— 开局后刷 3 只怪，看顶栏 / 生命条刻度 / 状态胶囊 / 卡格
 *   ② 卡条     —— openReward('skill')，四张卡同屏
 *   ③ 设置     —— 右上齿轮面板（两列 / 行高 40 / 开关 40×22）
 *   ④ 结算     —— forceDeath() 触发结算面板
 *
 * 用法：node tools/ui_kit_shot.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9698;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.screenshots', 'art', 'step6');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const BEFORE = path.join(OUT, '_before.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 生成"改前"副本：删 C1-10 CSS 段 + 还原卡面字符 + 还原暗角
 * @returns {void}
 */
function buildBefore() {
  const html = fs.readFileSync(MAIN, 'utf8');
  // 文件换行可能是 CRLF，不用跨行字面量匹配：先定位标题行，再向前回退到注释块开头
  const anchor = html.indexOf('C1-10 · UI kit 接入（唯一依据');
  if (anchor < 0) throw new Error('找不到 C1-10 CSS 段标题');
  const start = html.lastIndexOf('/* =', anchor);
  const styleEnd = html.indexOf('</style>', anchor);
  if (start < 0 || styleEnd < 0) throw new Error('找不到 C1-10 CSS 段边界，无法生成改前副本');
  let out = html.slice(0, start) + html.slice(styleEnd);

  // 卡面图标：改后是内联 SVG，改前是字符字形
  const iconAfter = "      + '<span class=\"r-glyph\">' + rewardGlyphHtml(option) + '</span>'";
  const iconBefore = "      + '<span class=\"r-glyph\">' + option.glyph + '</span>'";
  if (!out.includes(iconAfter)) throw new Error('找不到 rewardGlyphHtml 调用点');
  out = out.replace(iconAfter, iconBefore);

  // 暗角：改前 0.18 / 0.62
  out = out.split('vignette: { alpha: 0.35, inner: 0.52, outer: 1.12 }')
    .join('vignette: { alpha: 0.18, inner: 0.62, outer: 1.12 }');

  fs.writeFileSync(BEFORE, out, 'utf8');
  console.log('改前副本已生成: ' + BEFORE + '  (' + out.length + ' 字节)');
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  buildBefore();

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return fs.statSync(file).size;
  };

  /** 跑完整四组场景；tag 是 before/after */
  const runScenes = async (tag, url) => {
    await send('Page.navigate', { url });
    await sleep(1600);
    await ev(`document.getElementById('btnStart').click(); true`);
    await sleep(800);
    // 同机位：固定三只怪，位置相对玩家（diamond / square / hexagon 三种剪影）
    await ev(`(() => {
      const d = window.__roamDebug;
      d.spawnEnemy('wanderer', 90, -40);
      d.spawnEnemy('shooter', -110, 70);
      d.spawnEnemy('phaser', 150, 120);
      return true;
    })()`);
    await sleep(420);
    const hud = await shot(`hud-${tag}.png`);
    await sleep(200);

    const keys = await ev(`(() => window.__roamDebug.openReward('skill'))()`);
    await sleep(520);
    const cards = await shot(`cards-${tag}.png`);

    await ev(`(() => { const d = window.__roamDebug; const k = ${JSON.stringify(keys)}; if (k && k[0]) d.chooseReward(k[0]); return true; })()`);
    await sleep(420);
    await ev(`document.getElementById('btnSettings').click(); true`);
    await sleep(450);
    const settings = await shot(`settings-${tag}.png`);
    await ev(`document.getElementById('settingsClose').click(); true`);
    await sleep(320);

    await ev(`(() => { window.__roamDebug.forceDeath(); return true; })()`);
    await sleep(900);
    const result = await shot(`result-${tag}.png`);
    return { hud, cards, settings, result, keys };
  };

  const beforeFiles = await runScenes('before', 'file:///' + BEFORE.replace(/\\/g, '/'));
  const afterFiles = await runScenes('after', 'file:///' + MAIN.replace(/\\/g, '/'));

  console.log(JSON.stringify({ ok: true, out: OUT, beforeFiles, afterFiles, errors }, null, 2));
  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
