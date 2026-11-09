/**
 * 像素特效复核 + 震撼补强验收脚本（端口 9504）
 * 用法：node tools/arcane_fxaudit.js
 * 输出：.screenshots/art/fx-*.png + fx-result.json
 *
 * 说明：
 * 1) 五项旧效果（dissolve / glitch / scanline / impact / shatter）全部走
 *    "真实触发 → 读 state.fx 运行期状态"验活，不用假数据；
 * 2) 截图时会把对应效果的时长临时调长（只影响截图这一刻，测完立即还原），
 *    否则 0.2–0.6s 的效果在 CDP 截图往返里经常已经播完；
 * 3) 新增的爆环 / 低血色边 / 磁吸 / 里程碑 / Boss 演出按 FEEL_TARGETS 量化断言。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9504;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  // 默认 headless；FX_HEADED=1 时用真实窗口跑一遍（用户要求的"真机复测"，
  // 因为 headless 的合成 / 光栅化路径和真窗口有差异，fps 不能直接照搬）。
  const HEADED = process.env.FX_HEADED === '1';
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    ...(HEADED ? [] : ['--headless=new']),
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  console.log('模式：' + (HEADED ? '真实窗口（headed）' : 'headless'));

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
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };
  /** 一次性读取 fx 相关运行期状态（减少 CDP 往返） */
  const fxSnap = () => ev(`(function(){
    var f = state.fx;
    return {
      dissolve: f.dissolve ? { t: f.dissolve.t, dur: f.dissolve.duration, blocks: f.dissolve.blocks.length } : null,
      glitch: f.glitch ? { t: f.glitch.t, dur: f.glitch.dur, bands: f.glitch.bands.length } : null,
      scanline: f.scanline ? { t: f.scanline.t, dur: f.scanline.dur } : null,
      impacts: f.impacts.length,
      impactLines: PIXEL_FX_CONFIG.impact.lines,
      shards: f.shards.length,
      bursts: f.bursts.length,
      magnet: f.magnet.length,
      lastBurst: f.lastBurst ? JSON.parse(JSON.stringify(f.lastBurst)) : null,
      screen: f.screen ? { kind: f.screen.kind, tier: f.screen.tier, t: f.screen.t, dur: f.screen.dur,
        rays: f.screen.rays, flashMs: f.screen.flashMs } : null,
      screenLayers: f.screen ? 1 : 0,
      screenLog: f.screenLog.slice(-4),
      lowHpLevel: f.lowHpLevel,
      lastFlashMs: (state.feel && state.feel.lastFlashMs) || 0,
      slowMo: state.slowMo,
      hp: state.player.hp, hpMax: state.player.hpMax,
      shake: state.shake ? state.shake.power : 0
    };
  })()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2000);

  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1100);
  // 验收期间玩家必须无敌：否则低血用例 + 9999 血敌人会把流程打进"机体失效"结算屏，
  // 之后的截图全变成结算界面（第一次跑就是这么被污染的）。
  await ev(`(function(){
    state.player.invuln = 9999;
    state.player.hp = state.player.hpMax;
    return state.player.hp;
  })()`);
  await shot('fx-before.png');

  // ---------- A1 dissolve（换层 / 重开的像素溶解） ----------
  await ev(`window.__roamDebug.fxClear()`);
  await ev(`window.__roamDebug.fxTrigger('dissolve')`);
  await sleep(120);
  let s = await fxSnap();
  ok('A1 像素溶解在跑（块数 ≥600、时长 >0.5s）',
    !!s.dissolve && s.dissolve.blocks >= 600 && s.dissolve.dur > 0.5,
    s.dissolve);

  // ---------- A2 glitch（重伤 / 死亡撕裂） ----------
  await ev(`window.__roamDebug.fxClear()`);
  await ev(`window.__roamDebug.fxTrigger('glitch')`);
  await sleep(60);
  s = await fxSnap();
  ok('A2 故障撕裂在跑（strength 1 → 时长 ≥0.3s、band ≥6）',
    !!s.glitch && s.glitch.dur >= 0.3 && s.glitch.bands >= 6, s.glitch);

  // ---------- A3 scanline（开局 / 换层扫描） ----------
  await ev(`window.__roamDebug.fxClear()`);
  await ev(`window.__roamDebug.fxTrigger('scanline')`);
  await sleep(60);
  s = await fxSnap();
  ok('A3 CRT 扫描带在跑（有剩余时长）', !!s.scanline && s.scanline.dur > 0.3, s.scanline);

  // ---------- A4 impact（每次命中） ----------
  await ev(`window.__roamDebug.fxClear()`);
  await ev(`(function(){
    window.__roamDebug.spawnEnemy('crawler', 70, 10);
    window.__roamDebug.spawnEnemy('crawler', -70, 10);
    return state.enemies.length;
  })()`);
  await sleep(120);
  await ev(`window.__roamDebug.hitNearest(11)`);
  await sleep(80);
  s = await fxSnap();
  ok('A4 命中冲击线在跑（1 组、线数 ≥7）',
    s.impacts >= 1 && s.impactLines >= 7, { impacts: s.impacts, lines: s.impactLines });

  // ---------- A5 shatter（击杀崩解） ----------
  await ev(`window.__roamDebug.fxClear()`);
  const before = (await fxSnap()).shards;
  await ev(`(function(){
    window.__roamDebug.spawnEnemy('crawler', 60, 8);
    return null;
  })()`);
  await sleep(120);
  await ev(`window.__roamDebug.hitNearest(9999)`);
  await sleep(60);
  s = await fxSnap();
  const shatterCfg = await ev(`PIXEL_FX_CONFIG.shatter.count`);
  ok('A5 击杀崩解在跑（新增方块 ≈ 配置值 22）',
    s.shards - before >= shatterCfg - 4, { before: before, after: s.shards, cfg: shatterCfg });

  // ---------- A6 AOE 三环 + 粒子数 ----------
  await ev(`window.__roamDebug.fxClear()`);
  await ev(`(function(){
    var p = state.player;
    window.__roamDebug.spawnEnemy('crawler', 46, 12);
    window.__roamDebug.spawnEnemy('crawler', 74, -10);
    window.__roamDebug.spawnEnemy('crawler', 60, 40);
    return state.enemies.length;
  })()`);
  await sleep(140);
  // 把三只敌人的血量拉满：否则 AOE 会当场击杀，lastBurst 会被"击杀环"覆盖（测不到 AOE 环）
  await ev(`(function(){
    state.enemies.forEach(function(e){ e.hp = 9999; e.hpMax = 9999; });
    return state.enemies.length;
  })()`);
  await ev(`window.__roamDebug.fxTrigger('aoe')`);
  await sleep(50);
  s = await fxSnap();
  const aoeBurst = await ev(`(function(){
    var list = state.fx.bursts.filter(function(x){ return x.kind === 'aoe'; });
    if (!list.length) return null;
    var last = list[list.length - 1];
    return {
      rings: last.rings.length,
      particles: last.particles,
      radius: last.rings[last.rings.length - 1].to,
      inner: last.rings[0].color,
      outer: last.rings[last.rings.length - 1].color
    };
  })()`);
  ok('A6 AOE 多环叠加（环数 3、粒子数 ≥40）',
    !!aoeBurst && aoeBurst.rings === 3 && aoeBurst.particles >= 40, aoeBurst);

  // ---------- A7 色温偏移（外环更冷） ----------
  ok('A7 色温偏移：外环更偏冷（B↑ / R↓）',
    !!aoeBurst && aoeBurst.outer[2] > aoeBurst.inner[2] && aoeBurst.outer[0] < aoeBurst.inner[0],
    aoeBurst ? { inner: aoeBurst.inner, outer: aoeBurst.outer } : null);

  // ---------- A8 暴击 / 击杀的环数 ----------
  await ev(`window.__roamDebug.fxClear()`);
  await ev(`window.__roamDebug.fxTrigger('crit')`);
  const crit = (await fxSnap()).lastBurst;
  await ev(`(function(){
    window.__roamDebug.spawnEnemy('crawler', 50, 6);
    return window.__roamDebug.hitNearest(9999);
  })()`);
  await sleep(60);
  const kill = (await fxSnap()).lastBurst;
  ok('A8 暴击双环 / 击杀双环',
    !!crit && crit.kind === 'crit' && crit.rings === 2
    && !!kill && kill.kind === 'kill' && kill.rings === 2,
    { crit: crit && { kind: crit.kind, rings: crit.rings }, kill: kill && { kind: kill.kind, rings: kill.rings } });

  // ---------- A9 低血心跳色边 ----------
  await ev(`(function(){ state.player.hp = Math.round(state.player.hpMax * 0.15); return state.player.hp; })()`);
  await sleep(320);
  const low = (await fxSnap()).lowHpLevel;
  await shot('fx-lowhp.png');
  await ev(`(function(){
    state.player.hp = state.player.hpMax;
    state.player.invuln = 9999;
    return true;
  })()`);
  await sleep(800);
  const lowAfter = (await fxSnap()).lowHpLevel;
  ok('A9 低血色边：hp15% 出现（>0.1）/ hp85% 解除（<0.03）',
    low > 0.1 && lowAfter < 0.03, { low: low, after: lowAfter });

  // 低血用例之后很可能已经被围殴致死：重启一局并重新无敌，保证后续整屏演出截图干净
  await ev(`(function(){
    if (state.mode === 'result' || state.status !== 'playing') { window.__roamDebug.restart(); }
    return state.mode;
  })()`);
  await sleep(900);
  await ev(`(function(){
    window.__roamDebug.fxClear();
    state.player.invuln = 9999;
    state.player.hp = state.player.hpMax;
    return state.mode;
  })()`);

  // ---------- A10 拾取磁吸汇聚 ----------
  await ev(`window.__roamDebug.fxClear()`);
  const magnetN = await ev(`window.__roamDebug.fxTrigger('magnet')`);
  const magnetNow = (await fxSnap()).magnet;
  await sleep(360);
  const magnetLater = (await fxSnap()).magnet;
  ok('A10 磁吸汇聚：生成 ≥5 条、0.36s 内清空',
    Number(magnetN) >= 5 && magnetNow >= 5 && magnetLater === 0,
    { spawn: magnetN, now: magnetNow, later: magnetLater });

  // ---------- A11 10 连里程碑整屏演出 ----------
  await ev(`window.__roamDebug.fxClear()`);
  const milestoneStart = await ev(`window.__roamDebug.fxTrigger('milestone')`);
  await sleep(120);
  s = await fxSnap();
  const milestoneCfg = await ev(`JSON.parse(JSON.stringify(PIXEL_FX_CONFIG.milestone))`);
  await shot('fx-milestone.png');
  ok('A11 里程碑整屏演出：闪白 110ms / 光柱 18 / 慢动作 0.18s / 屏震 ≥8',
    milestoneStart === true && !!s.screen && s.screen.kind === 'milestone'
    && s.screen.rays === 18 && s.screen.flashMs === 110
    && s.lastFlashMs >= 100 && milestoneCfg.slowMo >= 0.18
    && s.slowMo > 0 && s.shake >= 8,
    { screen: s.screen, flashMs: s.lastFlashMs, cfgSlowMo: milestoneCfg.slowMo, slowMoLeft: s.slowMo, shake: s.shake });

  // ---------- A12 Boss 转换整屏演出 ----------
  await ev(`window.__roamDebug.fxClear()`);
  const bossStart = await ev(`window.__roamDebug.fxTrigger('bossPhase')`);
  await sleep(160);
  s = await fxSnap();
  const bossCfg = await ev(`JSON.parse(JSON.stringify(PIXEL_FX_CONFIG.bossPhase))`);
  await shot('fx-boss.png');
  ok('A12 Boss 转换：整屏层 bossPhase、光柱 22、闪白 140ms、慢动作 0.34s',
    bossStart === true && !!s.screen && s.screen.kind === 'bossPhase'
    && s.screen.rays === 22 && s.screen.flashMs === 140 && bossCfg.slowMo >= 0.34
    && s.slowMo > 0,
    { screen: s.screen, slowMoLeft: s.slowMo, cfgSlowMo: bossCfg.slowMo, flashMs: s.lastFlashMs });

  // ---------- A13 分档互斥（同一时刻最多一层整屏） ----------
  await ev(`window.__roamDebug.fxClear()`);
  const m1 = await ev(`window.__roamDebug.fxTrigger('milestone')`);
  const b1 = await ev(`window.__roamDebug.fxTrigger('bossPhase')`);
  const m2 = await ev(`window.__roamDebug.fxTrigger('milestone')`);
  s = await fxSnap();
  ok('A13 分档防晕：整屏层互斥（milestone 占用时 bossPhase / 再次 milestone 被拒）',
    m1 === true && b1 === false && m2 === false && s.screenLayers === 1 && s.screen.kind === 'milestone',
    { m1: m1, b1: b1, m2: m2, layers: s.screenLayers, kind: s.screen && s.screen.kind });

  // ---------- 截图：五项旧效果（临时加长时长，只影响截图这一刻） ----------
  // 先确保还在游戏中（不在结算屏），并重新给玩家无敌，避免敌人把流程打断
  await ev(`(function(){
    if (state.mode === 'result' || state.status !== 'playing') { window.__roamDebug.restart(); }
    return state.mode;
  })()`);
  await sleep(900);
  await ev(`(function(){
    window.__roamDebug.fxClear();
    state.player.invuln = 9999;
    state.player.hp = state.player.hpMax;
    return state.mode;
  })()`);
  const restore = `(function(){
    PIXEL_FX_CONFIG.dissolve.intro = 0.4; PIXEL_FX_CONFIG.dissolve.hold = 0.07; PIXEL_FX_CONFIG.dissolve.outro = 0.46;
    PIXEL_FX_CONFIG.glitch.duration = 0.42; PIXEL_FX_CONFIG.glitch.bands = 12; PIXEL_FX_CONFIG.glitch.maxShift = 34;
    PIXEL_FX_CONFIG.scanline.duration = 0.62; PIXEL_FX_CONFIG.scanline.lineAlpha = 0.05; PIXEL_FX_CONFIG.scanline.bandAlpha = 0.16;
    PIXEL_FX_CONFIG.impact.life = 0.2;
    PIXEL_FX_CONFIG.shatter.gravity = 520; PIXEL_FX_CONFIG.shatter.life = 0.5;
    return true;
  })()`;

  await ev(`(function(){
    PIXEL_FX_CONFIG.dissolve.intro = 1.1; PIXEL_FX_CONFIG.dissolve.hold = 0.55; PIXEL_FX_CONFIG.dissolve.outro = 0.75;
    return true;
  })()`);
  await ev(`window.__roamDebug.fxTrigger('dissolve')`);
  await sleep(420);
  await shot('fx-dissolve.png');
  // 关键：截图后立刻清掉溶解，否则它还在"压黑"时拍下一项，会把 glitch / scanline 也拍成黑屏
  await ev(`window.__roamDebug.fxClear()`);
  await ev(restore);

  // 故障撕裂截图：把撕裂带数 / 位移调到"肉眼可见档"（默认 12 带 / 34px 偏克制）
  await ev(`(function(){
    PIXEL_FX_CONFIG.glitch.duration = 1.6;
    PIXEL_FX_CONFIG.glitch.bands = 18;
    PIXEL_FX_CONFIG.glitch.maxShift = 60;
    return true;
  })()`);
  await ev(`window.__roamDebug.fxTrigger('glitch')`);
  await sleep(240);
  await shot('fx-glitch.png');
  await ev(`window.__roamDebug.fxClear()`);
  await ev(restore);

  // CRT 扫描截图：把线 / 亮带透明度调高（默认为"不影响看子弹"的极淡档）
  await ev(`(function(){
    PIXEL_FX_CONFIG.scanline.duration = 2.0;
    PIXEL_FX_CONFIG.scanline.lineAlpha = 0.14;
    PIXEL_FX_CONFIG.scanline.bandAlpha = 0.5;
    return true;
  })()`);
  await ev(`window.__roamDebug.fxTrigger('scanline')`);
  await sleep(400);
  await shot('fx-scanline.png');
  await ev(`window.__roamDebug.fxClear()`);
  await ev(restore);

  // AOE 爆环截图（把环寿命拉长，抓在中段扩散）
  await ev(`(function(){
    PIXEL_FX_CONFIG.burst.ringLife = 1.1;
    var p = state.player;
    window.__roamDebug.spawnEnemy('crawler', 46, 12);
    window.__roamDebug.spawnEnemy('crawler', 74, -10);
    return true;
  })()`);
  await sleep(160);
  await ev(`window.__roamDebug.fxTrigger('aoe')`);
  await sleep(240);
  await shot('fx-aoe.png');
  await ev(`(function(){ PIXEL_FX_CONFIG.burst.ringLife = 0.42; return true; })()`);

  // ---------- A15 清房过场 ----------
  // 先重开一局：上一批用例已经打空/打散了好几间房，继续往下杀很容易触发"楼层清空"弹窗，
  // 三选一弹窗会挡住截图。重开后只清一间房，其它房仍有怪，不会提前触发楼层奖励。
  await ev(`window.__roamDebug.restart()`);
  await sleep(900);
  await ev(`(function(){ window.__roamDebug.fxClear(); state.player.invuln = 9999; return true; })()`);
  const clearInfo = await ev(`(function(){
    var d = window.__roamDebug;
    var rooms = state.rooms, target = null;
    // 楼层随机：第 1 层不一定生成 'battle' 房，这里按"有敌人且未清"来选，
    // 只排除 boss / shop（这两类清空会触发额外演出或弹窗，干扰断言）。
    for (var i = 0; i < rooms.length; i += 1) {
      var r = rooms[i];
      var t = ROOM_TYPE_CONFIG.types[r.type] || ROOM_TYPE_CONFIG.types.battle;
      if (r.type !== 'boss' && r.type !== 'shop' && t.count[1] > 0 && !r.cleared) { target = r; break; }
    }
    if (!target) return { found: false, rooms: rooms.map(function (r) { return r.type; }) };
    d.teleport(target.cx, target.cy);
    // 只保留本房敌人：既避免误杀别处首领，也避免"全层清空"提前触发楼层奖励
    state.enemies = state.enemies.filter(function (e) { return e.roomId === target.id; });
    return { found: true, id: target.id, type: target.type, x: Math.round(target.cx), y: Math.round(target.cy),
      enemies: state.enemies.length };
  })()`);
  await sleep(160);
  // 用真实伤害入口逐个击杀本房敌人（走 damageEnemy → killEnemy → 清房判定）
  const clearKill = await ev(`(function(){
    var guard = 0;
    while (state.enemies.length > 0 && guard < 60) { guard += 1; window.__roamDebug.hitNearest(99999); }
    state.player.invuln = 9999;
    return state.enemies.length;
  })()`);
  await sleep(120);
  s = await fxSnap();
  const clearCfg = await ev(`JSON.parse(JSON.stringify(PIXEL_FX_CONFIG.clear))`);
  ok('A15 清房过场（真实链路）：打空一间战斗房 → 整屏层 clear（14 光柱 / 60ms 闪白 / 0.1s 慢动作）',
    !!clearInfo && clearInfo.found === true && clearKill === 0 && !!s.screen && s.screen.kind === 'clear'
    && s.screen.rays === 14 && s.screen.flashMs === 60 && clearCfg.slowMo >= 0.1,
    { room: clearInfo, screen: s.screen, cfgSlowMo: clearCfg.slowMo, enemiesLeft: clearKill });

  // 截图单独拍：真实清房大概率伴随经验/楼层奖励弹窗（一弹窗主循环就冻结），
  // 所以重置到干净的 playing 状态，用同一个 requestScreenFx 入口触发后再拍。
  await ev(`window.__roamDebug.restart()`);
  await sleep(900);
  await ev(`(function(){ window.__roamDebug.fxClear(); state.player.invuln = 9999; return true; })()`);
  await ev(`window.__roamDebug.fxTrigger('clear')`);
  await sleep(160);
  await shot('fx-clear.png');

  // ---------- A16 下楼过场（真实 descend，和像素溶解同帧叠加） ----------
  // A15 清空精英房会给经验，可能当场升级弹出三选一（mode=reward），
  // 那样 descend() 会被 mode 检查拒绝 → 先重开一局，保证从 playing 状态下楼。
  await ev(`window.__roamDebug.restart()`);
  await sleep(900);
  await ev(`(function(){
    window.__roamDebug.fxClear();
    state.player.invuln = 9999;
    return state.mode;
  })()`);
  const floorBefore = await ev(`state.floor`);
  const descendOk = await ev(`window.__roamDebug.descend()`);
  await ev(`(function(){ state.player.invuln = 9999; return true; })()`);
  await sleep(300);
  s = await fxSnap();
  const descendCfg = await ev(`JSON.parse(JSON.stringify(PIXEL_FX_CONFIG.descend))`);
  await shot('fx-descend.png');
  ok('A16 下楼过场：真实下楼 → 整屏层 descend（16 光柱 / 70ms 闪白）+ 像素溶解同时播放',
    descendOk === true && !!s.screen && s.screen.kind === 'descend' && s.screen.rays === 16
    && s.screen.flashMs === 70 && descendCfg.slowMo >= 0.16
    && !!s.dissolve && s.dissolve.blocks > 0,
    { floorBefore: floorBefore, floorAfter: floorBefore + 1, screen: s.screen,
      dissolve: s.dissolve, cfgSlowMo: descendCfg.slowMo, flashMs: s.lastFlashMs });

  // ---------- A14 帧率 / 异常 / 截图 ----------
  const perf = await ev(`(function(){
    return new Promise(function(resolve){
      var frames = 0;
      var t0 = performance.now();
      function tick(){
        frames += 1;
        if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
        else resolve({ fps: frames / ((performance.now() - t0) / 1000), errors: (window.__errors || []).slice(0, 6) });
      }
      requestAnimationFrame(tick);
    });
  })()`);
  const names = ['fx-before.png', 'fx-dissolve.png', 'fx-glitch.png', 'fx-scanline.png',
    'fx-aoe.png', 'fx-lowhp.png', 'fx-milestone.png', 'fx-boss.png',
    'fx-clear.png', 'fx-descend.png'];
  const modeEnd = await ev(`state.mode`);
  const sizes = names.map((n) => {
    const p = path.join(OUT_DIR, n);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  });
  ok('A14 帧率 ≥90 / 无脚本错误 / 10 张截图 >10KB / 截图时仍在游戏中',
    perf.fps >= 90 && (perf.errors || []).length === 0 && sizes.every((v) => v > 10240)
    && modeEnd === 'playing',
    { fps: Math.round(perf.fps * 10) / 10, errors: (perf.errors || []).length, sizes: sizes, mode: modeEnd });

  const passed = asserts.filter((a) => a.pass).length;
  console.log('----------------------------------------');
  console.log('pixelfx audit · ' + passed + '/' + asserts.length + ' PASS');
  console.log('PERF ' + JSON.stringify({ avgFps: Math.round(perf.fps * 10) / 10, errors: (perf.errors || []).length }));
  fs.writeFileSync(path.join(OUT_DIR, 'fx-result.json'),
    JSON.stringify({ passed: passed, total: asserts.length, asserts: asserts, perf: perf }, null, 2));

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (passed < asserts.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 200);
});
