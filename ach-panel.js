/* ============================================================
   烬 · 成就面板 v1.0 · ach-panel.js
   ------------------------------------------------------------
   职责：
     1) 内置 achievements.json 的 38 条成就数据（只读，不写回）；
     2) 渲染标题栏（总数 / 已完成 / 完成率环）、分类页签、卡片网格；
     3) 提供 progress / completedAt 外部接口，按「当前值 ≥ 目标」判定完成；
     4) 卡片详情、排序、只看未完成、三种演示状态；
     5) ?ach=off 时整体关闭，不创建任何 DOM；
     6) 奖励数值按主文件上限口径结算「实际到手」，不显示名义值。
   依赖：0。零外部请求，file:// 双击可用。
   注意：不修改 index_arcane_v2.html，挂到哪个容器由接入方决定。
   ============================================================ */
(function (global) {
  'use strict';

  var VERSION = '1.1.0';

  /* ------------------------------------------------------------
     成就数据：来自 achievements.json（38 条）
     字段说明：
       id/category/name/desc/hidden/metric/target/targetRef/
       existing/field/trigger/counterStatus/reward
     本模块只读这些字段，不写回、不改主文件存档。
     ------------------------------------------------------------ */
  var ACH_DATA = [
  {
    "id": "first_kill",
    "category": "combat",
    "name": "初次拆解",
    "desc": "累计击杀 1 只构装",
    "hidden": false,
    "existing": true,
    "metric": "kills",
    "target": 1,
    "targetRef": "",
    "field": "meta.stats.kills",
    "trigger": "metaMetricValue('kills') >= 1",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "kills_100",
    "category": "combat",
    "name": "拆解专家",
    "desc": "累计击杀 100 只构装",
    "hidden": false,
    "existing": true,
    "metric": "kills",
    "target": 100,
    "targetRef": "",
    "field": "meta.stats.kills",
    "trigger": "metaMetricValue('kills') >= 100",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "elite_50",
    "category": "combat",
    "name": "精英猎手",
    "desc": "累计击杀 50 只精英",
    "hidden": false,
    "existing": true,
    "metric": "eliteKills",
    "target": 50,
    "targetRef": "",
    "field": "meta.stats.eliteKills",
    "trigger": "metaMetricValue('eliteKills') >= 50",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "boss_kills_1",
    "category": "combat",
    "name": "首个首领",
    "desc": "累计击败 1 名首领",
    "hidden": false,
    "existing": true,
    "metric": "bossKills",
    "target": 1,
    "targetRef": "",
    "field": "meta.stats.bossKills",
    "trigger": "metaMetricValue('bossKills') >= 1",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "boss_kills_5",
    "category": "combat",
    "name": "首领终结者",
    "desc": "累计击败 5 名首领",
    "hidden": false,
    "existing": true,
    "metric": "bossKills",
    "target": 5,
    "targetRef": "",
    "field": "meta.stats.bossKills",
    "trigger": "metaMetricValue('bossKills') >= 5",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "first_win",
    "category": "combat",
    "name": "首次通关",
    "desc": "击倒最终首领完成一局",
    "hidden": false,
    "existing": true,
    "metric": "clears",
    "target": 1,
    "targetRef": "",
    "field": "meta.clears",
    "trigger": "metaMetricValue('clears') >= 1",
    "counterStatus": "已有",
    "reward": {
      "cards": 1
    }
  },
  {
    "id": "combo_16",
    "category": "combat",
    "name": "连锁初成",
    "desc": "单次连击峰值达到 16",
    "hidden": false,
    "existing": true,
    "metric": "comboPeak",
    "target": 16,
    "targetRef": "",
    "field": "meta.bestCombo",
    "trigger": "metaMetricValue('comboPeak') >= 16",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "combo_30",
    "category": "combat",
    "name": "连锁大师",
    "desc": "单次连击峰值达到 30",
    "hidden": false,
    "existing": true,
    "metric": "comboPeak",
    "target": 30,
    "targetRef": "",
    "field": "meta.bestCombo",
    "trigger": "metaMetricValue('comboPeak') >= 30",
    "counterStatus": "已有",
    "reward": {
      "aether": 2
    }
  },
  {
    "id": "flawless_1",
    "category": "combat",
    "name": "滴水不漏",
    "desc": "无伤清空 1 层",
    "hidden": false,
    "existing": true,
    "metric": "flawlessFloors",
    "target": 1,
    "targetRef": "",
    "field": "meta.stats.flawlessFloors",
    "trigger": "metaMetricValue('flawlessFloors') >= 1",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "flawless_5",
    "category": "combat",
    "name": "毫发无伤",
    "desc": "无伤清空 5 层",
    "hidden": false,
    "existing": true,
    "metric": "flawlessFloors",
    "target": 5,
    "targetRef": "",
    "field": "meta.stats.flawlessFloors",
    "trigger": "metaMetricValue('flawlessFloors') >= 5",
    "counterStatus": "已有",
    "reward": {
      "aether": 2
    }
  },
  {
    "id": "deaths_5",
    "category": "combat",
    "name": "屡败屡战",
    "desc": "累计死亡 5 次",
    "hidden": false,
    "existing": true,
    "metric": "deaths",
    "target": 5,
    "targetRef": "",
    "field": "meta.stats.deaths",
    "trigger": "metaMetricValue('deaths') >= 5",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "floor_3",
    "category": "exploration",
    "name": "下潜三层",
    "desc": "最高到达第 3 层",
    "hidden": false,
    "existing": true,
    "metric": "bestFloor",
    "target": 3,
    "targetRef": "",
    "field": "meta.bestFloor",
    "trigger": "metaMetricValue('bestFloor') >= 3",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "floor_5",
    "category": "exploration",
    "name": "抵达终章",
    "desc": "最高到达第 5 层",
    "hidden": false,
    "existing": true,
    "metric": "bestFloor",
    "target": 5,
    "targetRef": "",
    "field": "meta.bestFloor",
    "trigger": "metaMetricValue('bestFloor') >= 5",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "floor_8",
    "category": "exploration",
    "name": "深井常客",
    "desc": "最高到达第 8 层",
    "hidden": false,
    "existing": true,
    "metric": "bestFloor",
    "target": 8,
    "targetRef": "",
    "field": "meta.bestFloor",
    "trigger": "metaMetricValue('bestFloor') >= 8",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "hidden_room_1",
    "category": "exploration",
    "name": "墙后有人",
    "desc": "首次进入隐藏房",
    "hidden": false,
    "existing": true,
    "metric": "hiddenRooms",
    "target": 1,
    "targetRef": "",
    "field": "meta.stats.hiddenRooms",
    "trigger": "metaMetricValue('hiddenRooms') >= 1",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "void_rift_1",
    "category": "exploration",
    "name": "裂隙旅人",
    "desc": "首次使用虚空裂隙",
    "hidden": false,
    "existing": true,
    "metric": "voidRifts",
    "target": 1,
    "targetRef": "",
    "field": "meta.stats.voidRifts",
    "trigger": "metaMetricValue('voidRifts') >= 1",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "run_recipes_5",
    "category": "build",
    "name": "一局配方通",
    "desc": "单局发现 5 条融合配方",
    "hidden": false,
    "existing": true,
    "metric": "runRecipes",
    "target": 5,
    "targetRef": "",
    "field": "meta.bestRunRecipes",
    "trigger": "metaMetricValue('runRecipes') >= 5",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "single_school",
    "category": "build",
    "name": "专精一路",
    "desc": "只用同一流派（≥2 张不同魔法）通关",
    "hidden": false,
    "existing": true,
    "metric": "singleSchoolClears",
    "target": 1,
    "targetRef": "",
    "field": "meta.stats.singleSchoolClears",
    "trigger": "metaMetricValue('singleSchoolClears') >= 1",
    "counterStatus": "已有",
    "reward": {
      "aether": 2
    }
  },
  {
    "id": "recipe_3",
    "category": "build",
    "name": "配方猎手",
    "desc": "累计发现 3 条融合配方",
    "hidden": false,
    "existing": true,
    "metric": "recipes",
    "target": 3,
    "targetRef": "",
    "field": "meta.recipes.length",
    "trigger": "metaMetricValue('recipes') >= 3",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "recipe_all",
    "category": "build",
    "name": "配方全图鉴",
    "desc": "累计发现全部融合配方",
    "hidden": false,
    "existing": true,
    "metric": "recipes",
    "target": 13,
    "targetRef": "FUSION_CONFIG.length",
    "field": "meta.recipes.length",
    "trigger": "metaMetricValue('recipes') >= FUSION_CONFIG.length",
    "counterStatus": "已有",
    "reward": {
      "aether": 2
    }
  },
  {
    "id": "blueprint_1",
    "category": "build",
    "name": "蓝图收藏家",
    "desc": "解锁 1 张首领蓝图",
    "hidden": false,
    "existing": true,
    "metric": "blueprints",
    "target": 1,
    "targetRef": "",
    "field": "meta.bossBlueprints.length",
    "trigger": "metaMetricValue('blueprints') >= 1",
    "counterStatus": "已有",
    "reward": {
      "aether": 1
    }
  },
  {
    "id": "blueprint_all",
    "category": "build",
    "name": "蓝图集齐",
    "desc": "解锁全部首领蓝图",
    "hidden": false,
    "existing": true,
    "metric": "blueprints",
    "target": 3,
    "targetRef": "BOSS_BLUEPRINT_CONFIG.blueprints.length",
    "field": "meta.bossBlueprints.length",
    "trigger": "metaMetricValue('blueprints') >= BOSS_BLUEPRINT_CONFIG.blueprints.length",
    "counterStatus": "已有",
    "reward": {
      "aether": 2
    }
  },
  {
    "id": "kills_1000",
    "category": "combat",
    "name": "千机散架",
    "desc": "累计击杀 1000 只构装",
    "hidden": false,
    "existing": false,
    "metric": "kills",
    "target": 1000,
    "targetRef": "",
    "field": "meta.stats.kills",
    "trigger": "metaMetricValue('kills') >= 1000",
    "counterStatus": "已有",
    "reward": {}
  },
  {
    "id": "elite_200",
    "category": "combat",
    "name": "精英坟场",
    "desc": "累计击杀 200 只精英",
    "hidden": false,
    "existing": false,
    "metric": "eliteKills",
    "target": 200,
    "targetRef": "",
    "field": "meta.stats.eliteKills",
    "trigger": "metaMetricValue('eliteKills') >= 200",
    "counterStatus": "已有",
    "reward": {}
  },
  {
    "id": "boss_20",
    "category": "combat",
    "name": "首领名录",
    "desc": "累计击败 20 名首领",
    "hidden": false,
    "existing": false,
    "metric": "bossKills",
    "target": 20,
    "targetRef": "",
    "field": "meta.stats.bossKills",
    "trigger": "metaMetricValue('bossKills') >= 20",
    "counterStatus": "已有",
    "reward": {}
  },
  {
    "id": "combo_50",
    "category": "combat",
    "name": "连锁成瘾",
    "desc": "单次连击峰值达到 50",
    "hidden": false,
    "existing": false,
    "metric": "comboPeak",
    "target": 50,
    "targetRef": "",
    "field": "meta.bestCombo",
    "trigger": "metaMetricValue('comboPeak') >= 50",
    "counterStatus": "已有",
    "reward": {}
  },
  {
    "id": "floor_12",
    "category": "exploration",
    "name": "塔心回响",
    "desc": "最高到达第 12 层",
    "hidden": false,
    "existing": false,
    "metric": "bestFloor",
    "target": 12,
    "targetRef": "",
    "field": "meta.bestFloor",
    "trigger": "metaMetricValue('bestFloor') >= 12",
    "counterStatus": "已有",
    "reward": {}
  },
  {
    "id": "floor_20",
    "category": "exploration",
    "name": "深井尽头",
    "desc": "最高到达第 20 层",
    "hidden": false,
    "existing": false,
    "metric": "bestFloor",
    "target": 20,
    "targetRef": "",
    "field": "meta.bestFloor",
    "trigger": "metaMetricValue('bestFloor') >= 20",
    "counterStatus": "已有",
    "reward": {}
  },
  {
    "id": "daily_clear",
    "category": "exploration",
    "name": "今日签收",
    "desc": "通关任意一次每日挑战",
    "hidden": false,
    "existing": false,
    "metric": "dailyCleared",
    "target": 1,
    "targetRef": "",
    "field": "meta.seedRuns[*].daily / cleared",
    "trigger": "Object.keys(meta.seedRuns).some(k => meta.seedRuns[k].daily && meta.seedRuns[k].cleared)",
    "counterStatus": "需新增口径",
    "reward": {}
  },
  {
    "id": "codex_enemies_all",
    "category": "exploration",
    "name": "名录补全",
    "desc": "图鉴敌人条目全部解锁",
    "hidden": false,
    "existing": false,
    "metric": "codexEnemies",
    "target": 33,
    "targetRef": "ENEMY_CONFIG.length",
    "field": "meta.codex.enemies.length",
    "trigger": "metaMetricValue('codexEnemies') >= ENEMY_CONFIG.length",
    "counterStatus": "需新增口径",
    "reward": {}
  },
  {
    "id": "relics_10",
    "category": "build",
    "name": "拾荒成性",
    "desc": "图鉴遗物解锁 10 件",
    "hidden": false,
    "existing": false,
    "metric": "codexRelics",
    "target": 10,
    "targetRef": "",
    "field": "meta.codex.relics.length",
    "trigger": "metaMetricValue('codexRelics') >= 10",
    "counterStatus": "需新增口径",
    "reward": {}
  },
  {
    "id": "cards_all",
    "category": "build",
    "name": "卡池见底",
    "desc": "图鉴卡牌条目全部解锁",
    "hidden": false,
    "existing": false,
    "metric": "codexCards",
    "target": 20,
    "targetRef": "MAGIC_CONFIG.length + TECH_CONFIG.length",
    "field": "meta.codex.cards.length",
    "trigger": "metaMetricValue('codexCards') >= MAGIC_CONFIG.length + TECH_CONFIG.length",
    "counterStatus": "需新增口径",
    "reward": {}
  },
  {
    "id": "talents_30",
    "category": "build",
    "name": "天赋满墙",
    "desc": "累计投入 30 级天赋",
    "hidden": false,
    "existing": false,
    "metric": "talentLevels",
    "target": 30,
    "targetRef": "",
    "field": "sum(meta.talents)",
    "trigger": "metaMetricValue('talentLevels') >= 30",
    "counterStatus": "需新增口径",
    "reward": {}
  },
  {
    "id": "single_school_3",
    "category": "build",
    "name": "一路到底",
    "desc": "同一流派通关 3 次",
    "hidden": false,
    "existing": false,
    "metric": "singleSchoolClears",
    "target": 3,
    "targetRef": "",
    "field": "meta.stats.singleSchoolClears",
    "trigger": "metaMetricValue('singleSchoolClears') >= 3",
    "counterStatus": "已有",
    "reward": {}
  },
  {
    "id": "wager_3",
    "category": "hidden",
    "name": "三押三中",
    "desc": "赌注房累计获胜 3 次",
    "hidden": true,
    "existing": false,
    "metric": "wagerWins",
    "target": 3,
    "targetRef": "",
    "field": "meta.eventStats.wagerWins",
    "trigger": "metaMetricValue('wagerWins') >= 3",
    "counterStatus": "需新增口径",
    "reward": {}
  },
  {
    "id": "sacrifice_5",
    "category": "hidden",
    "name": "血本无归",
    "desc": "献祭房累计献祭 5 次",
    "hidden": true,
    "existing": false,
    "metric": "sacrifices",
    "target": 5,
    "targetRef": "",
    "field": "meta.eventStats.sacrifice",
    "trigger": "metaMetricValue('sacrifices') >= 5",
    "counterStatus": "需新增口径",
    "reward": {}
  },
  {
    "id": "barrel_20",
    "category": "hidden",
    "name": "桶边常客",
    "desc": "累计用爆桶击杀 20 只敌人",
    "hidden": true,
    "existing": false,
    "metric": "barrelKills",
    "target": 20,
    "targetRef": "",
    "field": "meta.stats.barrelKills（当前不存在）",
    "trigger": "metaMetricValue('barrelKills') >= 20",
    "counterStatus": "需新增计数器",
    "reward": {}
  },
  {
    "id": "challenge_10",
    "category": "hidden",
    "name": "无阶可退",
    "desc": "以挑战等级 10 通关一次",
    "hidden": true,
    "existing": false,
    "metric": "challenge10Clears",
    "target": 1,
    "targetRef": "",
    "field": "meta.challengeCleared['10']",
    "trigger": "metaMetricValue('challenge10Clears') >= 1",
    "counterStatus": "需新增口径",
    "reward": {}
  }
];

  /* ------------------------------------------------------------
     奖励结算口径（与主文件 META_PROGRESS_CONFIG 对齐）
     ------------------------------------------------------------
     · 主文件 maxAetherReward 现为 26（index_arcane_v2.html 第 16016 行），
       maxCardReward 为 1；旧值 12 会把第 13 点以后的奖励静默夹成 0。
     · achievements.json 的 notes 曾写「现有 22 条 aether 合计 23」，
       逐条实算是 21 条带 aether、合计 26；另有 1 条只给起手卡（first_win）。
       这里在加载时按数据重算，面板不再引用任何过期合计。
     ------------------------------------------------------------ */
  var MAX_AETHER_REWARD = 26;
  var MAX_CARD_REWARD = 1;
  var REWARD_TOTALS = ACH_DATA.reduce(function (acc, item) {
    var r = item.reward || {};
    if (Number(r.aether) > 0) { acc.aether += Number(r.aether); acc.aetherCount += 1; }
    if (Number(r.cards) > 0) { acc.cards += Number(r.cards); acc.cardsCount += 1; }
    return acc;
  }, { aether: 0, aetherCount: 0, cards: 0, cardsCount: 0 });

  /* 隐藏成就的模糊线索：只给氛围，不直接写死条件 */
  var HIDDEN_CLUES = {
    wager_3: '赌桌会记住连赢的手气。',
    sacrifice_5: '有些交换，需要付出不止一次。',
    barrel_20: '爆炸边缘，最容易散架。',
    challenge_10: '把所有退路都关掉之后，再赢一次。'
  };

  /* 分类：名称 / 颜色 / 图标（图标为内联 SVG，零请求） */
  var CATEGORY = {
    combat: {
      label: '战斗',
      color: '#ff8a3d',
      soft: 'rgba(255, 138, 61, .16)',
      line: 'rgba(255, 138, 61, .34)',
      icon: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M4 20 17.6 6.4M14.2 4.2l5.6 5.6M6.8 17.2l-2.6 2.6"/></g>'
    },
    exploration: {
      label: '探索',
      color: '#77aaff',
      soft: 'rgba(119, 170, 255, .16)',
      line: 'rgba(119, 170, 255, .34)',
      icon: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="12" cy="12" r="8.4"/><path d="M15.6 8.4l-2 5.2-5.2 2 2-5.2z"/></g>'
    },
    build: {
      label: '构筑',
      color: '#b085ff',
      soft: 'rgba(176, 133, 255, .16)',
      line: 'rgba(176, 133, 255, .38)',
      icon: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M12 3.4 20 7.6 12 12 4 7.6z"/><path d="M4 12.2l8 4.4 8-4.4"/><path d="M4 16.6l8 4.4 8-4.4"/></g>'
    },
    hidden: {
      label: '隐藏',
      color: '#ffc247',
      soft: 'rgba(255, 194, 71, .16)',
      line: 'rgba(255, 194, 71, .38)',
      icon: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.4"/></g>'
    }
  };

  /* 稀有度：与 ui-kit §7.2 同值；史诗小字单独用 #c9a6ff */
  var RARITY = {
    common: { label: '普通', rank: 1, color: '#9fb0c8', line: 'rgba(159, 176, 200, .34)', text: '#9fb0c8' },
    rare: { label: '稀有', rank: 2, color: '#4aa8ff', line: 'rgba(74, 168, 255, .46)', text: '#4aa8ff' },
    epic: { label: '史诗', rank: 3, color: '#b47cff', line: 'rgba(180, 124, 255, .55)', text: '#c9a6ff' },
    relic: { label: '遗物', rank: 4, color: '#ffc247', line: 'rgba(255, 194, 71, .55)', text: '#ffc247' }
  };

  /* 稀有度规则：纯展示口径，不写进数据；外部可在条目上加 rarity 覆盖 */
  var RARITY_OVERRIDE = {
    kills_100: 'epic', kills_1000: 'epic', elite_200: 'epic',
    recipe_all: 'epic', blueprint_all: 'epic',
    codex_enemies_all: 'epic', cards_all: 'epic',
    combo_50: 'rare', boss_20: 'rare', floor_20: 'rare',
    talents_30: 'rare', relics_10: 'rare',
    wager_3: 'relic', sacrifice_5: 'relic', barrel_20: 'relic', challenge_10: 'relic'
  };

  /* 图标：勾选 / 关闭（自绘，不用 emoji、不用字体） */
  var MEDAL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor"'
    + ' stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.4l4.2 4.2L19 7"/></g></svg>';
  var CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></g></svg>';

  var CATEGORY_ORDER = { combat: 0, exploration: 1, build: 2, hidden: 3 };

  /* 卡片上的「人话版条件」：只用于展示，详情里仍给完整 trigger 原文 */
  var METRIC_LABEL = {
    kills: '击杀构装', eliteKills: '击杀精英', bossKills: '击败首领', clears: '通关次数',
    comboPeak: '连击峰值', flawlessFloors: '无伤层数', deaths: '死亡次数', bestFloor: '最高层数',
    hiddenRooms: '隐藏房', voidRifts: '虚空裂隙', dailyCleared: '每日挑战通关',
    codexEnemies: '图鉴敌人', runRecipes: '单局配方', recipes: '累计配方',
    singleSchoolClears: '同流派通关', blueprints: '首领蓝图', codexRelics: '图鉴遗物',
    codexCards: '图鉴卡牌', talentLevels: '天赋等级', wagerWins: '赌桌连胜',
    sacrifices: '献祭次数', barrelKills: '爆桶击杀', challenge10Clears: '十层挑战'
  };

  /**
   * 生成卡片上的人话条件。
   * @param {Object} item 成就配置
   * @returns {string} 例如「击杀构装 ≥ 100」；未知口径回退完整 trigger
   */
  function conditionText(item) {
    var label = METRIC_LABEL[item.metric];
    return label ? label + ' ≥ ' + item.target : item.trigger;
  }
  var MIXED_METRICS = {
    kills: 128, deaths: 9, eliteKills: 37, bossKills: 6, bestFloor: 11, clears: 3,
    flawlessFloors: 2, hiddenRooms: 1, voidRifts: 2, singleSchoolClears: 2,
    comboPeak: 34, runRecipes: 6, recipes: 9, blueprints: 2,
    codexEnemies: 21, codexRelics: 7, codexCards: 14, talentLevels: 22,
    wagerWins: 2, sacrifices: 3, barrelKills: 11,
    dailyCleared: 0, challenge10Clears: 0
  };

  /* ------------------------------------------------------------
     工具函数
     ------------------------------------------------------------ */

  /**
   * 读取 URL 查询参数。
   * @param {string} name 参数名
   * @returns {string|null} 参数值；不存在返回 null
   */
  function query(name) {
    try {
      var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(global.location.search || '');
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * ?ach=off 关闭开关。
   * 也接受 html[data-ach="off"]，便于接入方用脚本临时关闭。
   * @returns {boolean} true 表示当前应完全禁用
   */
  function isDisabled() {
    var q = (query('ach') || '').toLowerCase();
    var attr = document.documentElement.getAttribute('data-ach');
    return q === 'off' || q === '0' || attr === 'off';
  }

  /**
   * 判断某条成就是否隐藏。
   * @param {Object} item 成就配置
   * @returns {boolean}
   */
  function isHidden(item) {
    return item.category === 'hidden' || item.hidden === true;
  }

  /**
   * 计算稀有度（展示口径）。
   * @param {Object} item 成就配置
   * @returns {string} common / rare / epic / relic
   */
  function rarityOf(item) {
    if (item.rarity && RARITY[item.rarity]) return item.rarity;
    if (RARITY_OVERRIDE[item.id]) return RARITY_OVERRIDE[item.id];
    if (isHidden(item)) return 'relic';
    if (item.targetRef || Number(item.target) >= 100) return 'epic';
    if (Number(item.target) >= 20) return 'rare';
    return 'common';
  }

  /**
   * 把 #rrggbb 颜色转成 rgba，用于卡片内发光。
   * @param {string} hex 颜色
   * @param {number} alpha 透明度 0–1
   * @returns {string} rgba(...)
   */
  function rgba(hex, alpha) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return 'rgba(255,255,255,' + alpha + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  /**
   * HTML 转义：所有成就文案都走这里，避免数据里的符号破坏结构。
   * @param {*} value 任意值
   * @returns {string} 已转义字符串
   */
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * 格式化达成时间。
   * @param {number|string|Date} value 时间戳 / ISO / Date
   * @returns {string} YYYY-MM-DD HH:mm；无效返回空串
   */
  function formatDate(value) {
    if (!value) return '';
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /**
   * 当前值：progress[id] 优先，其次 metrics[metric]，缺省 0。
   * @param {Object} item 成就配置
   * @param {Object} progress id → 当前值
   * @param {Object} metrics metric → 当前值
   * @returns {number} 非负数字
   */
  function currentOf(item, progress, metrics) {
    var byId = progress ? Number(progress[item.id]) : NaN;
    if (isFinite(byId)) return Math.max(0, byId);
    var byMetric = metrics ? Number(metrics[item.metric]) : NaN;
    if (isFinite(byMetric)) return Math.max(0, byMetric);
    return 0;
  }

  /**
   * 成就的名义奥能奖励（配置原值）。
   * @param {Object} item 成就配置
   * @returns {number}
   */
  function nominalAetherOf(item) {
    return Math.max(0, Math.floor(Number((item.reward || {}).aether) || 0));
  }

  /**
   * 成就的名义起手卡奖励（配置原值）。
   * @param {Object} item 成就配置
   * @returns {number}
   */
  function nominalCardsOf(item) {
    return Math.max(0, Math.floor(Number((item.reward || {}).cards) || 0));
  }

  /**
   * 按主文件口径结算「实际到手」奖励，结果写回每一行。
   * ------------------------------------------------------------
   * 已完成：按达成时间顺序重放，逐条扣减上限，得到当时真正到账的差额；
   *         这样旧档被旧上限夹成 0 的条目也会显示「已满」，不再报名义 +N。
   * 未完成：按「下一条解锁」预测可到账值，超出上限时标（上限内）。
   * 未传外部 rewards 时，视为新档满额可领：预算 = 已完成名义合计，
   * 因此预览页的卡片文字与旧版一致，不会凭空出现「已满」。
   * ------------------------------------------------------------
   * @param {Array<Object>} rows 行数据（就地写入 aether/card 的 gain 与 projected）
   * @param {Object} rewards { aether, cards, provided }
   * @returns {void}
   */
  function settleRewards(rows, rewards) {
    var rw = rewards || { aether: 0, cards: 0, provided: false };
    var doneRows = rows.filter(function (r) { return r.done; }).sort(function (a, b) {
      var ta = Number(a.completedAt) || 0;
      var tb = Number(b.completedAt) || 0;
      if (ta && tb && ta !== tb) return ta - tb;
      if (!!ta !== !!tb) return ta ? -1 : 1;
      return a.index - b.index;
    });
    var nominalAetherDone = doneRows.reduce(function (s, r) { return s + nominalAetherOf(r.item); }, 0);
    var nominalCardsDone = doneRows.reduce(function (s, r) { return s + nominalCardsOf(r.item); }, 0);

    /* 奥能：重放已完成条目 */
    var aetherBudget = rw.provided
      ? Math.min(MAX_AETHER_REWARD, Math.max(0, Math.floor(Number(rw.aether) || 0)))
      : Math.min(MAX_AETHER_REWARD, nominalAetherDone);
    var usedAether = 0;
    rows.forEach(function (r) { r.aetherGain = null; r.aetherProjected = null; });
    doneRows.forEach(function (r) {
      var gain = Math.min(nominalAetherOf(r.item), Math.max(0, aetherBudget - usedAether));
      r.aetherGain = gain;
      usedAether += gain;
    });
    /* 未完成条目的剩余额度：外部传了总额时以总额为准，否则以重放后的累计为准 */
    var aetherLeft = Math.max(0, MAX_AETHER_REWARD - (rw.provided ? aetherBudget : usedAether));
    rows.forEach(function (r) {
      if (!r.done) r.aetherProjected = Math.min(nominalAetherOf(r.item), aetherLeft);
    });

    /* 起手卡：上限 1，同样先重放再预测 */
    var cardsBudget = rw.provided
      ? Math.min(MAX_CARD_REWARD, Math.max(0, Math.floor(Number(rw.cards) || 0)))
      : Math.min(MAX_CARD_REWARD, nominalCardsDone);
    var usedCards = 0;
    rows.forEach(function (r) { r.cardGain = null; r.cardProjected = null; });
    doneRows.forEach(function (r) {
      var gain = Math.min(nominalCardsOf(r.item), Math.max(0, cardsBudget - usedCards));
      r.cardGain = gain;
      usedCards += gain;
    });
    var cardsLeft = Math.max(0, MAX_CARD_REWARD - (rw.provided ? cardsBudget : usedCards));
    rows.forEach(function (r) {
      if (!r.done) r.cardProjected = Math.min(nominalCardsOf(r.item), cardsLeft);
    });
  }

  /**
   * 奖励文案：只显示实际到手值；被上限夹住的显示「已满」，不报名义 +N。
   * @param {Object} item 成就配置
   * @param {Object} row 行数据（含 settleRewards 写入的 gain / projected）
   * @returns {string} 例如「奥能 +2」「起手卡 +1」「奥能已满 · 实得 0」；无奖励返回空串
   */
  function rewardText(item, row) {
    var r = item.reward || {};
    if (r.cards) {
      var cards = row ? (row.done ? row.cardGain : row.cardProjected) : nominalCardsOf(item);
      if (cards == null) cards = nominalCardsOf(item);
      return cards > 0 ? '起手卡 +' + cards : '起手卡已满';
    }
    if (r.aether) {
      var gain = row ? (row.done ? row.aetherGain : row.aetherProjected) : nominalAetherOf(item);
      if (gain == null) gain = nominalAetherOf(item);
      if (gain <= 0) return '奥能已满 · 实得 0';
      var nominal = nominalAetherOf(item);
      return '奥能 +' + gain + (gain < nominal ? '（上限内）' : '');
    }
    return '';
  }

  /**
   * 生成一组演示用完成时间（只在预览 state=done/mixed 使用）。
   * @param {string} id 成就 id
   * @returns {number} 时间戳
   */
  function demoDate(id) {
    var hash = 0;
    for (var i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) & 0x7fffffff;
    var base = new Date(2026, 8, 18, 20, 30, 0).getTime();
    return base + (hash % 41) * 86400000 + (hash % 12) * 3600000 + (hash % 59) * 60000;
  }

  /* ------------------------------------------------------------
     渲染
     ------------------------------------------------------------ */

  /**
   * 生成卡片 HTML。
   * @param {Object} row 已计算好的行（item / cur / done / ratio / rarity）
   * @param {boolean} revealHidden 是否揭晓隐藏内容（已完成时 true）
   * @returns {string} 卡片 HTML
   */
  function cardHtml(row, revealHidden) {
    var item = row.item;
    var cat = CATEGORY[item.category] || CATEGORY.combat;
    var rar = RARITY[row.rarity] || RARITY.common;
    var hiddenLocked = isHidden(item) && !row.done && !revealHidden;
    /* 未完成项统一降成灰蓝，只有隐藏项保留金色；完成项保留稀有度原色 */
    var accent = (row.done || hiddenLocked)
      ? rar
      : { color: '#8b9db6', line: 'rgba(139, 157, 182, .28)' };
    var name = hiddenLocked ? '???' : item.name;
    var desc = hiddenLocked ? '达成后揭晓名称与条件。' : item.desc;
    var cond = hiddenLocked
      ? '线索 · ' + (HIDDEN_CLUES[item.id] || '尚未记录任何线索。')
      : '条件 · ' + conditionText(item);
    var reward = hiddenLocked ? '' : rewardText(item, row);
    var pct = hiddenLocked ? 0 : (row.done ? 100 : Math.round(row.ratio * 1000) / 10);
    var numText = hiddenLocked ? '???' : (row.done ? item.target + ' / ' + item.target : row.cur + ' / ' + item.target);
    var medal = row.done ? '<span class="ach-medal" aria-label="已完成">' + MEDAL_ICON + '</span>' : '';
    var rarityChip = '<span class="ach-chip is-rarity' + (row.rarity === 'epic' ? ' is-epic' : '') + '">'
      + rar.label + '</span>';

    return '<button type="button" class="ach-card'
      + (row.done ? ' is-done' : ' is-locked')
      + (hiddenLocked ? ' is-hidden-locked' : '')
      + '" data-id="' + esc(item.id) + '"'
      + ' aria-label="' + esc(name + ' · ' + (row.done ? '已完成' : '未完成')) + '"'
      + ' style="--ach-rc:' + accent.color + ';--ach-rc-line:' + accent.line + ';--ach-rc-soft:' + rgba(accent.color, .16)
      + ';--ach-cat:' + cat.color + ';--ach-cat-soft:' + cat.soft + ';--ach-cat-line:' + cat.line + '">'
      + '<span class="ach-card-head">'
      + '<span class="ach-brick" aria-hidden="true"><svg viewBox="0 0 24 24" stroke-width="1.75">' + cat.icon + '</svg></span>'
      + '<span class="ach-name-wrap">'
      + '<span class="ach-name">' + esc(name) + '</span>'
      + '<span class="ach-sub"><span class="ach-chip">' + cat.label + '</span>' + rarityChip + '</span>'
      + '</span>' + medal + '</span>'
      + '<span class="ach-desc">' + esc(desc) + '</span>'
      + '<span class="ach-meta"><span class="ach-cond">' + esc(cond) + '</span>'
      + (reward ? '<span class="ach-reward">' + esc(reward) + '</span>' : '') + '</span>'
      + '<span class="ach-progress">'
      + '<span class="ach-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + item.target
      + '" aria-valuenow="' + (hiddenLocked ? 0 : Math.min(row.cur, item.target)) + '">'
      + '<i style="width:' + pct + '%"></i></span>'
      + '<span class="ach-num' + (hiddenLocked ? ' is-unknown' : '') + '">' + esc(numText) + '</span>'
      + '</span></button>';
  }

  /**
   * 生成详情弹层 HTML。
   * @param {Object} row 行数据
   * @returns {string} 弹层 HTML
   */
  function detailHtml(row) {
    var item = row.item;
    var cat = CATEGORY[item.category] || CATEGORY.combat;
    var rar = RARITY[row.rarity] || RARITY.common;
    var hiddenLocked = isHidden(item) && !row.done;
    var date = formatDate(row.completedAt);
    var pct = hiddenLocked ? 0 : (row.done ? 100 : Math.round(row.ratio * 1000) / 10);
    var name = hiddenLocked ? '???' : item.name;
    var desc = hiddenLocked ? '这条记录尚未揭开。' : item.desc;
    var statusChip = row.done
      ? '<span class="ach-chip is-rarity is-epic" style="color:var(--ach-gold);border-color:rgba(255,194,71,.55)">已完成</span>'
      : '<span class="ach-chip">未完成</span>';
    var rarityChip = '<span class="ach-chip is-rarity' + (row.rarity === 'epic' ? ' is-epic' : '') + '">' + rar.label + '</span>';
    var cond = hiddenLocked ? '未公开' : item.trigger;
    var condLine = hiddenLocked ? '未公开' : item.desc;
    var field = hiddenLocked ? '未公开' : item.field;
    var progress = hiddenLocked ? '???' : (row.done ? item.target + ' / ' + item.target : row.cur + ' / ' + item.target);
    var dateText = row.done ? (date || '未记录') : '尚未达成';
    var reward = rewardText(item, row);
    var note = hiddenLocked
      ? '<b>隐藏成就</b> · 线索：' + esc(HIDDEN_CLUES[item.id] || '尚未记录任何线索。')
      : (row.done
        ? '<b>已达成</b> · 记录时间 ' + esc(date || '未记录') + '。'
        : '<b>尚未达成</b> · 还差 ' + Math.max(0, item.target - row.cur) + '（当前 ' + Math.round(row.ratio * 100) + '%）。');

    return '<div class="ach-detail-layer" data-ach-detail="1" role="presentation">'
      + '<section class="ach-detail' + (row.done ? ' is-done' : '') + '" role="dialog" aria-modal="true" aria-label="成就详情" tabindex="-1"'
      + ' style="--ach-rc:' + rar.color + ';--ach-rc-line:' + rar.line + ';--ach-rc-soft:' + rgba(rar.color, .16)
      + ';--ach-cat:' + cat.color + ';--ach-cat-soft:' + cat.soft + ';--ach-cat-line:' + cat.line + '">'
      + '<header class="ach-detail-head">'
      + '<span class="ach-detail-brick" aria-hidden="true"><svg viewBox="0 0 24 24" stroke-width="1.75">' + cat.icon + '</svg></span>'
      + '<span class="ach-detail-title-wrap">'
      + '<span class="ach-eyebrow">ARCHIVE ENTRY</span>'
      + '<h2 class="ach-detail-title">' + esc(name) + '</h2>'
      + '<span class="ach-detail-sub"><span class="ach-chip">' + cat.label + '</span>' + rarityChip + statusChip + '</span>'
      + '</span>'
      + '<button type="button" class="ach-close" data-ach-close="1" aria-label="关闭详情">' + CLOSE_ICON + '</button>'
      + '</header>'
      + '<p class="ach-detail-desc">' + esc(desc) + '</p>'
      + '<dl class="ach-kv">'
      + '<dt>条件</dt><dd>' + esc(condLine) + '</dd>'
      + '<dt>判定式</dt><dd>' + esc(cond) + '</dd>'
      + '<dt>统计字段</dt><dd>' + esc(field) + '</dd>'
      + '<dt>当前进度</dt><dd' + (row.done ? ' class="is-gold"' : '') + '>' + esc(progress) + '</dd>'
      + '<dt>达成时间</dt><dd' + (row.done ? ' class="is-gold"' : ' class="is-unknown"') + '>' + esc(dateText) + '</dd>'
      + '<dt>奖励</dt><dd>' + (reward ? esc(reward) : '无') + '</dd>'
      + '</dl>'
      + '<div class="ach-detail-progress">'
      + '<span class="ach-bar"><i style="width:' + pct + '%"></i></span>'
      + '<span class="ach-num">' + esc(hiddenLocked ? '???' : Math.round(row.ratio * 100) + '%') + '</span>'
      + '</div>'
      + '<div class="ach-detail-note' + (hiddenLocked ? ' is-hidden' : '') + '">' + note + '</div>'
      + '</section></div>';
  }

  /* ------------------------------------------------------------
     控制器
     ------------------------------------------------------------ */

  /**
   * 在指定容器里创建成就面板。
   * @param {Element|string} host 容器元素或选择器
   * @param {Object} [options] 配置
   * @param {Object} [options.progress] 成就 id → 当前值（主接口）
   * @param {Object} [options.metrics] 统计口径 → 当前值（progress[id] 缺省时回退）
   * @param {Object} [options.completedAt] 成就 id → 时间戳 / ISO（可选）
   * @param {Object} [options.done] 成就 id → true（强制完成，可选）
   * @param {Object} [options.rewards] { aether, cards } 当前已到账总额（按上限 26 / 1 结算实得）
   * @param {string} [options.mode] progress(默认) / mixed / done / none
   * @param {string} [options.tab] all / combat / exploration / build / hidden
   * @param {string} [options.sort] category / progress / rarity
   * @param {boolean} [options.onlyLocked] 只看未完成
   * @param {string} [options.open] 初始打开的成就 id
   * @returns {Object} 控制器；失败时 ok=false 且所有方法为空操作
   */
  function mount(host, options) {
    var opts = options || {};
    if (typeof document === 'undefined') return disabled('无 document');
    if (isDisabled()) return disabled('?ach=off');

    var el = typeof host === 'string' ? document.querySelector(host) : host;
    if (!el) return disabled('容器不存在');

    var base = {
      progress: opts.progress || {},
      metrics: opts.metrics || {},
      completedAt: opts.completedAt || {},
      done: opts.done || {},
      /* 未传 rewards 时按「新档满额可领」处理：预算取已完成名义合计 */
      rewards: (opts.rewards && typeof opts.rewards === 'object')
        ? {
          aether: Math.max(0, Math.floor(Number(opts.rewards.aether) || 0)),
          cards: Math.max(0, Math.floor(Number(opts.rewards.cards) || 0)),
          provided: true
        }
        : { aether: 0, cards: 0, provided: false }
    };

    var view = {
      mode: opts.mode || 'progress',
      tab: opts.tab || 'all',
      sort: opts.sort || 'category',
      onlyLocked: !!opts.onlyLocked,
      openId: opts.open || null
    };
    var state = { rows: [], stats: { renderMs: 0, cards: 0, total: ACH_DATA.length }, lastFocus: null };
    var meta = { progress: {}, metrics: {}, completedAt: {}, done: {}, rewards: base.rewards };

    var panel = document.createElement('div');
    panel.className = 'ach-panel';
    panel.innerHTML =
      '<header class="ach-head">'
      + '<div class="ach-brand">'
      + '<span class="ach-eyebrow">EMBERFALL · ACHIEVEMENTS</span>'
      + '<span class="ach-title">成就档案</span>'
      + '<span class="ach-subtitle">' + ACH_DATA.length + ' 条 · 击杀 / 探索 / 构筑 / 隐藏</span>'
      + '</div>'
      + '<div class="ach-summary">'
      + '<div class="ach-stat"><span>总数</span><b data-ach-total>0</b></div>'
      + '<div class="ach-stat is-gold"><span>已完成</span><b data-ach-done>0</b></div>'
      + '<div class="ach-ring" data-ach-ring role="img" aria-label="完成率"><div class="ach-ring-in">'
      + '<b data-ach-pct>0</b><span>% 完成</span></div></div>'
      + '</div></header>'
      + '<div class="ach-tools">'
      + '<div class="ach-tabs" role="tablist" data-ach-tabs></div>'
      + '<div class="ach-tools-right">'
      + '<div class="ach-field"><label for="achSort">排序</label><span class="ach-sort-wrap">'
      + '<select class="ach-sort" id="achSort" data-ach-sort>'
      + '<option value="category">按分类</option>'
      + '<option value="progress">按完成度</option>'
      + '<option value="rarity">按稀有度</option>'
      + '</select></span></div>'
      + '<button type="button" class="ach-switch" role="switch" aria-checked="false" data-ach-switch>'
      + '<span class="ach-switch-track" aria-hidden="true"></span>'
      + '<span class="ach-switch-label">只看未完成</span>'
      + '</button>'
      + '</div></div>'
      + '<div class="ach-body" data-ach-body><div class="ach-grid" data-ach-grid></div></div>';

    el.appendChild(panel);

    var refs = {
      total: panel.querySelector('[data-ach-total]'),
      done: panel.querySelector('[data-ach-done]'),
      pct: panel.querySelector('[data-ach-pct]'),
      ring: panel.querySelector('[data-ach-ring]'),
      tabs: panel.querySelector('[data-ach-tabs]'),
      sort: panel.querySelector('[data-ach-sort]'),
      sw: panel.querySelector('[data-ach-switch]'),
      body: panel.querySelector('[data-ach-body]'),
      grid: panel.querySelector('[data-ach-grid]')
    };

    /**
     * 给一组成就计算「当前值 / 是否完成 / 进度比例」。
     * @param {Object} progress id → 当前值
     * @param {Object} metrics metric → 当前值
     * @param {Object} completedAt id → 时间
     * @param {Object} forced id → true
     * @returns {Array<Object>} 行数据
     */
    function buildRows(progress, metrics, completedAt, forced) {
      return ACH_DATA.map(function (item, index) {
        var cur = currentOf(item, progress, metrics);
        var done = !!(completedAt && completedAt[item.id]) || !!(forced && forced[item.id])
          || (cur >= Number(item.target || 1));
        var ratio = done ? 1 : (item.target > 0 ? Math.min(cur, item.target) / item.target : 0);
        return {
          item: item,
          index: index,
          cur: done ? Math.max(cur, Number(item.target || 1)) : cur,
          done: done,
          ratio: ratio,
          rarity: rarityOf(item),
          completedAt: completedAt ? completedAt[item.id] : null
        };
      });
    }

    /**
     * 按当前 mode 生成演示数据，然后刷新界面。
     * @param {string} mode progress / mixed / done / none
     * @returns {void}
     */
    function applyMode(mode) {
      view.mode = mode || 'progress';
      meta.rewards = base.rewards;
      if (view.mode === 'done') {
        meta.progress = {};
        meta.metrics = {};
        meta.completedAt = {};
        meta.done = {};
        ACH_DATA.forEach(function (item) { meta.done[item.id] = true; meta.completedAt[item.id] = demoDate(item.id); });
      } else if (view.mode === 'none') {
        meta.progress = {};
        meta.metrics = {};
        meta.completedAt = {};
        meta.done = {};
      } else if (view.mode === 'mixed') {
        meta.progress = {};
        meta.metrics = MIXED_METRICS;
        meta.done = {};
        meta.completedAt = {};
        ACH_DATA.forEach(function (item) {
          if (currentOf(item, {}, MIXED_METRICS) >= Number(item.target || 1)) {
            meta.completedAt[item.id] = demoDate(item.id);
          }
        });
      } else {
        meta.progress = base.progress;
        meta.metrics = base.metrics;
        meta.completedAt = base.completedAt;
        meta.done = base.done;
      }
      refresh();
    }

    /**
     * 取当前页签 + 筛选后的行，并按排序规则复制一份。
     * @returns {Array<Object>} 排序后的行
     */
    function visibleRows() {
      var list = state.rows.filter(function (row) {
        if (view.tab !== 'all' && row.item.category !== view.tab) return false;
        if (view.onlyLocked && row.done) return false;
        return true;
      });
      var copy = list.slice();
      if (view.sort === 'progress') {
        copy.sort(function (a, b) {
          if (a.done !== b.done) return a.done ? -1 : 1;
          if (b.ratio !== a.ratio) return b.ratio - a.ratio;
          return a.index - b.index;
        });
      } else if (view.sort === 'rarity') {
        copy.sort(function (a, b) {
          var dr = (RARITY[b.rarity] || RARITY.common).rank - (RARITY[a.rarity] || RARITY.common).rank;
          if (dr) return dr;
          if (a.done !== b.done) return a.done ? -1 : 1;
          return a.index - b.index;
        });
      } else {
        copy.sort(function (a, b) {
          var dc = (CATEGORY_ORDER[a.item.category] || 0) - (CATEGORY_ORDER[b.item.category] || 0);
          return dc || a.index - b.index;
        });
      }
      return copy;
    }

    /**
     * 刷新页签计数、标题栏、网格。
     * @returns {void}
     */
    function refresh() {
      state.rows = buildRows(meta.progress, meta.metrics, meta.completedAt, meta.done);
      settleRewards(state.rows, meta.rewards);
      var doneCount = state.rows.filter(function (r) { return r.done; }).length;
      var pct = state.rows.length ? Math.round((doneCount / state.rows.length) * 1000) / 10 : 0;

      refs.total.textContent = String(state.rows.length);
      refs.done.textContent = String(doneCount);
      refs.pct.textContent = String(pct);
      refs.ring.style.setProperty('--ach-pct', pct);
      refs.ring.classList.toggle('is-complete', doneCount === state.rows.length);
      refs.ring.setAttribute('aria-label', '完成率 ' + pct + '%');

      var counts = { all: state.rows.length, combat: 0, exploration: 0, build: 0, hidden: 0 };
      state.rows.forEach(function (row) {
        if (counts[row.item.category] != null) counts[row.item.category] += 1;
      });
      var tabs = [
        ['all', '全部'], ['combat', '战斗'], ['exploration', '探索'], ['build', '构筑'], ['hidden', '隐藏']
      ];
      refs.tabs.innerHTML = tabs.map(function (pair) {
        return '<button type="button" class="ach-tab' + (view.tab === pair[0] ? ' is-active' : '') + '"'
          + ' role="tab" aria-selected="' + (view.tab === pair[0]) + '" data-ach-tab="' + pair[0] + '">'
          + pair[1] + '<b>' + counts[pair[0]] + '</b></button>';
      }).join('');
      refs.sort.value = view.sort;
      refs.sw.setAttribute('aria-checked', view.onlyLocked ? 'true' : 'false');

      var rows = visibleRows();
      refs.grid.classList.toggle('is-hidden-tab', view.tab === 'hidden');

      var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
      if (!rows.length) {
        refs.grid.innerHTML = '<div class="ach-empty"><b>没有符合条件的成就</b><span>关掉「只看未完成」或换一个页签。</span></div>';
      } else {
        var hint = view.tab === 'hidden'
          ? '<div class="ach-hint"><b>HIDDEN · ' + (counts.hidden < 10 ? '0' : '') + counts.hidden
            + '</b><span>隐藏成就达成前只显示 ??? 与一条线索，完成后才揭晓名称和条件。</span></div>'
          : '';
        refs.grid.innerHTML = hint + rows.map(function (row) { return cardHtml(row, false); }).join('');
      }
      // 强制一次布局，得到真实的「38 条全渲染」耗时
      void refs.grid.getBoundingClientRect();
      var t1 = (global.performance && performance.now) ? performance.now() : Date.now();
      state.stats = { renderMs: Math.round((t1 - t0) * 100) / 100, cards: rows.length, total: ACH_DATA.length };
    }

    /**
     * 打开某条成就的详情弹层。
     * @param {string} id 成就 id
     * @returns {void}
     */
    function open(id) {
      var row = state.rows.filter(function (r) { return r.item.id === id; })[0];
      if (!row) return;
      var old = panel.querySelector('.ach-detail-layer');
      if (old) old.parentNode.removeChild(old);
      state.lastFocus = document.activeElement;
      panel.insertAdjacentHTML('beforeend', detailHtml(row));
      view.openId = id;
      var dialog = panel.querySelector('.ach-detail');
      if (dialog && dialog.focus) dialog.focus({ preventScroll: true });
      document.addEventListener('keydown', onKey);
    }

    /**
     * 关闭详情弹层并恢复焦点。
     * @returns {void}
     */
    function close() {
      var layer = panel.querySelector('.ach-detail-layer');
      if (layer) layer.parentNode.removeChild(layer);
      view.openId = null;
      document.removeEventListener('keydown', onKey);
      if (state.lastFocus && state.lastFocus.focus) {
        try { state.lastFocus.focus(); } catch (e) { /* 节点可能已被重渲染移除 */ }
      }
    }

    /**
     * Esc 关闭详情。
     * @param {KeyboardEvent} e 键盘事件
     * @returns {void}
     */
    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    /**
     * 事件委托：页签 / 排序 / 开关 / 卡片 / 详情关闭 / 遮罩。
     * @returns {void}
     */
    function bind() {
      panel.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-ach-tab]');
        if (tab) { view.tab = tab.getAttribute('data-ach-tab'); refresh(); return; }

        var card = e.target.closest('.ach-card');
        if (card) { open(card.getAttribute('data-id')); return; }

        var closeBtn = e.target.closest('[data-ach-close]');
        if (closeBtn) { close(); return; }

        if (e.target.getAttribute && e.target.getAttribute('data-ach-detail') === '1') close();
      });
      refs.sort.addEventListener('change', function () {
        view.sort = refs.sort.value; refresh();
      });
      refs.sw.addEventListener('click', function () {
        view.onlyLocked = !view.onlyLocked; refresh();
      });
    }

    bind();
    applyMode(view.mode);
    if (view.openId) open(view.openId);

    /**
     * 销毁面板。
     * @returns {void}
     */
    function destroy() {
      close();
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    }

    return {
      ok: true,
      version: VERSION,
      panel: panel,
      setMode: function (mode) { applyMode(mode); },
      setProgress: function (progress, completedAt) {
        base.progress = progress || {};
        base.completedAt = completedAt || {};
        base.metrics = {};
        base.done = {};
        applyMode('progress');
      },
      setMetrics: function (metrics, completedAt) {
        base.metrics = metrics || {};
        base.progress = {};
        base.completedAt = completedAt || {};
        base.done = {};
        applyMode('progress');
      },
      setRewards: function (rewards) {
        base.rewards = (rewards && typeof rewards === 'object')
          ? {
            aether: Math.max(0, Math.floor(Number(rewards.aether) || 0)),
            cards: Math.max(0, Math.floor(Number(rewards.cards) || 0)),
            provided: true
          }
          : { aether: 0, cards: 0, provided: false };
        meta.rewards = base.rewards;
        refresh();
      },
      setTab: function (tab) { view.tab = tab || 'all'; refresh(); },
      setSort: function (sort) { view.sort = sort || 'category'; refresh(); },
      setOnlyLocked: function (flag) { view.onlyLocked = !!flag; refresh(); },
      open: open,
      close: close,
      refresh: refresh,
      destroy: destroy,
      getStats: function () { return state.stats; },
      getRows: function () { return state.rows.slice(); }
    };
  }

  /**
   * 生成一个禁用状态的控制器（?ach=off 或挂载失败时返回）。
   * @param {string} reason 原因
   * @returns {Object} 全部为空操作的控制器
   */
  function disabled(reason) {
    var noop = function () {};
    return {
      ok: false,
      reason: reason || 'disabled',
      version: VERSION,
      panel: null,
      setMode: noop,
      setProgress: noop,
      setMetrics: noop,
      setRewards: noop,
      setTab: noop,
      setSort: noop,
      setOnlyLocked: noop,
      open: noop,
      close: noop,
      refresh: noop,
      destroy: noop,
      getStats: function () { return { renderMs: 0, cards: 0, total: 0 }; },
      getRows: function () { return []; }
    };
  }

  /* 对外接口 */
  global.ACHPanel = {
    version: VERSION,
    data: ACH_DATA.slice(),
    /* 实算合计：21 条带 aether、合计 26；1 条只给起手卡（first_win） */
    totals: REWARD_TOTALS,
    maxAetherReward: MAX_AETHER_REWARD,
    maxCardReward: MAX_CARD_REWARD,
    categories: CATEGORY,
    rarities: RARITY,
    rarityOf: rarityOf,
    isDisabled: isDisabled,
    mount: mount
  };
})(window);
