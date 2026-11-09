/**
 * 第 6 轮 · 第 3 组：发布包构建 + 验收
 * ------------------------------------------------------------
 * 产出（固定 3 个文件，目录 dist/<slug>_v<版本>/）：
 *   1) <游戏名>_v<版本>.html   单文件游戏（源码原样拷贝，零外部依赖）
 *   2) 说明.html                 一页说明（按键 / 难度 / 前五层速查 / 配方 / FAQ），数字从运行时配置生成
 *   3) 更新说明.md               版本号 + 本轮更新内容
 *
 * 游戏名 / 目录名 / 文件名 / 说明页页头统一从源码 GAME_CONFIG.title / slug 读取（第 19.5 项），
 * 本脚本不再手抄第二份名字。
 *
 * 验收：
 *   P1 版本号单一真源（源码 → 标题页 → 关于面板 → 说明页 → 更新说明）
 *   P2 全新目录 + 全新浏览器 profile（零缓存）双击可玩
 *   P3 无任何外部资源请求（Network 事件里 0 条 http/https）
 *   P4 包内文件清单固定，不含测试脚本 / 截图 / 临时目录 / .bak
 *   P5 说明页可打开且含按键表 / 难度 / 前五层速查 / 配方 / FAQ
 *   P6 输出包体大小与文件清单
 *
 * 用法：node tools/arcane_package.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9766;
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const OUT_ROOT = path.join(ROOT, 'dist');
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
 * 从源码里读出游戏名配置（唯一真源，不抄第二份）
 * @param {string} html 源码全文
 * @returns {{title:string,titleEn:string,subtitle:string,slug:string,version:string}}
 */
function readBrand(html) {
  const block = html.match(/const GAME_CONFIG = \{[\s\S]*?\n\};/);
  const body = block ? block[0] : html;
  const pick = (key) => {
    const re = new RegExp(key + ":\\s*'([^']*)'");
    return (body.match(re) || [])[1] || '';
  };
  const ver = (body.match(/version: '([0-9]+(?:\.[0-9]+)*)'/) || [])[1];
  if (!ver || ver === '4') throw new Error('未找到 GAME_CONFIG.version（注意 meta 版本号不是游戏版本号）');
  const brand = {
    title: pick('title'),
    titleEn: pick('titleEn'),
    subtitle: pick('subtitle'),
    slug: pick('slug'),
    version: ver,
    /* 作者署名与版本号同源：都从 GAME_CONFIG 读，发布包里不另写一份 */
    author: pick('author')
  };
  if (!brand.title) throw new Error('未找到 GAME_CONFIG.title（第 19.5 项改名真源）');
  if (!brand.slug) brand.slug = 'arcane';
  return brand;
}

/**
 * 构建发布包（拷贝单文件游戏，生成说明与更新说明由后续数据驱动）
 * @returns {{ver:string, dir:string, game:string, brand:Object}}
 */
function buildSkeleton() {
  const html = fs.readFileSync(SRC, 'utf8');
  const brand = readBrand(html);
  const ver = brand.version;
  const dir = path.join(OUT_ROOT, `${brand.slug}_v${ver}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const game = path.join(dir, `${brand.title}_v${ver}.html`);
  // 静态 <title> 也按名字真源重写（JS 未执行前的标签页文案不能停留在旧名）
  const branded = html.replace(/<title>[^<]*<\/title>/, `<title>${brand.title} · ${brand.titleEn}</title>`);
  fs.writeFileSync(game, branded);
  return { ver: ver, dir: dir, game: game, brand: brand };
}

/**
 * 说明页 HTML（数据全部来自运行时配置，数字不在模板里手写）
 * @param {string} ver 版本号
 * @param {Object} d 运行时导出的配置快照
 * @returns {string} 完整 HTML
 */
function buildGuideHtml(ver, d, brand) {
  const keys = d.keys.map((k) => `<tr><td><b>${k.keys}</b></td><td>${k.desc}</td></tr>`).join('');
  const diffs = d.diffs.map((m) => `<tr><td><b>${m.label}</b></td><td>${m.desc}</td></tr>`).join('');
  const floors = d.onboard.map((s) => `<tr><td><b>F${s.floor}</b></td><td>${s.verb}</td><td>${s.hint}</td></tr>`).join('');
  const recipes = d.fusions.map((f) => `<tr><td>${f.name}</td><td>${f.from}</td><td>${f.desc}</td></tr>`).join('');
  const faq = d.faq.map((f) => `<dt>${f.q}</dt><dd>${f.a}</dd>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${brand.title} v${ver} · 一页说明</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #070b12; color: #dbe9ff; font: 14px/1.7 "Segoe UI", "Microsoft YaHei", sans-serif; }
  main { max-width: 880px; margin: 0 auto; padding: 32px 20px 60px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: 0.04em; }
  .ver { display: inline-block; margin-left: 10px; padding: 1px 8px; border: 1px solid #2f6f88; border-radius: 99px; font-size: 12px; color: #7fe3ff; vertical-align: middle; }
  .lead { color: #8fa6c4; margin: 0 0 22px; }
  h2 { font-size: 16px; margin: 26px 0 10px; padding-left: 9px; border-left: 3px solid #3ee6ff; letter-spacing: 0.06em; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { border-bottom: 1px solid #16202e; padding: 5px 8px; vertical-align: top; text-align: left; }
  th { color: #7f96b4; font-weight: 400; }
  td b { color: #eaf3ff; }
  dl { margin: 0; } dt { color: #9fe9ff; margin-top: 10px; } dd { margin: 2px 0 0; color: #9fb0c7; }
  .note { margin-top: 28px; padding: 12px 14px; border: 1px solid #1d2b3c; border-radius: 8px; color: #8fa6c4; background: #0b1220; }
</style></head>
<body><main>
  <h1>${brand.title}<span class="ver">v${ver}</span></h1>
  <p class="lead">${brand.subtitle}实时肉鸽 · 单文件零外部资源 · 双击 HTML 即可游玩，不需要安装、不需要联网。</p>

  <h2>怎么开始</h2>
  <p>双击同目录下的 <b>${brand.title}_v${ver}.html</b>，在标题页选好难度后点「开始探索」：第一次开局会先选角色（守拙 / 疾火 / 观星），选完立即开跑；「继续上次」沿用上一局的选择，不会重复弹。存档写在浏览器 localStorage，换浏览器/清缓存会丢失；游戏内「设置 → 清空存档」也能重置。</p>

  <h2>按键</h2>
  <table><tr><th>按键</th><th>作用</th></tr>${keys}</table>

  <h2>难度</h2>
  <table><tr><th>难度</th><th>说明</th></tr>${diffs}</table>

  <h2>前五层速查</h2>
  <table><tr><th>层</th><th>主题</th><th>要做的事</th></tr>${floors}</table>
  <p class="lead">每层房间数 ${d.roomsLine}；战斗房 ${d.battleMin}–${d.battleMax} 只敌人，精英房 ${d.eliteMin}–${d.eliteMax} 只。清空当前层所有敌人后，走到金色楼梯按 <b>E</b> 下楼。</p>

  <h2>内容规模</h2>
  <ul class="lead">
    <li>敌人：<b>${d.enemyCount}</b> 种（其中专属怪 <b>${d.exclusiveCount}</b> 种）</li>
    <li>融合配方：<b>${d.fusions.length}</b> 条</li>
    <li>成就：<b>${d.achCount}</b> 条</li>
    <li>编队模板：<b>${d.formationCount}</b> 套（第 6 层起按区域混编出场）</li>
  </ul>

  <h2>融合配方（共 ${d.fusions.length} 条）</h2>
  <table><tr><th>融合技能</th><th>配方</th><th>效果</th></tr>${recipes}</table>

  <h2>常见问题</h2>
  <dl>${faq}</dl>

  <div class="note">版本 v${ver} · 作者：<b>${brand.author}</b> · 本说明页与游戏内数值共用同一份配置生成，若游戏更新，请以包内最新说明为准。</div>
</main></body></html>`;
}

/**
 * 更新说明 Markdown（内容按本版实际改动维护；版本号仍由 GAME_CONFIG 单一真源驱动）
 * @param {string} ver 版本号
 * @param {Object} brand 游戏名配置（name/title/subtitle/slug）
 * @returns {string} Markdown
 */
function buildChangelog(ver, brand) {
  const title = brand.title;
  return `# ${title} v${ver} · 更新说明

> ${brand.subtitle}单文件 · 零外部资源 · 双击即玩

---

## v1.8.2 敌人密度（e6）
- **战斗房敌人更多，但同屏峰值不升**：多出来的怪按「开局到场 60%，场上剩一半再补」排队出场，同屏硬上限仍是 10 只，本房总量硬上限 12 只。
- **楼层闸门**：F1–2 完全不加（F2 本来就是死亡墙）；F3–5 普通战斗房 +1 且不分批；F6+ 普通房 +2、小精英房（基础 ≤5 只）+1。
- **e6**：F9–10 精英房不分批（精英房不分批起点=第 9 层），避免 7 只精英被切成 5+2 后二次接敌把时长从 25s 拖到 33s。只改出场时机，不动数量与上限。
- **F3 同屏峰值 8→9、F5 同屏峰值 7→8 是有意为之，不是 bug**：前 5 层的增量不分批，整批同时出场，所以峰值各升 1 只；仍在同屏上限 10 以内。若改回分批，清场会变长、通关率反而更低，所以保留。
- **困难档**：数量增量更小（+1），压力靠更早到场、更早补员、F1–F5 就启用编队。
- 清空判定已把「还在排队」的怪算进去，不会提前开门或提前结算。

---

## v1.8.1 无障碍安全修复（相对 v1.8.0）
- **自爆预警环回到安全线**：闪烁 4.14Hz → **1.91Hz**（sin(t*26) → sin(t*12)），任意 1 秒 ≤3 次，符合 WCAG 2.3.1。
- **濒死抖动降频**：3.02Hz / 3.66Hz → **1.43Hz / 1.75Hz**（19 / 23 → 9 / 11），位移峰峰值不变。
- **闪白合流**：任意 1 秒内最多 3 次（340ms 最小间隔），被合流的闪白只记账、不播放，不影响判定。
- **14 处低对比小字提亮**：只改字色 / 不透明度 / 底色，**未改任何字号**。
- 本版同时包含此前已落地的**存档安全补丁**：坏档先备份再回退、多标签页写权锁与只读横幅、「重试写入」、地址加 ?saveguard=off 可完全回退。

---

## v1.8.0（相对 v1.7.1）
- **手机玩家不再被教错的玩法**：画布 / HUD / 提示条里的「按 E 进入」「按 E 购买」「站到祭坛旁按 E 选择」「WASD 移动，左键开火」在触屏设备上一律换成触屏说法（点交互键 / 摇杆移动 / 右侧点按施法）；键鼠设备文案原样不变。
- **技能池 12 → 18**：新增斥力脉冲、贯流长枪、天陨、符文重锤、灼痕烙印、护身符阵。六张新卡的伤害/奥能一律 ≤1.6（不高于火球的效率上限），强度只放在形状与爆发窗口。
- **保底阀同批落地**：新卡按 4–6 层分期解锁（minFloor）。F1–F3 的奖励池与扩容前逐项一致，不会因为池子变大把三选一稀释成"全是垃圾"。
- **修掉「路的虚影」**：探索过的房间里那条半透明走廊延伸带不再像鬼影一样压在雾上面；延伸带现在只在真正的地面之外出现。
- **门更好找**：每扇门加一道朝房心的地面光带，门框光晕的可视距离 340 → 620（站在房心四扇门都发光）。
- **无障碍两项**：自爆预警环闪烁 4.14Hz → 1.91Hz（任意 1 秒 ≤3 次，过安全线）；14 处低对比小字提亮（只改字色与不透明度，**未改任何字号**）。
- **全局兜底**：window 级错误、未处理的 Promise 拒绝、Canvas 上下文丢失都会落进提示面板，不再整屏白掉；面板不在正常流程里出现。

---

## v1.7.1 热修（相对 v1.7.0）
- 守拙：生命 128 → **104**（撤掉 +20 定点，被动 8% → 4%）。v1.7.0 的 128 让 10 层通关率冲到 51.30%，越过 40% 红线，这版回调到线下。
- 疾火：生命 90 → **95**（−10 → −5）；保留 +8% 伤害「增幅」与奥能加成。
- 观星：**主槽改回火球**（冰环退到副槽随身），生命 100、每秒回能 +2 不变。冰环主槽会让开局 DPS 过低，F2 死亡率过高。
- 出包门禁新增**四口径**（中性 / 守拙 / 疾火 / 观星）：10 层通关率 ≤40%、F20 到达 ≤36%、三角色前 3 层存活率两两差 ≤8pp，每角色判定样本 ≥2000 局。

---

## 这一版，玩家能感觉到什么

### 1. 开局先选角色，三种打法真的不一样
- **守拙**：生命上限 +4%（开局 104）；奥能 −10。每往下一层，再多 1.2% 生命。适合硬扛、贴脸、慢节奏。
- **疾火**：生命 −5（开局 95）；奥能 +15，再额外 +10，所有直接命中 +8% 伤害。每往下一层，再多 1.2% 奥能。适合高频施法、滚雪球。
- **观星**：奥能 +5、每秒回能 +2；主槽火球、冰环随身；每层同时涨 0.4% 生命和 0.8% 奥能。适合控场、稳扎稳打。
- 选择会被记住；「继续上次」「每日挑战 / 种子局」不会重复弹；选择页开着时按 Esc 关不掉，避免出现"没角色"的半成品状态。
- **旧存档安全**：老档第一次进游戏只会补一个"中性角色"字段，生命 / 奥能 / 已买天赋 / 结晶 / 历史层数一律不动。

### 2. 打击感分三档，不再"打棉花"
- 普通命中 / 强化命中 / 首领爆发各有自己的顿帧、震屏、粒子数、提示音与伤害数字大小：0.045 / 0.090 / 0.130 秒顿帧，3 / 6 / 10 点震屏，10 / 26 / 58 颗粒子，数字 12 / 16 / 22 号。
- 修掉一个根因：顿帧或慢动作时，冲击环、粒子、飘字也跟着"冻住"，看起来像没打中。现在演出走真实时间，世界时间才被压慢。
- 命中顿帧改为"帧内补偿"，连续命中不会互相吞掉反馈。
- 雷击的闪白只在真的劈到目标时才闪，空放不再糊屏。
- 想安静一点：地址后加 「?tier=off」 可关闭整套分级演出。

### 3. 技能"看得懂"了
- 回旋类的返程命中现在有**冷色飘字 + 冷色环**，一眼能分清"去程"和"返程"。
- 坍缩黑洞在最后 17% 时间会加速收束并亮出内核，提前告诉你"要炸了"，不再突然消失。

### 4. 新手引导更顺
- 空格交还「影步」，不再和"跳过提示"抢键。
- 暂停时提示计时也暂停，不会回来发现提示已经过期。
- 15 秒还没动，提示会换一句更具体的；真的开始打了就不再唠叨。
- 三选一卡片的底色更实（0.78），字不再被背景吃掉。
- 窄屏下提示条自动收窄，不再压住底部手牌。

### 5. 天赋按进度分层开放
- 1 层看到 3 项，11 层 3 档、21 层、30 层逐级放开到 11 / 21 / 30 项。
- 已经买过的天赋永远可见，不会因为"层数不够"被藏起来。

### 6. 第一次死，有人教你
- 首次死亡会多一张复盘卡：时间线、最后 10 秒吃到哪些伤害、哪些本来能躲、这局结晶最后去了哪。
- 只在第一次死亡出现，之后不再刷屏。

### 7. 存档更安全（这一版最不该出事的地方）
- 存档坏了：先把坏档备份成 「arcane_rogue_meta.broken.<时间戳>」，再回退到默认值；本次会话不再自动覆盖，避免"坏档把好档顶掉"。
- 多开标签页：另一个标签页改了存档会立刻收到通知，本页停止写入，避免互相覆盖。
- 补上两个漏掉的设置字段（「motionTrail」/「regionFx」），老档也能正常显示这两项。
- 浏览器空间满：不再静默失败，会先淘汰最旧的局内槽再重试，仍失败会明确提示。

### 8. 文案与界面
- 清掉武器残留措辞：「Q 近战」/「Q 近战挥击」/「V 武器判定范围」/「Y 近战」/「近战与新手优先」等，统一成魔法说法。
- 「祝福 · 锋刃协议」→「祝福 · 相位协议」；「回旋刃」→「回旋光轮」。
- 设置页删掉「素材化（A+C）阶段」这类内部说法；「关闭后 Q 完全无响应」改成玩家能懂的解释；「初始奥能上限 +N」改成「永久提高初始奥能上限」。
- 统一字号令牌与圆角/间距（含「--text-4」），窄屏不再裁切、面板不再互相压。

### 9. 版本
- 标题页与关于面板显示 v${ver}；版本号仍以文件内「GAME_CONFIG.version」为唯一真源。

---

## 已知边界（如实写，不藏）
- 命中反馈有一帧（约 16.7ms）的结构性延迟：帧首已经算好世界时间，顿帧只能从下一帧开始压，属于框架层限制。
- 打击分级的"三档色相差异"目前只体现在环 / 粒子数量与强度上，颜色分层还没接进绘制端，下一版再补。
- 训练模型里深层仍有 3 处难度凹点（F2→F3 −13.9s、F11→F12 −15.6s、F12→F13 −5.3s），v1.8.0 只加了技能与表现，没有再动数值曲线。

---

## 文件清单（固定 4 个）
- ${title}_v${ver}.html —— 游戏本体，双击即玩
- 说明.html —— 玩法、按键、设置、常见问题
- 更新说明.md —— 本文件
- manifest_v${ver}.json —— 出包指纹（字节、MD5、验收结果）

## 运行环境
- 桌面浏览器（Chrome / Edge / Firefox 近两年版本）；单文件，不联网也能玩。
- 存档在本机 localStorage；换浏览器、清缓存会丢档。
`;
}



/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const built = buildSkeleton();
  console.log(`构建目录: ${built.dir}`);

  // 全新 profile（零缓存）：prepareProfile 每次启动前都会删掉 .testprofile/edge
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
    } catch (e) { /* 端口没起 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const requests = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push(d ? ((d.exception || {}).description || d.text) : 'unknown');
    }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
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
  await send('Network.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
        + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };

  // ---------- P2/P3：在全新目录 + 全新 profile 打开发布包 ----------
  await send('Page.navigate', { url: pathToFileURL(built.game).href });
  await sleep(2400);
  const boot = await ev(`(() => ({
    mode: state.mode, status: state.status,
    canvas: !!(document.getElementById('game') || document.querySelector('canvas')),
    titleVersion: (document.getElementById('titleVersion') || {}).textContent || '',
    hasStart: !!document.getElementById('btnStart'),
    version: GAME_CONFIG.version
  }))()`);
  /* v1.7.0 三角色：发布包验收按"中性角色"口径（选择页流程由 _char_verify_tmp.js 单独验收） */
  await ev('__charPickedThisBoot = true; true');
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(1100);
  const playable = await ev(`(() => ({
    mode: state.mode, status: state.status, floor: state.floor,
    rooms: state.rooms.length, enemies: state.enemies.length,
    playerHp: Math.round(state.player.hp), aether: Math.round(state.player.aether),
    closed: !!document.getElementById('titleLayer') && document.getElementById('titleLayer').classList.contains('hidden'),
    aboutVersion: (document.getElementById('aboutVersion') || {}).textContent || ''
  }))()`);

  const external = requests.filter((u) => /^(http|https|ws|wss):/i.test(u));
  const localFiles = requests.filter((u) => u.indexOf('file://') === 0);
  check('P2 全新目录 + 零缓存 profile 下发布包可直接开局',
    boot.version === built.ver && boot.hasStart && playable.mode === 'playing'
    && playable.status === 'playing' && playable.closed && playable.rooms >= 4,
    { boot: boot, playable: playable });
  const dirSlash = built.dir.replace(/\\/g, '/');
  check('P3 无外部资源请求（0 条 http/https，仅本地 file://）',
    external.length === 0 && localFiles.length >= 1
    && localFiles.every((u) => u === 'about:blank' || decodeURIComponent(u).indexOf(encodeURI(dirSlash).replace(/%25/g, '%')) >= 0 || decodeURIComponent(u).indexOf(dirSlash) >= 0),
    { external: external.slice(0, 5), local: localFiles.map((u) => decodeURIComponent(u).slice(-40)) });
  check('P1a 版本号在标题页与关于面板一致', boot.titleVersion === 'v' + built.ver && playable.aboutVersion.indexOf('v' + built.ver) === 0,
    { title: boot.titleVersion, about: playable.aboutVersion, ver: built.ver });

  // ---------- 抽取配置快照（说明页数据源） ----------
  const data = await ev(`(() => {
    const f = helpFacts();
    const magicName = (id) => (MAGIC_BY_ID[id] ? MAGIC_BY_ID[id].name : id);
    const techName = (id) => (typeof TECH_BY_ID !== 'undefined' && TECH_BY_ID[id] ? TECH_BY_ID[id].name : id);
    return {
      version: GAME_CONFIG.version,
      keys: HELP_KEYS.map((k) => ({ keys: k.keys, desc: k.desc })),
      diffs: ['easy', 'normal', 'nightmare'].map((id) => {
        const m = DIFFICULTY_CONFIG.modes[id];
        const desc = id === 'normal'
          ? ('设计基线：每层 ' + f.rooms + ' 房、战斗房 ' + f.battleMin + '–' + f.battleMax + ' 只')
          : m.desc;
        return { id: id, label: m.label, desc: desc };
      }),
      roomsLine: f.rooms, battleMin: f.battleMin, battleMax: f.battleMax,
      eliteMin: f.eliteMin, eliteMax: f.eliteMax,
      onboard: ONBOARD_STEPS.map((s) => ({ floor: s.floor, verb: s.verb, hint: s.hint })),
      /* 第 7 轮：说明页要展示的三类真值数字，全部从运行时配置取，不在模板里手写 */
      enemyCount: ENEMY_CONFIG.length,
      exclusiveCount: ENEMY_CONFIG.filter((e) => e.exclusive).length,
      achCount: META_PROGRESS_CONFIG.achievements.length,
      formationCount: FORMATION_CONFIG.templates.length,
      fusions: FUSION_CONFIG.map((x) => ({ name: x.name, from: magicName(x.magic) + ' + ' + techName(x.tech), desc: x.desc })),
      faq: [
        { q: '双击后是黑屏 / 只有一个标题？', a: '请用 Edge / Chrome 等现代浏览器打开（IE 不支持）。文件必须是完整的 .html，不要用记事本另存为 .txt。' },
        { q: '为什么听不到 BGM？', a: 'BGM 默认关闭以尊重偏好。设置里可开启，音效与音量滑杆会记忆在存档。' },
        { q: '存档在哪？换电脑能带走吗？', a: '存在本机浏览器 localStorage，不随文件移动；换机器需要重新开始。' },
        { q: '打不过首领怎么办？', a: '先在第 2 层学会融合（F 键），并把精英房当练手；首领阶段切换时会有三拍提示，趁间隔拉开距离。' },
        { q: '能关掉华丽的演出吗？', a: '可以。设置里关闭「连击演出」后，屏幕脉冲与冲击环不再触发，命中反馈保留。' }
      ]
    };
  })()`);
  check('P1b 说明页数据源与游戏同版本', data.version === built.ver, { ver: data.version });

  // ---------- P4：清单固定 ----------
  const guide = path.join(built.dir, '说明.html');
  const changelog = path.join(built.dir, '更新说明.md');
  fs.writeFileSync(guide, buildGuideHtml(built.ver, data, built.brand));
  fs.writeFileSync(changelog, buildChangelog(built.ver, built.brand));
  const files = fs.readdirSync(built.dir).sort();
  const forbidden = files.filter((f) => /\.js$|\.bak_|\.testprofile|\.screenshots|\.md\.bak|result|screenshot/i.test(f));
  /* 正式文件 3 个；manifest_v<ver>.json 在全部验收结束后写入同一目录（见 P8） */
  check('P4 包内正式文件固定（3 个，无测试脚本 / 截图 / 临时目录）',
    files.length === 3 && forbidden.length === 0
    && files.indexOf(`${built.brand.title}_v${built.ver}.html`) >= 0
    && files.indexOf('说明.html') >= 0 && files.indexOf('更新说明.md') >= 0,
    { files: files, forbidden: forbidden });

  // 说明页打开可读（同一浏览器）
  await send('Page.navigate', { url: pathToFileURL(guide).href });
  await sleep(900);
  const guideText = await ev(`(() => {
    const t = document.body.innerText;
    return {
      len: t.length,
      hasVer: t.indexOf('v${built.ver}') >= 0,
      key: t.indexOf('影步冲刺') >= 0,
      diff: t.indexOf('设计基线') >= 0,
      floors: t.indexOf('前五层速查') >= 0,
      recipes: t.indexOf('融合配方') >= 0 && t.indexOf('追踪火球') >= 0,
      faq: t.indexOf('常见问题') >= 0 && t.indexOf('黑屏') >= 0,
      rows: document.querySelectorAll('tr').length,
      nums: (() => {
        const m = (re) => { const r = t.match(re); return r ? Number(r[1]) : -1; };
        return {
          enemy: m(/敌人：\\s*(\\d+)\\s*种/),
          exclusive: m(/专属怪\\s*(\\d+)\\s*种/),
          fusion: m(/融合配方（共\\s*(\\d+)\\s*条）/),
          ach: m(/成就：\\s*(\\d+)\\s*条/),
          formation: m(/编队模板：\\s*(\\d+)\\s*套/)
        };
      })()
    };
  })()`);
  check('P5 说明页可被普通玩家读懂（按键 / 难度 / 前五层 / 配方 / FAQ 均在且版本一致）',
    guideText.hasVer && guideText.key && guideText.diff && guideText.floors
    && guideText.recipes && guideText.faq && guideText.rows >= 25 && guideText.len > 800,
    guideText);
  /* 第 7 轮 · P7：说明页三类数字必须等于运行时配置真值（不是模板里手写的常数） */
  check('P7 说明页数字与配置真值一致（敌人 / 专属怪 / 配方 / 成就 / 编队）',
    guideText.nums.enemy === data.enemyCount
    && guideText.nums.exclusive === data.exclusiveCount
    && guideText.nums.fusion === data.fusions.length
    && guideText.nums.ach === data.achCount
    && guideText.nums.formation === data.formationCount
    && data.enemyCount > 0 && data.achCount > 0 && data.fusions.length > 0,
    {
      guide: guideText.nums,
      truth: {
        enemy: data.enemyCount, exclusive: data.exclusiveCount, fusion: data.fusions.length,
        ach: data.achCount, formation: data.formationCount
      }
    });

  // ---------- P1c：更新说明与源码同版本、同游戏名（第 24 项：三处统一） ----------
  const changeText = fs.readFileSync(changelog, 'utf8');
  check('P1c 更新说明与源码同版本、同游戏名',
    changeText.indexOf('v' + built.ver) >= 0 && changeText.indexOf(built.brand.title) >= 0,
    { ver: built.ver, title: built.brand.title, head: changeText.split('\n')[0] });

  // ---------- P6：体积与清单 ----------
  const sizes = files.map((f) => ({ name: f, bytes: fs.statSync(path.join(built.dir, f)).size }));
  const total = sizes.reduce((s, x) => s + x.bytes, 0);
  check('P6 包体大小与文件清单已生成（单文件游戏 < 5MB，总体 < 6MB）',
    sizes[0].bytes < 5 * 1024 * 1024 && total < 6 * 1024 * 1024,
    { totalBytes: total, totalMB: Number((total / 1048576).toFixed(2)), sizes: sizes.map((s) => ({ name: s.name, kb: Math.round(s.bytes / 1024) })) });

  /* 每个文件补 MD5，方便玩家/搬运工核对"拿到的是不是这一包" */
  const withMd5 = sizes.map((s) => {
    const buf = fs.readFileSync(path.join(built.dir, s.name));
    return {
      name: s.name,
      bytes: s.bytes,
      kb: Math.round(s.bytes / 1024),
      md5: crypto.createHash('md5').update(buf).digest('hex').toUpperCase()
    };
  });
  const manifest = {
    at: new Date().toISOString(),
    version: built.ver,
    dir: built.dir,
    files: withMd5,
    gameBytes: withMd5[0] ? withMd5[0].bytes : 0,
    gameMd5: withMd5[0] ? withMd5[0].md5 : '',
    totalBytes: total,
    checks: checks,
    runtimeErrors: runtimeErrors,
    externalRequests: external
  };
  fs.writeFileSync(path.join(built.dir, `manifest_v${built.ver}.json`), JSON.stringify(manifest, null, 2));

  // P8：最终目录必须是 4 个文件（manifest 在全部验收后写入）
  const finalFiles = fs.readdirSync(built.dir).sort();
  check('P8 包内最终清单（4 个文件，manifest 与游戏同版本）',
    finalFiles.length === 4 && finalFiles.indexOf(`manifest_v${built.ver}.json`) >= 0,
    { files: finalFiles, version: built.ver });

  const fails = checks.filter((c) => !c.ok);
  console.log(`\nRESULT: ${fails.length ? 'FAIL' : 'PASS'}  ${checks.length - fails.length}/${checks.length}`);
  if (runtimeErrors.length) console.log('RUNTIME ERRORS: ' + JSON.stringify(runtimeErrors.slice(0, 3)));
  await cleanup();
  process.exit(fails.length ? 1 : 0);
}

/**
 * 关闭 Edge 与临时 profile
 * @returns {Promise<void>}
 */
async function cleanup() {
  try { killEdge(EDGE_PROC); } catch (e) { /* 忽略 */ }
  await sleep(200);
}

main().catch(async (err) => {
  console.error('FATAL', err && err.message ? err.message : err);
  await cleanup();
  process.exit(1);
});
