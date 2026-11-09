# P1 补丁（就绪不落盘）

```
TARGET_FILE=index_arcane_v2.html
TARGET_MD5=C762F5944F5D3A46C3A69CBD6E971E48
ANCHOR=bossStatsForFloor（函数名锚点，全文不用行号）
APPLY_ORDER=P1a(F2 ×0.85) → P1b(F3 ×0.88)
```

> MD5 已于 2026-11-08 对当前冻结的主文件实测一致（`Get-FileHash -Algorithm MD5`）。
> 落盘前必须再校验一次；**不一致就停，不许按“看起来差不多”贴**。

---

## 0. 前置

- 主文件仍在 20 层长跑，**本轮零字节改动**；本文件只是补丁文本。
- 只动 `bossStatsForFloor` 的 `hp`，**不动 `damage`、不动其他层、不动任何机制**。
- 模拟器侧对应开关是 `ov.bossHpScaleByFloor`；两者口径同源。

---

## 1. P1a（只改 F2，×0.85）

### 定位

函数 `bossStatsForFloor(floorNumber)` 内，在以下两行：

```js
  hp *= deepHpMulOf(floorNumber);
  hp = Math.round(Math.min(cap * 2, hp));
```

### 改为

```js
  hp *= deepHpMulOf(floorNumber);
  /* P1a：仅 F2 首领血量 ×0.85（只动血量；伤害与其他层不动） */
  const BOSS_HP_FLOOR_SCALE = { 2: 0.85 };
  hp *= (BOSS_HP_FLOOR_SCALE[floorNumber] || 1);
  hp = Math.round(Math.min(cap * 2, hp));
```

### 验收（模拟器，10000 局）

```powershell
node tools/sim_panel/probe_p1.js --mode p1 --floor 2 --scale 0.85 --runs 10000
```

预期（A / A′）：F2 首领死 1594→1337 / 1635→1351；10 层 37.2% / 37.7%；F20 32.8% / 33.1%；
F4–F10 `avgBossSec` 偏差 ≤0.5s（PASS）。

---

## 2. P1b（只改 F3，×0.88；在 P1a 之后应用）

### 定位

P1a 插入的那一行：

```js
  const BOSS_HP_FLOOR_SCALE = { 2: 0.85 };
```

### 改为

```js
  const BOSS_HP_FLOOR_SCALE = { 2: 0.85, 3: 0.88 };
```

> 如果 P1a 还没贴，P1b 不能单独贴（否则没有这个常量）。应用顺序固定为 F2 → F3。

### 验收（模拟器，10000 局）

```powershell
node tools/sim_panel/probe_p1.js --mode p1 --floor 3 --scale 0.88 --runs 10000
```

预期（A / A′）：F3 首领死 1260→1028 / 1411→1138；10 层 36.7% / 37.2%；F20 32.3% / 32.7%；
F2 首领死与 `avgBossSec` 原封不动（单变量隔离）。

---

## 3. 合并总账（两刀贴完后必须单独跑，不许相加）

```powershell
node tools/sim_panel/probe_p1.js --mode p1 --scales 2:0.85,3:0.88 --runs 10000
```

预期（A / A′）：5 层 48.8% / 49.7%（仅参考）；10 层 37.9% / 38.5%；F20 33.2% / 33.7%；
F4–F10 漏层主判据 PASS（最大偏差 0.4s / 0.3s）。

**非加性提醒**：单跑 F2 −257、F3 −283，加号 540；合并实测 −504（少 36 人，6.7%）。
所以合并总账只能实测，不能把两次数字相加。

---

## 4. 与模拟器的已知差异（必须写清）

- 主文件最后是 `Math.round`，模拟器是浮点乘完直接进战斗：**单层最多差 1 HP**，
  不足以改变结论（满血 F2 首领约 3200 级血量）。
- 模拟器把「选卡/楼层」共用一条随机流；**A/B 只能看总账**，同人归因无效（见 BASELINE §8.1）。

---

## 5. 回滚

删除 `BOSS_HP_FLOOR_SCALE` 两行并把 `hp *= ...` 去掉，恢复：

```js
  hp *= deepHpMulOf(floorNumber);
  hp = Math.round(Math.min(cap * 2, hp));
```

---

## 6. P2 说明

P2（首领房入场回 25% 已损生命）只做了对照测量，**未出补丁**。
结论见 [F2_BOSS_REPORT.md](F2_BOSS_REPORT.md) §8.3：同效果下 P1 总账更好、且缩短战斗；
P2 单层更猛但收益不往下游传，并挤压红线余量。
