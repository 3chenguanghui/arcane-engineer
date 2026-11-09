/**
 * 已知红门禁（所有验收脚本共用）
 * ------------------------------------------------------------
 * 三条纪律（写在代码里，不靠人记）：
 * 1. 每条必须四要素齐全：name / reason / date / reviewCondition；
 *    缺任何一项 → 不算已知红，按 FAIL 处理。
 * 2. 新增条目必须显式批准：未批准的条目会让脚本打印 KNOWN-RED ADDED 并退出码 2，
 *    除非命令行带 --allow-known-red-add（此时会把名字写进 approved 并落盘）。
 * 3. 数量只能减不能增：固定打印「已知红 N 条（上轮 M 条）」；N > M 时标记 ▲ 并列出新增。
 * 清单文件：tools/known_red.json（entries 里没有条目的理想状态就是空数组）。
 */
const fs = require('fs');
const path = require('path');

const FILE = process.env.KNOWN_RED_FILE || path.join(__dirname, 'known_red.json');

/**
 * 读取清单文件（不存在时给空清单，不抛错）
 * @returns {{schema:number, baseline:number, approved:string[], entries:Array}}
 */
function readList() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      schema: Number(raw.schema) || 1,
      baseline: Number(raw.baseline) || 0,
      approved: Array.isArray(raw.approved) ? raw.approved : [],
      entries: Array.isArray(raw.entries) ? raw.entries : []
    };
  } catch (e) {
    return { schema: 1, baseline: 0, approved: [], entries: [] };
  }
}

/**
 * 校验四要素；返回缺失字段列表
 * @param {Object} entry 清单条目
 * @returns {string[]} 缺失字段名
 */
function missingFields(entry) {
  const need = ['name', 'reason', 'date', 'reviewCondition'];
  return need.filter((key) => !String(entry[key] || '').trim());
}

/**
 * 打印清单并给出判红结论
 * @param {Array<{name:string, ok:boolean}>} results 断言结果
 * @param {string} label 报表标题
 * @returns {{pass:number, total:number, known:number, failedActive:Array, exitCode:number}}
 */
function summarize(results, label) {
  const list = readList();
  const allowAdd = process.argv.indexOf('--allow-known-red-add') >= 0;
  const valid = [];
  const invalid = [];
  const orphans = [];
  const added = [];

  list.entries.forEach((entry) => {
    const miss = missingFields(entry);
    const hit = results.some((r) => r.name.indexOf(String(entry.name || '')) === 0);
    if (miss.length) {
      invalid.push({ name: entry.name || '(无名)', miss: miss });
    } else if (!hit) {
      orphans.push(entry.name);
    } else {
      valid.push(entry);
    }
  });

  // 新增 = 文件里有、但还没进 approved 的条目
  valid.forEach((entry) => {
    if (list.approved.indexOf(entry.name) < 0) added.push(entry.name);
  });

  const isKnown = (r) => valid.some((entry) => r.name.indexOf(entry.name) === 0);
  const active = results.filter((r) => !isKnown(r));
  const known = results.filter(isKnown);
  const pass = active.filter((r) => r.ok).length;
  const failedActive = active.filter((r) => !r.ok);

  // 四要素不全 / 指向不存在的断言 → 按 FAIL 计入，不允许留在清单里当护身符
  invalid.forEach((item) => {
    failedActive.push({
      name: item.name,
      ok: false,
      detail: '已知红条目缺少：' + item.miss.join(' / ')
    });
  });
  orphans.forEach((name) => {
    failedActive.push({ name: name, ok: false, detail: '清单条目没有对应断言（应删除或改名）' });
  });

  console.log('\n===== 已知红清单 =====');
  console.log(`已知红 ${valid.length} 条（上轮 ${list.baseline} 条）`);
  if (valid.length > list.baseline) {
    console.log('▲ 新增 ' + (valid.length - list.baseline) + ' 条：' + added.join('、') + '（必须说明新增理由）');
  }
  valid.forEach((entry) => {
    console.log(`  · ${entry.name} — ${entry.reason}（登记 ${entry.date}；复核：${entry.reviewCondition}）`
      + (known.some((r) => r.ok) ? '（现已转绿，请删除条目）' : ''));
  });
  invalid.forEach((item) => {
    console.log(`  ✗ ${item.name} — 四要素缺失（${item.miss.join(' / ')}），按 FAIL 处理`);
  });
  orphans.forEach((name) => {
    console.log(`  ✗ ${name} — 没有对应断言，按 FAIL 处理`);
  });

  let exitCode = failedActive.length ? 1 : 0;
  if (added.length) {
    added.forEach((name) => console.log(`KNOWN-RED ADDED: ${name}`));
    if (!allowAdd) {
      console.log('新增已知红未批准：带 --allow-known-red-add 重新运行才会通过（退出码 2）');
      exitCode = 2;
    } else {
      list.approved = list.approved.concat(added);
      console.log('KNOWN-RED APPROVED: ' + added.join('、'));
    }
  }

  console.log(`\n${label}有效通过率: ${pass}/${active.length}`);
  failedActive.forEach((r) => console.log(`  FAIL  ${r.name}  ${JSON.stringify(r.detail)}`));
  console.log(`RESULT: ${exitCode === 0 ? 'PASS' : (exitCode === 2 ? 'BLOCKED(新增已知红未批准)' : 'FAIL')}`
    + `  ${pass}/${active.length}（已知红 ${valid.length} 条不计入）`);

  // 只在正常结束时更新基线；被门禁拦下时保持旧基线，逼下一次重新面对新增
  if (exitCode !== 2) {
    list.baseline = valid.length;
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
  }
  return { pass, total: active.length, known: valid.length, failedActive, exitCode };
}

module.exports = { summarize, FILE };
