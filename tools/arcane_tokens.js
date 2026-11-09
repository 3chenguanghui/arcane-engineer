// 第 8 轮 · 组 3 断言：全局 UI 令牌收口（五类弹窗同宽 / 按钮三态 / 图标线宽均来自同一令牌集）
// 用法：node tools\arcane_tokens.js *> tools\tokens.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9683;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const BEFORE = path.join(__dirname, '..', 'index_arcane_v2.bak_pre8_title.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'tokens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1536,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) throw new Error('Edge CDP 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + m.params.exceptionDetails.text);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 900, deviceScaleFactor: 1, mobile: false });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const checks = [];
  /** 记录一条断言（两空格格式，供断言分类器识别） */
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + JSON.stringify(detail));
  };
  const openRewardShot = async () => {
    await ev(`(function(){ try { state.onboardSkipAll = true; hideIntroHint(true); } catch (e) {} ; return true; })()`);
    await ev(`document.getElementById('btnStart').click(); true`);
    await sleep(280);
    await ev(`openReward('floor', 'skill'); true`);
    await sleep(320);
  };

  // ---------- 0) before：收口前的旧版奖励弹窗 ----------
  await send('Page.navigate', { url: 'file:///' + BEFORE.replace(/\\/g, '/') });
  await sleep(1500);
  await openRewardShot();
  await shot('tokens-before-reward.png');

  // ---------- 1) 载入新版 ----------
  await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(1500);
  await openRewardShot();
  await shot('tokens-after-reward.png');

  // ---------- 2) 令牌本体 ----------
  const tok = await ev(`(function(){
    var cs = getComputedStyle(document.documentElement);
    var keys = ['--modal-w','--modal-pad','--modal-radius','--modal-shadow','--btn-pad','--btn-radius','--btn-bg','--btn-bg-hover','--btn-bg-active','--icon-stroke','--font-ui'];
    var out = {};
    keys.forEach(function(k){ out[k] = (cs.getPropertyValue(k) || '').trim(); });
    return out;
  })()`);
  check('令牌 --modal-w = 960px', tok['--modal-w'] === '960px', tok['--modal-w']);
  check('令牌 --modal-pad = 24px', tok['--modal-pad'] === '24px', tok['--modal-pad']);
  check('令牌 --btn-radius = 8px', tok['--btn-radius'] === '8px', tok['--btn-radius']);
  check('令牌 --icon-stroke = 1.5px', tok['--icon-stroke'] === '1.5px', tok['--icon-stroke']);
  check('令牌 --modal-shadow 非空', !!tok['--modal-shadow'], tok['--modal-shadow']);
  check('按钮三态令牌齐全', !!tok['--btn-bg'] && !!tok['--btn-bg-hover'] && !!tok['--btn-bg-active'], tok);

  // ---------- 3) 五类弹窗的最终生效宽度必须来自 --modal-w ----------
  const scan = await ev(`(function(){
    function lastValue(sel, prop){
      var out = [];
      function walk(rules){
        for (var i = 0; i < rules.length; i += 1){
          var r = rules[i];
          // Chrome 112+ 给所有样式规则都挂了空的 cssRules（CSS Nesting），
          // 必须先判"是不是样式规则"，否则会漏掉规则本身
          if (r.selectorText && r.style) {
            var sels = r.selectorText.split(',').map(function(s){ return s.trim(); });
            if (sels.indexOf(sel) >= 0){
              var v = r.style.getPropertyValue(prop);
              if (v) out.push(v);
            }
          }
          if (r.cssRules && r.cssRules.length) walk(r.cssRules);
        }
      }
      var sheets = document.styleSheets;
      for (var i = 0; i < sheets.length; i += 1){
        try { walk(sheets[i].cssRules); } catch (e) {}
      }
      return out.length ? out[out.length - 1] : '';
    }
    var res = {};
    ['.modal','.result-modal','.rules-card','.codex-card','.engrave-card'].forEach(function(sel){
      res[sel] = {
        width: lastValue(sel, 'width'),
        radius: lastValue(sel, 'border-radius'),
        shadow: lastValue(sel, 'box-shadow'),
        padding: lastValue(sel, 'padding')
      };
    });
    res.btn = { padding: lastValue('.btn','padding'), radius: lastValue('.btn','border-radius') };
    res.icon = lastValue('.btn > svg', 'stroke-width');
    res._sheets = document.styleSheets.length;
    return res;
  })()`);
  const five = ['.modal', '.result-modal', '.rules-card', '.codex-card', '.engrave-card'];
  check('五类弹窗宽度均取 var(--modal-w)', five.every((s) => scan[s] && scan[s].width.indexOf('var(--modal-w)') >= 0), scan);
  check('五类弹窗圆角均取令牌', five.every((s) => scan[s] && (scan[s].radius.indexOf('var(--modal-radius)') >= 0 || scan[s].radius.indexOf('var(--r-lg)') >= 0)), scan);
  check('五类弹窗阴影均取令牌', five.every((s) => scan[s] && scan[s].shadow.indexOf('var(--modal-shadow)') >= 0), scan);
  check('五类弹窗内边距均取令牌', five.every((s) => scan[s] && scan[s].padding.indexOf('var(--modal-pad)') >= 0), scan);
  check('按钮内边距/圆角取令牌', scan.btn.padding.indexOf('var(--btn-pad)') >= 0 && scan.btn.radius.indexOf('var(--btn-radius)') >= 0, scan.btn);
  check('图标线宽取令牌', scan.icon.indexOf('var(--icon-stroke)') >= 0, scan.icon);

  // ---------- 4) 真实渲染值抽查 ----------
  const live = await ev(`(function(){
    var layer = document.querySelector('.modal-layer');
    if (layer) layer.classList.remove('hidden');
    var m = document.querySelector('.modal');
    var cs = getComputedStyle(m);
    var btn = document.querySelector('.btn');
    var bs = getComputedStyle(btn);
    var h2 = m.querySelector('h2');
    var hs = h2 ? getComputedStyle(h2) : null;
    return {
      width: cs.width, radius: cs.borderRadius, padding: cs.padding, shadow: cs.boxShadow, font: cs.fontFamily, fontSize: cs.fontSize,
      btnPad: bs.padding, btnRadius: bs.borderRadius, h2Size: hs ? hs.fontSize : ''
    };
  })()`);
  check('奖励弹窗实测 width=960px', live.width === '960px', live);
  check('奖励弹窗实测圆角=16px', live.radius === '16px', live);
  check('奖励弹窗实测内边距=24px', live.padding === '24px', live);
  check('奖励弹窗实测阴影来自令牌', live.shadow.indexOf('80px') >= 0, live);
  check('按钮实测 8px 13px / 8px', live.btnPad === '8px 13px' && live.btnRadius === '8px', live);
  const tokenScale = ['11px', '12.5px', '14px', '16px', '20px', '26px', '38px'];
  check('弹窗标题字号在字号阶梯内', tokenScale.indexOf(live.h2Size) >= 0, live.h2Size);

  // ---------- 汇总 ----------
  const pass = checks.filter((c) => c.ok).length;
  console.log('TOKENS ASSERT: ' + pass + '/' + checks.length + ' PASS');
  console.log('exceptions=' + errors.length + (errors.length ? ' ' + errors.join(' | ') : ''));
  if (errors.length) process.exitCode = 1;
  if (pass !== checks.length) process.exitCode = 1;
  try { ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  await sleep(300);
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
