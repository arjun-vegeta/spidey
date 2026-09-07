/**
 * ROOM CODES — six characters, Crockford-style base32.
 *
 * The alphabet omits I, L, O and U so a code read aloud over voice chat or
 * copied off a screen can't land on the wrong room: typed `O` folds to `0`,
 * typed `I`/`L` fold to `1`, and `U` never appears at all (it keeps codes from
 * spelling anything unfortunate). 32^6 is a little over a billion codes, which
 * is far more than enough for rooms that only live as long as the browser tab.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ROOM_CODE_LENGTH = 6;

/**
 * Cryptographically random room code. Uses `getRandomValues` rather than
 * `randomUUID` because the latter is secure-context-only and LAN play is
 * served over plain http from a machine's local IP.
 */
export function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Folds a human-typed code onto the canonical alphabet: uppercases, maps the
 * visually confusable characters onto the ones we actually generate, and drops
 * separators people add out of habit (spaces, dashes).
 */
export function normalizeRoomCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    const folded = ch === 'O' ? '0' : ch === 'I' || ch === 'L' ? '1' : ch;
    if (ALPHABET.includes(folded)) out += folded;
    if (out.length === ROOM_CODE_LENGTH) break;
  }
  return out;
}

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}
