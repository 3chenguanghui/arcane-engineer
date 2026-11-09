/**
 * 熔炉房探针：统计 2000 局里 forgeUses 的真实分布
 * 目的：回答"熔炉是不是白给"——有多少局真的用 4 余烬换到了能力强化
 */
const path = require('path');
const DIR = path.join(__dirname, 'sim_panel');
const C = require(path.join(DIR, 'config.js'));
const S = require(path.join(DIR, 'sim.js'));

const CHARS = {
  中性: { id: 'base', hpFlat: 0, magics: ['fireball', 'frost'], regenBonus: 0, growthBias: null },
  守拙: { id: 'warden', hpFlat: 4, magics: ['flameCone', 'fireball'], regenBonus: 2, growthBias: { value: 0.45, survival: 0.55 } },
  疾火: { id: 'ember', hpFlat: -5, magics: ['fireball', 'blade'], regenBonus: 4, growthBias: { value: 0.85, survival: 0.15 } },
  观星: { id: 'gazer', hpFlat: 0, magics: ['fireball', 'frost'], regenBonus: 2, growthBias: { value: 0.55, survival: 0.45 } }
};

const RUNS = 2000;
const out = {};
Object.keys(CHARS).forEach((name) => {
  const hist = {};
  let reached4 = 0;
  let usesSum = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const r = S.runOne(S.runSeed(C.SIM_PARAMS.baseSeed, i), C.PROFILES.bot, 'normal',
      { charSpec: CHARS[name], talentSpec: null });
    const u = r.forgeUses || 0;
    if ((r.clearedFloors || 0) >= 3) reached4 += 1;
    usesSum += u;
    hist[u] = (hist[u] || 0) + 1;
  }
  out[name] = {
    reachedF4: reached4,
    reachedF4Pct: +(reached4 / RUNS * 100).toFixed(2),
    avgUsesAll: +(usesSum / RUNS).toFixed(3),
    avgUsesAmongF4: reached4 ? +(usesSum / reached4).toFixed(3) : 0,
    hist
  };
});
console.log(JSON.stringify(out, null, 1));
