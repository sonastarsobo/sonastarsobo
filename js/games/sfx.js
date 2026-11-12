// Tiny sound-effects kit for the games. Every sound is synthesised with the Web Audio API,
// so there are no audio files to download. Muting is remembered per device.
const KEY = 'bq-sfx-muted';
let ctx = null, master = null, noiseBuf = null;
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

/** Call from a click/tap (browsers only allow audio after a user gesture). */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.32;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no audio available */ }
}

const listeners = new Set();
export const isMuted = () => muted;
/** Run fn(muted) whenever sound is switched on or off. Returns an unsubscribe function. */
export function onMuteChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setMuted(m) {
  muted = !!m;
  if (muted) { try { window.speechSynthesis?.cancel(); } catch { /* no speech */ } }
  listeners.forEach((fn) => fn(muted));
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* private mode */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.32, ctx.currentTime, 0.02);
}

const ready = () => ctx && !muted && ctx.state === 'running';

function tone({ freq, to = null, type = 'sine', dur = 0.15, vol = 0.5, delay = 0, attack = 0.004 }) {
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.4, from = 2000, to = 300, delay = 0, type = 'lowpass' }) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf;
  f.type = type; f.frequency.setValueAtTime(from, t0); f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

const notes = (list, { type = 'triangle', step = 0.07, dur = 0.16, vol = 0.35 } = {}) =>
  list.forEach((f, i) => tone({ freq: f, type, dur, vol, delay: i * step }));

export const sfx = {
  /** laser zap */
  shoot() { if (!ready()) return; tone({ freq: 1400, to: 260, type: 'square', dur: 0.12, vol: 0.12 }); noise({ dur: 0.06, vol: 0.06, from: 6000, to: 1500, type: 'highpass' }); },
  /** correct hit — pitch climbs with the combo */
  hit(combo = 0) {
    if (!ready()) return;
    const base = 520 * Math.pow(2, Math.min(combo, 8) / 12);
    notes([base, base * 1.26, base * 1.5], { type: 'triangle', step: 0.05, dur: 0.14, vol: 0.32 });
    noise({ dur: 0.18, vol: 0.18, from: 3000, to: 400 });
  },
  /** shot the wrong organ */
  wrong() { if (!ready()) return; tone({ freq: 180, to: 90, type: 'sawtooth', dur: 0.28, vol: 0.22 }); tone({ freq: 190, to: 95, type: 'square', dur: 0.28, vol: 0.08 }); },
  /** a shield breaks */
  shieldLost() { if (!ready()) return; noise({ dur: 0.35, vol: 0.35, from: 900, to: 80 }); tone({ freq: 140, to: 50, type: 'sine', dur: 0.4, vol: 0.4 }); },
  /** a shield comes back */
  shieldUp() { if (!ready()) return; notes([660, 880, 1320], { type: 'sine', step: 0.08, dur: 0.25, vol: 0.28 }); },
  /** new wave */
  wave() { if (!ready()) return; notes([392, 523, 659, 784], { type: 'triangle', step: 0.08, dur: 0.18, vol: 0.28 }); },
  /** +time on the clock */
  timeBonus() { if (!ready()) return; tone({ freq: 1200, to: 1800, type: 'sine', dur: 0.12, vol: 0.18, delay: 0.06 }); },
  /** last seconds on the clock */
  tick(urgent = false) { if (!ready()) return; tone({ freq: urgent ? 1000 : 800, type: 'square', dur: 0.05, vol: 0.08 }); },
  /** time ran out / out of shields */
  gameOver() { if (!ready()) return; notes([392, 330, 262, 196], { type: 'sawtooth', step: 0.16, dur: 0.3, vol: 0.16 }); },
  /** mission complete */
  win() { if (!ready()) return; notes([523, 659, 784, 1047, 784, 1047], { type: 'triangle', step: 0.11, dur: 0.22, vol: 0.3 }); },
  /** picked up an organ */
  pick() { if (!ready()) return; tone({ freq: 520, to: 780, type: "sine", dur: 0.09, vol: 0.16 }); },
  /** dropped an organ on a spot */
  place() { if (!ready()) return; tone({ freq: 330, to: 220, type: "triangle", dur: 0.12, vol: 0.26 }); noise({ dur: 0.08, vol: 0.08, from: 1800, to: 300 }); },
  /** organ sent back to the box */
  unplace() { if (!ready()) return; tone({ freq: 440, to: 260, type: "sine", dur: 0.1, vol: 0.12 }); },
  /** flow switched on */
  flow() { if (!ready()) return; tone({ freq: 160, to: 480, type: "sine", dur: 0.6, vol: 0.18 }); noise({ dur: 0.6, vol: 0.06, from: 400, to: 2400, type: "bandpass" }); },
  /** UI click */
  click() { if (!ready()) return; tone({ freq: 700, type: 'sine', dur: 0.05, vol: 0.12 }); },
};
