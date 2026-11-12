// Pure game rules (no DOM, no three.js) — unit-tested in tests.html.

// ------------------------------------------------------------------ Organ Blaster
export const BLASTER = { rounds: 5, maxWaves: 8, shields: 3, maxTimeSec: 99, fullShieldBonus: 100 };

/**
 * Difficulty sets the pace: how fast organs fly in, how much they dodge, how many there are,
 * how much time you start with / win back per hit, and a score multiplier so harder games rank higher.
 */
export const DIFFICULTY = {
  easy: { label: 'Easy', icon: '🌱', desc: 'Slower organs that barely dodge. A roomy clock.', speed: 0.75, wander: 0.55, extraOrgans: -1, startSec: 75, bonusSec: 4, scoreMult: 0.75 },
  normal: { label: 'Normal', icon: '⚡', desc: 'Organs weave around. Keep hitting to keep the clock going.', speed: 1, wander: 1, extraOrgans: 0, startSec: 60, bonusSec: 3, scoreMult: 1 },
  hard: { label: 'Hard', icon: '🔥', desc: 'Fast, twisty organs, more of them and a tight clock. ×1.5 points.', speed: 1.4, wander: 1.5, extraOrgans: 1, startSec: 45, bonusSec: 2, scoreMult: 1.5 },
};
export const difficultyOf = (d) => DIFFICULTY[d] || DIFFICULTY.normal;

/** How each wave plays: prompt kind, number of organs and their speed. */
export function waveConfig(wave, difficulty = 'normal') {
  const d = difficultyOf(difficulty);
  return {
    promptType: wave <= 2 ? 'name' : 'function',
    count: Math.max(2, Math.min(3 + Math.floor((wave - 1) / 2), 6) + d.extraOrgans),
    travelSec: Math.max(3.5, 8 - (wave - 1) * 0.65) / d.speed,   // seconds for an organ to drift all the way to you
    wander: Math.min(1, 0.35 + (wave - 1) * 0.1) * d.wander,     // how much the organs dodge around
    rounds: BLASTER.rounds,
  };
}

/** Points for a correct hit. Combo multiplies; answering fast adds a bonus; harder difficulty multiplies. */
export function scoreFor(combo, responseMs, difficulty = 'normal') {
  const mult = 1 + Math.min(combo, 8) * 0.25;
  const speedBonus = Math.max(0, Math.round(50 - responseMs / 100));
  return Math.round((100 * mult + speedBonus) * difficultyOf(difficulty).scoreMult);
}

/** The countdown clock: time to start with, and the time won back for each correct hit (never above the cap). */
export function startTime(difficulty = 'normal') { return difficultyOf(difficulty).startSec; }
export function addTime(timeLeft, difficulty = 'normal') {
  return Math.min(BLASTER.maxTimeSec, timeLeft + difficultyOf(difficulty).bonusSec);
}
/** Points for the seconds still on the clock when the whole mission is finished. */
export function clockBonus(secondsLeft, difficulty = 'normal') {
  return Math.round(Math.max(0, secondsLeft) * 10 * difficultyOf(difficulty).scoreMult);
}
/** After each completed wave: get a shield back, or bonus points if you never lost one. */
export function waveReward(shields) {
  return shields < BLASTER.shields ? { shields: shields + 1, restored: true, bonus: 0 } : { shields, restored: false, bonus: BLASTER.fullShieldBonus };
}

/**
 * Choose a target + distractors. `weights` = { slug: n } — bigger means "show more often"
 * (organs the student keeps missing get picked more: simple spaced repetition).
 */
export function pickRound(organs, count, weights = {}, rand = Math.random, avoid = null) {
  const pool = organs.filter((o) => o.slug !== avoid) ;
  const list = pool.length ? pool : organs;
  const w = list.map((o) => 1 + (weights[o.slug] || 0));
  let r = rand() * w.reduce((a, b) => a + b, 0), target = list[0];
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) { target = list[i]; break; } }
  const others = organs.filter((o) => o.slug !== target.slug);
  const group = [target];
  const copy = others.slice();
  while (group.length < Math.min(count, organs.length) && copy.length) {
    group.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  }
  return { target, group };
}

export function accuracy(correct, total) { return total ? correct / total : 0; }

// ------------------------------------------------------------------ System Builder
/**
 * The order the flow visits slots: main path with each helper inserted right after the step it joins.
 * pathway = { path: [slug], helpers: [{slug, at}] }; only slugs present in `available` are used.
 */
export function flowOrder(pathway, available) {
  const has = new Set(available);
  const order = [];
  for (const step of pathway.path) {
    if (!has.has(step)) continue;
    order.push({ slug: step, helper: false });
    for (const h of pathway.helpers || []) if (h.at === step && has.has(h.slug)) order.push({ slug: h.slug, helper: true });
  }
  // any organ not mentioned in the pathway still has to be placed correctly
  for (const s of available) if (!order.some((o) => o.slug === s)) order.push({ slug: s, helper: true });
  return order;
}

/**
 * placements: { slotSlug: organSlug|null } — which organ the player dropped on each slot.
 * Returns how far the flow gets and the first problem.
 */
export function checkPlacement(placements, order) {
  for (let i = 0; i < order.length; i++) {
    const slot = order[i].slug;
    const placed = placements[slot] || null;
    if (placed !== slot) {
      return { complete: false, reached: i, failSlot: slot, placed, empty: !placed };
    }
  }
  return { complete: true, reached: order.length, failSlot: null, placed: null, empty: false };
}

export function builderStars(attempts) {
  if (attempts <= 1) return 3;
  if (attempts <= 3) return 2;
  return 1;
}

export function builderScore(stars, seconds, organCount) {
  return Math.max(50, Math.round(stars * 300 + organCount * 40 - seconds * 2));
}

export function builderHint(order, result, labels, substance) {
  if (result.complete) return '';
  const i = result.reached;
  const prev = i > 0 ? labels[order[i - 1].slug] : null;
  if (result.empty) return `This spot is still empty. Which organ belongs here?`;
  const placed = labels[result.placed] || result.placed;
  if (order[i].helper) return `The ${placed} isn't in the right spot. Think about which organ sits here and helps the ${prev || 'system'}.`;
  return prev
    ? `The ${substance} got stuck after the ${prev}. The ${placed} doesn't go here — what does the ${substance} reach next?`
    : `The ${substance} can't start: the ${placed} doesn't go here. Where does the ${substance} enter first?`;
}
