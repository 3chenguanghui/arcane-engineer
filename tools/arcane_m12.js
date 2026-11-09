// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// M1-2 专项验收：魔法/科技 6/6、回旋刃双段、符文雷触发/超时、磁吸、增幅、HUD 6 列、快捷键、fps、报错
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9450;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm12');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到元素 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };
  const setViewport = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false
    });
    await sleep(250);
  };
  const measureDeck = () => ev(`(() => {
    const measure = (rowId) => {
      const row = document.getElementById(rowId);
      if (!row) return null;
      const cards = Array.from(row.children);
      const rects = cards.map((card) => card.getBoundingClientRect());
      const tops = rects.map((r) => Math.round(r.top));
      const names = Array.from(row.querySelectorAll('.m-name'));
      // 按 top 分组 → 每行几张。A 批扩到 12/8 张后 6 列必然折行，
      // 验收点从"必须单行"改成"必须是 6 列网格：除末行外每行满 6 张"。
      const topCounts = {};
      tops.forEach((t) => { topCounts[t] = (topCounts[t] || 0) + 1; });
      const colsPerRow = Object.keys(topCounts).map(Number).sort((a, b) => a - b).map((t) => topCounts[t]);
      return {
        n: cards.length,
        rows: colsPerRow.length,
        colsPerRow,
        sameTop: tops.every((t) => Math.abs(t - tops[0]) <= 1),
        overflow: row.scrollWidth - row.clientWidth,
        clipped: names.filter((n) => n.scrollWidth > n.clientWidth + 1).length,
        left: Math.min.apply(null, rects.map((r) => r.left)),
        right: Math.max.apply(null, rects.map((r) => r.right)),
        top: Math.min.apply(null, tops),
        viewportW: innerWidth
      };
    };
    return { magic: measure('magicRow'), tech: measure('techRow'), innerW: innerWidth };
  })()`);

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await send('Page.navigate', { url });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(500);
  // H2 上线后清房不再发技能卡；本脚本验收旧奖励流程，关闭成长开关（XP 由 arcane_xp.js 覆盖）
  await ev('window.__roamDebug.xp.setEnabled(false); true');

  // ---------------- 页内主测试 ----------------
  const page = await ev(`(async () => {
    const out = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const d = window.__roamDebug;
    const S = () => d.getState();
    const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail });
    // 边等待边补血：正式局里血量上限有限，测试怪一直贴身会打断采样
    const hold = async (ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { d.setHp(999); await sleep(100); }
    };
    // 收奖励时避开磁吸，保证“无磁吸”基线成立
    const chooseSafe = () => {
      // M1-3 两段式：技能段 + 被动段，一直选到离开 reward 模式
      for (let guard = 0; guard < 4; guard += 1) {
        const snap = S();
        if (snap.mode !== 'reward') break;
        const opts = snap.options || [];
        const pick = opts.find((k) => !/magnet/.test(k)) || opts[0];
        if (!pick) break;
        d.chooseReward(pick);
      }
    };

    // 0) 先测奖励池（此时四张新卡都未持有，池里一定包含它们）
    const seen = new Set();
    for (let i = 0; i < 60; i += 1) {
      const keys = d.openReward() || [];
      keys.forEach((k) => seen.add(k));
    }
    ok('奖励池能抽出四张新卡',
      seen.has('magic:blade') && seen.has('magic:mine') && seen.has('tech:magnet') && seen.has('tech:amp'),
      Array.from(seen).filter((k) => /blade|mine|magnet|amp/.test(k)));
    chooseSafe();
    await sleep(250);

    // 2) 清场并关掉自动奖励，得到一个安静的测试场（奖励同样避开磁吸）
    d.setHp(999);
    d.setAether(100);
    d.clearFloor();
    await sleep(400);
    if (S().options && S().options.length) {
      chooseSafe();
      await sleep(250);
    }

    // 3) 磁吸被动：190px 掉落物，无磁吸不吸 / 有磁吸吸走（按调试标签精确定位）
    d.setHp(999);
    const noMagTag = d.spawnPickup('aether', 190, 0);
    await sleep(700);
    const noMagPick = S().pickupList.find((p) => p.tag === noMagTag);
    const noMagDist = noMagPick ? Math.hypot(noMagPick.x - S().player.x, noMagPick.y - S().player.y) : 0;
    ok('无磁吸时 190px 掉落物不被吸', !!noMagPick && noMagDist > 150, { dist: Math.round(noMagDist) });

    d.grantTech('magnet');
    const magTag = d.spawnPickup('aether', 190, 0);
    await sleep(1700);
    const magPick = S().pickupList.find((p) => p.tag === magTag);
    ok('持有磁吸后 190px 掉落物被吸走', !magPick, { stillThere: !!magPick });

    // 2) 卡表：A 批之后魔法 12 + 科技 8，且包含新旧标志卡
    const magicIds = Array.from(document.querySelectorAll('#magicRow .mini-card')).map((e) => e.dataset.magicId);
    const techIds = Array.from(document.querySelectorAll('#techRow .mini-card')).map((e) => e.dataset.techId);
    ok('魔法卡 12 张且含回旋刃/符文雷/熔岩地裂/冰霜环',
      magicIds.length === 12 && ['blade', 'mine', 'lavaFissure', 'frostRing'].every((id) => magicIds.includes(id)), magicIds);
    ok('科技卡 8 张且含磁吸/增幅/相位甲/时序器',
      techIds.length === 8 && ['magnet', 'amp', 'phase', 'rewind'].every((id) => techIds.includes(id)), techIds);

    // 3) 新卡可释放：回旋刃
    d.grantMagic('blade');
    d.resetCooldowns();
    d.setAether(100);
    d.setMouseAim(0);
    const aetherBefore = S().aether;
    const castBladeOk = d.cast();
    await sleep(60);
    ok('回旋刃可释放（返回 true + 扣奥能 + 场上出现投射物）',
      castBladeOk && S().aether < aetherBefore && S().projectiles >= 1,
      { castBladeOk, before: aetherBefore, after: S().aether, projectiles: S().projectiles });
    await sleep(1700);

    // 4) 回旋刃双段命中：一只高血量怪，去程 + 回程各一次（单段 18，双段 >= 34）
    d.killAllEnemies();
    await sleep(150);
    d.killAllEnemies();
    d.resetCooldowns();
    d.setAether(100);
    d.setHp(999);
    d.setMouseAim(0);
    const bladeId = d.spawnEnemy('devourer', 110, 0);
    await sleep(80);
    const bladeBefore = S().enemyList.find((e) => e.id === bladeId);
    // 朝敌人真实位置瞄准，并立刻钉住辅助瞄准角度，保证这一发一定穿过敌人
    if (bladeBefore) {
      d.setAimExact(Math.atan2(bladeBefore.y - S().player.y, bladeBefore.x - S().player.x));
    }
    d.cast();
    const bladeTrace = [];
    {
      const end = Date.now() + 1200;
      while (Date.now() < end) {
        d.setHp(999);
        const s = S();
        const e = s.enemyList.find((x) => x.id === bladeId);
        bladeTrace.push({
          t: bladeTrace.length * 60,
          p: s.projectilesInfo.map((pr) => [Math.round(pr.x - s.player.x), Math.round(pr.y - s.player.y), pr.returning, pr.hits]),
          e: e ? [Math.round(e.x - s.player.x), Math.round(e.y - s.player.y), e.hp] : null,
          mode: s.mode
        });
        await sleep(60);
      }
    }
    const bladeAfter = S().enemyList.find((e) => e.id === bladeId);
    const drop = bladeBefore ? bladeBefore.hp - (bladeAfter ? bladeAfter.hp : 0) : 0;
    ok('回旋刃去程+回程各命中一次', !!bladeBefore && drop >= 34,
      { before: bladeBefore && bladeBefore.hp, after: bladeAfter && bladeAfter.hp, drop,
        mode: S().mode, playerHp: S().player.hp,
        trace: drop >= 34 ? undefined : bladeTrace.slice(0, 12) });

    // 5) 符文雷：布防后敌人踩中立即引爆
    d.killAllEnemies();
    await sleep(150);
    d.resetCooldowns();
    d.setAether(100);
    d.setMouseAim(0);
    d.grantMagic('mine');
    const castMineOk = d.cast();
    await sleep(700);
    const mine = S().mineList[0];
    const expBefore = S().explosionStats.count;
    if (mine) {
      // 朝雷的真实落点生成敌人，保证一定落在触发半径内
      d.spawnEnemy('crawler', mine.x - S().player.x, mine.y - S().player.y);
    }
    await hold(500);
    const expAfter = S().explosionStats.count;
    ok('符文雷踩中引爆（爆炸统计 +1）', castMineOk && !!mine && expAfter >= expBefore + 1,
      { castMineOk, mine, expBefore, expAfter });

    // 6) 符文雷：没人踩，4 秒后自动引爆
    d.killAllEnemies();
    await sleep(150);
    d.resetCooldowns();
    d.setAether(100);
    d.setMouseAim(0);
    const expBefore2 = S().explosionStats.count;
    const castMineOk2 = d.cast();
    await sleep(500);
    const armedMine = S().mineList[0];
    await sleep(4400);
    const expAfter2 = S().explosionStats.count;
    ok('符文雷 4 秒自动引爆（雷清空 + 爆炸统计 +1）',
      castMineOk2 && !!armedMine && S().mines === 0 && expAfter2 >= expBefore2 + 1,
      { castMineOk2, armedMine, mines: S().mines, expBefore2, expAfter2 });

    // 7) 增幅：被动 1.08、装置 2.2、只吃一发
    // D2 新增了条件型遗物（背水/溢流/惯性），会影响 magicDamage 的倍率；
    // 这里先清空遗物并把生命/奥能放到"不触发条件"的区间，保证只测增幅本身。
    window.__roamDebug.d2.clearRelics();
    state.player.hp = state.player.hpMax;
    state.player.aether = state.player.aetherMax * 0.4; // 低于「溢流」阈值，但够放装置
    state.player.vx = 0; state.player.vy = 0;
    d.killAllEnemies();
    // 裸伤害不受“是否已持有增幅 / 奖励给过什么遗物”影响，倍率断言更稳定
    const rawBase = d.magicDamageBase('fireball');
    d.grantTech('amp');
    const passive = d.magicDamage('fireball');
    d.resetCooldowns();
    d.selectTech('amp');
    d.castDevice();
    const charge = S().ampCharge;
    const boosted = d.magicDamage('fireball');
    d.setAether(100);
    d.cast();
    const afterCharge = S().ampCharge;
    const afterCast = d.magicDamage('fireball');
    ok('增幅被动 +8% / 装置 ×2.2 / 只作用于下一发',
      Math.abs(passive / rawBase - 1.08) < 0.02
        && Math.abs(charge - 2.2) < 0.001
        && Math.abs(boosted / passive - 2.2) < 0.02
        && afterCharge === 1
        && Math.abs(afterCast / passive - 1) < 0.02,
      { rawBase, passive, charge, boosted, afterCharge, afterCast });

    // 8) 磁吸装置：把 220px 内的敌人拉近 42% 并减速（被动吸附已在第 2 步验证）
    d.killAllEnemies();
    await sleep(150);
    d.resetCooldowns();
    d.setHp(999);
    d.selectTech('magnet');
    const magId = d.spawnEnemy('devourer', 180, 0);
    await sleep(100);
    const magBefore = S().enemyList.find((e) => e.id === magId);
    const distBefore = magBefore
      ? Math.hypot(magBefore.x - S().player.x, magBefore.y - S().player.y) : 0;
    d.castDevice();
    await sleep(80);
    const magAfter = S().enemyList.find((e) => e.id === magId);
    const distAfter = magAfter
      ? Math.hypot(magAfter.x - S().player.x, magAfter.y - S().player.y) : distBefore;
    ok('磁吸脉冲拉近敌人并减速',
      distBefore > 0 && distBefore <= 220 && distAfter / distBefore <= 0.75
        && magAfter && magAfter.slow > 0,
      { distBefore: Math.round(distBefore), distAfter: Math.round(distAfter), slow: magAfter && magAfter.slow });

    // 10) 解锁全部 6+6，供 HUD 宽度检查使用
    magicIds.forEach((id) => d.grantMagic(id));
    techIds.forEach((id) => d.grantTech(id));
    await sleep(200);

    // 11) 键盘 5 / 6
    d.grantMagic('blade');
    d.grantMagic('mine');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
    const key5 = S().activeMagicId;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '6', bubbles: true }));
    const key6 = S().activeMagicId;
    ok('数字键 5 / 6 切到回旋刃 / 符文雷', key5 === 'blade' && key6 === 'mine', { key5, key6 });

    return { out, errors: window.__errors.slice() };
  })()`);

  page.out.forEach((item) => check(item.name, item.pass, item.detail));
  check('页内测试期间零报错', page.errors.length === 0, page.errors);

  // ---------------- HUD 6 列：三种视口 ----------------
  for (const [w, h] of [[1280, 720], [1600, 900], [1920, 1080]]) {
    await setViewport(w, h);
    // 鼠标停在卡片上会触发 hover 抬升（translateY），先移开再量"同 top"
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
    await sleep(180);
    const m = await measureDeck();
    ['magic', 'tech'].forEach((key) => {
      const row = m[key];
      const label = key === 'magic' ? '魔法卡' : '科技卡';
      // 6 列网格：行数 = ceil(n/6)，除最后一行外每行必须满 6 张，且同一行的 top 一致
      const wantRows = row ? Math.ceil(row.n / 6) : 0;
      check(`${w}x${h} ${label} 6 列网格（${wantRows} 行，不散行）`,
        !!row && row.rows === wantRows && row.colsPerRow.slice(0, -1).every((c) => c === 6)
          && row.colsPerRow.every((c) => c <= 6),
        row && { n: row.n, rows: row.rows, colsPerRow: row.colsPerRow, top: row.top });
      check(`${w}x${h} ${label} 无横向溢出 / 文字不裁切`,
        row && row.overflow <= 1 && row.clipped === 0
          && row.left >= 0 && row.right <= row.viewportW + 1,
        row && { overflow: row.overflow, clipped: row.clipped, left: Math.round(row.left), right: Math.round(row.right) });
    });
  }

  // 实战截图：回旋刃 / 符文雷
  await setViewport(1920, 1080);
  await ev(`(async () => {
    const d = window.__roamDebug;
    d.killAllEnemies();
    d.resetCooldowns();
    d.setAether(100);
    d.setMouseAim(0);
    d.grantMagic('blade');
    d.cast();
    await new Promise((r) => setTimeout(r, 220));
  })()`);
  await shot('01_blade.png');

  await ev(`(async () => {
    const d = window.__roamDebug;
    d.killAllEnemies();
    d.resetCooldowns();
    d.setAether(100);
    d.setMouseAim(0);
    d.grantMagic('mine');
    d.cast();
    await new Promise((r) => setTimeout(r, 700));
  })()`);
  await shot('02_mine_armed.png');
  await setViewport(1280, 720);
  await shot('03_hud_1280.png');

  // 性能：静置 8 秒后读 fps
  await sleep(4000);
  const perf = await ev(`(() => ({ fps: window.__roamDebug.getState().fps, errors: window.__errors.slice() }))()`);
  check('战斗帧率 >= 55', perf.fps >= 55, perf.fps);
  check('全程 __errors 为空', perf.errors.length === 0, perf.errors);

  const passed = results.filter((r) => r.ok).length;
  console.log(`RESULT ${passed}/${results.length}`);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ passed, total: results.length, results }, null, 2));
  ws.close();
  killEdge(edge);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
