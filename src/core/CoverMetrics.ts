/**
 * COVER METRICS — the one place that decides how tall a railing is and how the
 * player's silhouette sits against it.
 *
 * The whole cover mechanic is GEOMETRIC. Nothing anywhere special-cases "player
 * is crouched behind a rail, disable firing": every railing in the city is a
 * solid half-height wall, and the numbers below are chosen so that the ordinary
 * raycasts already in the game produce the intended behaviour:
 *
 *   STANDING behind a rail  eye at 1.70m  > 0.90m rail  -> shots clear it, you can fire
 *                           chest 1.22m   > 0.90m rail  -> enemies see you, you are exposed
 *
 *   CROUCHED behind a rail  eye at 0.72m  < 0.90m rail  -> your own shot hits the rail
 *                           hitbox top 0.90m <= rail top -> enemy bullets stop in the rail
 *                           chest 0.61m   < 0.90m rail  -> enemy LOS is blocked, they hold fire
 *
 *   CROUCHED IN THE OPEN    nothing in front of the muzzle, so you shoot and get shot
 *                           normally. Crouch is only cover when there is cover.
 *
 * Consequence: the trade-off is real. Stand up to shoot and take fire, duck to
 * be safe and give up your gun. And it holds at every rail in the world because
 * every rail is built from COVER_RAIL_HEIGHT.
 */

/** Standing character height, in metres. Everything else is derived from this. */
export const CHARACTER_HEIGHT = 1.8;

/**
 * Every balcony rail, terrace parapet, catwalk guard, balustrade and roof
 * parapet in the city is exactly half a character tall.
 */
export const COVER_RAIL_HEIGHT = CHARACTER_HEIGHT * 0.5; // 0.9

/**
 * Minimum solid thickness for a rail panel. Rails must be SOLID up to
 * COVER_RAIL_HEIGHT — an open balustrade of thin bars lets bullets through the
 * gaps and would not read as cover, so bar-and-post rails get an infill panel.
 */
export const RAIL_PANEL_THICKNESS = 0.12;

/**
 * Crouched height matches the rail exactly, so a crouched player's whole
 * silhouette fits behind one with nothing poking over the lip.
 */
export const CROUCH_HEIGHT = COVER_RAIL_HEIGHT; // 0.9

/** Eye height above the feet while standing — well clear of the rail. */
export const STAND_EYE_ABOVE_FEET = 1.7;

/**
 * Eye height above the feet while crouched. Deliberately below the rail lip so
 * a shot fired from cover hits the rail instead of the enemy.
 */
export const CROUCH_EYE_ABOVE_FEET = 0.72;

/**
 * Where enemies aim, as a fraction of the player's current stance height.
 * Standing -> 1.22m (over a 0.9m rail); crouched -> 0.61m (buried behind it).
 * Aiming at the raw capsule centre would put the standing aim point at exactly
 * 0.9m, right on the rail lip, and enemies would flicker in and out of LOS.
 */
export const CHEST_FRACTION = 0.68;

/**
 * Extra generosity above the head so shots at the hair still register while
 * standing. It is NOT applied when crouched: a 0.35m bonus would push the
 * crouched hitbox to 1.25m and let bullets clear the rail into the player's
 * head, which is exactly the cover leak this margin must not create.
 */
export const STAND_HEAD_MARGIN = 0.35;

/** Eye offset from the capsule CENTRE (the convention `Player.eyeH` uses). */
export function eyeOffsetFromCenter(crouching: boolean): number {
  return crouching
    ? CROUCH_EYE_ABOVE_FEET - CROUCH_HEIGHT * 0.5
    : STAND_EYE_ABOVE_FEET - CHARACTER_HEIGHT * 0.5;
}

/**
 * World Y of the chest aim point, given the capsule centre Y and the current
 * stance height. Enemies aim and run their line-of-sight check against this.
 */
export function chestY(centerY: number, stanceHeight: number): number {
  return centerY - stanceHeight * 0.5 + stanceHeight * CHEST_FRACTION;
}

/** True when a stance height reads as crouched (tolerant of float drift). */
export function isCrouchedHeight(stanceHeight: number): boolean {
  return stanceHeight <= (CROUCH_HEIGHT + CHARACTER_HEIGHT) * 0.5;
}

/**
 * Vertical hitbox band for enemy projectiles, from the capsule centre and the
 * current stance height. Crouched gets no head margin so the band tops out at
 * the rail height and the rail reliably eats the bullet.
 */
export function hitbandMinY(centerY: number, stanceHeight: number): number {
  return centerY - stanceHeight * 0.5;
}

export function hitbandMaxY(centerY: number, stanceHeight: number): number {
  const margin = isCrouchedHeight(stanceHeight) ? 0 : STAND_HEAD_MARGIN;
  return centerY + stanceHeight * 0.5 + margin;
}
