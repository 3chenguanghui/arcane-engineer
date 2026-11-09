# 成就系统 · 补丁设计（交整合线落地）

> 前置：主文件冻结，本文件**不含任何已落盘改动**。所有锚点使用**函数名**，不使用行号。
> 设计依据：[ACHIEVEMENTS.md](./ACHIEVEMENTS.md)。
> 总开关：`META_PROGRESS_CONFIG.enabled`（并新增 `?ach=off`）。每段可独立回滚。

---

## 落地顺序（严格串行）

| 批次 | 内容 | 类型 | 验收 |
|---|---|---|---|
| P0 | 配置表换 35 条 + `legacyIds` + `?ach=off` | A 类（不碰数值） | 语法 + 能加载 |
| P1 | `defaultMeta()` 新增 7 个字段 | A 类 | 语法 + 能加载 |
| P2 | `normalizeMeta()` 容错补齐 + 保留退休 id | A 类（存档读写，单独成批） | 老档坏档专项 |
| P3 | `metaMetricValue()` 新增 case | A 类 | 老档缺字段返回安全值 |
| P4 | 运行期写入钩子（通关/死亡/进房/秘藏/每日） | B 类（会改“某层存活/通关”口径？否，但影响成就结算） | 五关 + 同种子对照 |
| P5 | 提示队列（修同帧覆盖）+ 隐藏成就揭晓表现 | A 类 | 5 分钟自测见 `ACHIEVEMENTS_SELFTEST.md` |
| P6 | 成就墙分类/隐藏/样式 | A 类 | 能加载 + 截图 |
| P7 | 调试面板 `info()` 补新 metric | A 类 | 控制台可读 |

> P2 只改读档内存态，不写盘；P4 才新增写盘。两批之间不要混装。

---

## P0 · 配置表

### P0-1 总开关改为可回退

在 `META_PROGRESS_CONFIG` 定义处，把 `enabled: true` 改成：

```js
  /* 成就总开关：?ach=off 可整条线关闭（面板显示“已关闭”，不结算不写档） */
  enabled: (() => {
    try { return new URLSearchParams(location.search).get('ach') !== 'off'; }
    catch (error) { return true; }
  })(),
```

### P0-2 替换 `achievements:` 数组

整段替换现有 38 条。字段在旧结构上新增 `category`（`progress / skill / explore / long`）与 `hidden`（布尔）。

```js
  achievements: [
    /* ---- 进度 · PROGRESS（10） ---- */
    { id: 'floor_3', name: '下潜三层', desc: '最高到达第 3 层', category: 'progress', metric: 'bestFloor', target: 3, reward: { aether: 1 } },
    { id: 'floor_5', name: '抵达终章', desc: '最高到达第 5 层', category: 'progress', metric: 'bestFloor', target: 5, reward: { aether: 1 } },
    { id: 'floor_8', name: '深井常客', desc: '最高到达第 8 层', category: 'progress', metric: 'bestFloor', target: 8, reward: { aether: 1 } },
    { id: 'floor_12', name: '塔心回响', desc: '最高到达第 12 层', category: 'progress', metric: 'bestFloor', target: 12, reward: {} },
    { id: 'floor_20', name: '深井尽头', desc: '最高到达第 20 层', category: 'progress', metric: 'bestFloor', target: 20, reward: {} },
    { id: 'first_win', name: '首次通关', desc: '击倒最终首领完成一局', category: 'progress', metric: 'clears', target: 1, reward: { cards: 1 } },
    { id: 'clears_5', name: '五次收束', desc: '累计通关 5 次', category: 'progress', metric: 'clears', target: 5, reward: {} },
    { id: 'role_warden', name: '守拙之证', desc: '以守拙通关 1 次', category: 'progress', metric: 'charClearWarden', target: 1, reward: {} },
    { id: 'role_ember', name: '疾火之证', desc: '以疾火通关 1 次', category: 'progress', metric: 'charClearEmber', target: 1, reward: {} },
    { id: 'role_gazer', name: '观星之证', desc: '以观星通关 1 次', category: 'progress', metric: 'charClearGazer', target: 1, reward: {} },

    /* ---- 技巧 · SKILL（8） ---- */
    { id: 'flawless_1', name: '滴水不漏', desc: '无伤清空 1 层', category: 'skill', metric: 'flawlessFloors', target: 1, reward: { aether: 1 } },
    { id: 'flawless_5', name: '毫发无伤', desc: '无伤清空 5 层', category: 'skill', metric: 'flawlessFloors', target: 5, reward: { aether: 2 } },
    { id: 'perfect_run', name: '一尘不染', desc: '整局未掉血通关', category: 'skill', hidden: true, metric: 'perfectRuns', target: 1, reward: {} },
    { id: 'single_school', name: '专精一路', desc: '只用同一流派（≥2 张不同魔法）通关', category: 'skill', metric: 'singleSchoolClears', target: 1, reward: { aether: 2 } },
    { id: 'lowhp_win', name: '残血翻盘', desc: '通关瞬间生命 ≤ 15%', category: 'skill', hidden: true, metric: 'lowHpClears', target: 1, reward: {} },
    { id: 'fast_clear', name: '十二分钟', desc: '普通难度通关用时 ≤ 12 分 00 秒', category: 'skill', hidden: true, metric: 'fastestClear', target: 720, reward: {} },
    { id: 'combo_30', name: '连锁大师', desc: '单次连击峰值达到 30', category: 'skill', metric: 'comboPeak', target: 30, reward: { aether: 2 } },
    { id: 'combo_50', name: '连锁成瘾', desc: '单次连击峰值达到 50', category: 'skill', metric: 'comboPeak', target: 50, reward: {} },

    /* ---- 探索 · EXPLORE（8） ---- */
    { id: 'hidden_room_1', name: '墙后有人', desc: '首次进入秘藏房', category: 'explore', metric: 'hiddenRooms', target: 1, reward: { aether: 1 } },
    { id: 'void_rift_1', name: '裂隙旅人', desc: '首次使用虚空裂隙', category: 'explore', metric: 'voidRifts', target: 1, reward: { aether: 1 } },
    { id: 'rooms_all', name: '十二面', desc: '除起始房外 12 种房型各进入一次', category: 'explore', hidden: true, metric: 'roomTypesSeen', target: 12, reward: {} },
    { id: 'cards_all', name: '卡池见底', desc: '图鉴卡牌 26 张全部解锁', category: 'explore', metric: 'codexCards', target: 26, reward: {} },
    { id: 'codex_enemies_all', name: '名录补全', desc: '图鉴敌人 33 种全部解锁', category: 'explore', metric: 'codexEnemies', target: 33, reward: {} },
    { id: 'recipe_all', name: '配方全图鉴', desc: '累计发现全部融合配方', category: 'explore', metric: 'recipes', target: FUSION_CONFIG.length, reward: { aether: 2 } },
    { id: 'blueprint_all', name: '蓝图集齐', desc: '解锁全部首领蓝图', category: 'explore', metric: 'blueprints', target: BOSS_BLUEPRINT_CONFIG.blueprints.length, reward: { aether: 2 } },
    { id: 'relics_10', name: '拾荒成性', desc: '图鉴遗物解锁 10 件', category: 'explore', metric: 'codexRelics', target: 10, reward: {} },

    /* ---- 长期 · LONG（9） ---- */
    { id: 'kills_100', name: '拆解专家', desc: '累计击杀 100 只构装', category: 'long', metric: 'kills', target: 100, reward: { aether: 1 } },
    { id: 'kills_1000', name: '千机散架', desc: '累计击杀 1000 只构装', category: 'long', metric: 'kills', target: 1000, reward: {} },
    { id: 'elite_50', name: '精英猎手', desc: '累计击杀 50 只精英', category: 'long', metric: 'eliteKills', target: 50, reward: { aether: 1 } },
    { id: 'boss_kills_5', name: '首领终结者', desc: '累计击败 5 名首领', category: 'long', metric: 'bossKills', target: 5, reward: {} },
    { id: 'runs_20', name: '二十次下潜', desc: '累计开局 20 局', category: 'long', metric: 'runs', target: 20, reward: {} },
    { id: 'daily_streak_7', name: '七日不辍', desc: '连续 7 天进入今日挑战', category: 'long', metric: 'dailyStreakBest', target: 7, reward: {} },
    { id: 'talents_30', name: '天赋满墙', desc: '累计投入 30 级天赋', category: 'long', metric: 'talentLevels', target: 30, reward: {} },
    { id: 'play_5h', name: '五小时灯火', desc: '累计游玩 5 小时', category: 'long', metric: 'playSeconds', target: 18000, reward: {} },
    { id: 'challenge_10', name: '无阶可退', desc: '以挑战等级 10 通关一次', category: 'long', metric: 'challenge10Clears', target: 1, reward: {} }
  ]
```

### P0-3 退休 id 兼容名单

紧跟 `byId` 构建之后追加：

```js
/* 收敛前的旧 id：老档已解锁的记录必须保留，只是不展示、不计入 35 条总数。
   新增条目时不要往这里加；这里只允许保留历史。 */
META_PROGRESS_CONFIG.legacyIds = [
  'first_kill', 'elite_200', 'boss_kills_1', 'boss_20', 'combo_16',
  'recipe_3', 'blueprint_1', 'run_recipes_5', 'deaths_5', 'wager_3',
  'sacrifice_5', 'single_school_3', 'barrel_20', 'daily_clear'
];
META_PROGRESS_CONFIG.legacyById = {};
META_PROGRESS_CONFIG.legacyIds.forEach((id) => { META_PROGRESS_CONFIG.legacyById[id] = true; });
```

---

## P1 · `defaultMeta()` 新增字段

在 `defaultMeta()` 的 `stats` 内追加两项，并在 `achievementsAether` 之后追加 5 个容器：

```js
    stats: {
      kills: 0, deaths: 0,
      eliteKills: 0, bossKills: 0, flawlessFloors: 0,
      hiddenRooms: 0, voidRifts: 0, singleSchoolClears: 0,
      barrelKills: 0,
      /* 成就：整局无伤通关次数 / 残血通关次数 */
      perfectRuns: 0, lowHpClears: 0
    },
```

```js
    /* 成就 · 角色专属通关次数（只认三名角色，中性局不计） */
    charClears: { warden: 0, ember: 0, gazer: 0 },
    /* 成就 · 普通难度最快通关秒数；0 = 尚无记录（读取时转 999999 防止误判） */
    bestClearTime: 0,
    /* 成就 · 累计游玩秒数（通关/死亡时结算） */
    playSeconds: 0,
    /* 成就 · 已进入过的房型键（不含 start；最多 12 个） */
    roomTypesSeen: [],
    /* 成就 · 今日挑战连续天数：best 只增不减 */
    dailyStreak: { lastDate: '', current: 0, best: 0 },
```

---

## P2 · `normalizeMeta()` 容错

### P2-1 `stats` 补两项

在 `base.stats = {...}` 块内追加：

```js
      /* 成就：旧档没有 → 0；脏值归 0 */
      perfectRuns: Math.max(0, Math.floor(Number(rawStats.perfectRuns) || 0)),
      lowHpClears: Math.max(0, Math.floor(Number(rawStats.lowHpClears) || 0))
```

### P2-2 成就表保留退休 id

把现有过滤条件：

```js
    if (!META_PROGRESS_CONFIG.byId[id] || !rawAch[id]) return;
```

改为：

```js
    const known = META_PROGRESS_CONFIG.byId[id] || META_PROGRESS_CONFIG.legacyById[id];
    if (!known || !rawAch[id]) return;
```

`achievementsAether` 的过滤同样改为 `byId[id] || legacyById[id]`。

### P2-3 新容器归一化

在 `base.achievements = {}` 那段之后插入：

```js
  /* 成就 · 角色通关次数：只接受三名角色 + 非负整数；旧档/脏数据回 0 */
  const rawCharClears = raw.charClears && typeof raw.charClears === 'object' ? raw.charClears : {};
  base.charClears = { warden: 0, ember: 0, gazer: 0 };
  CHARACTER_CONFIG.ids.forEach((id) => {
    base.charClears[id] = Math.max(0, Math.floor(Number(rawCharClears[id]) || 0));
  });
  /* 成就 · 最快通关 / 累计游玩：非负整数；0 表示无记录 */
  base.bestClearTime = Math.max(0, Math.floor(Number(raw.bestClearTime) || 0));
  base.playSeconds = Math.max(0, Math.floor(Number(raw.playSeconds) || 0));
  /* 成就 · 房型：只保留 ROOM_TYPE_CONFIG 里存在且非 start 的键，去重限 12 */
  const rawRooms = Array.isArray(raw.roomTypesSeen) ? raw.roomTypesSeen : [];
  base.roomTypesSeen = Array.from(new Set(rawRooms.filter((type) =>
    typeof type === 'string' && type !== 'start' && ROOM_TYPE_CONFIG.types[type]
  ))).slice(0, 12);
  /* 成就 · 连续挑战：日期必须是 8 位数字；current/best 非负且 best ≥ current */
  const rawStreak = raw.dailyStreak && typeof raw.dailyStreak === 'object' ? raw.dailyStreak : {};
  const lastDate = typeof rawStreak.lastDate === 'string' && /^\d{8}$/.test(rawStreak.lastDate)
    ? rawStreak.lastDate : '';
  const current = Math.max(0, Math.floor(Number(rawStreak.current) || 0));
  base.dailyStreak = {
    lastDate: lastDate,
    current: current,
    best: Math.max(current, Math.floor(Number(rawStreak.best) || 0))
  };
```

> 读档过程零写盘：以上只改 `base`（新对象），不碰原 `raw`。

---

## P3 · `metaMetricValue()` 新增 case

插在 `default:` 之前：

```js
    /* 成就 · 新增口径（全部做缺失容错，缺字段返回安全值） */
    case 'runs': return Math.max(0, Math.floor(Number(m.runs) || 0));
    case 'perfectRuns': return Math.max(0, Math.floor(Number(m.stats && m.stats.perfectRuns) || 0));
    case 'lowHpClears': return Math.max(0, Math.floor(Number(m.stats && m.stats.lowHpClears) || 0));
    /* 无记录必须返回大数：返回 0 会被 target=720 判成“已达成” */
    case 'fastestClear': {
      const t = Math.max(0, Math.floor(Number(m.bestClearTime) || 0));
      return t > 0 ? t : 999999;
    }
    case 'charClearWarden': return Math.max(0, Math.floor(Number(m.charClears && m.charClears.warden) || 0));
    case 'charClearEmber': return Math.max(0, Math.floor(Number(m.charClears && m.charClears.ember) || 0));
    case 'charClearGazer': return Math.max(0, Math.floor(Number(m.charClears && m.charClears.gazer) || 0));
    case 'roomTypesSeen': return Array.isArray(m.roomTypesSeen) ? m.roomTypesSeen.length : 0;
    case 'dailyStreakBest': return Math.max(0, Math.floor(Number(m.dailyStreak && m.dailyStreak.best) || 0));
    case 'playSeconds': return Math.max(0, Math.floor(Number(m.playSeconds) || 0));
```

---

## P4 · 运行期写入钩子

### P4-1 统一结算函数（新增）

放在 `metaRecordPeak()` 之后：

```js
/**
 * 成就 · 一局结束时的统一记账（通关 / 死亡各调一次）
 * ------------------------------------------------------------
 * · 累计游玩秒数：无论胜负都记；
 * · 无伤 / 残血 / 角色通关：只在通关时记；
 * · 最快通关：只认“普通难度 + 非种子/每日局”，避免与排行榜口径冲突。
 * 不在此处 saveMeta()，落盘跟随 winGame / loseGame 既有的 saveMeta 调用点。
 * @param {boolean} won 是否通关
 * @returns {void}
 */
function recordAchievementRunEnd(won) {
  if (!state || !state.meta) return;
  const meta = state.meta;
  const elapsed = Math.max(0, Math.round(Number(state.elapsed) || 0));
  meta.playSeconds = Math.max(0, Math.floor(Number(meta.playSeconds) || 0) + elapsed);
  if (!won) return;

  meta.stats = meta.stats && typeof meta.stats === 'object' ? meta.stats : {};
  const player = state.player || {};
  const ratio = player.hpMax > 0 ? (Number(player.hp) || 0) / player.hpMax : 1;
  if (ratio <= 0.15) {
    meta.stats.lowHpClears = Math.max(0, Math.floor(Number(meta.stats.lowHpClears) || 0) + 1);
  }
  if (state.runNoHit !== false) {
    meta.stats.perfectRuns = Math.max(0, Math.floor(Number(meta.stats.perfectRuns) || 0) + 1);
  }

  const seeded = !!(state.seedInfo && state.seedInfo.active);
  if (!seeded && state.difficulty === 'normal' && elapsed > 0) {
    const prev = Math.max(0, Math.floor(Number(meta.bestClearTime) || 0));
    meta.bestClearTime = prev > 0 ? Math.min(prev, elapsed) : elapsed;
  }

  const cid = state.characterId;
  if (cid && META_PROGRESS_CONFIG.byId && CHARACTER_CONFIG.ids.indexOf(cid) >= 0) {
    meta.charClears = meta.charClears && typeof meta.charClears === 'object'
      ? meta.charClears : { warden: 0, ember: 0, gazer: 0 };
    meta.charClears[cid] = Math.max(0, Math.floor(Number(meta.charClears[cid]) || 0) + 1);
  }
}
```

### P4-2 `winGame()` 调用

在 `state.meta.clears = (state.meta.clears || 0) + 1;` 之后、`checkMetaAchievements()` 之前插入：

```js
  /* 成就：通关结算（无伤 / 残血 / 角色 / 最快 / 时长） */
  recordAchievementRunEnd(true);
```

### P4-3 `loseGame()` 调用

在 `metaBumpStat('deaths', 1);` 之后、`checkMetaAchievements()` 之前插入：

```js
  /* 成就：死亡只累计游玩时长 */
  recordAchievementRunEnd(false);
```

### P4-4 房型记录（新增函数）

放在 `trackBacktrack()` 之前：

```js
/**
 * 成就 · 记录“进入过某房型”（同一房型只记一次）
 * @param {string} type ROOM_TYPE_CONFIG.types 的键
 * @returns {boolean} 是否首次记录
 */
function noteRoomTypeSeen(type) {
  if (!state || !state.meta) return false;
  if (typeof type !== 'string' || type === 'start' || !ROOM_TYPE_CONFIG.types[type]) return false;
  const meta = state.meta;
  if (!Array.isArray(meta.roomTypesSeen)) meta.roomTypesSeen = [];
  if (meta.roomTypesSeen.indexOf(type) >= 0) return false;
  meta.roomTypesSeen.push(type);
  saveMeta();                    // 一生最多 12 次写盘
  checkMetaAchievements(true);
  return true;
}
```

在 `trackBacktrack()` 的 `bt.visited[room.id] = true;` 之后插入：

```js
  /* 成就：首次进入该房型（只在房间切换时触发，不是每帧） */
  noteRoomTypeSeen(room.type);
```

在 `enterHiddenRoom()` 的 `metaBumpStat('hiddenRooms', 1);` 之前插入：

```js
  /* 成就：秘藏房不经过 trackBacktrack，单独记 vault */
  noteRoomTypeSeen('vault');
```

### P4-5 连续挑战（新增函数 + 调用）

放在 `startDailyRun()` 之前：

```js
/**
 * 成就 · 今日挑战连续天数记账（每自然日最多一次）
 * 规则：昨天来过 → current+1；否则 current=1；best 只增不减。
 * @returns {boolean} 是否发生了新的一天
 */
function noteDailyStreak() {
  if (!state || !state.meta) return false;
  const meta = state.meta;
  const today = localDateKey();
  const s = meta.dailyStreak && typeof meta.dailyStreak === 'object'
    ? meta.dailyStreak : { lastDate: '', current: 0, best: 0 };
  if (s.lastDate === today) return false;
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDateKey(yesterdayDate);
  s.current = s.lastDate === yesterday
    ? Math.max(1, Math.floor(Number(s.current) || 0)) + 1
    : 1;
  s.best = Math.max(Math.floor(Number(s.best) || 0), s.current);
  s.lastDate = today;
  meta.dailyStreak = s;
  saveMeta();
  checkMetaAchievements(true);
  return true;
}
```

`startDailyRun()` 改为：

```js
  /* 成就：只有真正开局成功才计入连续天数 */
  if (startSeedRun(dailySeedValue(), { daily: true })) noteDailyStreak();
```

---

## P5 · 提示队列（修同帧覆盖）

### P5 播放规则（定稿）

| 规则 | 值 | 说明 |
|---|---|---|
| 同屏条数 | **1** | 绝不叠两条；靠独立元素 `#achvToast` 与系统 toast 分开 |
| 战斗内停留 | **1800 ms** | 从出现到淡出 |
| 隐藏成就停留 | **2400 ms** | 比普通多 600 ms，留出读“达成条件”的时间 |
| 条间空档 | **220 ms** | 先收起再放下一条，眼睛能分辨“换了一条” |
| 队列上限 | **6 条** | 超出部分不播，合并进“另有 N 项” |
| 同批顺序 | 进度 → 技巧 → 探索 → 长期，同类按配置表顺序 | 315 帧内不重排，保证可复现 |
| 结算详细条数 | **2 条** | 通关/死亡时最多详播 2 条，其余汇总 |
| 是否打断战斗 | **否** | 不暂停、不锁输入、不夺焦点、不进弹窗层 |
| 回退开关 | `?achnotice=off` | 整段提示关闭，成就照常解锁与写档 |

**被击杀结算打断的处理（三层）**

1. 正在播的那一条**不掐断**（最多还剩 1.8 秒），避免“字刚出来就没了”。
2. 队列里剩下的**立刻转结算模式**：最多再详播 2 条（**隐藏成就优先**，防止唯一的揭晓被汇总吞掉），其余合并成一条「成就解锁 ×N · 已记入档案」。
3. 结算面板 `z-index: 60`，成就条 `z-index: 66`，**盖在面板之上**；否则提示会在面板后面播给空气看。

### P5-1 CSS（插在 `.toast.is-error { … }` 之后）

```css
  /* ---------- 成就提示条（独立元素，不与系统 toast 抢同一个节点） ---------- */
  .achv-toast {
    position: absolute; left: 50%; top: 150px; transform: translate(-50%, -6px);
    z-index: 66;                     /* 结算面板 60 之上，规则层 70 之下 */
    min-width: 240px; max-width: min(560px, 84vw);
    padding: 10px 18px; border-radius: 8px;
    border: 1px solid rgba(255, 194, 71, 0.55);
    background: linear-gradient(180deg, rgba(20, 16, 8, 0.96), rgba(10, 12, 20, 0.96));
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55), inset 0 0 18px rgba(255, 194, 71, 0.10);
    color: #ffe6a8; font-size: 13px; text-align: center; pointer-events: none;
    opacity: 0; transition: opacity 0.18s ease, transform 0.18s ease;
  }
  .achv-toast.is-on { opacity: 1; transform: translate(-50%, 0); }
  .achv-toast .achv-line { letter-spacing: 0.5px; }
  .achv-toast .achv-sub { margin-top: 4px; font-size: 11.5px; color: rgba(255, 230, 168, 0.72); }
  /* 隐藏成就：紫金双层 + 一次性轻抖（不震屏、不打断操作） */
  .achv-toast.is-hidden {
    border-color: #b085ff;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), inset 0 0 22px rgba(176, 133, 255, 0.22),
      0 0 0 1px rgba(255, 194, 71, 0.35);
    color: #ecd9ff;
  }
  .achv-toast.is-hidden .achv-sub { color: rgba(236, 217, 255, 0.8); }
  .achv-toast.is-hidden.is-on { animation: achv-reveal 0.42s ease-out 1; }
  @keyframes achv-reveal {
    0%   { transform: translate(-50%, 0) scale(0.96); }
    40%  { transform: translate(calc(-50% + 1.5px), 0) scale(1.01); }
    70%  { transform: translate(calc(-50% - 1.5px), 0) scale(1); }
    100% { transform: translate(-50%, 0) scale(1); }
  }
```

### P5-2 HTML（插在 `<div id="toast" …></div>` 之后）

```html
  <div id="achvToast" class="achv-toast" role="status" aria-live="polite"></div>
```

### P5-3 ui 缓存（`ui.toast = document.getElementById('toast');` 下一行）

```js
  ui.achvToast = document.getElementById('achvToast');
```

### P5-4 队列实现（整段替换原 `announceAchievement`）

```js
/* ============================================================
   成就提示队列
   ------------------------------------------------------------
   旧实现的问题：checkMetaAchievements 在同一帧连续解锁多条时，每条都调
   showToast → toastNow，后一条直接覆盖前一条的文本，玩家永远只看到最后一条。
   现在的规则见 ACHIEVEMENTS_PATCH.md P5 播放规则表。
   ============================================================ */
const ACHV_NOTICE_CONFIG = {
  enabled: (() => {
    try { return new URLSearchParams(location.search).get('achnotice') !== 'off'; }
    catch (error) { return true; }
  })(),
  dwellMs: 1800,           /* 战斗内每条停留 */
  settlementDwellMs: 2000, /* 结算模式下每条停留 */
  hiddenDwellMs: 2400,     /* 隐藏成就揭晓停留 */
  summaryDwellMs: 1600,    /* “另有 N 项”汇总停留 */
  gapMs: 220,              /* 条间空档 */
  maxQueue: 6,             /* 战斗内队列上限 */
  settleMaxDetail: 2       /* 结算时最多详细播放条数 */
};

/* 隐藏成就白名单：配置项没写 hidden 时也能识别（P0 落地后 item.hidden 优先） */
const ACHV_HIDDEN_IDS = { perfect_run: 1, lowhp_win: 1, fast_clear: 1, rooms_all: 1 };
const ACHV_CATEGORY_RANK = { progress: 0, skill: 1, explore: 2, long: 3 };

let achvNoticeQueue = [];         /* 待播队列，元素 { item, aetherGained, index } */
let achvNoticeTimer = 0;          /* 停留或空档共用的定时器 */
let achvNoticeShowing = false;    /* 是否正在显示（含条间空档） */
let achvNoticeSettlement = false; /* 本局是否已结束（切结算合并策略） */
let achvNoticePlayed = 0;         /* 结算模式下已详播条数 */
let achvNoticeMerged = 0;         /* 被合并掉的条数 */
let achvNoticeRingDone = false;   /* 同一批只放一次脚下金环 */

/**
 * 判断某条成就是否为隐藏成就
 * @param {Object} item 成就配置
 * @returns {boolean} 是否隐藏
 */
function achvIsHidden(item) {
  if (!item) return false;
  if (item.hidden === true) return true;
  return !!ACHV_HIDDEN_IDS[item.id];
}

/**
 * 同批排序：分类（进度→技巧→探索→长期）优先，其次配置表顺序
 * 无 category 的旧条目统一按 rank 2，保持配置表原序，保证可复现
 * @param {Object} a 条目 A
 * @param {Object} b 条目 B
 * @returns {number} 比较值
 */
function achvNoticeCompare(a, b) {
  const rankOf = (entry) => {
    const r = ACHV_CATEGORY_RANK[entry && entry.item && entry.item.category];
    return Number.isFinite(r) ? r : 2;
  };
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra !== rb) return ra - rb;
  return (Number(a.index) || 0) - (Number(b.index) || 0);
}

/**
 * 隐藏成就提示文案（与普通成就的唯一区别在这两句）
 * @param {Object} item 成就配置
 * @param {string} rewardText 奖励文案
 * @returns {string} 主行文本
 */
function achvNoticeHeadline(item, rewardText) {
  const hidden = achvIsHidden(item);
  return (hidden ? '✧ 隐藏成就揭晓 · ' : '◈ 成就解锁 · ')
    + (item.name || item.id) + '（' + rewardText + '）';
}

/**
 * 渲染一条成就提示（普通 / 隐藏两种视觉）
 * @param {{item:Object, aetherGained:number}} entry 队列条目
 * @returns {void}
 */
function playAchvEntry(entry) {
  if (!entry || !entry.item) return;
  const item = entry.item;
  const hidden = achvIsHidden(item);
  const rewardText = achRewardText(item.id, entry.aetherGained, META_PROGRESS_CONFIG.maxAetherReward);
  if (ui.achvToast) {
    ui.achvToast.textContent = '';
    const line = document.createElement('div');
    line.className = 'achv-line';
    line.textContent = achvNoticeHeadline(item, rewardText);
    ui.achvToast.appendChild(line);
    /* 隐藏成就多一行“达成条件”：揭晓时把刚才做对了什么讲清楚 */
    if (hidden && item.desc) {
      const sub = document.createElement('div');
      sub.className = 'achv-sub';
      sub.textContent = '达成条件：' + item.desc;
      ui.achvToast.appendChild(sub);
    }
    ui.achvToast.className = 'achv-toast is-on' + (hidden ? ' is-hidden' : '');
  }
  playSfx('reward', hidden ? 0.9 : 0.6);
  /* 同一批只放一次金环与浮字，避免同帧叠出多个圈 */
  if (!achvNoticeRingDone && state && state.player) {
    achvNoticeRingDone = true;
    addRing(state.player.x, state.player.y, 22,
      hidden ? 'rgba(200, 160, 255, 0.9)' : 'rgba(255, 214, 120, 0.9)', 120, 0.6);
    addFloat((hidden ? '隐藏成就 · ' : '成就 · ') + item.name,
      state.player.x, state.player.y - 46,
      hidden ? '#d9b8ff' : '#ffd166', 12,
      { outline: 2, life: 1.1, outlineColor: 'rgba(28, 18, 4, 0.9)' });
  }
}

/**
 * 收起成就提示（只改 class，不销毁节点）
 * @returns {void}
 */
function hideAchvNotice() {
  if (ui.achvToast) ui.achvToast.className = 'achv-toast';
}

/**
 * 显示当前条 dwell 毫秒 → 收起 → 再等 gapMs → 播下一条
 * @param {number} dwell 本条的停留毫秒
 * @returns {void}
 */
function scheduleAchvNext(dwell) {
  achvNoticeShowing = true;
  clearTimeout(achvNoticeTimer);
  achvNoticeTimer = setTimeout(() => {
    achvNoticeTimer = 0;
    hideAchvNotice();
    achvNoticeTimer = setTimeout(() => {
      achvNoticeTimer = 0;
      achvNoticeShowing = false;
      pumpAchvNotice();
    }, ACHV_NOTICE_CONFIG.gapMs);
  }, dwell);
}

/**
 * 播放“另有 N 项成就”汇总条（被合并掉的条目统一走这里）
 * @returns {void}
 */
function playAchvSummary() {
  const count = achvNoticeMerged;
  achvNoticeMerged = 0;
  if (count <= 0) return;
  if (ui.achvToast) {
    ui.achvToast.textContent = '';
    const line = document.createElement('div');
    line.className = 'achv-line';
    line.textContent = '成就解锁 ×' + count + ' · 已记入档案';
    ui.achvToast.appendChild(line);
    ui.achvToast.className = 'achv-toast is-on';
  }
  playSfx('reward', 0.45);
  achvNoticeShowing = true;
  clearTimeout(achvNoticeTimer);
  achvNoticeTimer = setTimeout(() => {
    achvNoticeTimer = 0;
    hideAchvNotice();
    achvNoticeShowing = false;
  }, ACHV_NOTICE_CONFIG.summaryDwellMs);
}

/**
 * 驱动器：一次只播一条，播完隔 gapMs 再播下一条
 * @returns {void}
 */
function pumpAchvNotice() {
  if (!ACHV_NOTICE_CONFIG.enabled) return;
  /* 新一局开始：自动清掉上一局残留，避免“已经重开了还在播上局成就” */
  if (achvNoticeSettlement && state && state.status === 'playing') {
    achvNoticeReset();
    return;
  }
  if (achvNoticeShowing || !achvNoticeQueue.length) {
    /* 队列播完但还有被合并的条目：补一条汇总 */
    if (!achvNoticeShowing && !achvNoticeQueue.length && achvNoticeMerged > 0) playAchvSummary();
    return;
  }
  /* 教学提示占屏时先让路，等它收起（最多每 400ms 探一次） */
  if (typeof onboardHintVisible === 'function' && onboardHintVisible()) {
    clearTimeout(achvNoticeTimer);
    achvNoticeTimer = setTimeout(() => {
      achvNoticeTimer = 0;
      pumpAchvNotice();
    }, 400);
    return;
  }

  if (achvNoticeSettlement) {
    /* 结算模式：最多详播 settleMaxDetail 条，其余合并 */
    if (achvNoticePlayed >= ACHV_NOTICE_CONFIG.settleMaxDetail) {
      achvNoticeMerged += achvNoticeQueue.length;
      achvNoticeQueue.length = 0;
      playAchvSummary();
      return;
    }
    /* 隐藏成就优先：唯一的揭晓机会不能被汇总吞掉 */
    let pick = 0;
    for (let i = 0; i < achvNoticeQueue.length; i += 1) {
      if (achvIsHidden(achvNoticeQueue[i].item)) { pick = i; break; }
    }
    const entry = achvNoticeQueue.splice(pick, 1)[0];
    achvNoticePlayed += 1;
    playAchvEntry(entry);
    scheduleAchvNext(achvIsHidden(entry.item)
      ? ACHV_NOTICE_CONFIG.hiddenDwellMs
      : ACHV_NOTICE_CONFIG.settlementDwellMs);
    return;
  }

  const entry = achvNoticeQueue.shift();
  playAchvEntry(entry);
  scheduleAchvNext(achvIsHidden(entry.item)
    ? ACHV_NOTICE_CONFIG.hiddenDwellMs
    : ACHV_NOTICE_CONFIG.dwellMs);
}

/**
 * 成就提示入队（替代旧的“直接 showToast”）
 * @param {Object} item 成就配置
 * @param {number} aetherGained 本次实际到账奥能
 * @returns {void}
 */
function announceAchievement(item, aetherGained) {
  if (!ACHV_NOTICE_CONFIG.enabled || !item) return;
  /* 新一批开始：复位金环标记 */
  if (!achvNoticeQueue.length && !achvNoticeShowing) achvNoticeRingDone = false;
  achvNoticeQueue.push({
    item: item,
    aetherGained: Number(aetherGained) || 0,
    index: META_PROGRESS_CONFIG.achievements.indexOf(item)
  });
  achvNoticeQueue.sort(achvNoticeCompare);
  if (achvNoticeQueue.length > ACHV_NOTICE_CONFIG.maxQueue) {
    while (achvNoticeQueue.length > ACHV_NOTICE_CONFIG.maxQueue) {
      achvNoticeQueue.pop();      /* 只保留排在前面的，其余计入汇总 */
      achvNoticeMerged += 1;
    }
  }
  pumpAchvNotice();
}

/**
 * 本局结束（通关/死亡）：提示切换为结算合并模式
 * 必须在 checkMetaAchievements() 之前调用，新解锁条目才会走结算策略
 * @returns {void}
 */
function achvNoticeBeginSettlement() {
  achvNoticeSettlement = true;
  achvNoticePlayed = 0;
}

/**
 * 清空队列并复位（新一局开始时由 pump 自动调用）
 * @returns {void}
 */
function achvNoticeReset() {
  clearTimeout(achvNoticeTimer);
  achvNoticeTimer = 0;
  achvNoticeQueue.length = 0;
  achvNoticeShowing = false;
  achvNoticeSettlement = false;
  achvNoticePlayed = 0;
  achvNoticeMerged = 0;
  achvNoticeRingDone = false;
  hideAchvNotice();
}
```

### P5-5 结算钩子（死亡 / 通关）

`loseGame()` 里把：

```js
  metaBumpStat('deaths', 1);
  checkMetaAchievements();
```

改为：

```js
  metaBumpStat('deaths', 1);
  /* 成就：切结算合并模式（必须在 checkMetaAchievements 之前） */
  achvNoticeBeginSettlement();
  checkMetaAchievements();
```

`winGame()` 里把：

```js
  /* 第 5 轮 · 档案：通关次数达标后立刻结算成就（首次通关会奖励"开局多一张卡"） */
  checkMetaAchievements();
```

改为：

```js
  /* 第 5 轮 · 档案：通关次数达标后立刻结算成就（首次通关会奖励"开局多一张卡"） */
  achvNoticeBeginSettlement();
  checkMetaAchievements();
```

> 不修改 `checkMetaAchievements()` 的扫描逻辑与 11 类事件驱动：实测 0.024 ms/次，天然不每帧。

---

## P6 · 成就墙

### P6-1 HTML：`#archiveSection` 内加筛选与计数

在 `<span class="setting-state" id="archiveAchText">` 之后、`archive-grid` 之前插入：

```html
          <div class="ach-filter" role="tablist" aria-label="成就分类">
            <button type="button" class="ach-filter-btn is-on" data-ach-filter="all" role="tab" aria-selected="true">全部</button>
            <button type="button" class="ach-filter-btn" data-ach-filter="progress" role="tab" aria-selected="false">进度</button>
            <button type="button" class="ach-filter-btn" data-ach-filter="skill" role="tab" aria-selected="false">技巧</button>
            <button type="button" class="ach-filter-btn" data-ach-filter="explore" role="tab" aria-selected="false">探索</button>
            <button type="button" class="ach-filter-btn" data-ach-filter="long" role="tab" aria-selected="false">长期</button>
          </div>
```

### P6-2 JS：筛选状态 + 点击绑定

在 `renderArchivePanel()` 之前：

```js
/* 成就墙当前分类筛选：all / progress / skill / explore / long */
let achWallFilter = 'all';
```

在 `initUI()` 里绑定：

```js
  /* 成就墙分类筛选：只切筛选，不重建面板数据 */
  Array.prototype.forEach.call(document.querySelectorAll('[data-ach-filter]'), (btn) => {
    btn.addEventListener('click', () => {
      achWallFilter = btn.getAttribute('data-ach-filter') || 'all';
      Array.prototype.forEach.call(document.querySelectorAll('[data-ach-filter]'), (b) => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderArchivePanel();
    });
  });
```

### P6-3 `renderArchivePanel()` 改造要点

保留原有“重放奥能实得”的算法不变，只改三处：

1. 计数只看 **35 条有效条目**：
```js
  const list = META_PROGRESS_CONFIG.achievements;
  const got = list.filter((item) => meta.achievements && meta.achievements[item.id]).length;
  const byCat = {};
  list.forEach((item) => {
    const cat = item.category || 'long';
    byCat[cat] = byCat[cat] || { got: 0, total: 0 };
    byCat[cat].total += 1;
    if (meta.achievements && meta.achievements[item.id]) byCat[cat].got += 1;
  });
  if (ui.archiveAchText) {
    ui.archiveAchText.textContent = '成就 ' + got + ' / ' + list.length
      + ' · 进度 ' + byCat.progress.got + '/' + byCat.progress.total
      + ' · 技巧 ' + byCat.skill.got + '/' + byCat.skill.total;
  }
```

2. 按筛选过滤 + 分类分组：
```js
  const visible = list.filter((item) => achWallFilter === 'all' || (item.category || 'long') === achWallFilter);
  const catNames = { progress: '进度 · PROGRESS', skill: '技巧 · SKILL', explore: '探索 · EXPLORE', long: '长期 · LONG' };
```

3. 行渲染加“隐藏遮罩”：
```js
    const isHidden = item.hidden === true && !done;
    const rowName = isHidden ? '???' : item.name;
    const rowDesc = isHidden ? '隐藏成就 · 达成后揭示' : item.desc;
    const rowProg = isHidden ? '—' : (done ? item.target + '/' + item.target : value + '/' + item.target);
    const barHtml = isHidden ? ''
      : '<span class="ach-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + item.target + '"'
        + ' aria-valuenow="' + value + '" aria-label="' + item.name + ' ' + value + '/' + item.target + '">'
        + '<i style="width:' + pct + '%" data-w="' + pct + '"></i></span>';
```
行 class 增加 `is-locked` / `is-hidden`：
```js
    const rowClass = 'archive-ach-row'
      + (done ? ' is-done' : ' is-locked')
      + (isHidden ? ' is-hidden' : '');
```

分类标题在“全部”视图下插入：
```js
  /* 全部分类时按四类分组；筛选单类时不插标题 */
  const grouped = achWallFilter === 'all'
    ? ['progress', 'skill', 'explore', 'long'].map((cat) => ({
        cat: cat,
        rows: visible.filter((item) => (item.category || 'long') === cat)
      }))
    : [{ cat: '', rows: visible }];
```

### P6-4 CSS（追加到档案面板样式区）

```css
  /* 成就墙 · 分类筛选（青金紫体系，不新增色板） */
  .ach-filter { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 10px; }
  .ach-filter-btn {
    font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 4px; cursor: pointer;
    color: rgba(198, 226, 240, 0.72); background: rgba(18, 30, 42, 0.55);
    border: 1px solid rgba(62, 230, 255, 0.22);
  }
  .ach-filter-btn.is-on {
    color: #d8fbff; border-color: var(--tech);
    box-shadow: 0 0 0 1px rgba(62, 230, 255, 0.35), 0 0 12px rgba(62, 230, 255, 0.18);
  }
  .ach-cat-title {
    margin: 12px 0 6px; font-size: 12px; letter-spacing: 1px;
    color: var(--magic); border-left: 3px solid var(--magic); padding-left: 8px;
  }
  .archive-ach-row.is-locked { opacity: 0.45; }
  .archive-ach-row.is-hidden .ach-desc { color: rgba(176, 133, 255, 0.85); }
  .archive-ach-row.is-done .ach-name { color: var(--gold); }
  .archive-ach-row .ach-bar i {
    background: linear-gradient(90deg, var(--tech), var(--magic));
  }
```

---

## P7 · 调试面板补新口径

在 `__roamDebug.p2.info()` 的 metrics 数组里追加：

```js
          'runs', 'perfectRuns', 'lowHpClears', 'fastestClear',
          'charClearWarden', 'charClearEmber', 'charClearGazer',
          'roomTypesSeen', 'dailyStreakBest', 'playSeconds'
```

`info()` 返回对象里追加：

```js
          extended: {
            perfectRuns: Number(meta.stats && meta.stats.perfectRuns) || 0,
            lowHpClears: Number(meta.stats && meta.stats.lowHpClears) || 0,
            charClears: JSON.parse(JSON.stringify(meta.charClears || {})),
            bestClearTime: Number(meta.bestClearTime) || 0,
            playSeconds: Number(meta.playSeconds) || 0,
            roomTypesSeen: (meta.roomTypesSeen || []).slice(0, 12),
            dailyStreak: JSON.parse(JSON.stringify(meta.dailyStreak || {}))
          },
```

---

## 验收用例（整合线执行）

### 必跑 · 老档与坏档

1. 从当前存档删掉 `perfectRuns / lowHpClears / charClears / bestClearTime / playSeconds / roomTypesSeen / dailyStreak`，启动，确认：
   - 无异常、成就墙 0/35、`bestFloor` 等旧值不变。
2. 把 `achievements` 改成 `"bad"`、`roomTypesSeen` 改成 `{}`、`dailyStreak` 改成 `null`，启动，确认无异常。
3. 旧档带 `first_kill` / `deaths_5` 等退休 id，启动后 `meta.achievements` 仍含这些键，但总数按 35 计。

### 必跑 · 功能

4. `__roamDebug.p2.simulate('runs_20')` 等 35 条逐条模拟（或按分类抽样 + 高风险条目全测）。
5. 控制台把 `runs / kills / bestFloor` 同时推到多档目标后触发一次结算，确认 3 条提示依次出现，1.8 秒一条。
6. `?ach=off` 启动：成就不结算、面板显示“已关闭”。
7. 通关一局普通难度：`charClears` 对应角色 +1、`bestClearTime` 写入、`playSeconds` 增加。
8. 死亡一局：`playSeconds` 增加，`charClears / perfectRuns / lowHpClears` 不变。
9. 连续两日模拟（改 `dailyStreak.lastDate` 为昨天再开今日挑战）：`current` 变 2，`best` 取最大。
10. 进入 12 种房型后 `roomTypesSeen.length === 12`；重复进入不增加、不写盘。

### 必跑 · 代价

11. 控制台计时：`console.time` 包裹 `checkMetaAchievements(true)` 100 次，均值应 ≤ 0.1 ms。
12. 全文件搜索 `checkMetaAchievements`，确认无 `update()` / 绘制函数内调用。
13. 导出存档对比：新增字段序列化增量 ≤ +300 字节；35 条全解锁净增量 ≤ 0。

### 必跑 · 表现层

14. 未解锁普通条目：名称/条件/进度可见，行 45% 透明。
15. 未解锁隐藏条目：名称为 `???`，无进度条。
16. 已解锁条目：金色名称 + ✓ 日期，不只靠颜色区分。
17. 四类筛选切换后，计数与行数一致；`全部` 视图有四类分组标题。

---

## 回滚

| 批次 | 回滚方式 |
|---|---|
| P0 | 恢复原 38 条数组；`enabled: true`；删 `legacyIds` |
| P1/P2 | 删除新增字段与归一化块（老档不受影响，只是不再记录新指标） |
| P3 | 删除新增 case（未注册的成就不会读这些 metric） |
| P4 | 删除 5 处调用与 3 个新函数（不影响已有统计） |
| P5 | 恢复原 `announceAchievement`（退回同帧覆盖行为） |
| P6/P7 | 删除筛选节点/样式/调试字段 |

> P2 与 P4 必须分开回滚：先回 P4（停止写新字段），再回 P2（停止读），不要反过来。
