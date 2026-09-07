import { joinRoom, selfId, type Room } from 'trystero';
import {
  DEFAULT_MATCH_CONFIG,
  HEARTBEAT_MS,
  MAX_PLAYERS,
  PEER_TIMEOUT_MS,
  sortStandings,
  type MatchConfig,
  type NetEvent,
  type NetPhase,
  type PeerInfo,
  type Standing,
  type StatePacket,
} from './NetTypes';
import { coerceCharacterId, coerceName, wrapColor, type PlayerProfile } from './Profile';
import { generateRoomCode } from './RoomCode';

/**
 * Namespaces every room under this build so a stranger running some other
 * Trystero app can never collide with a Spidey room code.
 */
const APP_ID = 'spidey-shoot-ink-fps';

/**
 * ONLINE SESSION — a room of up to eight players, built on Trystero.
 *
 * Trystero handles matchmaking over public Nostr relays and then hands us a
 * direct, end-to-end-encrypted WebRTC mesh. The relays only ever carry the
 * handshake; once peers are connected, gameplay traffic goes straight between
 * browsers. That is what lets the whole game deploy as static files with no
 * backend of any kind.
 *
 * This class owns everything about a room EXCEPT the 3D representation of the
 * other players — see `RemotePlayerManager` for that. It deliberately knows
 * nothing about three.js so the lobby can run before the match does.
 */
export class NetSession {
  public readonly code: string;
  public readonly isCreator: boolean;

  public phase: NetPhase = 'connecting';
  public errorMessage: string = '';

  /** Peer id of the current host. Empty until the first lobby packet lands. */
  public hostId: string = '';
  public config: MatchConfig = { ...DEFAULT_MATCH_CONFIG };

  /** The host's wall-clock ms for the match start. Informational only. */
  public startedAt: number = 0;
  /**
   * OUR OWN clock reading for the same moment.
   *
   * The countdown is measured from this, never from `startedAt`. Two machines
   * routinely disagree about what time it is by seconds or minutes, and
   * subtracting the host's timestamp from our own clock would show a guest
   * either a timer longer than the limit or a frozen 0:00 for the whole match.
   * Every peer starts within a network hop of the others, so anchoring locally
   * is both accurate and immune to skew.
   */
  private localStartMs: number = 0;
  public finalStandings: Standing[] = [];
  public endReason: 'kills' | 'time' | 'hostLeft' | '' = '';

  private room: Room | null = null;
  private profile: PlayerProfile;
  private peers = new Map<string, PeerInfo>();
  private sendState!: (data: StatePacket, opts?: { target?: string }) => void;
  private sendEvent!: (data: NetEvent, opts?: { target?: string }) => void;
  private disposed = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ---- Callbacks wired by the UI and by Game -------------------------------
  public onRosterChange: ((roster: PeerInfo[]) => void) | null = null;
  public onPhaseChange: ((phase: NetPhase) => void) | null = null;
  public onMatchStart: ((cfg: MatchConfig, startedAt: number) => void) | null = null;
  public onMatchEnd: ((standings: Standing[], reason: string) => void) | null = null;
  public onRemoteState: ((peerId: string, s: StatePacket) => void) | null = null;
  public onRemoteShot: ((peerId: string, o: number[], d: number[], weapon: string) => void) | null = null;
  public onIncomingHit:
    | ((dmg: number, headshot: boolean, point: number[], from: number[], shooterId: string) => void)
    | null = null;
  public onRemoteDeath: ((peerId: string, killerId: string | null, headshot: boolean) => void) | null = null;
  public onRemoteSpawn: ((peerId: string, pos: number[]) => void) | null = null;
  public onKicked: ((reason: string) => void) | null = null;

  private constructor(code: string, profile: PlayerProfile, isCreator: boolean, cfg?: MatchConfig) {
    this.code = code;
    this.profile = profile;
    this.isCreator = isCreator;
    if (cfg) this.config = { ...cfg };
    if (isCreator) this.hostId = selfId;

    this.peers.set(selfId, {
      id: selfId,
      name: profile.name,
      colorIndex: profile.colorIndex,
      characterId: profile.characterId,
      kills: 0,
      deaths: 0,
      lastSeen: Date.now(),
      alive: true,
      isSelf: true,
    });

    this.connect();
  }

  /** Opens a brand-new room and returns its freshly minted six-character code. */
  public static create(profile: PlayerProfile, cfg: MatchConfig = DEFAULT_MATCH_CONFIG): NetSession {
    return new NetSession(generateRoomCode(), profile, true, cfg);
  }

  /** Joins an existing room. The code must already be normalized and valid. */
  public static join(profile: PlayerProfile, code: string): NetSession {
    return new NetSession(code, profile, false);
  }

  public get selfId(): string {
    return selfId;
  }

  /** The local player's own name, ink and character. */
  public get localProfile(): PlayerProfile {
    return this.profile;
  }

  public get isHost(): boolean {
    return this.hostId === selfId;
  }

  public get roster(): PeerInfo[] {
    return [...this.peers.values()];
  }

  public get playerCount(): number {
    return this.peers.size;
  }

  public getPeer(id: string): PeerInfo | undefined {
    return this.peers.get(id);
  }

  private connect(): void {
    let room: Room;
    try {
      room = joinRoom(
        {
          appId: APP_ID,
          // The room code doubles as the handshake password, so knowing the
          // Nostr topic alone is not enough to sit in on somebody's game.
          password: this.code,
        },
        `spidey-${this.code}`,
        {
          onJoinError: (details) => this.fail(details.error || 'Could not reach the matchmaking relays.'),
        }
      );
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
      return;
    }

    this.room = room;

    const stateAction = room.makeAction<StatePacket>('pstate');
    const eventAction = room.makeAction<NetEvent>('pevent');

    this.sendState = (data, opts) => {
      stateAction.send(data, opts).catch(() => {
        /* A peer vanishing mid-send is normal; onPeerLeave does the cleanup. */
      });
    };
    this.sendEvent = (data, opts) => {
      eventAction.send(data, opts).catch(() => {
        /* Same: never let a dropped peer reject into an unhandled rejection. */
      });
    };

    stateAction.onMessage = (data, ctx) => {
      const peer = this.peers.get(ctx.peerId);
      if (!peer) return;
      peer.lastSeen = Date.now();
      this.onRemoteState?.(ctx.peerId, data);
    };

    eventAction.onMessage = (data, ctx) => this.handleEvent(data, ctx.peerId);

    room.onPeerJoin = (peerId) => {
      // Announce ourselves to the newcomer; they answer with their own hello.
      this.sendEvent(this.helloPacket(), { target: peerId });
      if (this.isHost) this.admitOrReject(peerId);
    };

    room.onPeerLeave = (peerId) => this.removePeer(peerId);

    // Presence runs on its own clock, never the render loop: a player waiting
    // in a lobby or paused on the escape menu sends no game traffic at all, and
    // without this they would age out of everyone else's roster.
    this.heartbeatTimer = setInterval(() => this.onHeartbeat(), HEARTBEAT_MS);

    this.setPhase('lobby');
    this.emitRoster();
  }

  private onHeartbeat(): void {
    if (this.disposed || !this.room) return;
    this.sendEvent({ t: 'ping' });
    this.pruneStalePeers();
  }

  /**
   * Host-side gate. Trystero rooms are open to anyone holding the code, so the
   * player cap is enforced here: the ninth peer is told the room is full and
   * shows itself the door.
   */
  private admitOrReject(peerId: string): void {
    if (this.peers.size >= MAX_PLAYERS) {
      this.sendEvent({ t: 'full' }, { target: peerId });
      return;
    }
    this.broadcastLobby();
  }

  private handleEvent(ev: NetEvent, from: string): void {
    const known = this.peers.get(from);
    if (known) known.lastSeen = Date.now();

    switch (ev.t) {
      case 'hello': {
        const existing = this.peers.get(from);
        const name = coerceName(ev.name);
        const colorIndex = wrapColor(ev.colorIndex);
        const characterId = coerceCharacterId(ev.char);
        if (existing) {
          existing.name = name;
          existing.colorIndex = colorIndex;
          existing.characterId = characterId;
        } else {
          if (this.peers.size >= MAX_PLAYERS) {
            // The host will turn them away; until then, refuse to show a
            // ninth player on any scoreboard.
            break;
          }
          this.peers.set(from, {
            id: from,
            name,
            colorIndex,
            characterId,
            kills: 0,
            deaths: 0,
            lastSeen: Date.now(),
            alive: true,
            isSelf: false,
          });
          // A peer we had not met yet: make sure they have our profile too.
          this.sendEvent(this.helloPacket(), { target: from });
        }
        if (this.isHost) this.broadcastLobby();
        this.emitRoster();
        break;
      }

      case 'lobby': {
        // Only the acknowledged host may redefine the room.
        if (this.hostId && from !== this.hostId && from !== ev.host) break;
        this.hostId = ev.host;
        this.config = { ...ev.cfg };
        this.emitRoster();
        break;
      }

      case 'ping':
        // Refreshing `lastSeen` above was the entire point.
        break;

      case 'full':
        this.errorMessage = `That room already has ${MAX_PLAYERS} players.`;
        this.setPhase('error');
        this.onKicked?.(this.errorMessage);
        this.leave();
        break;

      case 'start':
        if (from !== this.hostId) break;
        this.config = { ...ev.cfg };
        this.beginMatch(ev.startedAt);
        break;

      case 'shot':
        this.onRemoteShot?.(from, ev.o, ev.d, ev.w);
        break;

      case 'hit':
        this.onIncomingHit?.(ev.dmg, ev.hs, ev.p, ev.from, from);
        break;

      case 'died': {
        const victim = this.peers.get(from);
        // Counting only the transition from alive to dead makes a repeated or
        // replayed `died` harmless, instead of relying on nobody ever sending
        // one twice.
        if (!victim || !victim.alive) break;
        victim.deaths++;
        victim.alive = false;
        if (ev.by && ev.by !== from) {
          const killer = this.peers.get(ev.by);
          if (killer) killer.kills++;
        }
        this.onRemoteDeath?.(from, ev.by, ev.hs);
        this.emitRoster();
        this.checkMatchEnd();
        break;
      }

      case 'spawn': {
        const peer = this.peers.get(from);
        if (peer) peer.alive = true;
        this.onRemoteSpawn?.(from, ev.p);
        this.emitRoster();
        break;
      }

      case 'end':
        if (from !== this.hostId) break;
        this.concludeMatch(ev.standings, ev.reason);
        break;

      case 'rematch':
        if (from !== this.hostId) break;
        this.config = { ...ev.cfg };
        this.resetScores();
        this.beginMatch(ev.startedAt);
        break;
    }
  }

  // ---- Lobby ---------------------------------------------------------------

  private broadcastLobby(): void {
    if (!this.isHost) return;
    this.sendEvent({ t: 'lobby', host: selfId, cfg: this.config, order: [...this.peers.keys()] });
  }

  /** Host-only: change the rules everyone will play by. */
  public setConfig(cfg: Partial<MatchConfig>): void {
    if (!this.isHost) return;
    this.config = { ...this.config, ...cfg };
    this.broadcastLobby();
    this.emitRoster();
  }

  /**
   * Applies a profile change — rename, recolour or a different character —
   * locally and announces it. One packet covers all three, so switching
   * character mid-lobby needs no new message and no reconnect.
   */
  public updateProfile(profile: PlayerProfile): void {
    this.profile = profile;
    const me = this.peers.get(selfId);
    if (me) {
      me.name = profile.name;
      me.colorIndex = profile.colorIndex;
      me.characterId = profile.characterId;
    }
    this.sendEvent(this.helloPacket());
    this.emitRoster();
  }

  /** Our own profile announce. One place, so the three fields never drift. */
  private helloPacket(): NetEvent {
    return {
      t: 'hello',
      name: this.profile.name,
      colorIndex: this.profile.colorIndex,
      char: this.profile.characterId,
    };
  }

  /** Host-only: drop the lobby and start the deathmatch on every machine. */
  public startMatch(): void {
    if (!this.isHost) return;
    const startedAt = Date.now();
    this.resetScores();
    this.sendEvent({ t: 'start', cfg: this.config, startedAt });
    this.beginMatch(startedAt);
  }

  /** Host-only: replay with the same room, same people, scores back to zero. */
  public requestRematch(): void {
    if (!this.isHost) return;
    const startedAt = Date.now();
    this.resetScores();
    this.sendEvent({ t: 'rematch', cfg: this.config, startedAt });
    this.beginMatch(startedAt);
  }

  private beginMatch(startedAt: number): void {
    this.startedAt = startedAt;
    this.localStartMs = Date.now();
    // A lobby can sit for minutes; do not carry stale liveness into the match.
    const now = Date.now();
    for (const p of this.peers.values()) p.lastSeen = now;
    this.finalStandings = [];
    this.endReason = '';
    for (const p of this.peers.values()) p.alive = true;
    this.setPhase('playing');
    this.onMatchStart?.(this.config, startedAt);
    this.emitRoster();
  }

  private resetScores(): void {
    for (const p of this.peers.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.alive = true;
    }
  }

  // ---- Match reporting -----------------------------------------------------

  public reportState(s: StatePacket): void {
    if (this.phase !== 'playing') return;
    this.sendState(s);
  }

  public reportShot(origin: number[], dir: number[], weapon: string): void {
    if (this.phase !== 'playing') return;
    this.sendEvent({
      t: 'shot',
      o: [origin[0], origin[1], origin[2]],
      d: [dir[0], dir[1], dir[2]],
      w: weapon,
    });
  }

  /** Tell one victim we hit them. They decide the damage's consequences. */
  public reportHit(targetId: string, dmg: number, headshot: boolean, point: number[], from: number[]): void {
    if (this.phase !== 'playing') return;
    this.sendEvent(
      {
        t: 'hit',
        dmg,
        hs: headshot,
        p: [point[0], point[1], point[2]],
        from: [from[0], from[1], from[2]],
      },
      { target: targetId }
    );
  }

  /** Announce our own death. Every peer credits the killer from this one packet. */
  public reportDeath(killerId: string | null, headshot: boolean): void {
    const me = this.peers.get(selfId);
    // Same alive-to-dead guard as the remote path, so a double report costs
    // nothing on our own scoreboard either.
    if (!me || !me.alive) return;
    me.deaths++;
    me.alive = false;
    if (killerId && killerId !== selfId) {
      const killer = this.peers.get(killerId);
      if (killer) killer.kills++;
    }
    this.sendEvent({ t: 'died', by: killerId, hs: headshot });
    this.emitRoster();
    this.checkMatchEnd();
  }

  public reportSpawn(pos: number[]): void {
    const me = this.peers.get(selfId);
    if (me) me.alive = true;
    this.sendEvent({ t: 'spawn', p: [pos[0], pos[1], pos[2]] });
    this.emitRoster();
  }

  public standings(): Standing[] {
    return sortStandings(
      this.roster.map((p) => ({
        id: p.id,
        name: p.name,
        colorIndex: p.colorIndex,
        kills: p.kills,
        deaths: p.deaths,
      }))
    );
  }

  /** Seconds left on the clock, or null when the match is untimed. */
  public secondsRemaining(): number | null {
    if (!this.config.timeLimitSec || this.phase !== 'playing') return null;
    const elapsed = (Date.now() - this.localStartMs) / 1000;
    return Math.max(0, Math.ceil(this.config.timeLimitSec - elapsed));
  }

  /**
   * Host-only end-of-match check. Guests never decide this for themselves —
   * they wait for the host's `end` packet so nobody sees a different winner.
   */
  private checkMatchEnd(): void {
    if (!this.isHost || this.phase !== 'playing') return;
    const limit = this.config.killLimit;
    if (limit > 0 && this.roster.some((p) => p.kills >= limit)) {
      this.declareEnd('kills');
    }
  }

  /** Driven from the game loop so the clock can expire without any traffic. */
  public tick(): void {
    if (this.disposed) return;
    if (this.isHost && this.phase === 'playing') {
      const left = this.secondsRemaining();
      if (left !== null && left <= 0) this.declareEnd('time');
    }
  }

  private declareEnd(reason: 'kills' | 'time' | 'hostLeft'): void {
    const standings = this.standings();
    this.sendEvent({ t: 'end', standings, reason });
    this.concludeMatch(standings, reason);
  }

  private concludeMatch(standings: Standing[], reason: 'kills' | 'time' | 'hostLeft'): void {
    this.finalStandings = sortStandings(standings);
    this.endReason = reason;
    this.setPhase('ended');
    this.onMatchEnd?.(this.finalStandings, reason);
  }

  // ---- Peer churn ----------------------------------------------------------

  private removePeer(peerId: string): void {
    if (!this.peers.delete(peerId)) return;

    // Host election is by lowest id among everyone still here: every peer runs
    // the same comparison over the same set, so they all reach the same answer
    // without a vote.
    if (peerId === this.hostId) {
      const ids = [...this.peers.keys()].sort();
      this.hostId = ids[0] ?? selfId;
      if (this.isHost) this.broadcastLobby();
    }

    this.emitRoster();
    this.checkMatchEnd();
  }

  /**
   * WebRTC does not always fire a clean close when a laptop lid shuts or a
   * network drops, so a peer that has gone quiet for a long time is retired.
   */
  private pruneStalePeers(): void {
    const cutoff = Date.now() - PEER_TIMEOUT_MS;
    let dropped = false;
    for (const [id, p] of this.peers) {
      if (id === selfId || p.lastSeen >= cutoff) continue;
      this.peers.delete(id);
      dropped = true;
    }
    if (dropped) this.emitRoster();
  }

  // ---- Plumbing ------------------------------------------------------------

  private setPhase(phase: NetPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.onPhaseChange?.(phase);
  }

  private fail(message: string): void {
    this.errorMessage = message;
    this.setPhase('error');
  }

  private emitRoster(): void {
    this.onRosterChange?.(this.roster);
  }

  public leave(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    try {
      this.room?.leave();
    } catch {
      // Already torn down; nothing to do.
    }
    this.room = null;
    this.peers.clear();
    this.setPhase('idle');
  }
}
