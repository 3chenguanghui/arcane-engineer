# skill-feel-v1 硬约束核对清单

- [x] 改前备份 `backup/index-pre-skillfeel.html`：2,947,258 B / `ADE53A18E96D758E531B5C53BB8FB13E`
- [x] 主文件开工指纹与调度台基线一致（2,947,258 B / `ADE53A18…`）
- [x] `tools/sim_panel/sim.js` MD5 未变：`3051C033CB3C00AA86718E491740CA50`
- [x] `tools/sim_panel/config.js` MD5 未变：`6CA6E486DB5AA35FA20CD4A54ADD3052`
- [x] 不新增随机数：新增代码块 `rand(` / `Math.random` 实测 **0**（4 个切片全部 CLEAN）
- [x] 音效调用次数不增不减（只改既有 `playSfx` 实参 / 音色名）
- [x] `MAGIC_CONFIG` 的 cost / cooldown / damage / heal / rarity 未改
- [x] D2 / D4 已验基线未触碰（本批没有进奖励池、没有改房间权重）
- [x] 未引用外部新资源（`skill-fx.js` 不参与，全部内联）
- [x] `tools/arcane_syntax.js` → `RESULT: PASS`（2 chunk OK）
- [x] 页面启动 → `BOOT: PASS`，runtime error 0
- [x] 专项探针 `tools/skill_sig_probe.js` → **16/16 PASS / VERDICT: PASS**
- [x] 光环软上限：300 枚注入后 `updateEffects` 收敛到 120
- [x] 连续 60 次施法峰值环数 36 ≤ 120（无累积）
- [x] reduced-motion：签名环 1 枚、`grow = 0`、`life = 0.22`
- [x] 命中飘字归属色：`#ff8a3d`（火球）实测命中
- [x] 三项分别上报（手感 / 可读性表 / 体检表 + 前 2 项）

## 最终指纹

```
SIZE = 2,967,364 B
MD5  = CF0425AA1F17EA76394955E7617AC69F
```

## 回滚

```powershell
Copy-Item backup\index-pre-skillfeel.html index_arcane_v2.html -Force
```
