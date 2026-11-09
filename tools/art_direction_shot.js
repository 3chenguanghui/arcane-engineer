/**
 * 美术定调页截图器：把本地 HTML（自包含对照图）整页截图成 PNG
 * ------------------------------------------------------------
 * 用法：node tools/art_direction_shot.js <输入.html> <输出.png> [宽度]
 * 做法：
 *   1) 用固定测试 profile 启动 Edge 无头模式（复用 arcane_profile 的清理逻辑）；
 *   2) 走 CDP：先按目标宽度布局，读 document.documentElement.scrollHeight；
 *   3) 再把视口高度改成整页高度，整页截图（不裁切，避免 clip 参数报错）；
 *   4) 结束后 killEdge 并清理 profile，不在 Temp 留垃圾。
 * @returns {Promise<void>}
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9689;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  const input = path.resolve(process.argv[2] || path.join(__dirname, '..', '.screenshots', 'art', 'art-direction.html'));
  const output = path.resolve(process.argv[3] || path.join(__dirname, '..', '.screenshots', 'art', 'art-direction.png'));
  const width = Number(process.argv[4] || 1500);

  if (!fs.existsSync(input)) throw new Error('输入 HTML 不存在：' + input);

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=' + width + ',1000',
    'about:blank'
  ], { stdio: 'ignore' });

  // 等调试端口就绪
  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (error) { /* 端口还没起 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  await new Promise((resolve) => { ws.onopen = resolve; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + input.replace(/\\/g, '/') });
  await sleep(2200);

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面脚本异常：' + r.exceptionDetails.text);
    return r.result.value;
  };

  // 等图片（若有）解码完成，避免截到空白
  const imgInfo = await ev(`(async () => {
    const imgs = Array.from(document.images || []);
    await Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((res) => { im.onload = res; im.onerror = res; }))));
    return { count: imgs.length, broken: imgs.filter((im) => !im.naturalWidth).length };
  })()`);

  const height = await ev('Math.ceil(document.documentElement.scrollHeight)');
  await send('Emulation.setDeviceMetricsOverride', { width, height: height + 1, deviceScaleFactor: 1, mobile: false });
  await sleep(600);

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.from(shot.data, 'base64'));

  const size = fs.statSync(output).size;
  console.log(JSON.stringify({
    ok: true,
    input,
    output,
    width,
    height,
    bytes: size,
    images: imgInfo
  }, null, 2));

  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((error) => {
  console.error('FATAL', error && error.message ? error.message : error);
  process.exit(1);
});
