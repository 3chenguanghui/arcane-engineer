# 第 19 项 · 玩家与敌人形象辨识度规格（identity）

> 自行裁定，不请求批准。只在"需求自相矛盾 / 破坏单文件零依赖 / 两个已确认系统互斥"时才停下来发消息。
> 本项不涉及玩法数值、不新增文件依赖，纯绘制层。

## 1. 问题定义

第 5 轮给三大区做了"族签名件"（机械方肩 / 符文尖冠 / 虚空触须），解决了**跨族**可辨；
但同族内部所有敌人共用同一种签名件，缩到 60px 实战尺寸后包围盒被签名件吃满，
出现同区撞脸：

| 最差对（before） | 剪影特征距离 |
|---|---|
| warper-voidconduit | 0.042 |
| screamer-siphon | 0.112 |
| stalker-voidbishop | 0.147 |
| devourer-coalescer | 0.161 |
| runesprite-hexer | 0.185 |
| assembler-gearsplit | 0.197 |

同时存在同区同 hex 或近似 hex 的配色撞车（patrol/gearsplit 同为 `#ffb84d`、
riveter/forgepriest 同为 `#ff7a4d`、shardling/siphon 同为 `#58e0ff` 等）。

## 2. 量化口径（与 `tools/arcane_identity.js` 完全一致）

读数来源：`__roamDebug.identity.readOne(key, 60)` → 60px 离屏绘制 → 像素统计。
和玩家在战场上看到的尺寸一致，不用"放大图"自证。

| 指标 | 定义 | 取值范围 |
|---|---|---|
| 剪影差异 | `abs(aspectA-aspectB) + abs(complexityA-complexityB)/3 + abs(fillA-fillB)`；aspect = 包围盒宽/高，complexity = 边缘像素/√面积 | 0 起，越大越可分 |
| 主色差 | 60px 内"饱和度最高 25% 像素"的平均色 RGB 欧氏距离 | 0–441 |
| 轮廓占比 | `fill` = 剪影像素面积 / 包围盒面积（1 = 实心块，0.2 = 稀疏碎边） | 0–1 |

## 3. 验收阈值（自行判定）

| 断言 | 阈值 | 理由 |
|---|---|---|
| I1 31 个单位全部可读 | 31/31 非空 | 缺一个就等于有单位在实战中"消失" |
| I2 同区非召唤怪剪影可辨 | 每区 min ≥ 0.20 | 0.20 对应"包围盒比例或填充率至少差 20%"，肉眼在 60px 下能分 |
| I3 同区非召唤怪主色不撞车 | 每区 min ≥ 15 RGB | 15 是"能看出两个色块不同"的下限，避免完全同色 |
| I4 玩家 + 三族代表剪影 | min ≥ 0.30 | 沿用第 5 轮公开阈值，不回退 |
| I5 玩家 + 三族代表主色 | min ≥ 25 RGB | 同上，保留族色语义 |
| I6 玩家 vs 任意敌人 | 剪影 ≥ 0.25 且主色 ≥ 25 | 玩家永远是画面焦点，略低于跨族阈值可接受（有专属剪影 + 动效 + 居中） |
| I7 重绘增益 | 最差剪影对提升 ≥ 0.08 | 证明不是"换皮"，而是真的把最差瓶颈抬起来 |
| I8 对照图 | before/after 尺寸一致、像素不同 | 同格位同尺寸，差异只来自绘制 |
| I9 同屏并排 | 玩家 + 三族各一只同房间，玩家每帧只画一次 | 真实场景可读性 + 不重复绘制 |

召唤怪（gearsplit→geargrind、mirrorghost→mirrorphantom）**故意与母体相似**，
属于玩法语义（分裂碎块 / 镜像分身），因此不参与"同区必须可辨"的统计；它们的配色也保持与母体一致。

## 4. 实现

单文件内新增两块，全部配置驱动、可整体回退：

1. `IDENTITY_CONFIG`（约 L31725）
   - `enabled`：总开关；`false` = 上一版"同族共用一种签名件"，即 before 对照组。
   - `variantOf`（按 `enemy.body`，不是 id）：每族四型签名件。
   - `overrides`：个别单位的额外几何（凝聚体收容环、符灵单长角、裂隙幼体双竖须）。
   - `verify`：上表阈值，验收脚本直接读取，不写死在测试里。
2. `drawSilhouetteFlare(family, r, t, color, body)` 增加 `body` 参数与三种新几何：
   - 机械 v3 尖肩（横梁两端上翘尖刺）
   - 符文 v3 光环（圆环 + 4 刻度，替代尖冠）
   - 虚空 v3 分叉触须 / `ring` 收容环
3. 配色去重（仅改色值，不改 AI / 数值）：
   `patrol #ffcf70`、`forgepriest #e8552f`、`hexer #d86bff`、`chanter #d98bff`、
   `runesprite #ff8fe0`、`cipher #b06bff`、`shardling #9fe8ff`、`riftling #5f8dff`、
   `screamer #9a5bff`、`voidbishop #c06bff`、`coalescer #5fffd8`。
4. 调试口 `__roamDebug.identity`：`info / setEnabled / units / readOne / sheet`。
   `sheet` 输出"玩家 1 行 + 三区各 1 行"的全单位对照图，before/after 格位一致。

绘制层只影响外观：碰撞半径、命中判定、AI 全部走原配置，未改动。

## 5. 证据

- 工具：`tools/arcane_identity.js`（端口 9543，串行运行）。
- `RESULT: PASS 10/10`，运行时异常 0。
- 图：`.screenshots/art/identity-before.png`、`identity-after.png`（1210×584，同尺寸）；
  `.screenshots/art/identity-scene-before.png`、`identity-scene-after.png`（1440×900 真实同屏）。
- 数据：`.screenshots/art/identity-result.json`（逐单位读数 + 全组合距离）、`identity-metrics.json`。

## 6. 风险 / 边界

- 阈值 0.20 与实测最差 0.224（riveter-gearsplit）余量偏薄；这两只是"窄双塔 vs 尖肩齿轮"，
  已属于真实几何差异。后续若再加敌人，必须重跑本工具，不能只看单帧截图。
- `sheet` 依赖 `drawUnitForSilhouette` 的离屏绘制；它会把 `ctx` 临时切走，
  工具与页面都做了 `try/finally` 还原，避免污染主画布。
- 本项只改"看到的形状"，不改平衡；敌人强度相关回归（enemies 33/33）已确认未受影响。
