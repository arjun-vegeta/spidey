import { MAX_PLAYERS, type PeerInfo, type Standing } from '../net/NetTypes';
import { colorCssFor } from '../net/Profile';

export interface KillFeedEntry {
  killerName: string;
  killerColor: number;
  victimName: string;
  victimColor: number;
  headshot: boolean;
  /** True when the local player is either party, so the row can be emphasised. */
  involvesSelf: boolean;
}

interface FeedRow {
  el: HTMLElement;
  expires: number;
}

const FEED_SECONDS = 5;
const FEED_MAX = 5;

/**
 * MULTIPLAYER HUD — the parts of the screen that only exist in deathmatch.
 *
 * Kept out of `HUD` deliberately: that class is already responsible for the
 * whole single-player readout, and none of this should cost anything (or risk
 * anything) when you are playing solo. It builds its own overlay layer and
 * `setActive(false)` removes it from the page entirely.
 */
export class MultiplayerHud {
  private root: HTMLElement;
  private statusEl: HTMLElement;
  private feedEl: HTMLElement;
  private boardEl: HTMLElement;
  private boardBody: HTMLElement;
  private respawnEl: HTMLElement;
  private endEl: HTMLElement;

  private feedRows: FeedRow[] = [];
  private boardPinned = false;
  private active = false;

  /** Wired by Game so the leaderboard buttons can act. */
  public onRematch: (() => void) | null = null;
  public onLeave: (() => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'mp-hud';
    this.root.className = 'mp-hud';
    this.root.style.display = 'none';

    this.root.innerHTML = `
      <div class="mp-status" id="mp-status"></div>
      <div class="mp-feed" id="mp-feed"></div>
      <div class="mp-board" id="mp-board">
        <div class="mp-board-card">
          <div class="mp-board-title">SCOREBOARD</div>
          <div class="mp-board-head">
            <span class="mp-col-name">PLAYER</span>
            <span class="mp-col-num">K</span>
            <span class="mp-col-num">D</span>
          </div>
          <div class="mp-board-body" id="mp-board-body"></div>
          <div class="mp-board-foot">HOLD TAB</div>
        </div>
      </div>
      <div class="mp-respawn" id="mp-respawn"></div>
      <div class="mp-end" id="mp-end"></div>
    `;

    document.body.appendChild(this.root);

    this.statusEl = this.root.querySelector('#mp-status') as HTMLElement;
    this.feedEl = this.root.querySelector('#mp-feed') as HTMLElement;
    this.boardEl = this.root.querySelector('#mp-board') as HTMLElement;
    this.boardBody = this.root.querySelector('#mp-board-body') as HTMLElement;
    this.respawnEl = this.root.querySelector('#mp-respawn') as HTMLElement;
    this.endEl = this.root.querySelector('#mp-end') as HTMLElement;

    this.boardEl.style.display = 'none';
    this.respawnEl.style.display = 'none';
    this.endEl.style.display = 'none';
  }

  public setActive(on: boolean): void {
    this.active = on;
    this.root.style.display = on ? 'block' : 'none';
    document.body.classList.toggle('mp-mode', on);
    if (!on) {
      this.clearFeed();
      this.hideRespawn();
      this.hideEnd();
      this.setScoreboardPinned(false);
    }
  }

  public get isActive(): boolean {
    return this.active;
  }

  // ---- Match status line ---------------------------------------------------

  /**
   * @param leader Highest score in the room, for the "X / limit" readout.
   * @param secondsLeft null when the match is untimed.
   */
  public updateStatus(leader: number, killLimit: number, secondsLeft: number | null, players: number): void {
    const clock =
      secondsLeft === null
        ? ''
        : ` · ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
    const text = `DEATHMATCH · ${leader}/${killLimit} FRAGS${clock} · ${players}/${MAX_PLAYERS}`;
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
    // Last thirty seconds go red so the clock actually reads as pressure.
    this.statusEl.classList.toggle('urgent', secondsLeft !== null && secondsLeft <= 30);
  }

  // ---- Kill feed -----------------------------------------------------------

  public pushKill(entry: KillFeedEntry): void {
    const row = document.createElement('div');
    row.className = 'mp-feed-row';
    if (entry.involvesSelf) row.classList.add('mine');

    const killer = document.createElement('span');
    killer.className = 'mp-feed-name';
    killer.style.color = colorCssFor(entry.killerColor);
    killer.textContent = entry.killerName;

    const verb = document.createElement('span');
    verb.className = 'mp-feed-verb';
    verb.textContent = entry.headshot ? ' ✷ ' : ' → ';

    const victim = document.createElement('span');
    victim.className = 'mp-feed-name';
    victim.style.color = colorCssFor(entry.victimColor);
    victim.textContent = entry.victimName;

    row.append(killer, verb, victim);
    this.feedEl.appendChild(row);
    this.feedRows.push({ el: row, expires: performance.now() * 0.001 + FEED_SECONDS });

    while (this.feedRows.length > FEED_MAX) {
      const oldest = this.feedRows.shift();
      oldest?.el.remove();
    }
  }

  private clearFeed(): void {
    for (const r of this.feedRows) r.el.remove();
    this.feedRows.length = 0;
  }

  // ---- Scoreboard ----------------------------------------------------------

  public setScoreboardPinned(on: boolean): void {
    this.boardPinned = on;
    // The end-of-match leaderboard owns the screen; TAB must not fight it.
    const visible = on && this.endEl.style.display === 'none';
    this.boardEl.style.display = visible ? 'flex' : 'none';
  }

  public renderScoreboard(roster: PeerInfo[], hostId: string): void {
    if (!this.boardPinned) return;
    const sorted = [...roster].sort(
      (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name)
    );
    this.boardBody.replaceChildren();
    for (const p of sorted) {
      const row = document.createElement('div');
      row.className = 'mp-board-row';
      if (p.isSelf) row.classList.add('self');
      if (!p.alive) row.classList.add('down');

      const name = document.createElement('span');
      name.className = 'mp-col-name';
      const dot = document.createElement('span');
      dot.className = 'mp-dot';
      dot.style.background = colorCssFor(p.colorIndex);
      const label = document.createElement('span');
      label.textContent = p.name + (p.id === hostId ? ' ★' : '');
      name.append(dot, label);

      const k = document.createElement('span');
      k.className = 'mp-col-num';
      k.textContent = String(p.kills);

      const d = document.createElement('span');
      d.className = 'mp-col-num';
      d.textContent = String(p.deaths);

      row.append(name, k, d);
      this.boardBody.appendChild(row);
    }
  }

  // ---- Respawn -------------------------------------------------------------

  public showRespawn(secondsLeft: number, killerName: string | null): void {
    this.respawnEl.style.display = 'flex';
    const secs = Math.max(0, Math.ceil(secondsLeft));
    this.respawnEl.replaceChildren();

    const title = document.createElement('div');
    title.className = 'mp-respawn-title';
    title.textContent = 'SKETCHED OUT';

    const by = document.createElement('div');
    by.className = 'mp-respawn-by';
    by.textContent = killerName ? `erased by ${killerName}` : 'erased';

    const count = document.createElement('div');
    count.className = 'mp-respawn-count';
    count.textContent = secs > 0 ? String(secs) : 'REDRAWING…';

    this.respawnEl.append(title, by, count);
  }

  public hideRespawn(): void {
    this.respawnEl.style.display = 'none';
  }

  // ---- End of match --------------------------------------------------------

  /**
   * Final leaderboard. Only the host gets a rematch button — everyone else is
   * told who they are waiting on, so nobody sits staring at a dead control.
   */
  public showEnd(
    standings: Standing[],
    selfId: string,
    isHost: boolean,
    hostName: string,
    reason: string
  ): void {
    this.boardEl.style.display = 'none';
    this.endEl.style.display = 'flex';
    this.endEl.replaceChildren();

    const card = document.createElement('div');
    card.className = 'mp-end-card';

    const tape = document.createElement('div');
    tape.className = 'modal-tape';

    const badge = document.createElement('div');
    badge.className = 'modal-badge';
    badge.textContent =
      reason === 'time' ? '[ TIME EXPIRED ]' : reason === 'hostLeft' ? '[ HOST LEFT ]' : '[ FRAG LIMIT REACHED ]';

    const title = document.createElement('div');
    title.className = 'mp-end-title';
    title.textContent = 'FINAL STANDINGS';

    const winner = standings[0];
    const crown = document.createElement('div');
    crown.className = 'mp-end-winner';
    if (winner) {
      const who = winner.id === selfId ? 'YOU WIN' : `${winner.name} WINS`;
      crown.textContent = `🏆 ${who}`;
      crown.style.color = colorCssFor(winner.colorIndex);
    }

    const table = document.createElement('div');
    table.className = 'mp-end-table';

    const head = document.createElement('div');
    head.className = 'mp-end-row mp-end-head';
    head.innerHTML =
      '<span class="mp-end-rank">#</span><span class="mp-end-name">PLAYER</span>' +
      '<span class="mp-end-num">KILLS</span><span class="mp-end-num">DEATHS</span><span class="mp-end-num">K/D</span>';
    table.appendChild(head);

    standings.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'mp-end-row';
      if (s.id === selfId) row.classList.add('self');

      const rank = document.createElement('span');
      rank.className = 'mp-end-rank';
      rank.textContent = String(i + 1);

      const name = document.createElement('span');
      name.className = 'mp-end-name';
      const dot = document.createElement('span');
      dot.className = 'mp-dot';
      dot.style.background = colorCssFor(s.colorIndex);
      const label = document.createElement('span');
      label.textContent = s.name;
      name.append(dot, label);

      const k = document.createElement('span');
      k.className = 'mp-end-num';
      k.textContent = String(s.kills);

      const d = document.createElement('span');
      d.className = 'mp-end-num';
      d.textContent = String(s.deaths);

      const kd = document.createElement('span');
      kd.className = 'mp-end-num';
      // Deaths of zero would divide by zero; a clean sheet just shows the kills.
      kd.textContent = s.deaths === 0 ? s.kills.toFixed(2) : (s.kills / s.deaths).toFixed(2);

      row.append(rank, name, k, d, kd);
      table.appendChild(row);
    });

    const actions = document.createElement('div');
    actions.className = 'mp-end-actions';

    if (isHost) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'menu-btn menu-btn-primary';
      again.textContent = 'REMATCH  ↵';
      again.addEventListener('click', () => this.onRematch?.());
      actions.appendChild(again);
    } else {
      const wait = document.createElement('div');
      wait.className = 'menu-waiting';
      wait.textContent = `WAITING ON ${hostName || 'THE HOST'} FOR A REMATCH…`;
      actions.appendChild(wait);
    }

    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'menu-btn menu-btn-ghost';
    leave.textContent = 'LEAVE ROOM';
    leave.addEventListener('click', () => this.onLeave?.());
    actions.appendChild(leave);

    card.append(tape, badge, title, crown, table, actions);
    this.endEl.appendChild(card);
  }

  public hideEnd(): void {
    this.endEl.style.display = 'none';
    this.endEl.replaceChildren();
  }

  public get isEndVisible(): boolean {
    return this.endEl.style.display !== 'none';
  }

  // ---- Frame ---------------------------------------------------------------

  public update(): void {
    if (!this.active || this.feedRows.length === 0) return;
    const now = performance.now() * 0.001;
    let i = 0;
    while (i < this.feedRows.length) {
      const row = this.feedRows[i];
      if (row.expires <= now) {
        row.el.remove();
        this.feedRows.splice(i, 1);
      } else {
        // Fade the last second so rows dissolve like drying ink.
        const left = row.expires - now;
        row.el.style.opacity = left < 1 ? String(Math.max(0, left)) : '1';
        i++;
      }
    }
  }
}
