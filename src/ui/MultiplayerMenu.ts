import { NetSession } from '../net/NetSession';
import {
  KILL_LIMIT_CHOICES,
  MAX_PLAYERS,
  TIME_LIMIT_CHOICES,
  type MatchConfig,
  type PeerInfo,
} from '../net/NetTypes';
import {
  INK_COLORS,
  NAME_MAX,
  NAME_MIN,
  colorCssFor,
  isNameValid,
  loadProfile,
  sanitizeName,
  saveProfile,
  type PlayerProfile,
} from '../net/Profile';
import { isValidRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from '../net/RoomCode';
import { characterById } from '../characters/Characters';
import { CharacterPicker } from './CharacterPicker';

type Screen = 'home' | 'mp' | 'join' | 'lobby' | 'dropin' | 'char';

/** Hand-drawn host crown, inked to match everything else on the page. */
const CROWN_SVG = `
  <svg viewBox="0 0 24 19" aria-hidden="true" focusable="false">
    <path d="M2.6 14.2 L4.1 4.6 L8.6 9.4 L12 2.9 L15.4 9.4 L19.9 4.6 L21.4 14.2 Z"
      fill="none" stroke="currentColor" stroke-width="1.9"
      stroke-linejoin="round" stroke-linecap="round" />
    <path d="M3.6 16.8 L20.4 16.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
  </svg>`;

/**
 * THE FRONT DOOR — everything before a match: identity, solo vs multiplayer,
 * creating or joining a room, the lobby, and the drop-in gate.
 *
 * It owns its own DOM overlay and never touches the game directly; `main.ts`
 * wires the two callbacks it exposes.
 */
export class MultiplayerMenu {
  private root: HTMLElement;
  private screens = new Map<Screen, HTMLElement>();
  private current: Screen = 'home';

  private profile: PlayerProfile;
  private charButton: HTMLButtonElement | null = null;
  private identitySwatches: HTMLElement | null = null;
  private picker: CharacterPicker | null = null;
  /** Screen to return to when the player closes character select. */
  private pickerReturn: Screen = 'home';
  private session: NetSession | null = null;
  private joinError = '';
  private pendingCode = '';

  /** Fired when the player picks solo — hands control to the classic flow. */
  public onSolo: (() => void) | null = null;
  /** Fired when a multiplayer match actually begins and the player drops in. */
  public onEnterMatch: ((session: NetSession) => void) | null = null;
  /** Fired when the player abandons a session and lands back on the menu. */
  public onLeaveSession: (() => void) | null = null;

  constructor() {
    this.profile = loadProfile();

    this.root = document.createElement('div');
    this.root.id = 'main-menu';
    this.root.className = 'menu-overlay';
    document.body.appendChild(this.root);

    this.buildChrome();
    this.show('home');
  }

  public get playerProfile(): PlayerProfile {
    return this.profile;
  }

  public get activeSession(): NetSession | null {
    return this.session;
  }

  public isOpen(): boolean {
    return this.root.style.display !== 'none';
  }

  public open(): void {
    this.root.style.display = 'flex';
    document.body.classList.remove('in-game');
  }

  public close(): void {
    this.picker?.unmount();
    this.root.style.display = 'none';
  }

  // ---- Chrome --------------------------------------------------------------

  private buildChrome(): void {
    const card = document.createElement('div');
    card.className = 'menu-card';
    card.innerHTML = `
      <div class="modal-tape"></div>
      <div class="modal-stamp">DRAFT #01 // ROSTER</div>
      <div class="modal-badge">[ SPIDEY SHOOT // BLUEPRINT DEATHMATCH ]</div>
      <div class="instructions-title">SPIDEY SHOOT</div>
      <div class="instructions-subtitle">FIRST-PERSON BALLPOINT BLUEPRINT FPS</div>
    `;

    card.appendChild(this.buildIdentityRow());

    const body = document.createElement('div');
    body.className = 'menu-body';
    card.appendChild(body);

    for (const name of ['home', 'mp', 'join', 'lobby', 'dropin', 'char'] as Screen[]) {
      const el = document.createElement('div');
      el.className = 'menu-screen';
      el.style.display = 'none';
      body.appendChild(el);
      this.screens.set(name, el);
    }

    this.root.appendChild(card);

    this.renderHome();
    this.renderMultiplayerPicker();
    this.renderJoin();
  }

  /** Name + ink colour, editable from every screen. */
  private buildIdentityRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'menu-identity';

    const label = document.createElement('span');
    label.className = 'menu-identity-label';
    label.textContent = 'SIGNED AS';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'menu-name-input';
    input.maxLength = NAME_MAX;
    input.value = this.profile.name;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Your player name');

    const hint = document.createElement('div');
    hint.className = 'menu-name-hint';

    /**
     * Rejects a too-short name by restoring the previous one rather than
     * silently inventing a random replacement — losing the name you just typed
     * to a generator is worse than being told it was too short.
     */
    const commit = () => {
      const next = sanitizeName(input.value);
      if (!isNameValid(next)) {
        hint.textContent = `NAMES ARE ${NAME_MIN}–${NAME_MAX} CHARACTERS`;
        input.classList.add('invalid');
        input.value = this.profile.name;
        return;
      }
      hint.textContent = '';
      input.classList.remove('invalid');
      if (next === this.profile.name) return;
      this.commitProfile({ ...this.profile, name: next });
    };

    input.addEventListener('input', () => {
      // Clear the scolding as soon as the name becomes acceptable again.
      if (isNameValid(sanitizeName(input.value))) {
        hint.textContent = '';
        input.classList.remove('invalid');
      }
    });
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    // ENTER starts the game everywhere else, so it must not bubble from here.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
    });

    const swatches = document.createElement('div');
    swatches.className = 'menu-swatches';
    INK_COLORS.forEach((c, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'menu-swatch';
      dot.style.background = colorCssFor(i);
      dot.title = c.name;
      dot.setAttribute('aria-label', `Ink colour ${c.name}`);
      if (i === this.profile.colorIndex) dot.classList.add('active');
      dot.addEventListener('click', () => {
        this.commitProfile({ ...this.profile, colorIndex: i });
      });
      swatches.appendChild(dot);
    });

    const charBtn = document.createElement('button');
    charBtn.type = 'button';
    charBtn.className = 'menu-charbtn';
    charBtn.title = 'Choose your character';
    charBtn.addEventListener('click', () => this.openPicker());
    this.charButton = charBtn;
    this.refreshCharButton();

    row.append(label, input, swatches, charBtn, hint);
    this.identitySwatches = swatches;
    return row;
  }

  /** Keeps the identity strip honest after a change made on another screen. */
  private refreshCharButton(): void {
    if (!this.charButton) return;
    const def = characterById(this.profile.characterId);
    this.charButton.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'menu-charbtn-dot';
    dot.style.background = colorCssFor(this.profile.colorIndex);
    const name = document.createElement('span');
    name.className = 'menu-charbtn-name';
    name.textContent = def.name;
    const hint = document.createElement('span');
    hint.className = 'menu-charbtn-hint';
    hint.textContent = 'CHANGE';
    this.charButton.append(dot, name, hint);
  }

  private refreshSwatches(): void {
    this.identitySwatches?.querySelectorAll('.menu-swatch').forEach((n, j) => {
      n.classList.toggle('active', j === this.profile.colorIndex);
    });
  }

  /**
   * The ONE path that changes identity: save it, tell the room, and refresh
   * every screen that shows it. Character select, the ink swatches and the
   * name field all come through here, so no two of them can disagree.
   */
  private commitProfile(next: PlayerProfile): void {
    this.profile = next;
    saveProfile(this.profile);
    this.session?.updateProfile(this.profile);
    this.refreshCharButton();
    this.refreshSwatches();
    this.picker?.sync(this.profile.characterId, this.profile.colorIndex);
    this.renderLobby();
  }

  // ---- Character select ----------------------------------------------------

  private openPicker(): void {
    if (this.current !== 'char') this.pickerReturn = this.current;
    if (!this.picker) {
      this.picker = new CharacterPicker(this.profile.characterId, this.profile.colorIndex);
      this.picker.onChange = (characterId, colorIndex) => {
        this.commitProfile({ ...this.profile, characterId, colorIndex });
      };
      const el = this.screen('char');
      el.replaceChildren();

      const title = document.createElement('div');
      title.className = 'menu-section-title';
      title.textContent = 'CHOOSE YOUR CHARACTER';
      el.appendChild(title);
      el.appendChild(this.picker.element);

      const actions = document.createElement('div');
      actions.className = 'menu-actions';
      actions.appendChild(
        this.button('DONE', 'menu-btn-primary', () => this.closePicker())
      );
      el.appendChild(actions);
    }
    this.picker.sync(this.profile.characterId, this.profile.colorIndex);
    this.show('char');
    // Mounted after the screen is visible, so the canvas can measure itself.
    this.picker.mount();
  }

  private closePicker(): void {
    // Stop the preview loop the moment it leaves the screen: it is sitting in
    // front of a game that wants the frame budget back.
    this.picker?.unmount();
    this.show(this.pickerReturn === 'char' ? 'home' : this.pickerReturn);
  }

  private show(screen: Screen): void {
    this.current = screen;
    for (const [name, el] of this.screens) {
      el.style.display = name === screen ? 'block' : 'none';
    }
    this.open();
  }

  private screen(name: Screen): HTMLElement {
    return this.screens.get(name)!;
  }

  private button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `menu-btn ${cls}`;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- Home ----------------------------------------------------------------

  private renderHome(): void {
    const el = this.screen('home');
    el.replaceChildren();

    const grid = document.createElement('div');
    grid.className = 'menu-choice-grid';

    grid.appendChild(
      this.choiceCard(
        'SOLO',
        'WAVE SURVIVAL',
        'Fight the red-ink invasion alone. Endless waves, rising modifiers.',
        () => {
          this.close();
          this.onSolo?.();
        }
      )
    );

    grid.appendChild(
      this.choiceCard(
        'MULTIPLAYER',
        'DEATHMATCH',
        `Swing and shoot against up to ${MAX_PLAYERS - 1} friends. Share a six-character code.`,
        () => this.show('mp')
      )
    );

    el.appendChild(grid);
  }

  private choiceCard(title: string, kicker: string, blurb: string, onClick: () => void): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-choice';
    b.innerHTML = `
      <span class="menu-choice-kicker"></span>
      <span class="menu-choice-title"></span>
      <span class="menu-choice-blurb"></span>
    `;
    (b.querySelector('.menu-choice-kicker') as HTMLElement).textContent = kicker;
    (b.querySelector('.menu-choice-title') as HTMLElement).textContent = title;
    (b.querySelector('.menu-choice-blurb') as HTMLElement).textContent = blurb;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- Create / join picker ------------------------------------------------

  private renderMultiplayerPicker(): void {
    const el = this.screen('mp');
    el.replaceChildren();

    const note = document.createElement('p');
    note.className = 'menu-note';
    note.textContent =
      'Rooms are peer-to-peer. Nothing is stored on a server and nothing leaves your browser but the game traffic itself.';

    const grid = document.createElement('div');
    grid.className = 'menu-choice-grid';
    grid.appendChild(
      this.choiceCard('CREATE ROOM', 'HOST', 'Open a room and get a code to share.', () =>
        this.createRoom()
      )
    );
    grid.appendChild(
      this.choiceCard('JOIN ROOM', 'GUEST', 'Enter a friend’s six-character code.', () => {
        this.joinError = '';
        this.pendingCode = '';
        this.renderJoin();
        this.show('join');
      })
    );

    const back = this.button('← BACK', 'menu-btn-ghost', () => this.show('home'));

    el.append(note, grid, back);
  }

  // ---- Join ----------------------------------------------------------------

  private renderJoin(): void {
    const el = this.screen('join');
    el.replaceChildren();

    const label = document.createElement('div');
    label.className = 'menu-section-title';
    label.textContent = 'ENTER ROOM CODE';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'menu-code-input';
    input.maxLength = ROOM_CODE_LENGTH;
    input.placeholder = '––––––';
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.value = this.pendingCode;

    const err = document.createElement('div');
    err.className = 'menu-error';
    err.textContent = this.joinError;

    const go = this.button('JOIN', 'menu-btn-primary', () => attempt());
    go.disabled = !isValidRoomCode(this.pendingCode);

    const attempt = () => {
      const code = normalizeRoomCode(input.value);
      if (!isValidRoomCode(code)) {
        this.joinError = `A room code is ${ROOM_CODE_LENGTH} characters.`;
        err.textContent = this.joinError;
        return;
      }
      this.joinRoom(code);
    };

    input.addEventListener('input', () => {
      // Fold as the player types so they see exactly what will be used.
      const folded = normalizeRoomCode(input.value);
      input.value = folded;
      this.pendingCode = folded;
      go.disabled = !isValidRoomCode(folded);
      if (this.joinError) {
        this.joinError = '';
        err.textContent = '';
      }
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && isValidRoomCode(normalizeRoomCode(input.value))) attempt();
    });

    const back = this.button('← BACK', 'menu-btn-ghost', () => this.show('mp'));

    el.append(label, input, err, go, back);
    setTimeout(() => input.focus(), 30);
  }

  // ---- Session lifecycle ---------------------------------------------------

  private createRoom(): void {
    this.attachSession(NetSession.create(this.profile));
  }

  private joinRoom(code: string): void {
    this.attachSession(NetSession.join(this.profile, code));
  }

  private attachSession(session: NetSession): void {
    this.session?.leave();
    this.session = session;

    session.onRosterChange = () => this.renderLobby();
    session.onPhaseChange = () => this.renderLobby();
    session.onKicked = (reason) => {
      this.joinError = reason;
      this.session = null;
      this.renderJoin();
      this.show('join');
    };
    session.onMatchStart = () => this.renderDropIn();
    session.onMatchEnd = () => {
      // The end-of-match leaderboard lives in the in-game HUD, not here.
    };

    this.show('lobby');
    this.renderLobby();
  }

  private leaveSession(): void {
    this.session?.leave();
    this.session = null;
    this.onLeaveSession?.();
    this.show('home');
  }

  // ---- Lobby ---------------------------------------------------------------

  private renderLobby(): void {
    const s = this.session;
    const el = this.screen('lobby');
    if (!s) {
      el.replaceChildren();
      return;
    }
    // Roster changes fire on every kill and respawn during a live match, when
    // this screen is closed and nobody can see it. Rebuilding the whole lobby
    // then is pure waste. (This guard is what the no-op it replaced intended.)
    if (!this.isOpen() || (this.current !== 'lobby' && this.current !== 'dropin')) {
      return;
    }

    el.replaceChildren();

    if (s.phase === 'error') {
      const err = document.createElement('div');
      err.className = 'menu-error menu-error-block';
      err.textContent = s.errorMessage || 'Could not connect.';
      el.append(err, this.button('← BACK', 'menu-btn-ghost', () => this.leaveSession()));
      return;
    }

    // Room code, big and copyable
    const codeBlock = document.createElement('div');
    codeBlock.className = 'menu-code-block';

    const codeLabel = document.createElement('div');
    codeLabel.className = 'menu-section-title';
    codeLabel.textContent = 'ROOM CODE';

    const codeValue = document.createElement('div');
    codeValue.className = 'menu-code-value';
    codeValue.textContent = s.code;

    const copy = this.button('COPY CODE', 'menu-btn-ghost menu-btn-small', () => {
      navigator.clipboard?.writeText(s.code).then(
        () => {
          copy.textContent = 'COPIED ✓';
          setTimeout(() => (copy.textContent = 'COPY CODE'), 1400);
        },
        () => {
          copy.textContent = 'COPY FAILED';
          setTimeout(() => (copy.textContent = 'COPY CODE'), 1400);
        }
      );
    });

    codeBlock.append(codeLabel, codeValue, copy);
    el.appendChild(codeBlock);

    // Roster
    const rosterTitle = document.createElement('div');
    rosterTitle.className = 'menu-section-title';
    rosterTitle.textContent = `PLAYERS ${s.playerCount} / ${MAX_PLAYERS}`;
    el.appendChild(rosterTitle);

    const list = document.createElement('ul');
    list.className = 'menu-roster';
    const ordered = [...s.roster].sort((a, b) => Number(b.isSelf) - Number(a.isSelf));
    for (const p of ordered) list.appendChild(this.rosterRow(p, s.hostId));
    el.appendChild(list);

    if (s.phase === 'connecting') {
      const waiting = document.createElement('div');
      waiting.className = 'menu-note';
      waiting.textContent = 'Reaching the matchmaking relays…';
      el.appendChild(waiting);
    }

    // Match rules — host edits, everyone reads
    el.appendChild(this.rulesBlock(s));

    const actions = document.createElement('div');
    actions.className = 'menu-actions';

    if (s.isHost) {
      const start = this.button('START MATCH', 'menu-btn-primary', () => s.startMatch());
      if (s.playerCount < 2) {
        start.disabled = true;
        start.title = 'At least one other player has to join first.';
      }
      actions.appendChild(start);
    } else {
      const waiting = document.createElement('div');
      waiting.className = 'menu-waiting';
      waiting.textContent = 'WAITING FOR HOST TO START…';
      actions.appendChild(waiting);
    }

    actions.appendChild(this.button('LEAVE ROOM', 'menu-btn-ghost', () => this.leaveSession()));
    el.appendChild(actions);
  }

  private rosterRow(p: PeerInfo, hostId: string): HTMLElement {
    const li = document.createElement('li');
    li.className = 'menu-roster-row';

    const dot = document.createElement('span');
    dot.className = 'menu-roster-dot';
    dot.style.background = colorCssFor(p.colorIndex);

    const name = document.createElement('span');
    name.className = 'menu-roster-name';
    // textContent, never innerHTML: this string came off the wire.
    name.textContent = p.name;

    // Your own row is the one with your name on it — it needs no "YOU" label,
    // just enough weight to find at a glance. The host gets a crown.
    if (p.isSelf) li.classList.add('is-self');

    const crown = document.createElement('span');
    crown.className = 'menu-roster-crown';
    if (p.id === hostId) {
      // Drawn, not an emoji: a colour glyph would be the only thing on screen
      // that is not ballpoint on paper. Static markup, no user data.
      crown.innerHTML = CROWN_SVG;
      crown.title = 'Host';
      crown.setAttribute('aria-label', 'Host');
    }

    // Which design they are wearing, so the lobby answers "who is the tall
    // one in teal?" before the match starts rather than during it.
    const char = document.createElement('span');
    char.className = 'menu-roster-char';
    char.textContent = characterById(p.characterId).name;

    li.append(dot, name, char, crown);
    return li;
  }

  private rulesBlock(s: NetSession): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'menu-rules';

    const title = document.createElement('div');
    title.className = 'menu-section-title';
    title.textContent = 'MATCH RULES';
    wrap.appendChild(title);

    wrap.appendChild(
      this.ruleRow(
        'FRAG LIMIT',
        KILL_LIMIT_CHOICES.map((n) => ({ label: String(n), value: n })),
        s.config.killLimit,
        s.isHost,
        (v) => s.setConfig({ killLimit: v })
      )
    );

    wrap.appendChild(
      this.ruleRow(
        'TIME LIMIT',
        TIME_LIMIT_CHOICES.map((n) => ({ label: n === 0 ? 'NONE' : `${n / 60} MIN`, value: n })),
        s.config.timeLimitSec,
        s.isHost,
        (v) => s.setConfig({ timeLimitSec: v })
      )
    );

    return wrap;
  }

  private ruleRow(
    label: string,
    options: Array<{ label: string; value: number }>,
    active: number,
    editable: boolean,
    onPick: (v: number) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'menu-rule-row';

    const l = document.createElement('span');
    l.className = 'menu-rule-label';
    l.textContent = label;
    row.appendChild(l);

    const opts = document.createElement('div');
    opts.className = 'menu-rule-options';
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-pill';
      b.textContent = o.label;
      if (o.value === active) b.classList.add('active');
      if (!editable) {
        b.disabled = true;
      } else {
        b.addEventListener('click', () => onPick(o.value));
      }
      opts.appendChild(b);
    }
    row.appendChild(opts);
    return row;
  }

  // ---- Drop in -------------------------------------------------------------

  /**
   * A match cannot grab pointer lock straight off a network packet — browsers
   * require a user gesture — so everyone passes through this gate. It doubles
   * as a "get ready" beat, which is nicer than being dropped in mid-blink.
   */
  private renderDropIn(): void {
    const el = this.screen('dropin');
    el.replaceChildren();

    const title = document.createElement('div');
    title.className = 'menu-dropin-title';
    title.textContent = 'MATCH IS LIVE';

    const sub = document.createElement('div');
    sub.className = 'menu-note';
    const s = this.session;
    sub.textContent = s
      ? `First to ${s.config.killLimit} frags${s.config.timeLimitSec ? ` · ${s.config.timeLimitSec / 60} minute clock` : ''}`
      : '';

    const go = this.button('DROP IN  ↵', 'menu-btn-primary menu-btn-huge', () => this.dropIn());

    const hint = document.createElement('div');
    hint.className = 'menu-note';
    hint.textContent = 'Press ENTER or click to take the field.';

    el.append(title, sub, go, hint);
    this.show('dropin');
  }

  private dropIn(): void {
    if (!this.session) return;
    this.close();
    this.onEnterMatch?.(this.session);
  }

  /** Called by main.ts for the global ENTER handler. */
  public handleEnterKey(): boolean {
    if (!this.isOpen()) return false;
    if (this.current === 'dropin') {
      this.dropIn();
      return true;
    }
    return false;
  }

  /** Re-opens the menu on the lobby after a match, ready for a rematch. */
  public returnToLobby(): void {
    if (this.session && this.session.phase !== 'idle') {
      this.show('lobby');
      this.renderLobby();
    } else {
      this.session = null;
      this.show('home');
    }
  }
}

export type { MatchConfig };
