// Saves a game session + every answer to Supabase. Events are sent in batches so nothing is lost.
import { startGameSession, endGameSession, insertGameEvents } from '../api.js';
import { toast } from '../ui.js';

export class GameSession {
  constructor(game, system, level) {
    Object.assign(this, { game, system, level, id: null, buffer: [], timer: null, startedAt: Date.now() });
    this._onHide = () => { if (document.visibilityState === 'hidden') this.flush(); };
    document.addEventListener('visibilitychange', this._onHide);
  }

  async start() {
    try {
      this.id = await startGameSession(this.game, this.system, this.level);
    } catch (e) {
      console.error(e);
      toast('Playing offline: this game will not be saved.', 'error');
    }
    this.timer = setInterval(() => this.flush(), 8000);
    return this.id;
  }

  log({ slug, promptType = 'name', correct, responseMs = null }) {
    if (!this.id) return;
    this.buffer.push({ session_id: this.id, system: this.system, slug, prompt_type: promptType, correct: !!correct,
      response_ms: responseMs == null ? null : Math.round(responseMs) });
    if (this.buffer.length >= 8) this.flush();
  }

  async flush() {
    if (!this.id || !this.buffer.length) return;
    const rows = this.buffer.splice(0);
    try { await insertGameEvents(rows); } catch (e) { console.error(e); this.buffer.unshift(...rows); }
  }

  async end(fields) {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this._onHide);
    if (!this.id) return;
    await this.flush();
    try {
      await endGameSession(this.id, { duration_ms: Date.now() - this.startedAt, ...fields });
    } catch (e) { console.error(e); toast('Could not save your score.', 'error'); }
  }
}
