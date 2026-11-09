# M1-3 任务清单（已全部完成并验证）

> 只改 `index_arcane_v2.html`（T7 清单除外）。

## T0 备份与基线（完成）
- [x] 生成 `index_arcane_v2.bak_20261103_m13.html`
- [x] 记录基线：m12 27/27、verify 34/34、flow3 38/38、p1a 39/39、facing 23/23、fusion 78/78、体检 issues=0

## T1 配置与状态（完成）
- [x] `RARITY_CONFIG` / `REWARD_RARITY` / `REWARD_CONFIG` 进配置区
- [x] 12 张魔法 / 科技卡补 `rarity` 字段（普通 5 / 稀有 5 / 史诗 2）
- [x] `createInitialState` 增加 `rewardStage / fusionPity / floorGotFusion`
- **验收**：`__roamDebug.rarityConfig()` 返回 55/35/10

## T2 技能段：过滤 + 权重 + 稀有度（完成）
- [x] `buildRewardOptions('skill')` 只收魔法 / 科技 / 融合，剔除已持有
- [x] `pickWeightedOptions` 按稀有度权重不放回抽 3 张
- [x] 每张写入 `rarity` 字段，卡面同步角标
- **验收**：200 次抽样 3 张 / 不重复 / 无遗物 / 三档均出现

## T3 融合保底（完成）
- [x] `fusionPity >= 4` 时强制替换一张为可融合配方
- [x] 无可融合配方时用 `findFusionEnablingModule` 补「只差一张」模块
- [x] 都没有才保留补给
- **验收**：`pity=4 + 全模块` 必现 fusion；`pity=4 + 仅火球` 出现「补上它即可凑出融合」

## T4 被动段（独立弹窗，完成）
- [x] `openPassiveReward()` + `rewardStage='passive'`
- [x] 技能段选完自动进入被动段并保留弹窗
- [x] 被动段选完关闭回 playing 并结算 pity
- **验收**：阶段 / 池类型 / ×1.12 生效 / 回 playing 四项

## T5 弹窗 UI 与稀有度（完成）
- [x] 阶段化 kicker / 标题 / 副标题 / 底部说明（含保底进度）
- [x] `.r-rarity` 角标 + 三档边框颜色
- **验收**：1280/1920 × 100%/125% 三卡同 top、inside、covered=0、overflow=0

## T6 专项 + 回归 + 体检（完成）
- [x] `%TEMP%\arcane_m13.js` 26 条断言
- [x] 更新 verify / flow3 / p1a / m12 收奖励为「循环选到 playing」
- [x] 五项回归 + m12 全绿；facing 偶发 flake 已定位为敌人击退，测试先清场后稳定
- [x] 6 视口 × 8 状态（新增被动段）体检：issues=0，截图 48 张
- **验收**：26/26 + 全回归 + issues=0 + fps 120 + `__errors` 空

## T7 清单收敛（完成）
- [x] 清单三条改 `[x]` 附证据
- [x] 自检无 `[~]`
