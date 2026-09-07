/**
 * PLAYER PROFILE — the name, ink colour and character a player carries into
 * every match.
 *
 * Everything lives in localStorage. There is no account, no server record and
 * no database: a profile is three fields in this browser, editable from the
 * menu and from the in-game pause screen at any time.
 */

import { CHARACTERS, characterById, type CharacterId } from '../characters/Characters';

export interface PlayerProfile {
  name: string;
  /** Index into `INK_COLORS`, not a raw hex value, so palettes can be retuned. */
  colorIndex: number;
  /**
   * Which of the eight designs this player wears.
   *
   * Shape and colour are deliberately SEPARATE choices. The character decides
   * the silhouette; `colorIndex` still decides the ink, and the ink is what
   * ties an avatar to its name plate, its tracers and its line in the kill
   * feed. Two players on the same character in different colours must never
   * be hard to tell apart.
   */
  characterId: CharacterId;
}

/**
 * The eight ink colours a player picks from. THE WHOLE CHARACTER is drawn in
 * the chosen one — body hatching and trim alike — and the same colour carries
 * the name plate, the tracers and the kill feed, so an avatar, its label and
 * its bullets always agree.
 *
 * Deliberately excludes the crimson
 * (0xb71520 / 0xd63031) reserved for AI hostiles so a friend never reads as an
 * enemy at a glance, and every entry stays legible against cream paper.
 */
export const INK_COLORS: ReadonlyArray<{ name: string; hex: number }> = [
  { name: 'BALLPOINT NAVY', hex: 0x152778 },
  { name: 'TEAL', hex: 0x0f7b7b },
  { name: 'FOREST', hex: 0x2c6e2f },
  { name: 'PLUM', hex: 0x6b2d8c },
  { name: 'BURNT ORANGE', hex: 0xc25e12 },
  { name: 'GRAPHITE', hex: 0x3c3c46 },
  { name: 'MAGENTA', hex: 0xb5197a },
  { name: 'OCHRE', hex: 0x9a7a12 },
];

/**
 * Name length bounds. The upper bound is 15 because the longest name the
 * generator can produce ("SMUDGED-SWINGER") is exactly that, and a cap that
 * truncated its own default names would be a bug. The lower bound keeps a
 * player from hiding behind a one-character smudge on the scoreboard.
 */
export const NAME_MIN = 3;
export const NAME_MAX = 15;

const ADJECTIVES = [
  'INKY', 'SMUDGED', 'DRAFTED', 'TRACED', 'BOLD', 'FAINT', 'HATCHED',
  'DOODLED', 'PENNED', 'SKETCHY', 'BLOTTED', 'RULED',
];

const NOUNS = [
  'SPIDER', 'DRAFTER', 'SWINGER', 'NIB', 'MARGIN', 'BIRO', 'SCRAWL',
  'WEBHEAD', 'STENCIL', 'QUILL', 'GLYPH', 'SPLOTCH',
];

const KEY = 'spidey-profile-v1';

function randomInt(bound: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % bound;
}

export function randomName(): string {
  return `${ADJECTIVES[randomInt(ADJECTIVES.length)]}-${NOUNS[randomInt(NOUNS.length)]}`;
}

/**
 * Strips control characters and collapses whitespace so a name can never break
 * the scoreboard layout or smuggle markup into another player's HUD. Names are
 * also rendered via textContent everywhere — this is belt and braces, because
 * a name arrives over the wire from a peer we do not control.
 */
export function sanitizeName(raw: string): string {
  return String(raw ?? '')
    // Line breaks and tabs become a space, so "line<newline>break" stays two
    // readable words rather than welding into one.
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]/g, ' ')
    // Everything else non-printing just goes, including the zero-width
    // tricks used to fake a duplicate of somebody else’s name.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/** True when a sanitized name is long enough to accept. */
export function isNameValid(name: string): boolean {
  return name.length >= NAME_MIN && name.length <= NAME_MAX;
}

/**
 * Sanitizes, and falls back to a fresh random name when what is left is
 * unusable. Names arrive over the wire from peers we do not control, so this
 * is the last line of defence as well as a convenience for the local player.
 */
export function coerceName(raw: string): string {
  const clean = sanitizeName(raw);
  return isNameValid(clean) ? clean : randomName();
}

export function loadProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
      const name = sanitizeName(parsed.name ?? '');
      if (isNameValid(name)) {
        const idx = typeof parsed.colorIndex === 'number' ? parsed.colorIndex : 0;
        return {
          name,
          colorIndex: wrapColor(idx),
          // A profile saved before the roster existed, or naming a design that
          // has since been renamed, falls back to the default rather than
          // leaving the player with no avatar.
          characterId: coerceCharacterId(parsed.characterId),
        };
      }
    }
  } catch {
    // Private browsing or disabled storage: fall through to a fresh profile.
  }
  const fresh: PlayerProfile = {
    name: randomName(),
    colorIndex: randomInt(INK_COLORS.length),
    // Random, like the colour: a first-time player lands on somebody with a
    // silhouette rather than on the plainest sketch in the book.
    characterId: CHARACTERS[randomInt(CHARACTERS.length)].id,
  };
  saveProfile(fresh);
  return fresh;
}

export function saveProfile(p: PlayerProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Profile simply doesn't persist; the session still works.
  }
}

/**
 * Coerces anything into a real character id. Ids arrive from localStorage and
 * from peers we do not control, so this is a validation boundary, not a
 * convenience: `characterById` falls back to the first design for junk.
 */
export function coerceCharacterId(raw: unknown): CharacterId {
  return characterById(typeof raw === 'string' ? raw : '').id;
}

export function wrapColor(i: number): number {
  const n = INK_COLORS.length;
  return (((i | 0) % n) + n) % n;
}

export function colorHexFor(colorIndex: number): number {
  return INK_COLORS[wrapColor(colorIndex)].hex;
}

export function colorCssFor(colorIndex: number): string {
  return `#${colorHexFor(colorIndex).toString(16).padStart(6, '0')}`;
}
