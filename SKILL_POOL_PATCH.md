# SKILL_POOL_PATCH · 技能池扩容（6 张基础技能）

> 目标文件：`index_arcane_v2.html`（只读，本补丁不落盘主文件）
> `TARGET_MD5`：**应用时现场读取**，不写死。本轮读取时是 `96C94262…` / 2,755,687 B（仍在被其他线改动，见文末"现场状态"）。
> 锚点命中数：全部 = **1**（校验命令见 §0）。

---

## §0 应用前置检查（必须先跑）

```bash
node tools/_anchor_check.js
```

期望输出：

```
A1 1   A2 1   A3 1   A4 1   A5 1   A6 1   A8 1   A9 1   A10 1   A11 1
A7 22  ← 只核对字段存在（player.invuln 是既有字段），不作锚点
```

`A1`–`A6`、`A8`–`A11` 任何一项不是 `1` → **停下，不要打补丁**。说明上游又改了同名区域，需要重新取锚点。

依赖函数签名（应用时已核对，全部存在且参数一致）：

| 依赖 | 签名 |
|---|---|
| `getMagicDamage(magic, fusion)` | 伤害 = 面板 × `state.mods.damageMul` × 等级系数 |
| `aoeAimPoint(maxRange)` | 返回瞄准点 `{x,y}`（超射程时回落） |
| `aoeFallback(magic, damage)` | 关闭 AoE 时的旧口径兜底 |
| `aoeRecord(id, shape, params, from, to)` / `aoeRecordHit(record, enemy)` | AoE 验收台账 |
| `aoeDistToSegment(px,py,x1,y1,x2,y2)` | 点到线段距离 |
| `isWalkableCircle(x, y, r)` | 落点合法性 |
| `findNearestEnemy(x, y, maxRange, exclude)` | 最近敌人（含 boss） |
| `damageEnemy(enemy, amount, dirAngle, opts)` | 唯一伤害出口（含顿帧/屏震） |
| `addRing(x,y,radius,color,grow,life,shape,spin)` | 环 |
| `addBeam(points, color, life, width, branch)` | 光束/长条 |
| `addBurst(x,y,color,count,speed)` / `addSparks(x,y,color,count)` | 粒子 |
| `addFloat(text,x,y,color,size,opts)` | 飘字 |
| `spawnAoeZone(zone)` | 持续/延迟区域（`delayBurst` 已带预兆圈） |
| `player.shield`（秒）/ `player.invuln`（秒） | 既有字段，语义为"剩余秒数"，用 `Math.max` 叠加 |
| `floorHealAmount(n)` | 治疗量随层数校正 |

---

## P1 · MAGIC_CONFIG 追加 6 张（锚点 A1）

**锚点 A1（唯一命中）**

```js
    desc: '以自身为中心炸开冰霜环，命中敌人并减速。'
  }
];
```

**替换为**

```js
    desc: '以自身为中心炸开冰霜环，命中敌人并减速。'
  },
  /* ---- S 批 · 技能池扩容：3 张范围 + 3 张单体/功能 ----------------------------------
     · 全部复用既有 vfx.type 与绘制原语，零外部资源
     · damage/cost 一律 ≤ 1.6（= 火球效率上限），强度靠形状与覆盖，不靠数值效率
     · minFloor 分期解锁：保证 F1–F3 的奖励池与扩容前完全一致（红线①的硬保障）
     ------------------------------------------------------------------------------ */
  {
    id: 'pulseShock', name: '斥力脉冲', glyph: '◎', tag: '范围', rarity: 'rare',
    cost: 30, cooldown: 3.4, damage: 26, minFloor: 4,
    vfx: { type: 'bolt', core: '#d8c8ff', glow: '#8e6bff', accent: '#efe6ff' },
    desc: '以自身为中心炸出一圈斥力：推开并击伤周围敌人，施法瞬间获得 0.35 秒无敌。'
  },
  {
    id: 'pierceLance', name: '贯流长枪', glyph: '⇢', tag: '贯穿', rarity: 'rare',
    cost: 30, cooldown: 3.6, damage: 38, minFloor: 5,
    vfx: { type: 'bolt', core: '#ffe6a8', glow: '#ffb14a', accent: '#fff6d8' },
    desc: '朝瞄准方向射出一条 620px 贯穿光枪，命中路径上所有敌人，伤害不随距离衰减。'
  },
  {
    id: 'skyfall', name: '天陨', glyph: '☄', tag: '范围', rarity: 'epic',
    cost: 50, cooldown: 6.0, damage: 78, minFloor: 6,
    vfx: { type: 'lava', core: '#ffd9a0', glow: '#ff7a3d', accent: '#ffeec2' },
    desc: '在瞄准点标记 2 秒天陨预兆，落点半径 210 内全体受击。'
  },
  {
    id: 'hammer', name: '符文重锤', glyph: '❖', tag: '单体', rarity: 'rare',
    cost: 34, cooldown: 3.0, damage: 52, minFloor: 4,
    vfx: { type: 'rune', core: '#e6d8ff', glow: '#9b6bff', accent: '#f6eeff' },
    desc: '砸向 280px 内最近的敌人，对精英与首领额外 ×1.5。'
  },
  {
    id: 'brand', name: '灼痕烙印', glyph: '✦', tag: '灼烧', rarity: 'common',
    cost: 23, cooldown: 1.4, damage: 36, minFloor: 4,
    vfx: { type: 'fire', core: '#ffcf8a', glow: '#ff8a3d', accent: '#ffe6b8' },
    desc: '在瞄准点烙下灼痕：立刻结算一次，并在 0.7s / 1.4s 各再结算一次，落点固定。'
  },
  {
    id: 'ward', name: '护身符阵', glyph: '✜', tag: '守护', rarity: 'common',
    cost: 24, cooldown: 5.0, damage: 0, minFloor: 4,
    vfx: { type: 'heal', core: '#b8ffd8', glow: '#4ade9b', accent: '#e8fff0' },
    desc: '展开 5 秒护身符阵（受到的伤害减半）并立刻回复 12 生命。'
  }
];
```

---

## P2 · SKILL_POOL_CONFIG（锚点 A2，紧跟 AOE_SKILL_CONFIG 之后）

**锚点 A2（唯一命中）**

```js
  frostRing: { shape: 'selfring', radius: 140, slow: 1.6, damageMul: 1 }
};
```

**替换为**

```js
  frostRing: { shape: 'selfring', radius: 140, slow: 1.6, damageMul: 1 }
};

/**
 * S 批 · 技能池扩容 6 张新卡的结算参数表
 * kind 决定结算分支，shape 只给验收脚本/台账用（保证 AoE 台账口径统一）
 * @type {Object}
 */
const SKILL_POOL_CONFIG = {
  pulseShock:  { kind: 'selfringPush', shape: 'selfring', radius: 150, push: 110, invuln: 0.35, minFloor: 4 },
  pierceLance: { kind: 'pierceLine',  shape: 'line',     length: 620, width: 34,                   minFloor: 5 },
  skyfall:     { kind: 'delayedBomb', shape: 'delay',    radius: 210, delay: 2.0,                  minFloor: 6 },
  hammer:      { kind: 'heavySingle', shape: 'single',   range: 280, eliteMul: 1.5,                minFloor: 4 },
  brand:       { kind: 'dotBrand',    shape: 'single',   radius: 28, gap: 0.7,                    minFloor: 4 },
  ward:        { kind: 'wardSelf',    shape: 'self',     shield: 5.0, heal: 12,                    minFloor: 4 }
};
```

---

## P3 · 统一结算函数 castPoolSkill（锚点 A4，插在 spawnAoeZone 之前）

**锚点 A4（唯一命中）**

```js
/**
 * 生成一个持续区域（奥术雷池 / 熔雷带 / 坍缩 / 霜焰延迟爆）
```

**在它前面插入下面整段（不要动锚点本身）**

```js
/* ================================================================
   S 批 · 技能池扩容：6 张新基础技能的统一结算入口
   为什么只写一个函数：6 个 if 分支共用同一套"取伤害 / 取瞄准 / 记账 / 收尾"，
   复制 6 份会出现 6 处漂移点，之后每次调参都要改 6 遍。
   ================================================================ */

/**
 * 结算 S 批新基础技能（castSlot 命中 SKILL_POOL_CONFIG 时调用）
 * @param {Object} magic MAGIC_CONFIG 中的一格
 * @param {Object|null} fusion 融合配置；新卡暂无融合配方，恒 null
 * @returns {void}
 */
function castPoolSkill(magic, fusion) {
  const cfg = SKILL_POOL_CONFIG[magic.id];
  if (!cfg) return;
  const damage = getMagicDamage(magic, fusion);
  const isAoe = cfg.kind === 'selfringPush' || cfg.kind === 'pierceLine'
    || cfg.kind === 'delayedBomb' || cfg.kind === 'dotBrand';
  if (isAoe && AOE_SKILL_CONFIG.enabled === false) { aoeFallback(magic, damage); return; }

  const player = state.player;
  const vfx = magic.vfx || { core: '#ffd9a0', glow: '#ff9c3d', accent: '#fff2c8' };
  const color = (fusion && fusion.color) || vfx.glow;
  const angle = getAimAngle();
  player.castAnim = 1;
  player.angle = angle;

  // ---- ① 斥力脉冲：自身 360° 爆发｜先推后打，把"被围住"在一帧里解开 ----
  if (cfg.kind === 'selfringPush') {
    addRing(player.x, player.y, 12, hexToRgba(vfx.accent, 0.9), cfg.radius, 0.30, 'shockwave');
    addRing(player.x, player.y, cfg.radius * 0.55, hexToRgba(color, 0.55), cfg.radius, 0.24, 'ring', -1.6);
    addBurst(player.x, player.y, vfx.accent, 24, 260);
    addSparks(player.x, player.y, vfx.accent, 12);
    triggerShake(4.0, 0.20);
    flashScreen('rgba(255, 214, 160, 0.07)');
    playSfx('frost', 0.8);
    const record = aoeRecord(magic.id, cfg.shape, { radius: cfg.radius, push: cfg.push },
      { x: player.x, y: player.y }, { x: player.x, y: player.y });
    for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = state.enemies[i];
      if (!enemy || enemy.hp <= 0) continue;
      if (dist(player.x, player.y, enemy.x, enemy.y) > cfg.radius + enemy.radius) continue;
      const dirAway = Math.atan2(enemy.y - player.y, enemy.x - player.x);
      const push = cfg.push * (enemy.isBoss ? 0.12 : 1);   // 首领抗推，否则变成"推走首领"逃课
      const nx = enemy.x + Math.cos(dirAway) * push;
      const ny = enemy.y + Math.sin(dirAway) * push;
      if (isWalkableCircle(nx, ny, enemy.radius)) { enemy.x = nx; enemy.y = ny; }
      damageEnemy(enemy, damage, dirAway, { abilityId: magic.id });
      aoeRecordHit(record, enemy);
      if (enemy.hp > 0) addSparks(enemy.x, enemy.y, vfx.accent, 4);
    }
    player.invuln = Math.max(player.invuln || 0, cfg.invuln);
    if (record.hits >= 2) addFloat('斥力 ×' + record.hits, player.x, player.y - 38, color, 15);
    return;
  }

  // ---- ② 贯流长枪：620×34 长条穿透｜每只只吃一次、不衰减 ----
  if (cfg.kind === 'pierceLine') {
    const to = { x: player.x + Math.cos(angle) * cfg.length, y: player.y + Math.sin(angle) * cfg.length };
    addBeam([{ x: player.x, y: player.y }, to], hexToRgba(color, 0.92), 0.26, cfg.width * 0.62, false);
    addRing(to.x, to.y, 8, hexToRgba(vfx.accent, 0.85), 44, 0.26, 'shockwave');
    for (let k = 1; k <= 5; k += 1) {
      const t = k / 6;
      addSparks(player.x + (to.x - player.x) * t, player.y + (to.y - player.y) * t, vfx.accent, 4);
    }
    playSfx('bolt', 0.8);
    triggerShake(2.4, 0.14, true, angle);
    const record = aoeRecord(magic.id, cfg.shape, { length: cfg.length, width: cfg.width },
      { x: player.x, y: player.y }, to);
    for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = state.enemies[i];
      if (!enemy || enemy.hp <= 0) continue;
      if (aoeDistToSegment(enemy.x, enemy.y, player.x, player.y, to.x, to.y) > cfg.width * 0.5 + enemy.radius) continue;
      damageEnemy(enemy, damage, angle, { abilityId: magic.id });
      aoeRecordHit(record, enemy);
      if (enemy.hp > 0) addSparks(enemy.x, enemy.y, vfx.accent, 5);
    }
    if (record.hits >= 2) addFloat('贯穿 ×' + record.hits, player.x, player.y - 38, color, 15);
    return;
  }

  // ---- ③ 天陨：2.0s 预兆 + r210 落点｜复用 delayBurst 的既有结算与顿帧 ----
  if (cfg.kind === 'delayedBomb') {
    const point = aoeAimPoint(340);
    // 预兆：从 r=radius 收到 0 的倒计时环，玩家能"读秒"
    addRing(point.x, point.y, cfg.radius, hexToRgba(color, 0.55), 0, cfg.delay, 'rune', -1.1);
    addRing(point.x, point.y, 6, hexToRgba(vfx.accent, 0.85), cfg.radius, 0.30, 'hex');
    addSparks(point.x, point.y, vfx.accent, 8);
    playSfx('cast', 0.9);
    const record = aoeRecord(magic.id, cfg.shape, { radius: cfg.radius, delay: cfg.delay },
      { x: point.x, y: point.y }, { x: point.x, y: point.y });
    spawnAoeZone({
      type: 'delayBurst', x: point.x, y: point.y, radius: cfg.radius,
      life: cfg.delay, maxLife: cfg.delay, tick: 0, tickInterval: cfg.delay,
      damage: damage, color: color, accent: vfx.accent,
      record: record, delayName: '天陨', abilityId: magic.id
    });
    return;
  }

  // ---- ④ 符文重锤：单体重击，射程硬门 + 精英/首领 ×1.5 ----
  if (cfg.kind === 'heavySingle') {
    const target = findNearestEnemy(player.x, player.y, cfg.range);
    if (!target) return;                              // 双重保险：castSlot 已做过同样的提前返回
    const dir = Math.atan2(target.y - player.y, target.x - player.x);
    player.angle = dir;
    addBeam([{ x: player.x, y: player.y }, { x: target.x, y: target.y }],
      hexToRgba(vfx.accent, 0.85), 0.14, 10, false);
    addRing(target.x, target.y, target.radius, hexToRgba(color, 0.9), target.radius + 34, 0.30, 'hex');
    addBurst(target.x, target.y, vfx.accent, 18, 150);
    addSparks(target.x, target.y, vfx.accent, 10);
    playSfx('fire', 0.85);
    triggerShake(4.6, 0.20, true, dir);
    const heavyMul = (target.elite || target.isBoss) ? cfg.eliteMul : 1;
    damageEnemy(target, damage * heavyMul, dir, { abilityId: magic.id });
    if (target.hp > 0) addFloat(heavyMul > 1 ? '重锤 · 破甲' : '重锤', target.x, target.y - 26, color, 14);
    return;
  }

  // ---- ⑤ 灼痕烙印：落点 r28，1 即时 + 2 延迟，落点固定（走开就漏跳） ----
  if (cfg.kind === 'dotBrand') {
    const point = aoeAimPoint(300);
    const tickDamage = damage / 3;
    addRing(point.x, point.y, cfg.radius, hexToRgba(vfx.accent, 0.8), cfg.radius + 14, 0.26, 'hex');
    addSparks(point.x, point.y, vfx.accent, 6);
    playSfx('frost', 0.6);
    const record = aoeRecord(magic.id, cfg.shape, { radius: cfg.radius, gap: cfg.gap },
      { x: point.x, y: point.y }, { x: point.x, y: point.y });
    for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = state.enemies[i];
      if (!enemy || enemy.hp <= 0) continue;
      if (dist(point.x, point.y, enemy.x, enemy.y) > cfg.radius + enemy.radius) continue;
      damageEnemy(enemy, tickDamage, null, { abilityId: magic.id });
      aoeRecordHit(record, enemy);
    }
    for (let k = 1; k <= 2; k += 1) {
      spawnAoeZone({
        type: 'delayBurst', x: point.x, y: point.y, radius: cfg.radius,
        life: cfg.gap * k, maxLife: cfg.gap * k, tick: 0, tickInterval: cfg.gap * k,
        damage: tickDamage, color: color, accent: vfx.accent,
        record: record, delayName: '灼痕', abilityId: magic.id
      });
    }
    return;
  }

  // ---- ⑥ 护身符阵：5s 减伤 + 即时回血｜复用 player.shield 既有时长语义 ----
  if (cfg.kind === 'wardSelf') {
    player.shield = Math.max(player.shield || 0, cfg.shield);
    const heal = floorHealAmount(cfg.heal);
    player.hp = clamp(player.hp + heal, 0, player.hpMax);
    addRing(player.x, player.y, 24, hexToRgba(vfx.accent, 0.85), 96, 0.42, 'hex');
    addRing(player.x, player.y, 12, hexToRgba(color, 0.6), 70, 0.50, 'rune', 1.4);
    addBurst(player.x, player.y, vfx.accent, 14, 120);
    playSfx('cast', 0.7);
    addFloat('护身 ' + heal + ' · ' + cfg.shield.toFixed(1) + 's', player.x, player.y - 40, color, 13);
    return;
  }
}

```

---

## P4 · castSlot 分发（锚点 A3）

**锚点 A3（唯一命中）**

```js
  else if (magic.id === 'frostRing') castFrostRing(magic, fusion);
  else castHeal(magic, fusion);
```

**替换为**

```js
  else if (magic.id === 'frostRing') castFrostRing(magic, fusion);
  else if (SKILL_POOL_CONFIG[magic.id]) castPoolSkill(magic, fusion);   // S 批：6 张新基础技能
  else castHeal(magic, fusion);
```

---

## P5 · castSlot 的"空放不扣费"前置门（锚点 A6）

重锤是硬射程卡，必须和 bolt 一样在**扣奥能/进冷却之前**判空，否则 280px 内没怪时白扣 34 奥能。

**锚点 A6（唯一命中）**

```js
  if (magic.id === 'bolt' && !findNearestEnemy(state.player.x, state.player.y, 520)) {
```

**在它前面插入**

```js
  // S 批：符文重锤是 280px 硬射程，空放直接不消耗（否则会变成"最贵的失误"）
  if (magic.id === 'hammer' && !findNearestEnemy(state.player.x, state.player.y, SKILL_POOL_CONFIG.hammer.range)) {
    showToast('射程内没有目标', 'warn');
    return;
  }
```

> `showToast` 若在当前版本已改名，改成离它最近的提示函数即可；这一行只是反馈，不影响逻辑。

---

## P6 · 奖励池楼层闸门（锚点 A5）

**锚点 A5（唯一命中）**

```js
    MAGIC_CONFIG.forEach((magic) => {
      if (state.ownedMagic.includes(magic.id)) return;
```

**替换为**

```js
    MAGIC_CONFIG.forEach((magic) => {
      if (state.ownedMagic.includes(magic.id)) return;
      // S 批：新卡按楼层分期解锁 —— 这是"前 3 层通关率不跳"的硬保障
      // （F1–F3 的奖励池因此与扩容前逐项一致；闸门只会让早期更弱，不可能更强）
      if (magic.minFloor && Number(state.floor || 1) < magic.minFloor) return;
```

---

## P7 · 卡面图标登记（锚点 A11）

项目自己的规矩（`ui-kit.md §8`）是"**同族共用一图，不追求 1:1 独图**"，只有 12 张内联 SVG。
所以新卡**不新增第 13 张图**，按技能族落到既有 symbol；每张新卡唯一的"符印"是 `glyph` 字符
（`◎ ⇢ ☄ ❖ ✦ ✜`，与既有 `△ ◎ ⌁` 走同一条字符渲染路径，零外部资源）。

不登记也能显示（会落到 `magic → i-pool` 兜底图），但 6 张卡会长得一模一样，等于"没有符印"。

**锚点 A11（唯一命中）**

```js
const REWARD_ICON_MAP = {
  /* 魔法 */
  'magic:fireball': 'i-flame',
```

**替换为**

```js
const REWARD_ICON_MAP = {
  /* 魔法 */
  'magic:pulseShock': 'i-shield',
  'magic:ward': 'i-shield',
  'magic:pierceLance': 'i-blade',
  'magic:hammer': 'i-charge',
  'magic:skyfall': 'i-flame',
  'magic:brand': 'i-poison',
  'magic:fireball': 'i-flame',
```

---

## P8 · 验收清单（打完补丁后按顺序跑）

1. **静态**
   ```bash
   node tools/_anchor_check.js          # 应用后应全部为 0（锚点已被替换）
   node tools/_sig_check.js             # 依赖签名仍在
   ```
2. **能开能打**：F4 之后能在三选一里看到新卡（F1–F3 不应出现）。
3. **AoE 台账**：`aoeRecord` 新增 4 个 id（pulseShock / pierceLance / skyfall / brand），
   形状字段分别是 `selfring / line / delay / single`。
4. **手感四段**（承接上一轮口径）：蓄力 0；释放→命中 0 帧（重锤/长枪为瞬时结算）；
   顿帧由 `damageEnemy` 内的 `FX_TIER_CONFIG` 统一给，不新开一套。
5. **数值门**：`node tools/sim_panel/probe_skillpool.js --runs 10000 --profile bot`
   （注意 sim 不含护盾/击退字段，`ward` 不参与数值门）。
6. **单帧耗时**：新增粒子峰值 24（脉冲）/ 20（长枪）/ 8（天陨）颗，低于 S2 档 60 的上限。

---

## 可选补偿阀（**未实测，不进本补丁**）

扩容实测代价是"三选一稀释"：5 张卡让 10 层通关率 −5.8pp（见 `技能池扩容.md` §5）。
若要把它拉回 ±2pp，最小改动是把技能段三选一改成四选一：

```js
function rewardChoiceCountForStage(stage) {
  const n = 3 + Math.max(0, Math.floor(stage / 4));
  return Math.min(n, 4);
}
```

代价是卡牌行布局要容纳 4 张（需浏览器验证，未做）。**不建议在没验证 UI 前上线。**

---

## 现场状态（必读）

- 你给的 `2,716,347 / 539781FE…` 已经过期：本轮开跑时是 `2,730,578 / 28B9DBCA…`，
  收尾时是 `2,755,687 / 96C94262…`，期间另有线在并发写主文件（`probe_chars*`、`probe_difficulty*` 产物时间戳可证）。
- 所以本补丁**不写任何行号**、不写死 MD5；请以"锚点命中 = 1"为唯一应用条件。
