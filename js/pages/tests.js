// Browser test page for the pure game logic: open tests.html.
import { waveConfig, scoreFor, pickRound, accuracy, flowOrder, checkPlacement, builderStars, builderScore, builderHint, BLASTER,
  startTime, addTime, clockBonus, waveReward } from '../games/logic.js';
import { PATHWAYS } from '../data/pathways.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.message]); } };
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected true'); };

// ---------- Organ Blaster
test('waves 1-2 use names, 3+ use functions', () => { eq(waveConfig(1).promptType, 'name'); eq(waveConfig(2).promptType, 'name'); eq(waveConfig(3).promptType, 'function'); });
test('more organs and faster in later waves', () => { ok(waveConfig(8).count > waveConfig(1).count); ok(waveConfig(8).travelSec < waveConfig(1).travelSec); ok(waveConfig(20).count <= 6); ok(waveConfig(20).travelSec >= 3.5); ok(waveConfig(8).wander > waveConfig(1).wander); ok(waveConfig(20).wander <= 1); });
test('combo increases score', () => { ok(scoreFor(5, 3000) > scoreFor(0, 3000)); });
test('fast answers earn a bonus', () => { ok(scoreFor(0, 500) > scoreFor(0, 8000)); eq(scoreFor(0, 99999), 100); });
test('combo multiplier is capped', () => { eq(scoreFor(8, 9999), scoreFor(50, 9999)); });
const organs = ['a', 'b', 'c', 'd', 'e'].map((slug) => ({ slug, label: slug.toUpperCase() }));
test('round has target + distinct distractors', () => {
  for (let i = 0; i < 50; i++) {
    const { target, group } = pickRound(organs, 4);
    eq(group.length, 4); ok(group.includes(target)); eq(new Set(group.map((g) => g.slug)).size, 4);
  }
});
test('round never asks for more organs than exist', () => { eq(pickRound(organs.slice(0, 2), 6).group.length, 2); });
test('weak organs are picked more often', () => {
  let n = 0; for (let i = 0; i < 2000; i++) if (pickRound(organs, 3, { e: 8 }).target.slug === 'e') n++;
  ok(n > 800, `picked e ${n} times`);
});
test('same target is not repeated back-to-back', () => { for (let i = 0; i < 50; i++) ok(pickRound(organs, 3, {}, Math.random, 'a').target.slug !== 'a'); });
test('accuracy', () => { eq(accuracy(3, 4), 0.75); eq(accuracy(0, 0), 0); });
test('blaster constants', () => { eq(BLASTER.shields, 3); });
test('harder difficulty = faster, twistier, more organs, less time', () => {
  const e = waveConfig(4, 'easy'), n = waveConfig(4, 'normal'), h = waveConfig(4, 'hard');
  ok(e.travelSec > n.travelSec && n.travelSec > h.travelSec); ok(e.wander < n.wander && n.wander < h.wander);
  ok(e.count < n.count && n.count < h.count); ok(waveConfig(1, 'easy').count >= 2);
  ok(startTime('easy') > startTime('normal') && startTime('normal') > startTime('hard'));
  eq(waveConfig(4), waveConfig(4, 'nonsense'));
});
test('harder difficulty scores more', () => { ok(scoreFor(2, 3000, 'hard') > scoreFor(2, 3000) && scoreFor(2, 3000) > scoreFor(2, 3000, 'easy')); });
test('correct hits add time, capped', () => { eq(addTime(10), 13); eq(addTime(10, 'easy'), 14); eq(addTime(98), BLASTER.maxTimeSec); });
test('clock bonus for time left, never negative', () => { eq(clockBonus(12), 120); eq(clockBonus(-3), 0); ok(clockBonus(10, 'hard') > clockBonus(10)); });
test('wave reward restores one shield, or gives points when full', () => {
  eq(waveReward(1), { shields: 2, restored: true, bonus: 0 }); eq(waveReward(3).shields, 3); ok(waveReward(3).bonus > 0 && !waveReward(3).restored);
});

// ---------- System Builder
const pw = { path: ['mouth', 'oesophagus', 'stomach', 'small-intestine'], helpers: [{ slug: 'liver', at: 'small-intestine' }] };
test('flow order inserts helpers after their step', () => {
  eq(flowOrder(pw, ['stomach', 'liver', 'mouth', 'oesophagus', 'small-intestine']).map((o) => o.slug), ['mouth', 'oesophagus', 'stomach', 'small-intestine', 'liver']);
});
test('flow order skips missing organs and appends unknown ones', () => {
  eq(flowOrder(pw, ['mouth', 'stomach', 'extra']).map((o) => o.slug), ['mouth', 'stomach', 'extra']);
});
const order = flowOrder(pw, ['mouth', 'oesophagus', 'stomach', 'small-intestine', 'liver']);
const perfect = Object.fromEntries(order.map((o) => [o.slug, o.slug]));
test('all correct → complete', () => { ok(checkPlacement(perfect, order).complete); });
test('flow stops at first wrong organ', () => {
  const p = { ...perfect, stomach: 'oesophagus', oesophagus: 'stomach' };
  const r = checkPlacement(p, order);
  ok(!r.complete); eq(r.reached, 1); eq(r.failSlot, 'oesophagus'); eq(r.placed, 'stomach');
});
test('empty slot blocks the flow', () => { const r = checkPlacement({ ...perfect, liver: null }, order); ok(r.empty); eq(r.failSlot, 'liver'); });
test('stars by attempts', () => { eq(builderStars(1), 3); eq(builderStars(2), 2); eq(builderStars(3), 2); eq(builderStars(9), 1); });
test('score never below 50', () => { ok(builderScore(1, 99999, 3) >= 50); ok(builderScore(3, 20, 5) > builderScore(1, 20, 5)); });
test('hint names the organ in the wrong place', () => {
  const r = checkPlacement({ ...perfect, stomach: 'oesophagus', oesophagus: 'stomach' }, order);
  ok(/Stomach/.test(builderHint(order, r, { stomach: 'Stomach', mouth: 'Mouth', oesophagus: 'Food pipe' }, 'food')));
});
test('every pathway level has a path', () => {
  for (const [s, p] of Object.entries(PATHWAYS)) for (const l of ['simple', 'medium', 'full']) ok(p.levels[l].path.length >= 2, `${s}/${l}`);
});

const passed = results.filter((r) => r[1]).length;
document.getElementById('app').innerHTML = `<h1>Logic tests: ${passed}/${results.length} passed ${passed === results.length ? '✅' : '❌'}</h1>
  <div class="card"><table class="table">${results.map(([n, p, m]) => `<tr><td>${p ? '✅' : '❌'}</td><td>${n}</td><td class="muted">${m || ''}</td></tr>`).join('')}</table></div>`;
window.__TEST_RESULTS__ = { passed, total: results.length, failed: results.filter((r) => !r[1]) };
