/**
 * 帧内耗时归因（工作副本专用）
 * ------------------------------------------------------------
 * 思路：直接给主循环里的 render() / update() 包计时器，量"每帧主线程毫秒"。
 * 这比无头浏览器的 rAF 帧率可靠：无头环境会跑在 120Hz，帧率被刷新率卡住，
 * 看不出特性开关的差别；而"每帧毫秒"同会话前后对比能直接回答"关掉它省多少"。
 * 用法：node mobile/tools/mperf2.js [--force]
 * 产物：mobile/shots/perf2.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MOBILE_DIR = path.join(__dirname, '..');
process.env.ARCANE_PROFILE_ROOT = path.join(MOBILE_DIR, '.profile_perf2');
const { prepareProfile, killEdge } = require(path.join(MOBILE_DIR, '..', 'tools', 'arcane_profile'));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9564;
const SNAP = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const OUT_DIR = path.join(MOBILE_DIR, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动 Edge
 * @returns {Promise<{send:Function, ev:Function, close:Function}>}
 */
async function bootEdge() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files', '--mute-audio',
    '--hide-scrollbars', '--window-size=900,600', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(edge); throw new Error('Edge 调试端口未就绪'); }
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
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, ev, close: () => { try { ws.close(); } catch (e) { /* ignore */ } killEdge(edge); } };
}

/** 页面内安装计时器（必须能覆写全局 render/update，否则返回 false） */
const INSTALL = `(function(){
  if (typeof render !== 'function' || typeof update !== 'function') return false;
  if (window.__inst) return true;
  window.__inst = { rf: [], uf: [], on: true };
  window.__origR = render;
  window.__origU = update;
  window.__wrapR = function () {
    if (!window.__inst.on) return window.__origR.apply(this, arguments);
    var t = performance.now();
    window.__origR.apply(this, arguments);
    window.__inst.rf.push(performance.now() - t);
  };
  window.__wrapU = function () {
    if (!window.__inst.on) return window.__origU.apply(this, arguments);
    var t = performance.now();
    window.__origU.apply(this, arguments);
    window.__inst.uf.push(performance.now() - t);
  };
  window.render = window.__wrapR;
  window.update = window.__wrapU;
  return true;
})()`;

/** 页面内统计（毫秒） */
const STATS = `(function(){
  function st(a){
    if (!a.length) return {n:0};
    var b = a.slice().sort(function(x,y){return x-y;});
    function q(p){return b[Math.min(b.length-1,Math.max(0,Math.floor(b.length*p)))];}
    var sum=0; for (var i=0;i<b.length;i++) sum+=b[i];
    return {n:b.length, median:Math.round(b[b.length>>1]*100)/100,
            mean:Math.round(sum/b.length*100)/100,
            p95:Math.round(q(0.95)*100)/100, max:Math.round(b[b.length-1]*100)/100};
  }
  var r = st(window.__inst.rf), u = st(window.__inst.uf);
  return {render:r, update:u,
          frameMedian: (r.n&&u.n)?Math.round((r.median+u.median)*100)/100:null};
})()`;

/**
 * 采样 ms 毫秒，清空缓冲后统计
 * @param {Object} cdp CDP
 * @param {number} ms 采样时长
 * @returns {Promise<Object>} 统计
 */
async function snap(cdp, ms) {
  await cdp.ev(`(window.__inst.rf.length=0, window.__inst.uf.length=0, true)`);
  await sleep(ms);
  return await cdp.ev(STATS);
}

/** 主流程 */
async function main() {
  if (!process.argv.includes('--force')) {
    const cpu = Number(require('child_process').execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"', { encoding: 'utf8' }).trim()) || 0;
    if (cpu >= 60) { console.log(`CPU=${cpu}% 高负载，加 --force 继续`); process.exitCode = 3; return; }
  }
  const bytes = fs.statSync(SNAP).size;
  const md5 = require('crypto').createHash('md5').update(fs.readFileSync(SNAP)).digest('hex').toUpperCase();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = { snapshot: { bytes, md5 }, method: '包裹 render()/update() 计时，同会话顺序对照；桌面无头 Edge，非真机', rows: [] };

  const cdp = await bootEdge();
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenWidth: 844, screenHeight: 390,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Page.navigate', { url: 'file:///' + SNAP.replace(/\\/g, '/') + '?perf2=1' });
    for (let i = 0; i < 100; i += 1) {
      if (await cdp.ev(`document.readyState === 'complete' && typeof state !== 'undefined'`)) break;
      await sleep(200);
    }
    await sleep(800);
    await cdp.ev(`(document.getElementById('btnStart') || {}).click(); true`);
    await sleep(500);
    if (!(await cdp.ev(`state.mode === 'playing'`))) {
      await cdp.ev(`(function(){var c=document.querySelector('.char-card');if(c)c.click();var b=document.getElementById('btnCharConfirm');if(b)b.click();return true;})()`);
    }
    for (let i = 0; i < 80; i += 1) {
      if (await cdp.ev(`state.mode === 'playing'`)) break;
      await sleep(200);
    }
    await sleep(3500);

    const installed = await cdp.ev(INSTALL);
    out.installed = installed;
    if (!installed) throw new Error('render/update 不是可覆写的全局函数');

    out.env = await cdp.ev(`({
      quality: (typeof currentQualityTier==='function')?currentQualityTier():null,
      canvas: { w: canvas.width, h: canvas.height },
      css: { w: Math.round(canvas.getBoundingClientRect().width), h: Math.round(canvas.getBoundingClientRect().height) },
      dpr: window.devicePixelRatio,
      postfx: state.meta.postfx,
      particles: (state.particles||[]).length
    })`);

    /** 一轮对照 */
    async function row(name, setup, teardown, ms) {
      if (setup) await cdp.ev(setup);
      await sleep(500);
      const s = await snap(cdp, ms);
      if (teardown) await cdp.ev(teardown);
      await sleep(400);
      const r = { name, ms, renderMedian: s.render.median, renderP95: s.render.p95, updateMedian: s.update.median, updateP95: s.update.p95, frameMedian: s.frameMedian, frames: s.render.n };
      out.rows.push(r);
      console.log(`  [${name}] render=${r.renderMedian}ms(p95 ${r.renderP95}) update=${r.updateMedian}ms(p95 ${r.updateP95}) 合计=${r.frameMedian}ms frames=${r.frames}`);
      return r;
    }

    console.log('基线 12s …');
    await row('基线', null, null, 12000);

    await row('关迷雾', `(function(){window.__fk=setInterval(function(){try{fogReady=false;}catch(e){}},80);return true;})()`,
      `(function(){clearInterval(window.__fk);try{fogReady=true;}catch(e){}return true;})()`, 10000);

    await row('关后处理', `(function(){window.__pfx=JSON.parse(JSON.stringify(state.meta.postfx||{}));state.meta.postfx={bloom:false,chroma:false,crt:false,vignette:false};return true;})()`,
      `(function(){state.meta.postfx=window.__pfx;return true;})()`, 10000);

    await row('关shadowBlur', `(function(){var d=Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,'shadowBlur');window.__sd=d;Object.defineProperty(CanvasRenderingContext2D.prototype,'shadowBlur',{configurable:true,get:function(){return 0;},set:function(){}});return true;})()`,
      `(function(){Object.defineProperty(CanvasRenderingContext2D.prototype,'shadowBlur',window.__sd);return true;})()`, 10000);

    await row('只跑 update（不绘制）', `(window.render=function(){}, true)`,
      `(window.render=window.__wrapR, true)`, 8000);

    /* 战斗中粒子：先开火 10s 基线，再开火+清空粒子 10s */
    await cdp.ev(`(window.__fire=setInterval(function(){window.dispatchEvent(new KeyboardEvent('keydown',{key:'j'}));},160), true)`);
    await sleep(800);
    const fireBase = await snap(cdp, 10000);
    out.rows.push({ name: '开火基线', ms: 10000, renderMedian: fireBase.render.median, renderP95: fireBase.render.p95, updateMedian: fireBase.update.median, updateP95: fireBase.update.p95, frameMedian: fireBase.frameMedian, frames: fireBase.render.n, particlesAtEnd: await cdp.ev(`(state.particles||[]).length`) });
    console.log('  [开火基线]', JSON.stringify(out.rows[out.rows.length - 1]));

    await cdp.ev(`(window.__pk=setInterval(function(){try{state.particles.length=0;}catch(e){}},40), true)`);
    await sleep(500);
    const fireNoP = await snap(cdp, 10000);
    await cdp.ev(`(clearInterval(window.__pk), clearInterval(window.__fire), true)`);
    out.rows.push({ name: '开火+清空粒子', ms: 10000, renderMedian: fireNoP.render.median, renderP95: fireNoP.render.p95, updateMedian: fireNoP.update.median, updateP95: fireNoP.update.p95, frameMedian: fireNoP.frameMedian, frames: fireNoP.render.n });
    console.log('  [开火+清空粒子]', JSON.stringify(out.rows[out.rows.length - 1]));

    /* 还原 */
    await cdp.ev(`(window.render=window.__origR, window.update=window.__origU, window.__inst=null, true)`);
  } finally {
    cdp.close();
  }
  fs.writeFileSync(path.join(OUT_DIR, 'perf2.json'), JSON.stringify(out, null, 2));
  console.log('已写出 shots/perf2.json');
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exit(1);
});
