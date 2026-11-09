# 无障碍量化数据表（自动生成，勿手改）

快照：2740252 B / 2290127 字符 / 63930 行 / MD5 BA68478FE49A6DFA25C8B3F4CD368FAC

## A. 文字对比度不达标全表

| 实测 | 门槛 | 位置（行） | 选择器 | 前景色（已合成） | 字号 | 判定底色 |
|---|---|---|---|---|---|---|
| **2.15:1** | 4.5:1 | L4617 | `#titleLayer .title-corner` | #4D5C73 (α0.62) | 9 | surface-3 |
| **3.1:1** | 4.5:1 | L1021 | `.mini-card.is-locked .m-name` | #5F7593 (α0.55) | 11 | surface-3 |
| **3.4:1** | 4.5:1 | L979 | `.mini-card .m-floor` | #697C97 (α0.55) | 继承 | surface-3 |
| **3.47:1** | 4.5:1 | L4593 | `#titleLayer .title-tool[aria-pressed="false"]` | #6D7D92 (α1.00) | 继承 | surface-3 |
| **3.7:1** | 4.5:1 | L1409 | `.spirit-line .spirit-tag` | #5587A1 (α0.50) | 10.5 | surface-3 |
| **3.92:1** | 4.5:1 | L1153 | `.card-tip .ct-foot` | #7286A1 (α0.62) | 10 | surface-3 |
| **3.92:1** | 4.5:1 | L1199 | `.fusion-bar.is-empty` | #7286A1 (α0.62) | 继承 | surface-3 |
| **3.98:1** | 4.5:1 | L4277 | `.engrave-empty` | #7C869C (α1.00) | 12 | surface-3 |
| **4.13:1** | 4.5:1 | L1974 | `.tal-locked` | #8D887D (α0.50) | 11.5 | surface-3 |
| **4.26:1** | 4.5:1 | L445 | `.floor-mod-row b.mod-avoid` | #FF3D6E (α1.00) | 继承 | surface-3 |
| **4.26:1** | 4.5:1 | L804 | `.map-bar .map-mod.mod-avoid` | #FF3D6E (α1.00) | 继承 | surface-3 |
| **4.48:1** | 4.5:1 | L4457 | `#titleLayer .title-stat span` | #7F90A8 (α1.00) | 9 | surface-3 |
| **4.48:1** | 4.5:1 | L4542 | `#titleLayer .title-difficulty-head` | #7F90A8 (α1.00) | 10 | surface-3 |
| **4.48:1** | 4.5:1 | L4601 | `#titleLayer .title-talents .talent-head h3` | #7F90A8 (α1.00) | 10 | surface-3 |

合计 **14** 条（检查了 437 个含 color 的规则，其余 423 条达标）。

## B. 字号低于线全表（CSS）

| 字号 | 门槛 | 条数 | 位置（行）与选择器 |
|---|---|---|---|
| 8.5px | 12px | 2 | L863 `.card-row.is-dense .m-key`<br>L965 `.mini-card .m-meta` |
| 9px | 12px | 11 | L1474 `.mini-card .m-fuse-badge`<br>L4381 `#titleLayer .title-kicker`<br>L4457 `#titleLayer .title-stat span`<br>L4570 `#titleLayer .difficulty-mode span`<br>L4612 `#titleLayer .title-talents .t-info span`<br>L4617 `#titleLayer .title-corner`<br>L4792 `.talent-page-head h2 em`<br>L4880 `.tal-cat`<br>L4881 `.tal-state`<br>L4891 `.tal-group-tag`<br>L4994 `.t-cat` |
| 9.5px | 12px | 2 | L664 `body.hud-compact .card-row.is-dense .m-name`<br>L719 `.dock-btn em` |
| 10px | 12px | 29 | L667 `body.hud-compact .fusion-note`<br>L671 `body.hud-compact .minimap-legend`<br>L718 `.dock-btn span`<br>L1122 `.card-tip .ct-rarity`<br>L1153 `.card-tip .ct-foot`<br>L1724 `.enemy-group > b em`<br>L2088 `.fusion-table tr.is-owned td.f-name::after`<br>L2303 `.tree-node .n-state`<br>L2379 `.wb-weapon`<br>L2457 `.tree-inspector .i-tag`<br>L3038 `.r-fuse-badge`<br>L3211 `.p1-bar-empty`<br>L3628 `.title-kicker .title-ver`<br>L4219 `.hud-readouts .hud-record > span`<br>L4303 `.mini-card .m-slot`<br>L4542 `#titleLayer .title-difficulty-head`<br>L4553 `#titleLayer .title-difficulty-head em`<br>L4580 `#titleLayer .title-tool`<br>L4601 `#titleLayer .title-talents .talent-head h3`<br>L4609 `#titleLayer .title-talents .crystal-count`<br>L4613 `#titleLayer .title-talents .t-buy`<br>L4803 `.tal-cap-label`<br>L4807 `.tal-cap-text`<br>L4850 `.tal-col-head span`<br>L4890 `.tal-detail`<br>L4903 `.tal-lv`<br>L4904 `.tal-buy`<br>L4930 `.tal-tip`<br>L4974 `.tal-lg` |
| 10.5px | 12px | 17 | L854 `.card-row.is-dense .m-name`<br>L1139 `.card-tip .ct-fuse .fx`<br>L1180 `.fusion-bar .fb-chip`<br>L1409 `.spirit-line .spirit-tag`<br>L1443 `.onboard-hint .ob-verb`<br>L1953 `.settings-author, .setting-author`<br>L1994 `.p1-fd-head`<br>L2002 `.p1-fd-tag`<br>L2367 `.wb-tag`<br>L2374 `.wb-note`<br>L2378 `.wb-tag-name`<br>L2380 `.wb-recipe`<br>L2928 `.reward-card.reward-relic-v2 .r-fam`<br>L2994 `.owned-strip .own-label`<br>L3074 `.reward-card .r-rarity`<br>L3315 `.run-epilogue .epi-head`<br>L3563 `.save-slot-row .slot-sub` |
| 11px | 12px | 118 | L248 `.brand .sub`<br>L272 `.readout > span`<br>L291 `.readout > b em`<br>L298 `.readout > i.readout-enemy`<br>L320 `.hud-record > span`<br>L364 `.floor-head`<br>L387 `.floor-num span`<br>L393 `.floor-theme`<br>L415 `.floor-row`<br>L428 `.floor-row b`<br>L451 `.tag-pips b`<br>L452 `.tag-pip`<br>L462 `.tag-pip b`<br>L495 `.fusion-pips b`<br>L516 `.bar-group .bar-label`<br>L527 `.bar-warn`<br>L601 `.btn kbd`<br>L765 `.intro-hint span`<br>L782 `.map-bar`<br>L805 `.map-legend`<br>L819 `.deck-title`<br>L828 `.deck-title i`<br>L847 `.card-row.is-dense .m-glyph`<br>L933 `.mini-card .m-sub`<br>L1021 `.mini-card.is-locked .m-name`<br>L1024 `.mini-card .m-key`<br>L1049 `.mini-card .m-ring i`<br>L1073 `.mini-card .m-fused`<br>L1130 `.card-tip .ct-line`<br>L1162 `.fusion-bar`<br>L1214 `.fslot`<br>L1253 `.fusion-note`<br>L1260 `.fusion-hint kbd, .deck-keys kbd`<br>L1268 `.deck-keys`<br>L1288 `.skill-chip span`<br>L1326 `.minimap-head`<br>L1337 `.minimap-legend`<br>L1761 `.rule-block h3 em`<br>L1773 `.rule-block kbd`<br>L1809 `.talent-box .crystal-count`<br>L1837 `.talent-row .t-info span`<br>L1838 `.talent-row .t-level`<br>L1844 `.talent-row .t-buy`<br>L1856 `.talent-note`<br>L1912 `.setting-row > b`<br>L1950 `.setting-note`<br>L2017 `.aim-mode`<br>L2083 `.fusion-table th`<br>L2106 `.help-card h3 em`<br>L2129 `.quickref li span`<br>L2130 `.help-card kbd, .help-note kbd`<br>L2143 `.help-note`<br>L2153 `.tree-progress`<br>L2181 `.tree-ready`<br>L2199 `.tree-ready .ready-chip`<br>L2240 `.tree-col-head`<br>L2295 `.tree-node .n-meta`<br>L2469 `.tree-inspector .i-stats`<br>L2476 `.tree-inspector .i-empty`<br>L2477 `.tree-legend`<br>L2524 `.setting-row .setting-hint`<br>L2538 `.settings-save p`<br>L2556 `.archive-cell span`<br>L2559 `.archive-ach-row`<br>L2711 `.modal-kicker`<br>L2758 `.modal-layer.is-reward .modal-sub`<br>L2824 `.reward-card .r-tag`<br>L2833 `.reward-card .r-key`<br>L2863 `.reward-card .r-result`<br>L2977 `.reward-card.reward-relic-v2 .r-result`<br>L3102 `.modal-note`<br>L3142 `.result-stat span`<br>L3162 `.result-hint`<br>L3195 `.p1-evidence-head`<br>L3221 `.p1-legend`<br>L3252 `.p1-detail`<br>L3298 `.tower-tag`<br>L3300 `.tower-meta`<br>L3326 `.bio-head`<br>L3348 `.victory-badge`<br>L3392 `.boss-title-sub`<br>L3507 `.title-lr-label`<br>L3513 `.title-lr-note`<br>L3535 `.title-seed-records`<br>L3670 `.title-stat span`<br>L3686 `.title-guide-title`<br>L3712 `.guide-item kbd`<br>L3745 `.title-difficulty-head`<br>L3771 `.difficulty-mode span`<br>L3806 `.btn-start kbd`<br>L3858 `.theme-chip span`<br>L3894 `.floor-wipe .wipe-text span`<br>L4065 `body.ui-v2 .floor-head span`<br>L4179 `.context-hint span`<br>L4220 `.hud-readouts .hud-record > b`<br>L4258 `.engrave-col-head`<br>L4267 `.engrave-item span`<br>L4268 `.engrave-item em`<br>L4293 `.od-label`<br>L4431 `#titleLayer .title-tagline`<br>L4611 `#titleLayer .title-talents .t-info b`<br>L4809 `.tal-wallet`<br>L4962 `.tal-respec-btn`<br>L4982 `.talent-open-btn`<br>L5108 `.reward-card .r-tag, .reward-card .r-rarity`<br>L5209 `.btn kbd, .btn-start kbd`<br>L5218 `#titleLayer .title-kicker .title-ver`<br>L5224 `#titleLayer .title-stat span`<br>L5242 `.readout > b em, .readout > i.readout-enemy`<br>L5261 `.dock-btn em`<br>L5270 `body.hud-compact .card-row.is-dense .m-name`<br>L5273 `.mini-card .m-key, .card-row.is-dense .m-key`<br>L5274 `.mini-card .m-meta`<br>L5275 `.mini-card .m-fuse-badge`<br>L5276 `.mini-card .m-slot`<br>L5288 `.setting-state, .setting-note, .setting-row .setting-hint`<br>L5289 `.settings-author, .setting-author`<br>L5305 `.save-slot-row .slot-sub` |
| 11.5px | 12px | 8 | L1974 `.tal-locked`<br>L2351 `.tree-weapon-bridge`<br>L2761 `.modal-layer.is-reward .reward-card .r-desc`<br>L2961 `.reward-card.reward-relic-v2 .r-syn`<br>L3000 `.owned-strip .own-chip`<br>L3023 `.reward-card .r-fuse`<br>L3302 `.tower-context`<br>L3317 `.run-epilogue .epi-last` |

合计 **187** 条低于线（共检查 203 条 <12px 声明）。

## C. Canvas 字号

| 字号 | 行 | 字体串 |
|---|---|---|
| 11px | L7080 | `700 11px "Segoe UI", system-ui, sans-serif` |
| 10px | L13310 | `bold 10px "Microsoft YaHei UI", sans-serif` |
| 8px | L13396 | `bold 8px "Microsoft YaHei UI", sans-serif` |
| 6px | L13399 | `6px "Microsoft YaHei UI", sans-serif` |
| 11px | L18947 | `bold 11px "Microsoft YaHei UI", "Segoe UI", sans-serif` |
| 9px | L19000 | `bold 9px "Microsoft YaHei UI", "Segoe UI", sans-serif` |
| 11px | L19031 | `bold 11px "Microsoft YaHei UI", "Segoe UI", sans-serif` |
| 11px | L19181 | `bold 11px "Microsoft YaHei UI", "Segoe UI", sans-serif` |
| 11px | L19186 | `bold 11px "Microsoft YaHei UI", "Segoe UI", sans-serif` |
| 10px | L19189 | `10px "Microsoft YaHei UI", "Segoe UI", sans-serif` |
| 10px | L19197 | `bold 10px "Microsoft YaHei UI", "Segoe UI", sans-serif` |
| 10px | L19203 | `10px "Microsoft YaHei UI", "Segoe UI", sans-serif` |
| 10px | L25688 | `600 10px "Microsoft YaHei", sans-serif` |
| 11px | L26787 | `11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |
| 10px | L28572 | `10px "Cascadia Mono", Consolas, monospace` |
| 11px | L30264 | `bold 11px "Cascadia Mono", Consolas, monospace` |
| 11px | L32302 | `11px "Microsoft YaHei", sans-serif` |
| 11px | L32419 | `11px "JetBrains Mono", Consolas, monospace` |
| 10px | L34488 | `10px "Microsoft YaHei", sans-serif` |
| 10px | L35186 | `700 10px "Microsoft YaHei", sans-serif` |
| 11px | L35214 | `700 11px "Microsoft YaHei", sans-serif` |
| 11px | L35222 | `600 11px "Microsoft YaHei", sans-serif` |
| 9px | L43771 | `bold 9px "Microsoft YaHei", sans-serif` |
| 8px | L43774 | `8px "Microsoft YaHei", sans-serif` |
| 9px | L47099 | `600 9px "Microsoft YaHei", sans-serif` |
| 10px | L47186 | `10px "JetBrains Mono", Consolas, monospace` |
| 11px | L52248 | `11px "Segoe UI", sans-serif` |
| 11px | L52430 | `bold 11px "Microsoft YaHei UI", "Segoe UI", sans-serif` |
| 11px | L52791 | `bold 11px "Microsoft YaHei UI", "Segoe UI", sans-serif` |
| 11px | L63613 | `11px sans-serif` |
| 10px | L63719 | `10px sans-serif` |

## D. 色盲三型 ΔE00（CIEDE2000，sRGB 线性空间模拟）

| 语义对 | 正常 | 红色盲 P | 绿色盲 D | 蓝色盲 T | 判定（最差） |
|---|---|---|---|---|---|
| 敌人血条 vs 玩家血条起 | 14.7 | 11.7 | 6.9 | 5.4 | 不可分 |
| 敌人血条 vs 玩家血条终(拾取金) | 43.6 | 25.2 | 16.6 | 17.1 | 可分 |
| 敌人血条 vs 奥能球(青) | 74.7 | 34.4 | 43.7 | 62.5 | 可分 |
| 危险预警环 vs 玩家血条终(拾取金) | 44.2 | 25.5 | 15.8 | 20.4 | 可分 |
| 危险预警环 vs 奥能球(青) | 77.2 | 39 | 46.9 | 64.5 | 可分 |
| 危险预警环 vs 治疗(绿) | 76.9 | 21.9 | 13.4 | 60.6 | 可分 |
| 精英环(暖金) vs 敌人血条 | 38.5 | 23 | 13.9 | 22.9 | 可分 |
| 精英环(暖金) vs 危险预警环 | 39.8 | 24.5 | 15 | 26 | 可分 |
| 精英环(暖金) vs 玩家血条终(拾取金) | 9.8 | 10 | 9.7 | 6.5 | 边缘 |
| 玩家血条起 vs 玩家血条终(拾取金) | 28.4 | 14.8 | 10.1 | 11.9 | 可分 |
| 警告橙 vs 玩家血条终(拾取金) | 4.4 | 2.3 | 1.6 | 2.3 | 不可分 |
| 稀有蓝 vs 史诗紫 | 27.6 | 6.3 | 0.1 | 31.2 | 不可分 |
| 普通灰 vs 稀有蓝 | 14.5 | 15 | 16.1 | 16 | 可分 |
| 冰霜 vs 雷电 | 4.4 | 4.1 | 4 | 2.8 | 不可分 |
| 冰霜 vs 奥能球(青) | 9 | 2.9 | 0.8 | 5.1 | 不可分 |
| 连锁绿 vs 治疗(绿) | 17.1 | 15.6 | 19 | 9 | 边缘 |
| 控制紫 vs 史诗紫 | 6.9 | 2.7 | 4.7 | 20.2 | 不可分 |
| 灼烧橙 vs 玩家血条终(拾取金) | 18.5 | 9.4 | 6.4 | 8.9 | 边缘 |
| 淬毒绿 vs 治疗(绿) | 18.2 | 15 | 19 | 12.7 | 可分 |

## E. 语义色在画布地面上的对比度（图形门槛 3:1）

| 语义 | 颜色 | 地面 #12233A | 暗地面 #0A1524 | 判定 |
|---|---|---|---|---|
| 敌人血条 | #FF6B7F | 5.77:1 | 6.69:1 | 达标 |
| 危险预警环 | #FF5A6E | 5.23:1 | 6.06:1 | 达标 |
| 玩家血条起 | #FF8A6B | 6.86:1 | 7.94:1 | 达标 |
| 玩家血条终(拾取金) | #FFC247 | 9.84:1 | 11.4:1 | 达标 |
| 奥能球(青) | #3EE6FF | 10.52:1 | 12.19:1 | 达标 |
| 治疗(绿) | #47E8A7 | 10.07:1 | 11.67:1 | 达标 |
| 警告橙 | #FFB84D | 9.2:1 | 10.66:1 | 达标 |
| 精英环(暖金) | #FFD696 | 11.54:1 | 13.36:1 | 达标 |
| 精英环外(橙红) | #FF785A | 6.09:1 | 7.06:1 | 达标 |
| 魔法紫 | #B085FF | 5.76:1 | 6.67:1 | 达标 |
| 稀有蓝 | #4AA8FF | 6.28:1 | 7.28:1 | 达标 |
| 史诗紫 | #B47CFF | 5.48:1 | 6.34:1 | 达标 |
| 普通灰 | #9FB0C8 | 7.17:1 | 8.31:1 | 达标 |
| 冰霜 | #7FD8FF | 9.92:1 | 11.49:1 | 达标 |
| 雷电 | #8FE4FF | 11.08:1 | 12.84:1 | 达标 |
| 连锁绿 | #9CFF5E | 12.72:1 | 14.73:1 | 达标 |
| 控制紫 | #8F7BFF | 4.86:1 | 5.63:1 | 达标 |
| 灼烧橙 | #FF9A5A | 7.55:1 | 8.75:1 | 达标 |
| 淬毒绿 | #B6FF6B | 13.19:1 | 15.28:1 | 达标 |

## F. 循环动画与高频闪烁

| 频率 | 行 | 选择器 | 声明 |
|---|---|---|---|
| 1.11Hz | L574 | `.bar.is-low > i` | lowPulse 0.9s ease-in-out infinite |
| 0.91Hz | L983 | `.mini-card.is-partner` | partnerPulse 1.1s ease-in-out infinite |
| 0.67Hz | L220 | `.danger-layer.is-on` | dangerPulse 1.5s ease-in-out infinite |
| 0.63Hz | L1255 | `.fusion-hint.is-ready` | readyGlow 1.6s ease-in-out infinite |
| 0.45Hz | L2330 | `.tree-node.is-ready` | treeReadyPulse 2.2s ease-in-out infinite |
| 0.36Hz | L3279 | `.tower-orb` | towerPulse 2.8s ease-in-out infinite |

JS 侧 >3Hz 振荡：

| 频率 | 行 | 表达式 |
|---|---|---|
| 4.14Hz | L34150 | `Math.sin(t * 26…` |
| 3.02Hz | L35833 | `Math.sin(t * 19…` |
| 3.66Hz | L35834 | `Math.cos(t * 23…` |
