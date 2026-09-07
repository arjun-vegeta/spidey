import * as THREE from 'three';
import type { CharacterId } from './Characters';
import type { RigParts } from './CharacterRig';

/**
 * SIGNATURES — the parts that make each of the eight a character instead of a
 * mannequin, one self-contained block per design.
 *
 * Coats, and when to use which: big sub-masses (a hood, a coat body, a pencil
 * crown) stay on the HATCHED coats, because a large flat fill stops looking
 * like pen. Small costume parts — plates, wraps, straps, brims, tails — use
 * `trim`, which is filled in solid. That split is what makes the eight
 * palettes tell each other apart at range while every figure still reads as
 * part of the same drawing.
 *
 * The skeleton is already standing when a signature runs (see
 * `CharacterRig.buildSkeleton`), so everything here is costume: shells, plates,
 * hoods, brims, tails and drips. All of it is non-collidable decoration.
 *
 * Local space is the design's own drawn metres, before height normalisation.
 * Useful anchors:
 *   `p.torso`  origin at the pelvis, +Y up the spine, +Z is FORWARD
 *   `p.head`   origin at the base of the neck
 *   arm/leg groups have their origin at the socket, limbs hanging down -Y
 */

type Signature = (p: RigParts) => void;

/** Front face of a box of depth `d`, plus a hair of clearance. */
const front = (d: number) => d / 2 + 0.008;

/**
 * A box whose bottom face is sheared into a slant — a chisel nib.
 *
 * The bottom vertices are lifted in proportion to their X, so the low corner
 * keeps the full height and the high corner loses `cut`. Every vertex stays
 * inside the original box, which is the point: the angle lands on the
 * silhouette without anything poking out of the head's own footprint.
 */
function chiselGeometry(w: number, h: number, d: number, cut: number): THREE.BoxGeometry {
  const geom = new THREE.BoxGeometry(w, h, d);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > -h / 2 + 1e-4) continue; // bottom face only
    const t = (pos.getX(i) / (w / 2) + 1) / 2; // 0 at -x, 1 at +x
    pos.setY(i, pos.getY(i) + cut * t);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

// ---------------------------------------------------------------------------
// THE FACE
// ---------------------------------------------------------------------------

/**
 * Draws the lens cut named by the def, into `p.eyes`.
 *
 * This is the highest-value detail in the whole rig: at range the mask is the
 * only thing that tells you which way a player is facing. Two rules hold for
 * every style:
 *
 *   - Y ZERO IS THE EYE LINE. Never pick a height off the skull — the rig
 *     pins this group to `AVATAR_EYE_Y` so all eight share one eye line.
 *   - A pale lens always gets a filled surround behind it. Cream drawn on a
 *     cream head is invisible, which is the standing trap of this palette.
 */
function drawLens(p: RigParts): void {
  const { kit, eyes, b } = p;
  // Front of the head, plus whatever the design says its real face sticks out
  // by. Drawing on the box's face alone buries the mask in a rounded skull.
  const z = front(b.headDepth) + b.faceZ;
  const w = b.headWidth;
  const h = b.headHeight;

  switch (p.def.lens) {
    case 'teardrop': {
      // Two tilted teardrops. The tilt is the entire personality of the mask.
      for (const side of [-1, 1]) {
        kit.box(eyes, w * 0.42, h * 0.32, 0.03, {
          coat: 'trim',
          bare: true,
          pos: [side * w * 0.23, 0, z],
          rot: [0, 0, side * -0.22],
        });
        kit.box(eyes, w * 0.32, h * 0.22, 0.04, {
          coat: 'lens',
          bare: true,
          pos: [side * w * 0.23, 0, z + 0.004],
          rot: [0, 0, side * -0.22],
        });
      }
      break;
    }
    case 'goggles': {
      for (const side of [-1, 1]) {
        kit.tube(eyes, w * 0.21, w * 0.21, 0.035, 8, {
          coat: 'trim',
          bare: true,
          pos: [side * w * 0.26, 0, z],
          rot: [Math.PI / 2, 0, 0],
        });
        kit.tube(eyes, w * 0.14, w * 0.14, 0.05, 8, {
          coat: 'lens',
          bare: true,
          pos: [side * w * 0.26, 0, z + 0.006],
          rot: [Math.PI / 2, 0, 0],
        });
      }
      // Strap, so the goggles read as worn rather than painted on.
      kit.box(eyes, w * 1.04, 0.05, b.headDepth * 1.02, { coat: 'trim', pos: [0, 0, 0] });
      break;
    }
    case 'band': {
      kit.box(eyes, w * 1.02, h * 0.17, 0.04, { coat: 'trim', pos: [0, 0, z] });
      kit.box(eyes, w * 0.72, h * 0.07, 0.045, {
        coat: 'lens',
        bare: true,
        pos: [0, 0, z + 0.008],
      });
      break;
    }
    case 'tsquare': {
      // Brow bar plus a ruled drop down the nose: a T-square worn as a mask.
      kit.box(eyes, w * 1.16, h * 0.16, 0.05, { coat: 'trim', pos: [0, h * 0.06, z] });
      kit.box(eyes, w * 0.16, h * 0.46, 0.045, { coat: 'trim', pos: [0, -h * 0.16, z] });
      for (const side of [-1, 1]) {
        kit.box(eyes, w * 0.26, h * 0.1, 0.05, {
          coat: 'lens',
          bare: true,
          pos: [side * w * 0.3, -h * 0.03, z + 0.006],
        });
      }
      break;
    }
    case 'hollow': {
      // No glass. Two punched holes, drawn in the outline colour so the head
      // reads as empty paper with something missing from it.
      for (const side of [-1, 1]) {
        kit.box(eyes, w * 0.22, h * 0.3, 0.05, {
          coat: 'lens',
          bare: true,
          pos: [side * w * 0.24, 0, z - 0.01],
        });
      }
      break;
    }
    case 'cyclops': {
      // Kept narrower than the skull it is set into: a wide flat plate on a
      // round head floats off the curve at its outer corners.
      kit.box(eyes, w * 0.86, h * 0.42, 0.05, { coat: 'trim', pos: [0, 0, z - 0.015] });
      kit.box(eyes, w * 0.72, h * 0.28, 0.055, { coat: 'lens', bare: true, pos: [0, 0, z] });
      // Highlight blot in the corner of the lens: the drawn glint.
      kit.box(eyes, w * 0.1, h * 0.07, 0.065, {
        coat: 'trim',
        bare: true,
        pos: [-w * 0.21, h * 0.06, z + 0.002],
      });
      break;
    }
    case 'slot': {
      // LEVEL. Chisel Tip's angle belongs to the nib the whole head is cut
      // into; tilting the eye slot as well read as a mistake rather than a
      // design, so the slit is square to the world and the head does the work.
      kit.box(eyes, w * 0.9, h * 0.22, 0.035, { coat: 'trim', pos: [0, 0, z] });
      kit.box(eyes, w * 0.78, h * 0.09, 0.045, {
        coat: 'lens',
        bare: true,
        pos: [0, 0, z + 0.004],
      });
      break;
    }
    case 'monocle': {
      kit.tube(eyes, w * 0.25, w * 0.25, 0.03, 10, {
        coat: 'trim',
        bare: true,
        pos: [w * 0.24, 0, z],
        rot: [Math.PI / 2, 0, 0],
      });
      kit.tube(eyes, w * 0.18, w * 0.18, 0.045, 10, {
        coat: 'lens',
        bare: true,
        pos: [w * 0.24, 0, z + 0.005],
        rot: [Math.PI / 2, 0, 0],
      });
      // The other eye is a single dot — one pen press, nothing more.
      kit.box(eyes, w * 0.1, h * 0.08, 0.03, {
        coat: 'trim',
        bare: true,
        pos: [-w * 0.24, 0, z],
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// 1. THE FIRST DRAFT — the yardstick
// ---------------------------------------------------------------------------

const firstDraft: Signature = (p) => {
  const { kit, torso, b, leftArm, rightArm } = p;
  const z = front(b.torsoDepth);

  // Web ribbing across the chest: three verticals, two horizontals, all fine.
  for (let i = -1; i <= 1; i++) {
    kit.box(torso, 0.02, b.torsoHeight * 0.82, 0.02, {
      coat: 'trim',
      bare: true,
      pos: [i * b.torsoWidth * 0.28, b.torsoHeight * 0.52, z],
      rot: [0, 0, i * 0.1],
    });
  }
  for (const y of [0.36, 0.66]) {
    kit.box(torso, b.torsoWidth * 0.9, 0.02, 0.02, {
      coat: 'trim',
      bare: true,
      pos: [0, b.torsoHeight * y, z],
    });
  }

  // Chest mark: a blot with four scratched legs. Small on purpose — it should
  // read as a doodle, not a logo.
  kit.blob(torso, 0.045, { coat: 'trim', bare: true, pos: [0, b.torsoHeight * 0.55, z + 0.01] });
  for (const rot of [0.6, -0.6]) {
    kit.box(torso, 0.19, 0.014, 0.014, {
      coat: 'trim',
      bare: true,
      pos: [0, b.torsoHeight * 0.55, z + 0.012],
      rot: [0, 0, rot],
    });
  }

  // Web-shooter cuffs at both wrists, and light shoulder caps.
  for (const arm of [leftArm, rightArm]) {
    kit.tube(arm, b.armWidth * 0.85, b.armWidth * 0.85, 0.09, 8, {
      coat: 'trim',
      pos: [0, -b.armLength * 0.88, 0],
    });
  }
  // Shoulder caps, kept small. Wide slabs here would steal the read from
  // Graphite and Chisel Tip, whose shoulders ARE their silhouette.
  for (const side of [-1, 1]) {
    kit.box(torso, b.armWidth * 1.25, 0.09, b.torsoDepth * 0.8, {
      coat: 'trim',
      pos: [side * b.shoulder * 0.78, b.torsoHeight - 0.06, 0],
      rot: [0, 0, side * -0.1],
    });
  }
};

// ---------------------------------------------------------------------------
// 2. GRAPHITE — the pencil stub
// ---------------------------------------------------------------------------

const graphite: Signature = (p) => {
  const { kit, torso, head, b, leftArm, rightArm } = p;

  // The shaft IS the torso: hide the default box rather than hiding a prism
  // inside it, which would z-fight along every shared face.
  p.torsoShell.visible = false;

  // Hexagonal shaft. A six-sided prism standing on end IS a pencil, and it is
  // the reason this silhouette reads instantly.
  kit.tube(torso, b.torsoWidth * 0.54, b.torsoWidth * 0.54, b.torsoHeight * 1.02, 6, {
    pos: [0, b.torsoHeight * 0.5, 0],
    rot: [0, Math.PI / 6, 0],
  });

  // Sharpened crown: wood cone, then a stub of exposed lead. Kept SHORT on
  // purpose. A taller point looks better in isolation and is a trap: the whole
  // drawing is normalised into a fixed envelope, so every centimetre of hat is
  // a centimetre the body loses, and a tall crown drops the drawn face below
  // the shared head box — you would aim at the goggles and score a body shot.
  kit.cone(head, b.headWidth * 0.58, 0.1, 6, {
    coat: 'accent',
    pos: [0, b.headHeight + 0.04, 0],
    rot: [0, Math.PI / 6, 0],
  });
  kit.cone(head, b.headWidth * 0.18, 0.045, 6, { pos: [0, b.headHeight + 0.085, 0] });

  // Taped fists, seated ON the wrist rather than floating past it. Cream tape,
  // so the knuckles are the brightest thing on the figure and you watch the
  // hands — which is where this character's whole threat lives.
  for (const arm of [leftArm, rightArm]) {
    kit.box(arm, b.armWidth * 1.35, b.armWidth * 1.25, b.armDepth * 1.35, {
      coat: 'paper',
      pos: [0, -b.armLength + 0.03, 0],
    });
    kit.box(arm, b.armWidth * 1.4, 0.035, b.armDepth * 1.4, {
      coat: 'trim',
      bare: true,
      pos: [0, -b.armLength + 0.15, 0],
    });
  }

  // Block shoulders: chunky and deep, not the wide thin fins Chisel Tip wears.
  for (const side of [-1, 1]) {
    kit.box(torso, b.armWidth * 1.5, 0.22, b.torsoDepth * 0.86, {
      coat: 'trim',
      pos: [side * b.shoulder * 0.9, b.torsoHeight - 0.09, 0],
      rot: [0, 0, side * -0.16],
    });
  }
  // Ferrule collar, clamped where the shaft meets the sharpened end.
  
  kit.tube(torso, b.torsoWidth * 0.4, b.torsoWidth * 0.4, 0.08, 8, {
    coat: 'trim',
    pos: [0, b.torsoHeight + 0.01, 0],
  });

  // Eraser block strapped to the back.
  kit.box(torso, b.torsoWidth * 0.5, 0.22, 0.16, {
    coat: 'paper',
    pos: [0, b.torsoHeight * 0.55, -b.torsoDepth * 0.62],
  });
};

// ---------------------------------------------------------------------------
// 3. CROSSHATCH — the trailing line
// ---------------------------------------------------------------------------

const crosshatch: Signature = (p) => {
  const { kit, torso, head, b, leftArm, rightArm, leftLeg, rightLeg } = p;

  // Hood: a shell around the skull, pushed back and peaked, open at the face.
  kit.box(head, b.headWidth * 1.14, b.headHeight * 1.0, b.headDepth * 1.06, {
    coat: 'accent',
    pos: [0, b.headHeight * 0.5, -b.headDepth * 0.12],
  });
  // Peak folded back along the skull, not standing up off it: a hood that has
  // been blown flat by the last swing.
  kit.cone(head, b.headWidth * 0.34, 0.28, 5, {
    coat: 'accent',
    pos: [0, b.headHeight * 0.86, -b.headDepth * 0.5],
    rot: [1.35, 0, 0],
  });

  // Three scarf tails off the back of the neck, each shorter and lazier than
  // the last. They keep drawing themselves after the body stops — this is the
  // trail you see when Crosshatch swings past a window.
  const tails: Array<[number, number, number, number]> = [
    [0.1, 0.42, -0.78, 0.0],
    [0.085, 0.34, -0.62, 0.9],
    [0.07, 0.26, -0.48, 1.8],
  ];
  tails.forEach(([w, len, rest, phase], i) => {
    kit.hanging(torso, w, len, 0.022, {
      coat: 'trim',
      pos: [(i - 1) * 0.07, b.torsoHeight * 0.94, -b.torsoDepth * 0.45],
      rot: [rest, 0, 0],
      sway: { axis: 'x', rest, amplitude: 0.2 + i * 0.05, rate: 0.8 + i * 0.15, phase, drag: 0.09 },
    });
  });

  // Wrapped forearms and shins: bandage rings, two per limb.
  for (const arm of [leftArm, rightArm]) {
    for (const t of [0.62, 0.82]) {
      kit.tube(arm, b.armWidth * 0.95, b.armWidth * 0.95, 0.055, 7, {
        coat: 'trim',
        pos: [0, -b.armLength * t, 0],
      });
    }
  }
  for (const leg of [leftLeg, rightLeg]) {
    for (const t of [0.7, 0.86]) {
      kit.tube(leg, b.legWidth * 0.72, b.legWidth * 0.72, 0.06, 7, {
        coat: 'trim',
        pos: [0, -b.legLength * t, 0],
      });
    }
  }

  // Waist sash, tied off to one side.
  kit.box(torso, b.torsoWidth * 1.06, 0.09, b.torsoDepth * 1.06, {
    coat: 'trim',
    pos: [0, b.torsoHeight * 0.16, 0],
  });
  kit.hanging(torso, 0.06, 0.26, 0.02, {
    coat: 'trim',
    pos: [b.torsoWidth * 0.42, b.torsoHeight * 0.16, b.torsoDepth * 0.2],
    rot: [-0.2, 0, 0.25],
    sway: { axis: 'x', rest: -0.2, amplitude: 0.22, rate: 1.3, phase: 2.4, drag: 0.08 },
  });
};

// ---------------------------------------------------------------------------
// 4. THE ARCHITECT — drawn to spec
// ---------------------------------------------------------------------------

const architect: Signature = (p) => {
  const { kit, torso, head, b, leftLeg, rightLeg } = p;
  const z = front(b.torsoDepth);

  // Set-square pauldrons: three-sided plates, flattened, hung off each
  // shoulder at the drafting angle.
  for (const side of [-1, 1]) {
    const plate = kit.cone(torso, b.armWidth * 2.1, 0.3, 3, {
      coat: 'trim',
      pos: [side * b.shoulder * 0.95, b.torsoHeight - 0.02, 0],
      rot: [0, 0, side * 2.2],
    });
    plate.scale.z = 0.34;
  }

  // Chest wedge, ruled to 45 degrees.
  kit.box(torso, b.torsoWidth * 0.56, b.torsoWidth * 0.56, 0.07, {
    coat: 'trim',
    pos: [0, b.torsoHeight * 0.56, z],
    rot: [0, 0, Math.PI / 4],
  });
  kit.box(torso, b.torsoWidth * 0.3, 0.02, 0.09, {
    coat: 'paper',
    bare: true,
    pos: [0, b.torsoHeight * 0.56, z + 0.02],
  });

  // Tube of rolled plans, slung across the back, paper ends showing.
  const tube = kit.tube(torso, 0.075, 0.075, 0.62, 8, {
    coat: 'trim',
    pos: [0, b.torsoHeight * 0.55, -b.torsoDepth * 0.66],
    rot: [0.12, 0, 0.55],
  });
  for (const end of [-1, 1]) {
    const cap = kit.tube(tube, 0.062, 0.062, 0.05, 8, {
      coat: 'paper',
      bare: true,
      pos: [0, end * 0.33, 0],
    });
    cap.raycast = () => {};
  }

  // Belt with dimension ticks, the way a drawing is annotated.
  kit.box(torso, b.torsoWidth * 1.04, 0.1, b.torsoDepth * 1.04, {
    coat: 'trim',
    pos: [0, b.torsoHeight * 0.14, 0],
  });
  for (let i = -2; i <= 2; i++) {
    kit.box(torso, 0.018, 0.16, 0.02, {
      coat: 'paper',
      bare: true,
      pos: [i * b.torsoWidth * 0.2, b.torsoHeight * 0.14, z],
    });
  }

  // Greaves and a stiff standing collar: nothing about this figure is casual.
  for (const leg of [leftLeg, rightLeg]) {
    kit.box(leg, b.legWidth * 1.2, b.legLength * 0.4, b.legDepth * 1.15, {
      coat: 'trim',
      pos: [0, -b.legLength * 0.78, 0],
    });
  }
  kit.box(head, b.headWidth * 1.3, 0.12, b.headDepth * 1.2, {
    coat: 'trim',
    pos: [0, 0.02, 0],
  });
};

// ---------------------------------------------------------------------------
// 5. WHITEOUT — corrected, incompletely
// ---------------------------------------------------------------------------

const whiteout: Signature = (p) => {
  const { kit, torso, b, leftArm, rightArm } = p;

  // Painted-over coat shell: barely a shade off the paper, so the figure hangs
  // on its outline alone.
  kit.box(torso, b.torsoWidth * 1.1, b.torsoHeight * 0.88, b.torsoDepth * 1.12, {
    coat: 'accent',
    pos: [0, b.torsoHeight * 0.52, 0],
  });

  // Torn hem: seven strips of different lengths, drifting. The brush stopped
  // here and the figure walked off with the damage.
  for (let i = 0; i < 7; i++) {
    const t = (i / 6 - 0.5) * 2; // -1 .. 1 across the waist
    const len = 0.2 + (i % 3) * 0.11;
    kit.hanging(torso, 0.085, len, 0.03, {
      coat: 'trim',
      pos: [t * b.torsoWidth * 0.5, b.torsoHeight * 0.14, Math.cos(t * 1.4) * b.torsoDepth * 0.5],
      rot: [0, t * 0.5, t * 0.12],
      sway: { axis: 'x', rest: 0, amplitude: 0.13 + (i % 3) * 0.04, rate: 0.55 + i * 0.11, phase: i * 1.1, drag: 0.1 },
    });
  }

  // No hands. The arms taper away into nothing, which is the single detail
  // people remember about this design.
  for (const arm of [leftArm, rightArm]) {
    kit.cone(arm, b.armWidth * 0.62, 0.16, 5, {
      pos: [0, -b.armLength - 0.06, 0],
      rot: [Math.PI, 0, 0],
    });
  }

  // A single dragged brush stroke across the chest, and a smear at the hip.
  kit.box(torso, b.torsoWidth * 1.25, 0.14, 0.06, {
    coat: 'paper',
    pos: [0.02, b.torsoHeight * 0.62, front(b.torsoDepth * 1.12)],
    rot: [0, 0, 0.24],
  });
  kit.blob(torso, 0.1, {
    coat: 'paper',
    pos: [-b.torsoWidth * 0.5, b.torsoHeight * 0.3, b.torsoDepth * 0.45],
  });
};

// ---------------------------------------------------------------------------
// 6. INKBLOT — the spill
// ---------------------------------------------------------------------------

const inkblot: Signature = (p) => {
  const { kit, torso, head, b, leftArm, rightArm, leftLeg, rightLeg } = p;

  // Round body and a skull that never separated from it. Both replace the
  // default boxes outright: this is the one design with no straight lines.
  p.torsoShell.visible = false;
  p.headShell.visible = false;

  const body = kit.blob(torso, b.torsoWidth * 0.56, { pos: [0, b.torsoHeight * 0.5, 0] });
  body.scale.set(1, 0.9, 0.96);
  const dome = kit.blob(head, b.headWidth * 0.72, { pos: [0, b.headHeight * 0.42, 0] });
  dome.scale.set(1, 0.8, 0.94);

  // Drips off both shoulders, each hanging from a different point and swinging
  // a beat behind the body.
  // Hung off the ARMS, on the outside edge where they silhouette against the
  // paper. Slung off the body itself they simply sank into it — the shell is
  // wider than any believable drip offset.
  const drips: Array<[number, number, number]> = [
    [0.46, 0.24, 0.0],
    [0.74, 0.17, 1.4],
  ];
  [leftArm, rightArm].forEach((arm, side) => {
    const out = side === 0 ? -1 : 1;
    drips.forEach(([t, len, phase], i) => {
      const g = new THREE.CylinderGeometry(0.042, 0.008, len, 6);
      g.translate(0, -len / 2, 0);
      const drip = kit.add(arm, g, {
        coat: 'trim',
        pos: [out * b.armWidth * 0.52, -b.armLength * t, 0],
        sway: { axis: 'z', rest: 0, amplitude: 0.18, rate: 0.7 + i * 0.2, phase, drag: 0.14 },
      });
      // Bead on the end of each drip: ink about to let go.
      kit.blob(drip, 0.032, { coat: 'trim', bare: true, pos: [0, -len, 0] });
    });
  });

  // A last fat drop off the lower front of the dome, mid-fall. On the head
  // rather than in the mask group: it is costume, and the mask group is held
  // to sitting inside the head hitbox.
  kit.blob(head, 0.045, { coat: 'trim', pos: [b.headWidth * 0.18, 0, b.headDepth * 0.53] });

  // Splat feet, flattened where the figure landed. Lifted so the splat SITS on
  // the ground rather than half sinking through it.
  for (const leg of [leftLeg, rightLeg]) {
    const splat = kit.blob(leg, b.legWidth * 0.95, {
      coat: 'trim',
      pos: [0, -b.legLength + b.legWidth * 0.4, 0],
    });
    splat.scale.set(1.25, 0.42, 1.3);
  }

  // Tendril arms: knuckle beads instead of fists.
  for (const arm of [leftArm, rightArm]) {
    for (const t of [0.55, 0.85]) {
      kit.blob(arm, b.armWidth * 0.72, { coat: 'trim', pos: [0, -b.armLength * t, 0] });
    }
    const fist = kit.blob(arm, b.armWidth * 1.0, { pos: [0, -b.armLength - 0.04, 0] });
    fist.scale.set(1, 0.85, 1);
  }
};

// ---------------------------------------------------------------------------
// 7. CHISEL TIP — broad from the front, gone from the side
// ---------------------------------------------------------------------------

const chiselTip: Signature = (p) => {
  const { kit, torso, head, b, leftArm, rightArm } = p;
  const z = front(b.torsoDepth);

  // THE HEAD IS THE NIB. The first pass stuck a rotated plate on top of a
  // normal head: its corners hung outside the skull and it fought the eye
  // slot's own angle, so it read as a slipped sticker rather than a cut pen.
  // Now the head geometry itself is sheared into a chisel — one angle, on the
  // silhouette, where it belongs.
  p.headShell.visible = false;
  kit.add(head, chiselGeometry(b.headWidth, b.headHeight, b.headDepth, b.headHeight * 0.5), {
    pos: [0, b.headHeight / 2, 0],
  });

  // Wet edge along the cut: the pale sliver where the stroke would start.
  // Angled to match the shear exactly, because it traces the same line.
  const cutAngle = Math.atan2(b.headHeight * 0.5, b.headWidth);
  kit.box(head, Math.hypot(b.headWidth, b.headHeight * 0.5) * 0.98, 0.035, b.headDepth * 1.02, {
    coat: 'lens',
    bare: true,
    pos: [0, b.headHeight * 0.14, 0],
    rot: [0, 0, cutAngle],
  });

  // Cap ring worn as a collar.
  kit.tube(torso, b.headWidth * 0.66, b.headWidth * 0.66, 0.09, 10, {
    coat: 'trim',
    pos: [0, b.torsoHeight + 0.01, 0],
  });

  // Barrel ridges down the chest, the grip moulding of a marker body.
  for (let i = -2; i <= 2; i++) {
    kit.box(torso, 0.035, b.torsoHeight * 0.72, 0.03, {
      coat: 'trim',
      bare: true,
      pos: [i * b.torsoWidth * 0.17, b.torsoHeight * 0.52, z],
    });
  }

  // Shoulder fins: wide, paper-thin, and the reason this thing disappears when
  // it turns sideways.
  for (const side of [-1, 1]) {
    kit.box(torso, b.armWidth * 2.4, 0.12, b.torsoDepth * 0.9, {
      coat: 'trim',
      pos: [side * b.shoulder * 1.02, b.torsoHeight - 0.03, 0],
      rot: [0, 0, side * -0.16],
    });
  }

  // Pocket clip down the spine.
  kit.box(torso, 0.09, b.torsoHeight * 0.62, 0.05, {
    coat: 'trim',
    pos: [0, b.torsoHeight * 0.66, -b.torsoDepth * 0.6],
    rot: [0.08, 0, 0],
  });

  // Flat plate cuffs — everything on this design is a plate.
  for (const arm of [leftArm, rightArm]) {
    kit.box(arm, b.armWidth * 1.4, 0.12, b.armDepth * 1.6, {
      coat: 'trim',
      pos: [0, -b.armLength * 0.9, 0],
    });
  }
};

// ---------------------------------------------------------------------------
// 8. THE SURVEYOR — brim and coat
// ---------------------------------------------------------------------------

const surveyor: Signature = (p) => {
  const { kit, torso, head, b } = p;
  const z = front(b.torsoDepth);

  // Flat ruled brim: a hard horizontal where everyone else has a head. Read
  // from a rooftop away, this one line is the whole character.
  kit.tube(head, b.headWidth * 1.05, b.headWidth * 1.05, 0.035, 10, {
    coat: 'trim',
    pos: [0, b.headHeight * 0.94, -0.01],
  });
  kit.tube(head, b.headWidth * 0.55, b.headWidth * 0.6, 0.19, 8, {
    coat: 'trim',
    pos: [0, b.headHeight * 1.05, -0.01],
  });
  kit.box(head, b.headWidth * 1.14, 0.03, b.headWidth * 1.14, {
    coat: 'paper',
    bare: true,
    pos: [0, b.headHeight * 0.99, -0.01],
  });

  // Long coat, with a skirt that flares on every landing.
  // The coat is FILLED, not hatched. Ochre hatching on cream paper is too
  // faint to read as a coat at any distance, and the coat is the character.
  kit.box(torso, b.torsoWidth * 1.14, b.torsoHeight * 0.8, b.torsoDepth * 1.16, {
    coat: 'trim',
    pos: [0, b.torsoHeight * 0.56, 0],
  });
  const panels: Array<[number, number, number]> = [
    [-1, 0.5, 0.0],
    [0, 0.56, 1.1],
    [1, 0.5, 2.2],
  ];
  panels.forEach(([x, len, phase]) => {
    kit.hanging(torso, b.torsoWidth * 0.46, len, b.torsoDepth * 0.5, {
      coat: 'trim',
      pos: [x * b.torsoWidth * 0.36, b.torsoHeight * 0.18, x === 0 ? -b.torsoDepth * 0.3 : 0],
      sway: { axis: 'x', rest: 0, amplitude: 0.1, rate: 0.6, phase, drag: 0.07 },
    });
  });

  // Bandolier of spare refills across the chest.
  const strap = kit.box(torso, b.torsoWidth * 1.5, 0.1, 0.05, {
    pos: [0, b.torsoHeight * 0.55, z],
    rot: [0, 0, 0.62],
  });
  for (let i = -2; i <= 2; i++) {
    const refill = kit.tube(strap, 0.022, 0.022, 0.15, 6, {
      coat: 'paper',
      bare: true,
      pos: [i * 0.13, 0, 0.05],
      rot: [0, 0, Math.PI / 2],
    });
    refill.raycast = () => {};
  }

  // Folding rule on the hip and a note satchel behind it.
  kit.box(torso, 0.07, 0.3, 0.05, {
    coat: 'paper',
    pos: [b.torsoWidth * 0.6, b.torsoHeight * 0.26, b.torsoDepth * 0.2],
    rot: [0, 0, -0.22],
  });
  kit.box(torso, b.torsoWidth * 0.6, 0.24, 0.14, {
    pos: [-b.torsoWidth * 0.22, b.torsoHeight * 0.34, -b.torsoDepth * 0.72],
  });
};

const SIGNATURES: Record<CharacterId, Signature> = {
  'first-draft': firstDraft,
  graphite,
  crosshatch,
  architect,
  whiteout,
  inkblot,
  'chisel-tip': chiselTip,
  surveyor,
};

/** Draws the face, then the character's own parts. */
export function decorate(id: CharacterId, parts: RigParts): void {
  drawLens(parts);
  SIGNATURES[id](parts);
}
