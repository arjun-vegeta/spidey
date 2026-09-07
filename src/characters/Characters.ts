/**
 * THE ROSTER — eight playable sketches for multiplayer.
 *
 * Everything here is DATA. No THREE, no DOM, no game state: a character is a
 * palette, a set of proportions and a signature key. `CharacterRig` turns one
 * into geometry; `CharacterSignatures` owns the per-character flourishes.
 *
 * ------------------------------------------------------------------------
 * DESIGN RULES every entry obeys
 * ------------------------------------------------------------------------
 * 1. ONE SILHOUETTE EACH. You must be able to name the character from a
 *    black shape at 40 metres: the bruiser is wide and hunched, the acrobat
 *    is thin with a trailing scarf, the marker is a flat plate that all but
 *    disappears edge-on. Two characters never share a build profile.
 *
 * 2. COSMETIC ONLY. Every rig is normalised to CHARACTER_HEIGHT and shoots
 *    from the same eye height, and `CharacterRig` gives all eight the SAME
 *    invisible hit proxies. A wide character is not a bigger target and a
 *    thin one is not a harder one — see `CharacterRig.buildHitProxies`.
 *
 * 3. NOBODY WEARS ENEMY RED. The crimson band (0xb71520 / 0xd63031) belongs
 *    to AI hostiles, exactly as `Profile.INK_COLORS` documents. A human must
 *    never read as a hostile across a rooftop, so the roster stops at plum,
 *    magenta and burnt orange.
 *
 * 4. IT IS ALL STATIONERY. This is a biro drawing in a notebook, so the cast
 *    is drawn from the desk it was doodled on: pencil stubs, correction
 *    fluid, chisel markers, drafting sets, spilled ink.
 */

export type CharacterId =
  | 'first-draft'
  | 'graphite'
  | 'crosshatch'
  | 'architect'
  | 'whiteout'
  | 'inkblot'
  | 'chisel-tip'
  | 'surveyor';

/** Which lens cut sits on the mask. Drives the one part of the face that reads at range. */
export type LensStyle =
  | 'teardrop'   // classic webhead pair
  | 'goggles'    // small round lamps
  | 'band'       // single wraparound visor slot
  | 'tsquare'    // wide brow bar with a nose drop
  | 'hollow'     // two empty holes, no glass
  | 'cyclops'    // one big lens across the whole face
  | 'slot'       // narrow angled slit
  | 'monocle';   // one round eyepiece, off-centre

export interface CharacterPalette {
  /** Main ink the body is hatched in. */
  ink: number;
  /** Second ink for plates, wraps and gear. Usually the same hue, pushed. */
  accent: number;
  /** Outline colour. Always the darkest value in the set. */
  edge: number;
  /** Lens/eye colour. Pale so the face pops out of the hatching. */
  lens: number;
}

/**
 * Skeleton measurements in metres, before height normalisation.
 *
 * `legLength + torsoHeight + neck + headHeight` is the character's natural
 * height; `CharacterRig` scales the art so that figure lands on
 * CHARACTER_HEIGHT no matter how stumpy or lanky the design is.
 */
export interface CharacterBuild {
  torsoWidth: number;
  torsoHeight: number;
  torsoDepth: number;
  /** Half-span from spine to shoulder socket. Sets how wide the arms hang. */
  shoulder: number;
  armLength: number;
  armWidth: number;
  armDepth: number;
  legLength: number;
  legWidth: number;
  legDepth: number;
  /** Gap between torso top and chin. Zero reads as "no neck". */
  neck: number;
  headWidth: number;
  headHeight: number;
  headDepth: number;
  /** Forward lean of the whole torso, radians. Negative floats backwards. */
  stoop: number;
  /**
   * Extra forward offset for the mask, in metres.
   *
   * The lens cuts are drawn against the front face of the head BOX. A design
   * whose visible head is not that box — Inkblot's dome bulges well past it —
   * would otherwise have its mask buried inside its own skull, showing as
   * facets slicing across the lens. Such a design declares how far out its
   * face actually is.
   */
  faceZ: number;
}

export interface CharacterDef {
  id: CharacterId;
  /** Menu name. Uppercase, because every label in this game is uppercase. */
  name: string;
  /** One line under the name in the picker. */
  tagline: string;
  /** Two or three sentences of flavour for the expanded card. */
  bio: string;
  /** The three-bar read on the card. Cosmetic — nothing reads these in combat. */
  vibe: { build: string; read: string; drawnWith: string };
  palette: CharacterPalette;
  build: CharacterBuild;
  lens: LensStyle;
  /**
   * Nearest entry in `Profile.INK_COLORS`, so a character can seed the
   * player's ink colour when the two systems are eventually wired together.
   */
  inkColorIndex: number;
}

/** Shared baseline. Each design overrides only what makes it itself. */
const BASE: CharacterBuild = {
  torsoWidth: 0.55,
  torsoHeight: 0.65,
  torsoDepth: 0.35,
  shoulder: 0.35,
  armLength: 0.5,
  armWidth: 0.14,
  armDepth: 0.14,
  legLength: 0.8,
  legWidth: 0.18,
  legDepth: 0.2,
  neck: 0.04,
  headWidth: 0.32,
  headHeight: 0.34,
  headDepth: 0.32,
  stoop: 0.04,
  faceZ: 0,
};

const build = (over: Partial<CharacterBuild>): CharacterBuild => ({ ...BASE, ...over });

export const CHARACTERS: ReadonlyArray<CharacterDef> = [
  {
    id: 'first-draft',
    name: 'THE FIRST DRAFT',
    tagline: 'THE ONE ON PAGE ONE',
    bio:
      'The sketch this whole notebook started from, still wearing the pose it was drawn in. ' +
      'Nothing about it is exaggerated, which is exactly what makes it the yardstick: every ' +
      'other design on the roster is a note scribbled in this one’s margin.',
    vibe: { build: 'STANDARD', read: 'CLEAN LINE', drawnWith: 'BALLPOINT NAVY' },
    palette: { ink: 0x152778, accent: 0x0d1a53, edge: 0x0a1240, lens: 0xf5eedd },
    build: build({}),
    lens: 'teardrop',
    inkColorIndex: 0,
  },
  {
    id: 'graphite',
    name: 'GRAPHITE',
    tagline: 'PRESSED HARD ENOUGH TO TEAR THE PAGE',
    bio:
      'Six flat sides, a sharpened head and a body drawn with the pen dug in. Widest shoulders ' +
      'in the roster, shortest legs, and taped blocks for fists. Reads as a pencil stub that ' +
      'got angry, and the hunch means you see the shoulders before you see the face.',
    vibe: { build: 'HEAVYWEIGHT', read: 'WIDE + HUNCHED', drawnWith: '4B GRAPHITE' },
    palette: { ink: 0x3c3c46, accent: 0x25252c, edge: 0x18181e, lens: 0xe8dcc0 },
    build: build({
      torsoWidth: 0.72,
      torsoHeight: 0.6,
      torsoDepth: 0.46,
      shoulder: 0.46,
      armLength: 0.56,
      armWidth: 0.19,
      armDepth: 0.19,
      legLength: 0.74,
      legWidth: 0.23,
      legDepth: 0.24,
      neck: 0,
      headWidth: 0.34,
      // Short skull. Headgear is paid for out of head height (see
      // MAX_DRAWN_TOP), and this is the design that spends the most on a hat.
      headHeight: 0.26,
      stoop: 0.17,
    }),
    lens: 'goggles',
    inkColorIndex: 5,
  },
  {
    id: 'crosshatch',
    name: 'CROSSHATCH',
    tagline: 'ALL LINE, NO WEIGHT',
    bio:
      'Drawn in one breath and barely filled in. Tallest and thinnest of the eight, hooded, with ' +
      'three loose scarf ribbons that keep drawing themselves behind the swing long after the ' +
      'body has stopped moving. The trail is the tell: you know Crosshatch went past, not who.',
    vibe: { build: 'FEATHERWEIGHT', read: 'THIN + TRAILING', drawnWith: 'TEAL ROLLERBALL' },
    palette: { ink: 0x0f7b7b, accent: 0x0a5757, edge: 0x073d3d, lens: 0xf5eedd },
    build: build({
      torsoWidth: 0.46,
      torsoHeight: 0.6,
      torsoDepth: 0.28,
      shoulder: 0.3,
      armLength: 0.56,
      armWidth: 0.11,
      armDepth: 0.11,
      legLength: 0.94,
      legWidth: 0.15,
      legDepth: 0.17,
      neck: 0.06,
      headWidth: 0.29,
      headHeight: 0.32,
      headDepth: 0.3,
      stoop: 0.1,
    }),
    lens: 'band',
    inkColorIndex: 1,
  },
  {
    id: 'architect',
    name: 'THE ARCHITECT',
    tagline: 'DRAWN TO SPEC, NOT TO TASTE',
    bio:
      'The only figure in the book with dimension lines on it. Set-square pauldrons, a chest wedge ' +
      'ruled to 45°, a tube of rolled plans across the back and a T-square across the brow. Stands ' +
      'dead upright because the drafting grid it was built on does not permit a slouch.',
    vibe: { build: 'PLATED', read: 'ANGULAR + UPRIGHT', drawnWith: 'DRAFTING ORANGE' },
    palette: { ink: 0xc25e12, accent: 0x8a3f08, edge: 0x5c2a05, lens: 0xf5eedd },
    build: build({
      torsoWidth: 0.62,
      torsoHeight: 0.66,
      torsoDepth: 0.42,
      shoulder: 0.42,
      armLength: 0.5,
      armWidth: 0.17,
      armDepth: 0.17,
      legLength: 0.74,
      legWidth: 0.21,
      legDepth: 0.22,
      neck: 0.03,
      headWidth: 0.33,
      stoop: 0.0,
    }),
    lens: 'tsquare',
    inkColorIndex: 4,
  },
  {
    id: 'whiteout',
    name: 'WHITEOUT',
    tagline: 'PAINTED OVER, STILL MOVING',
    bio:
      'Somebody tried to correct this one out of the page and stopped halfway. The body is bare ' +
      'paper held together by its own outline — no hatching, no fill, just a hard edge and two ' +
      'holes where the mask should be. The coat hem is still torn into strips from the brush.',
    vibe: { build: 'HOLLOW', read: 'OUTLINE ONLY', drawnWith: 'CORRECTION FLUID' },
    // Body ink sits nearly on the paper value, so the figure survives on its
    // outline alone. That is the whole design, and it is why `edge` is the
    // strongest colour in this entry.
    palette: { ink: 0xe4dcc6, accent: 0xc7c1b2, edge: 0x152778, lens: 0x152778 },
    // Long in the body and short in the leg, the opposite of Crosshatch's
    // proportions: both are slender, but this one is a hanging coat and that
    // one is a sprinter, and they must never be confused at a distance.
    build: build({
      torsoWidth: 0.52,
      torsoHeight: 0.72,
      torsoDepth: 0.34,
      shoulder: 0.36,
      armLength: 0.62,
      armWidth: 0.12,
      armDepth: 0.12,
      legLength: 0.78,
      legWidth: 0.16,
      legDepth: 0.18,
      neck: 0.07,
      headWidth: 0.33,
      headHeight: 0.33,
      headDepth: 0.3,
      stoop: -0.03,
    }),
    lens: 'hollow',
    inkColorIndex: 5,
  },
  {
    id: 'inkblot',
    name: 'INKBLOT',
    tagline: 'THE PEN LEAKED AND IT GOT UP',
    bio:
      'Not drawn so much as spilled. Round where everyone else is boxy, squat where everyone ' +
      'else is tall, one enormous lens across a head that never quite separated from the ' +
      'shoulders. Drips hang off the arms and keep swinging a beat behind the body.',
    vibe: { build: 'SQUAT', read: 'ROUND + LOW', drawnWith: 'PLUM, TOO MUCH OF IT' },
    palette: { ink: 0x6b2d8c, accent: 0x4a1c63, edge: 0x2f1041, lens: 0xf0e4b8 },
    build: build({
      torsoWidth: 0.78,
      torsoHeight: 0.62,
      torsoDepth: 0.58,
      // Wide sockets: the round body is almost as broad as it is tall, and
      // arms set any closer in would simply vanish inside it.
      shoulder: 0.54,
      armLength: 0.46,
      armWidth: 0.17,
      armDepth: 0.17,
      legLength: 0.56,
      legWidth: 0.25,
      legDepth: 0.26,
      neck: 0,
      headWidth: 0.34,
      headHeight: 0.28,
      headDepth: 0.32,
      stoop: 0.2,
      // The dome sits well proud of the head box, so the visor rides out to
      // meet it rather than sinking into the blob.
      faceZ: 0.062,
    }),
    lens: 'cyclops',
    inkColorIndex: 3,
  },
  {
    id: 'chisel-tip',
    name: 'CHISEL TIP',
    tagline: 'BROAD FROM THE FRONT, GONE FROM THE SIDE',
    bio:
      'A marker stroke with legs. Every part is a wide, shallow plate, so head-on it is the ' +
      'broadest thing on the roof and edge-on it is a line. The head is a nib cut at 45° and the ' +
      'collar is the cap ring it left behind.',
    vibe: { build: 'FLAT SLAB', read: 'WIDE / VANISHING', drawnWith: 'MAGENTA CHISEL MARKER' },
    palette: { ink: 0xb5197a, accent: 0x7d0f53, edge: 0x520935, lens: 0xf5eedd },
    build: build({
      torsoWidth: 0.7,
      torsoHeight: 0.62,
      torsoDepth: 0.22,
      shoulder: 0.42,
      armLength: 0.52,
      armWidth: 0.16,
      armDepth: 0.09,
      legLength: 0.78,
      legWidth: 0.21,
      legDepth: 0.13,
      neck: 0.02,
      headWidth: 0.38,
      headHeight: 0.3,
      headDepth: 0.18,
      stoop: 0.05,
    }),
    lens: 'slot',
    inkColorIndex: 6,
  },
  {
    id: 'surveyor',
    name: 'THE SURVEYOR',
    tagline: 'MEASURED THE CITY BEFORE ANYONE BUILT IT',
    bio:
      'Long coat, flat ruled brim, a bandolier of spare refills and a folding rule on the hip. ' +
      'Lanky and unhurried, with a coat skirt that flares on every landing. The brim is the ' +
      'silhouette: a hard horizontal line where everyone else has a head.',
    vibe: { build: 'LANKY', read: 'BRIM + COAT', drawnWith: 'OCHRE FOUNTAIN PEN' },
    palette: { ink: 0x9a7a12, accent: 0x6b5309, edge: 0x453405, lens: 0xf5eedd },
    build: build({
      torsoWidth: 0.52,
      torsoHeight: 0.62,
      torsoDepth: 0.32,
      shoulder: 0.34,
      armLength: 0.56,
      armWidth: 0.13,
      armDepth: 0.13,
      legLength: 0.88,
      legWidth: 0.15,
      legDepth: 0.18,
      neck: 0.06,
      headWidth: 0.3,
      headHeight: 0.32,
      headDepth: 0.3,
      stoop: 0.06,
    }),
    lens: 'monocle',
    inkColorIndex: 7,
  },
];

export const DEFAULT_CHARACTER_ID: CharacterId = 'first-draft';

/**
 * Skeleton height of a build, sole to the crown of the bare head — BEFORE any
 * headgear. Useful for reasoning about proportions; it is deliberately NOT
 * what the rig normalises on.
 *
 * `CharacterRig` measures the finished drawing instead, hats included, and
 * fits that into a fixed envelope. Normalising on this number would let a
 * pencil crown or a hat brim escape the envelope, and a crouched player whose
 * hat clears a parapet is exposed in cover that hides everyone else — the one
 * asymmetry this roster is not allowed to have. See `CoverMetrics`.
 */
export function naturalHeight(b: CharacterBuild): number {
  return b.legLength + b.torsoHeight + b.neck + b.headHeight;
}

export function characterById(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/** Menu-order lookup, tolerant of a stale saved index. */
export function characterByIndex(i: number): CharacterDef {
  const n = CHARACTERS.length;
  return CHARACTERS[(((i | 0) % n) + n) % n];
}

export function characterIndex(id: string): number {
  const i = CHARACTERS.findIndex((c) => c.id === id);
  return i < 0 ? 0 : i;
}

export function inkCssFor(def: CharacterDef): string {
  return `#${def.palette.ink.toString(16).padStart(6, '0')}`;
}
