// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// P1-UI：面板拆分（帮助 / 技能树 / 设置）+ 技能树三态 专项验收
//   node arcane_p1a_ui.js <html> <截图目录>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9753;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p1a_ui');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* wait */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const report = { assertions: [], notes: {} };
  const check = (name, ok, detail) => report.assertions.push({ name, ok: !!ok, detail });

  /* ---------- 1. 标题页：天赋在主菜单，HUD 三入口 ---------- */
  const title = await ev(`(function(){
    return {
      hasTalents: !!document.querySelector('.title-talents [data-talent-body]'),
      talentRows: document.querySelectorAll('.title-talents [data-talent-id]').length,
      crystals: (document.querySelector('.title-talents [data-talent-crystals]') || {}).textContent,
      hudButtons: Array.prototype.slice.call(document.querySelectorAll('.hud-actions .btn')).map(function(b){ return b.id; }),
      rulesLabel: document.getElementById('btnRules').textContent.trim(),
      legacyNaming: document.body.textContent.indexOf('规则 · 融合配方') >= 0
    };
  })()`);
  report.notes.title = title;
  check('标题页（主菜单）有永久天赋区块', title.hasTalents === true, title);
  check('标题页天赋有 3 行可升级', title.talentRows === 3, title.talentRows);
  check('HUD 有 帮助 / 技能树 / 设置 三个入口',
    ['btnRules', 'btnSkillTree', 'btnSettings'].every((id) => title.hudButtons.indexOf(id) >= 0), title.hudButtons);
  check('全站不再出现「规则 · 融合配方 · 永久天赋」旧命名', title.legacyNaming === false && title.rulesLabel.indexOf('帮助') >= 0, { legacyNaming: title.legacyNaming, label: title.rulesLabel });
  await shot('01_title.png');

  /* ---------- 2. 帮助面板（H）：只放键位 / 楼层 / 敌人 ---------- */
  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);
  // H2 升级四选一会把 state.mode 切到 reward，打断本脚本的面板流程；关掉成长开关保持纯 UI 采样
  await ev("window.__roamDebug.xp.setEnabled(false); true");
  const beforeHelp = await ev('window.__roamDebug.getState().elapsed');
  await ev("window.__roamDebug.openPanel('rules'); true");
  await sleep(420);
  const help = await ev(`(function(){
    var body = document.getElementById('rulesBody');
    var text = body.textContent;
    return {
      mode: state.mode,
      cards: body.querySelectorAll('.help-card').length,
      hasKeys: text.indexOf('操作键位') >= 0,
      hasFloor: text.indexOf('楼层循环与难度') >= 0,
      hasEnemies: text.indexOf('敌人类型') >= 0,
      hasFusionTable: text.indexOf('融合配方') >= 0,
      tabs: Array.from(document.querySelectorAll('[data-help-tab]')).map(function(b){ return b.getAttribute('data-help-tab'); }),
      panes: Array.from(document.querySelectorAll('[data-help-pane]')).map(function(p){
        return {
          id: p.getAttribute('data-help-pane'),
          on: p.classList.contains('is-on'),
          cards: p.querySelectorAll('.help-card').length,
          fusionRows: p.querySelectorAll('.fusion-table tbody tr').length,
          text: p.textContent
        };
      }),
      hasTalents: body.querySelectorAll('[data-talent-id]').length > 0,
      hasAudio: text.indexOf('BGM') >= 0,
      scrollH: body.scrollHeight, clientH: body.clientHeight,
      elapsed: state.elapsed
    };
  })()`);
  report.notes.help = help;
  // 冻结判定改为"面板已打开后连采两次"，避免 CDP 往返期间的 2 帧正常推进被误判
  await sleep(420);
  const helpElapsed2 = await ev('state.elapsed');
  check('H = 帮助：打开后 mode = rules 且世界暂停',
    help.mode === 'rules' && Math.abs(helpElapsed2 - help.elapsed) < 0.02,
    { before: help.elapsed, after: helpElapsed2 });
  // H3 起帮助改成三页签（操作 / 融合配方 / 规则）；默认打开第一页，其余两页互斥隐藏
  const opsPane = help.panes && help.panes.find((p) => p.id === 'ops');
  const fusionPane = help.panes && help.panes.find((p) => p.id === 'fusion');
  const rulesPane = help.panes && help.panes.find((p) => p.id === 'rules');
  check('H 面板 = 操作 / 融合配方 / 规则 三页签', help.tabs && help.tabs.join(',') === 'ops,fusion,rules'
    && help.panes.length === 3 && help.panes.filter((p) => p.on).length === 1 && opsPane && opsPane.on,
  { tabs: help.tabs, panes: help.panes && help.panes.map((p) => p.id + (p.on ? ':on' : '')) });
  check('帮助三页签共含 键位 + 楼层难度 + 敌人',
    opsPane && opsPane.cards === 1 && /操作键位/.test(opsPane.text)
    && /楼层循环与难度/.test(rulesPane ? rulesPane.text : '') && /敌人类型/.test(rulesPane ? rulesPane.text : ''),
    { opsCards: opsPane && opsPane.cards, opsText: opsPane && opsPane.text.slice(0, 40) });
  check('页签②融合配方 = FUSION_CONFIG 条数（13）', fusionPane && fusionPane.fusionRows === 13, fusionPane && fusionPane.fusionRows);
  check('H 面板不再含永久天赋', help.hasTalents === false, help);
  check('H 面板不再含音频设置', help.hasAudio === false, help);
  check('H 面板内容一屏读完（无需滚动）', help.scrollH <= help.clientH + 4, { scroll: help.scrollH, client: help.clientH });
  await shot('02_help.png');

  /* ---------- 3. 技能树：三态 + 连线 + 互斥 ---------- */
  const elapsedHelp = help.elapsed;
  await ev("window.__roamDebug.openPanel('skilltree'); true");
  await sleep(600);
  const tree0 = await ev('window.__roamDebug.treeState()');
  const treePanels = await ev(`(function(){
    return {
      mode: state.mode,
      rulesOpen: document.getElementById('rulesPanel').classList.contains('is-open'),
      treeOpen: document.getElementById('skillTreePanel').classList.contains('is-open'),
      settingsOpen: document.getElementById('settingsPanel').classList.contains('is-open'),
      elapsed: state.elapsed
    };
  })()`);
  report.notes.treeInitial = { tree0, treePanels };
  // A 批之后卡池 = 魔法 12 + 科技 8 + 融合 13 = 33 节点，连线仍是每条融合两条父线（26）
  check('技能树：节点 = 12 魔法 + 8 科技 + 13 融合', tree0.nodes.filter((n) => n.kind === 'magic').length === 12
    && tree0.nodes.filter((n) => n.kind === 'tech').length === 8
    && tree0.nodes.filter((n) => n.kind === 'fusion').length === 13, tree0.nodes.length);
  check('技能树：连线数 = 融合数 × 2（每个融合两条父线）', tree0.links === 13 * 2, tree0.links);
  check('面板互斥：打开技能树时帮助面板已关闭',
    treePanels.mode === 'skilltree' && treePanels.rulesOpen === false && treePanels.settingsOpen === false, treePanels);
  check('技能树打开时世界仍冻结', Math.abs(treePanels.elapsed - elapsedHelp) < 0.02, treePanels.elapsed);
  // 初始局只会自带起始魔法（火球），其余模块都是"可解锁"；10 条融合全为锁定
  check('初始局：除起始火球外全为可解锁、10 融合全为锁定',
    tree0.nodes.filter((n) => n.kind !== 'fusion' && n.id !== 'fireball').every((n) => n.state === 'ready')
    && tree0.nodes.filter((n) => n.kind === 'magic' && n.id === 'fireball').every((n) => n.state === 'owned')
    && tree0.nodes.filter((n) => n.kind === 'fusion').every((n) => n.state === 'locked'), tree0.nodes.map((n) => n.label));
  check('初始局提示条写明缺哪一个',
    /缺/.test(tree0.ready) && tree0.ready.indexOf('可凑出的融合') < 0, tree0.ready);
  await shot('03_tree_initial.png');

  /* ---------- 4. 悬停 / 点击：检查器与父节点高亮 ---------- */
  const hoverFusion = await ev(`(function(){
    var node = document.querySelector('[data-tree-node="fusion:homingFireball"]') || document.querySelector('[data-tree-node^="fusion:"]');
    node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return { id: node.getAttribute('data-tree-node'), inspector: document.getElementById('treeInspector').textContent };
  })()`);
  report.notes.hoverFusion = hoverFusion.hoverFusion;
  check('悬停融合节点：检查器显示名称/效果/来源', /来源/.test(hoverFusion.inspector) && hoverFusion.inspector.length > 20, hoverFusion.inspector);

  const hoverMagic = await ev(`(function(){
    var node = document.querySelector('[data-tree-node="magic:fireball"]');
    node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    var inspector = document.getElementById('treeInspector').textContent;
    var hot = document.querySelectorAll('#treeLinks path.link.is-hot').length;
    return { inspector: inspector, hot: hot };
  })()`);
  check('悬停魔法节点：详情里列出"可融合对象"', /可融合/.test(hoverMagic.inspector), hoverMagic.inspector);
  check('悬停魔法节点：相关连线高亮', hoverMagic.hot >= 2, hoverMagic.hot);

  const clickFusion = await ev(`(function(){
    var node = document.querySelector('[data-tree-node="fusion:homingFireball"]') || document.querySelector('[data-tree-node^="fusion:"]');
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return window.__roamDebug.treeState();
  })()`);
  const focused = clickFusion.nodes.filter((n) => n.focus).length;
  const parents = clickFusion.nodes.filter((n) => n.parent).length;
  report.notes.clickFusion = { focused, parents, inspector: hoverFusion.inspector };
  check('点击融合节点：自身 focused + 两个父节点 parent 高亮', focused === 1 && parents === 2, { focused, parents });
  await shot('04_tree_focus.png');

  /* ---------- 5. 有 2 模块 → 融合可凑出 ---------- */
  await ev("window.__roamDebug.grantMagic('fireball'); window.__roamDebug.grantTech('field'); true");
  await sleep(120);
  await ev("window.__roamDebug.closePanel('skilltree'); window.__roamDebug.openPanel('skilltree'); true");
  await sleep(650);
  const tree2 = await ev('window.__roamDebug.treeState()');
  report.notes.tree2 = tree2;
  const novaNode = tree2.nodes.find((n) => n.id === 'novaBurst');
  check('拥有火球 + 力场后：爆炸新星节点变"可凑出"', novaNode && novaNode.state === 'ready' && novaNode.label === '可凑出', novaNode);
  check('可凑出提示条出现（金 chip）', /可凑出的融合/.test(tree2.ready) && tree2.ready.indexOf('爆炸新星') >= 0, tree2.ready);
  check('已拥有模块显示"已解锁"',
    tree2.nodes.find((n) => n.id === 'fireball').state === 'owned'
    && tree2.nodes.find((n) => n.id === 'field').state === 'owned', tree2.nodes.filter((n) => n.state === 'owned').map((n) => n.id));
  await shot('05_tree_2modules.png');

  /* ---------- 6. 融合 1 条 ---------- */
  await ev("window.__roamDebug.closePanel('skilltree'); true");
  await sleep(200);
  // D1 渐进解锁：第 1 层融合默认锁着，本步要验证"融合成功"必须先达成解锁条件（等价于玩家清掉第一间房）
  await ev("window.__roamDebug.unlocks.grant('fusion'); true");
  const fusedOk = await ev("window.__roamDebug.fuse()");
  report.notes.fuseCall = fusedOk;
  await sleep(300);
  await ev("window.__roamDebug.openPanel('skilltree'); true");
  await sleep(600);
  const tree1 = await ev('window.__roamDebug.treeState()');
  report.notes.tree1 = tree1;
  check('融合后：爆炸新星变"已解锁/已激活"', tree1.nodes.find((n) => n.id === 'novaBurst').state === 'owned', tree1.fusions);
  check('进度文案显示 融合 1/13', /融合\s*1\/13/.test(tree1.progress.replace(/\s+/g, ' ')), tree1.progress);
  await shot('06_tree_1fusion.png');

  /* ---------- 7. 全解锁 ---------- */
  await ev(`(function(){
    ['fireball','frost','bolt','heal','blade','mine','lavaFissure','arcanePool','runeOrbit','collapseHole','flameCone','frostRing'].forEach(function(id){ window.__roamDebug.grantMagic(id); });
    ['concentrator','field','capacitor','nanite','magnet','amp','phase','rewind'].forEach(function(id){ window.__roamDebug.grantTech(id); });
    return true;
  })()`);
  await ev("window.__roamDebug.openPanel('skilltree'); true");
  await sleep(650);
  const treeAll = await ev('window.__roamDebug.treeState()');
  report.notes.treeAll = treeAll;
  check('全解锁：12/12 魔法 + 8/8 科技都是已解锁',
    treeAll.nodes.filter((n) => n.kind !== 'fusion' && n.state === 'owned').length === 20, treeAll.progress);
  check('全解锁：可凑出清单 ≥ 4 条融合', (treeAll.ready.match(/按 F/g) || []).length >= 4, treeAll.ready);
  await shot('07_tree_all.png');

  /* ---------- 8. 设置面板：后处理开关 + 互斥 ---------- */
  await ev("window.__roamDebug.openPanel('settings'); true");
  await sleep(450);
  const settings0 = await ev(`(function(){
    return {
      mode: state.mode,
      treeOpen: document.getElementById('skillTreePanel').classList.contains('is-open'),
      audio: !!document.getElementById('bgmVolume'),
      aim: document.querySelectorAll('[data-aim-mode]').length,
      postFx: window.__roamDebug.postFxState(),
      wipe: !!document.getElementById('btnWipeSave'),
      elapsed: state.elapsed
    };
  })()`);
  report.notes.settings = settings0;
  check('设置独立成页：音频 / 瞄准三档 / 后处理 / 清档 都在',
    settings0.audio && settings0.aim === 3 && settings0.wipe && settings0.mode === 'settings', settings0);
  check('设置与技能树互斥（技能树已关闭）', settings0.treeOpen === false, settings0);
  await shot('08_settings.png');

  const postOff = await ev("window.__roamDebug.setPostFx(false); window.__roamDebug.postFxState()");
  check('设置里关闭后处理：配置立即生效', postOff.enabled === false && postOff.configEnabled === false, postOff);
  await shot('09_settings_postfx_off.png');
  const postOn = await ev("window.__roamDebug.setPostFx(true); window.__roamDebug.postFxState()");
  check('重新打开后处理：配置恢复', postOn.enabled === true && postOn.configEnabled === true, postOn);

  /* ---------- 9. 奖励弹窗次级入口：打开技能树 → 关闭回到奖励 ---------- */
  const reward = await ev(`(function(){
    window.__roamDebug.closePanel('settings');
    window.__roamDebug.openReward();
    return {
      mode: state.mode,
      hasEntry: !!document.querySelector('#modal [data-action="skilltree"]')
    };
  })()`);
  report.notes.reward = reward;
  check('奖励弹窗里有"查看技能树"次级入口', reward.hasEntry === true, reward);
  await shot('10_reward_entry.png');
  await ev(`document.querySelector('#modal [data-action="skilltree"]').click(); true`);
  await sleep(500);
  const rewardTree = await ev('window.__roamDebug.panelState()');
  check('奖励里打开技能树：mode=skilltree 且记录返回 reward',
    rewardTree.mode === 'skilltree' && rewardTree.returnMode === 'reward', rewardTree);
  await shot('11_tree_from_reward.png');
  await ev("window.__roamDebug.closePanel('skilltree'); true");
  await sleep(350);
  const backReward = await ev(`(function(){
    return {
      mode: state.mode,
      modalVisible: !document.getElementById('modalLayer').classList.contains('hidden')
    };
  })()`);
  check('关闭技能树：回到奖励弹窗且弹窗重新可见',
    backReward.mode === 'reward' && backReward.modalVisible === true, backReward);
  await ev(`(() => {
    const d = window.__roamDebug;
    for (let guard = 0; guard < 4; guard += 1) {
      const s = d.getState();
      if (s.mode !== 'reward' || !s.options.length) break;
      d.chooseReward(s.options[0]);
    }
    return d.getState().mode;
  })()`);
  await sleep(300);

  /* ---------- 10. 结算页：天赋在结算里 ---------- */
  await ev('window.__roamDebug.forceDeath(); true');
  await sleep(700);
  const result = await ev(`(function(){
    return {
      mode: state.mode,
      hasTalentBox: !!document.querySelector('#modal [data-talent-body]'),
      talentRows: document.querySelectorAll('#modal [data-talent-id]').length,
      hint: document.querySelector('#modal .result-hint').textContent
    };
  })()`);
  report.notes.result = result;
  check('结算页带永久天赋（3 行）', result.hasTalentBox && result.talentRows === 3, result);
  check('结算页提示指向 T / O / H 三个入口', /技能树/.test(result.hint) && /设置/.test(result.hint), result.hint);
  await shot('12_result.png');

  /* ---------- 11. ESC 关闭 + 帧率 + 报错 ---------- */
  await ev("window.__roamDebug.openPanel('rules'); true");
  await sleep(300);
  const escClosed = await ev(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { mode: state.mode };
  })()`);
  check('Esc 可关闭当前面板（结算页下回到 result）', escClosed.mode === 'result', escClosed);

  await ev("window.__roamDebug.restart(); true");
  await sleep(1200);
  const final = await ev('window.__roamDebug.getState()');
  const errors = await ev('window.__roamDebug.errors()');
  report.notes.fps = final.fps;
  report.notes.errors = errors;
  // 帧率只记录不判红（本轮约定：fps 属负载敏感项）。D 批后处理默认开泛光，
  // 无头环境同一份代码可在 44–120fps 之间波动，判红会掩盖真正的功能回归。
  console.log('PERF(只记录) 帧率 = ' + final.fps + '（无头环境，postfx 默认泛光）');
  check('全程无报错', Array.isArray(errors) && errors.length === 0, errors);

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  const failed = report.assertions.filter((a) => !a.ok);
  console.log('==== ' + (report.assertions.length - failed.length) + '/' + report.assertions.length + ' 通过 ====');
  failed.forEach((a) => console.log('FAIL: ' + a.name + ' :: ' + JSON.stringify(a.detail)));
  ws.close(); killEdge(edge);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });



