import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  characterById,
  characterByIndex,
  characterIndex,
  naturalHeight,
  type CharacterBuild,
} from '../src/characters/Characters';
import {
  AVATAR_EYE_Y,
  CharacterRig,
  HEAD_BASE_Y,
  MAX_DRAWN_TOP,
  buildRoster,
} from '../src/characters/CharacterRig';
import {
  CHARACTER_HEIGHT,
  COVER_RAIL_HEIGHT,
  CROUCH_HEIGHT,
  STAND_EYE_ABOVE_FEET,
} from '../src/core/CoverMetrics';

/**
 * Bounding box of what actually gets DRAWN: no invisible hit proxies, and
 * nothing a signature switched off. `Box3.expandByObject` would count both.
 */
function drawnBox(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !obj.visible) return;
    const mat = mesh.material as THREE.Material;
    if (mat && mat.visible === false) return;
    let hidden = false;
    obj.traverseAncestors((a) => {
      if (!a.visible) hidden = true;
    });
    if (hidden) return;
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
  });
  return box;
}

/** sRGB hue/saturation straight off the byte values, no colour-space detour. */
function hsl(hex: number): { hue: number; sat: number } {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / d) % 6);
  else if (max === g) hue = 60 * ((b - r) / d + 2);
  else hue = 60 * ((r - g) / d + 4);
  if (hue < 0) hue += 360;
  const l = (max + min) / 2;
  return { hue, sat: d / (1 - Math.abs(2 * l - 1)) };
}

describe('character roster data', () => {
  it('is exactly eight entries with unique ids and names', () => {
    expect(CHARACTERS).toHaveLength(8);
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(8);
    expect(new Set(CHARACTERS.map((c) => c.name)).size).toBe(8);
  });

  it('never dresses a player in hostile crimson', () => {
    // AI hostiles own the red band (0xb71520 / 0xd63031). A human who reads as
    // an enemy across a rooftop gets shot by their own team.
    for (const c of CHARACTERS) {
      for (const hex of [c.palette.ink, c.palette.accent, c.palette.edge]) {
        const { hue, sat } = hsl(hex);
        const fromRed = Math.min(hue, 360 - hue);
        // Saturated ink within 18 degrees of pure red is hostile territory.
        expect(sat > 0.35 && fromRed < 18, `${c.name} uses enemy red`).toBe(false);
      }
    }
  });

  it('keeps outlines darker than the ink they outline', () => {
    for (const c of CHARACTERS) {
      const ink = new THREE.Color(c.palette.ink);
      const edge = new THREE.Color(c.palette.edge);
      const lum = (col: THREE.Color) => col.r * 0.299 + col.g * 0.587 + col.b * 0.114;
      expect(lum(edge), `${c.name} outline is not the darkest value`).toBeLessThan(lum(ink));
    }
  });

  it('gives every design its own silhouette', () => {
    // Two characters may not share a build profile: front-on width, depth and
    // leg-to-torso ratio all have to differ somewhere.
    const key = (b: CharacterBuild) =>
      [
        (b.shoulder * 2).toFixed(2),
        b.torsoDepth.toFixed(2),
        (b.legLength / b.torsoHeight).toFixed(2),
        b.headWidth.toFixed(2),
      ].join('/');
    expect(new Set(CHARACTERS.map((c) => key(c.build))).size).toBe(8);

    // And no two are near-copies: at least three measurements must differ by
    // a visible margin.
    for (let i = 0; i < CHARACTERS.length; i++) {
      for (let j = i + 1; j < CHARACTERS.length; j++) {
        const a = CHARACTERS[i].build;
        const b = CHARACTERS[j].build;
        const dims: Array<keyof CharacterBuild> = [
          'torsoWidth', 'torsoDepth', 'shoulder', 'legLength', 'armLength', 'headWidth', 'stoop',
        ];
        const different = dims.filter((d) => Math.abs(a[d] - b[d]) > 0.03).length;
        expect(
          different,
          `${CHARACTERS[i].name} and ${CHARACTERS[j].name} look too alike`
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('spreads the eight lens styles across the roster', () => {
    expect(new Set(CHARACTERS.map((c) => c.lens)).size).toBe(8);
  });

  it('maps each entry onto a real ink colour slot', () => {
    for (const c of CHARACTERS) {
      expect(c.inkColorIndex).toBeGreaterThanOrEqual(0);
      expect(c.inkColorIndex).toBeLessThan(8);
    }
  });

  it('looks up by id and index, and survives junk', () => {
    expect(characterById(DEFAULT_CHARACTER_ID).id).toBe(DEFAULT_CHARACTER_ID);
    expect(characterById('not-a-character').id).toBe(CHARACTERS[0].id);
    expect(characterByIndex(9).id).toBe(CHARACTERS[1].id);
    expect(characterByIndex(-1).id).toBe(CHARACTERS[7].id);
    expect(characterIndex('inkblot')).toBe(CHARACTERS.findIndex((c) => c.id === 'inkblot'));
    expect(characterIndex('nope')).toBe(0);
  });
});

describe('character rigs', () => {
  it('keeps every drawn design under the ceiling, hats included', () => {
    // MAX_DRAWN_TOP is the whole cover guarantee in one number: crouch halves
    // the rig, so a drawn top under CHARACTER_HEIGHT is a crouched top under
    // the rail lip. A pencil crown or a hat brim that escaped this would be a
    // cover exploit, not a cosmetic difference.
    for (const c of CHARACTERS) {
      const rig = new CharacterRig(c);
      const box = drawnBox(rig.group);
      expect(box.max.y, `${c.name} is drawn above the ceiling`).toBeLessThanOrEqual(MAX_DRAWN_TOP);
      expect(box.min.y, `${c.name} does not stand on the ground`).toBeCloseTo(0, 2);
      rig.dispose();
    }
  });

  it('puts every neck line and every eye line in the same place', () => {
    // The two numbers that have to match across the roster: the chin, so every
    // head lands in the shared head box, and the drawn eyes, so aiming at a
    // mask is the same shot whoever is wearing it.
    for (const c of CHARACTERS) {
      const rig = new CharacterRig(c);
      rig.group.updateMatrixWorld(true);

      const chin = new THREE.Vector3();
      rig.head.getWorldPosition(chin);
      expect(chin.y, `${c.name} neck line`).toBeCloseTo(HEAD_BASE_Y, 3);

      const eye = new THREE.Vector3();
      rig.eyes.getWorldPosition(eye);
      expect(eye.y, `${c.name} eye line`).toBeCloseTo(AVATAR_EYE_Y, 3);
      expect(rig.eyeLineHeight).toBe(AVATAR_EYE_Y);
      rig.dispose();
    }
  });

  it('keeps the eye line the same for all eight while crouched', () => {
    const measured = CHARACTERS.map((c) => {
      const rig = new CharacterRig(c);
      rig.update(1 / 60, { crouching: true });
      rig.group.updateMatrixWorld(true);
      const eye = new THREE.Vector3();
      rig.eyes.getWorldPosition(eye);
      const y = eye.y;
      expect(y).toBeCloseTo(rig.crouchedEyeLineHeight, 3);
      rig.dispose();
      return y;
    });
    for (const y of measured) expect(y).toBeCloseTo(measured[0], 4);
    // And a crouched eye line has to be below the rail it is hiding behind,
    // or ducking would leave you staring over your own cover.
    expect(measured[0]).toBeLessThan(COVER_RAIL_HEIGHT);
  });

  it('hides every design behind a rail when crouched', () => {
    // THE cover invariant. Crouch squashes the rig, and a rail is half a
    // character tall, so the whole drawn figure has to disappear behind it —
    // for all eight, or picking one of them means being seen from cover that
    // hides everybody else. See the header of `CoverMetrics`.
    for (const c of CHARACTERS) {
      const rig = new CharacterRig(c);
      rig.update(1 / 60, { crouching: true });
      const box = drawnBox(rig.group);
      expect(box.max.y, `${c.name} pokes over a rail when crouched`).toBeLessThanOrEqual(
        COVER_RAIL_HEIGHT
      );
      // And the whole drawn figure, measured, not just the number the rig
      // reports: the squash has to take the hat down with it.
      expect(rig.drawnSpanY().max * (CROUCH_HEIGHT / CHARACTER_HEIGHT)).toBeLessThanOrEqual(
        COVER_RAIL_HEIGHT
      );
      rig.dispose();
    }
  });

  it('keeps every drawn mask inside the head hitbox', () => {
    // Aiming at the mask has to score a HEADSHOT whichever design you picked,
    // so the drawn eyes and their surrounds must sit inside the head proxy.
    for (const c of CHARACTERS) {
      const rig = new CharacterRig(c);
      rig.group.updateMatrixWorld(true);
      const proxy = new THREE.Box3().setFromObject(rig.headMesh!);
      const mask = drawnBox(rig.eyes);
      expect(mask.min.y, `${c.name} mask hangs below its head box`).toBeGreaterThanOrEqual(
        proxy.min.y - 1e-6
      );
      expect(mask.max.y, `${c.name} mask rides above its head box`).toBeLessThanOrEqual(
        proxy.max.y + 1e-6
      );
      rig.dispose();
    }
  });

  it('takes eye height from CoverMetrics, never from the costume', () => {
    // Whichever character is picked, the camera, the muzzle and every cover
    // raycast use the same eye height. That is what makes these cosmetic.
    for (const c of CHARACTERS) {
      const rig = new CharacterRig(c);
      expect(rig.eyeHeight).toBe(STAND_EYE_ABOVE_FEET);
      expect(rig.headBaseHeight).toBe(HEAD_BASE_Y);
      rig.dispose();
    }
  });

  it('scales the art root, never the hitbox', () => {
    const rig = new CharacterRig('inkblot');
    expect(rig.art.scale.x).toBeCloseTo(rig.silhouetteScale, 5);
    expect(rig.silhouetteScale).not.toBe(1);
    expect(rig.group.scale.x).toBe(1);
    // Crouching squashes the group — proxies and all — by the same factor for
    // every design, so the crouched hitbox stays identical too.
    rig.update(1 / 60, { crouching: true });
    expect(rig.group.scale.y).toBeCloseTo(CROUCH_HEIGHT / CHARACTER_HEIGHT, 5);
    rig.dispose();
  });

  it('still reports a sane skeleton height for reasoning about proportions', () => {
    for (const c of CHARACTERS) {
      expect(naturalHeight(c.build)).toBeGreaterThan(1.2);
      expect(naturalHeight(c.build)).toBeLessThan(2.4);
    }
  });

  it('gives all eight the identical hitbox', () => {
    const rigs = buildRoster();
    const boxFor = (rig: CharacterRig) => {
      const box = new THREE.Box3();
      for (const m of rig.collidableMeshes) {
        m.updateMatrixWorld(true);
        box.expandByObject(m);
      }
      return box;
    };
    const first = boxFor(rigs[0]);
    for (const rig of rigs) {
      expect(rig.collidableMeshes).toHaveLength(6);
      expect(rig.headMesh).not.toBeNull();
      const box = boxFor(rig);
      expect(box.min.distanceTo(first.min), `${rig.def.name} hitbox differs`).toBeLessThan(1e-6);
      expect(box.max.distanceTo(first.max), `${rig.def.name} hitbox differs`).toBeLessThan(1e-6);
      rig.dispose();
    }
  });

  it('resolves a hit back to the rig, and marks the head', () => {
    const rig = new CharacterRig('architect');
    const head = rig.headMesh!;
    expect(head.userData.characterRig).toBe(rig);
    expect(head.userData.isHead).toBe(true);
    for (const m of rig.collidableMeshes) {
      if (m !== head) expect(m.userData.isHead).toBe(false);
    }
    rig.dispose();
  });

  it('never lets costume geometry eat a bullet', () => {
    // Costume is thick — capes, brims, pauldrons. If any of it were
    // raycastable, a shot could land on a hat instead of a head.
    const rig = new CharacterRig('surveyor');
    rig.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(0, 1.5, 6),
      new THREE.Vector3(0, 0, -1).normalize()
    );
    const hits = ray.intersectObject(rig.group, true);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(rig.collidableMeshes).toContain(hit.object as THREE.Mesh);
    }
    rig.dispose();
  });

  it('can be posed and animated without touching the hitbox', () => {
    const rig = new CharacterRig('crosshatch');
    const headBefore = rig.headMesh!.position.clone();
    for (let i = 0; i < 120; i++) rig.update(1 / 60, { speed: 6, pitch: 0.4 });
    expect(rig.leftLeg.rotation.x).not.toBe(0);
    expect(rig.head.rotation.x).toBeCloseTo(0.2, 5);
    expect(rig.headMesh!.position.equals(headBefore)).toBe(true);

    rig.update(1 / 60, { swinging: true });
    expect(rig.leftArm.rotation.x).toBeCloseTo(-2.3, 5);
    rig.dispose();
  });

  it('flashes red on a hit and settles back to its own ink', () => {
    const rig = new CharacterRig('graphite');
    rig.flashHit();
    // The flash lives on the shared ink material; step past its lifetime and
    // the figure must be its own colour again, not stuck crimson.
    for (let i = 0; i < 20; i++) rig.update(1 / 60);
    const torsoMesh = rig.torso.children.find(
      (c) => (c as THREE.Mesh).isMesh
    ) as THREE.Mesh;
    const uniforms = (torsoMesh.material as THREE.ShaderMaterial).uniforms;
    const ink = uniforms.uInkColor.value as THREE.Color;
    expect(ink.getHex()).toBe(rig.def.palette.ink);
    rig.dispose();
  });

  it('honours an ink override so a player colour can win', () => {
    const rig = new CharacterRig('chisel-tip', { inkOverride: 0x0f7b7b });
    const torsoMesh = rig.torso.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
    const ink = (torsoMesh.material as THREE.ShaderMaterial).uniforms.uInkColor.value as THREE.Color;
    expect(ink.getHex()).toBe(0x0f7b7b);
    rig.dispose();
  });

  it('topples on death, like every other body in the game', () => {
    const rig = new CharacterRig('whiteout');
    rig.setDead(true);
    expect(rig.group.rotation.z).toBeGreaterThan(1);
    rig.setDead(false);
    expect(rig.group.rotation.z).toBe(0);
    rig.dispose();
  });

  it('disposes cleanly and twice over', () => {
    const rig = new CharacterRig('first-draft');
    rig.dispose();
    expect(() => rig.dispose()).not.toThrow();
    expect(rig.collidableMeshes).toHaveLength(0);
  });
});

describe('wearing a player colour', () => {
  it('dresses the whole character in the chosen ink', () => {
    // One colour, one drawing. The body hatching and the filled trim both
    // come from the player's ink, so an avatar matches its own name plate,
    // tracers and kill-feed line instead of carrying a foreign accent.
    const ink = 0x0f7b7b;
    for (const c of CHARACTERS) {
      const rig = new CharacterRig(c, { inkOverride: ink });
      const body = rig.torso.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh;
      const bodyInk = (body.material as THREE.ShaderMaterial).uniforms.uInkColor.value as THREE.Color;
      expect(bodyInk.getHex(), `${c.name} body ink`).toBe(ink);

      // Trim is a flat fill derived from the same hue: never the design's own
      // default accent, which would be a second, unrelated colour. The two
      // coats that are deliberately NOT the player's colour are the pale lens
      // and the cream paper trim (tape, correction fluid), so they are named
      // and skipped rather than guessed at by saturation.
      const untinted = new Set([c.palette.lens, 0xf5eedd]);
      const want = { h: 0, s: 0, l: 0 };
      new THREE.Color(ink).getHSL(want);

      rig.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
        if (!mesh.isMesh || !mat || !mat.isMeshBasicMaterial) return;
        if (mat.visible === false) return; // hit proxies
        if (untinted.has(mat.color.getHex())) return;

        const hsl = { h: 0, s: 0, l: 0 };
        mat.color.getHSL(hsl);
        expect(Math.abs(hsl.h - want.h), `${c.name} trim hue (#${mat.color.getHexString()})`)
          .toBeLessThan(0.06);
      });

      rig.dispose();
    }
  });
});
