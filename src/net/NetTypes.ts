/**
 * WIRE PROTOCOL for Spidey deathmatch.
 *
 * Trust model — deliberately the loose one that suits a game you play with
 * friends over a room code, not a ranked ladder:
 *
 *   - Each peer is authoritative over its OWN avatar transform. Nobody can
 *     move anybody else.
 *   - Each peer is authoritative over its OWN health. A shooter reports a hit;
 *     the victim decides what it costs and whether it killed them. This is why
 *     `hit` is sent to one target rather than broadcast.
 *   - Kills are counted from the victim's `died` broadcast, which every peer
 *     receives, so scoreboards agree without anyone tallying centrally.
 *   - The host is a tiebreaker, not a server: it owns the roster, the match
 *     config, and the moment the match starts and ends.
 *
 * A determined peer can cheat. That is an accepted trade for needing no
 * server, no account and no database anywhere in the stack.
 */

/** Hard cap on a single room. The host turns away anyone past this. */
export const MAX_PLAYERS = 8;

/** Transform broadcasts per second. 15 is smooth once interpolated. */
export const STATE_HZ = 15;

/** How long a corpse waits before it can respawn, in seconds. */
export const RESPAWN_SECONDS = 3;

/**
 * Presence beat, in ms. Sent on a timer rather than from the render loop so a
 * player sitting in a lobby, paused on the escape menu, or watching a respawn
 * counter still counts as present.
 */
export const HEARTBEAT_MS = 3000;

/**
 * Silence longer than this retires a peer. WebRTC does not reliably fire a
 * close event when a laptop lid shuts, so this is the real backstop — but it
 * must be comfortably longer than several missed heartbeats, or an ordinary
 * network hiccup would evict somebody mid-match.
 */
export const PEER_TIMEOUT_MS = 15000;

import type { CharacterId } from '../characters/Characters';

export type MatchConfig = {
  /** First to this many kills ends the match. */
  killLimit: number;
  /** Match length in seconds; 0 means no clock. */
  timeLimitSec: number;
};

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  killLimit: 15,
  timeLimitSec: 300,
};

export const KILL_LIMIT_CHOICES = [5, 10, 15, 25] as const;
export const TIME_LIMIT_CHOICES = [0, 180, 300, 600] as const;

/** Roster entry as every peer sees it. */
export interface PeerInfo {
  id: string;
  name: string;
  colorIndex: number;
  /** Which of the eight designs to draw for this peer. */
  characterId: CharacterId;
  kills: number;
  deaths: number;
  /** Best-effort liveness marker, refreshed on every packet from this peer. */
  lastSeen: number;
  /** False while the peer is waiting out a respawn. */
  alive: boolean;
  isSelf: boolean;
}

export type Standing = {
  id: string;
  name: string;
  colorIndex: number;
  kills: number;
  deaths: number;
};

/** Compact transform packet — the only message sent at frame-ish rates. */
export type StatePacket = {
  /** position x, y, z */
  p: [number, number, number];
  /** yaw, pitch */
  r: [number, number];
  /** bitfield: 1 swinging, 2 crouching, 4 sprinting, 8 dead, 16 grounded */
  f: number;
  /** active weapon index */
  w: number;
  /**
   * Current health. Without this a shooter's predicted damage is never
   * corrected, so a wounded rival's floating bar would stay wrong through
   * their whole regen.
   */
  h: number;
  /** web anchor point while swinging, so remote web lines draw */
  a?: [number, number, number];
};

export const FLAG_SWINGING = 1;
export const FLAG_CROUCHING = 2;
export const FLAG_SPRINTING = 4;
export const FLAG_DEAD = 8;
export const FLAG_GROUNDED = 16;

export type NetEvent =
  /**
   * Profile announce: sent on join, and again whenever the player renames,
   * recolours or switches character. `char` is a roster id, validated on
   * arrival — a peer can put anything on the wire.
   */
  | { t: 'hello'; name: string; colorIndex: number; char: string }
  /** Presence beat. Carries nothing; arriving at all is the whole message. */
  | { t: 'ping' }
  /** Host → everyone: authoritative roster, config and host identity. */
  | { t: 'lobby'; host: string; cfg: MatchConfig; order: string[] }
  /** Host → one peer: the room is at MAX_PLAYERS, please leave. */
  | { t: 'full' }
  /** Host → everyone: match begins now. */
  | { t: 'start'; cfg: MatchConfig; startedAt: number }
  /** Shooter → everyone: replicate a tracer and a gunshot. */
  | { t: 'shot'; o: [number, number, number]; d: [number, number, number]; w: string }
  /** Shooter → victim: "I hit you". The victim decides the consequences. */
  | { t: 'hit'; dmg: number; hs: boolean; p: [number, number, number]; from: [number, number, number] }
  /** Victim → everyone: I died, credit this peer. */
  | { t: 'died'; by: string | null; hs: boolean }
  /** Respawner → everyone: I am back, at this position. */
  | { t: 'spawn'; p: [number, number, number] }
  /** Host → everyone: match over, here are the final standings. */
  | { t: 'end'; standings: Standing[]; reason: 'kills' | 'time' | 'hostLeft' }
  /** Host → everyone: reset scores and play again. */
  | { t: 'rematch'; cfg: MatchConfig; startedAt: number };

export type NetPhase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'ended' | 'error';

/**
 * Sorts standings the way a scoreboard should read: kills descending, then
 * fewest deaths, then name so the order is stable across peers rather than
 * depending on Map insertion order (which differs per machine).
 */
export function sortStandings(rows: Standing[]): Standing[] {
  return [...rows].sort(
    (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name)
  );
}
