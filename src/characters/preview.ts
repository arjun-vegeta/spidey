/**
 * ROSTER TURNTABLE — a standalone review page for the eight character designs.
 *
 * Dev-only. Nothing in the game imports this, and `vite build` only bundles
 * `index.html`, so it never ships. Run `npm run dev` and open /characters.html
 * to spin the designs, compare silhouettes and walk them.
 *
 *   1-8 / arrows   pick a character
 *   L              lineup: all eight, same scale, for silhouette comparison
 *   W              toggle walking
 *   S              toggle the swing tuck
 *   F              flat black fill, to judge the silhouette alone
 */

import * as THREE from 'three';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';
import { CHARACTERS, inkCssFor } from './Characters';
import { CharacterRig } from './CharacterRig';

const PAPER = 0xf5eedd;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const listEl = document.getElementById('roster') as HTMLElement;
const cardEl = document.getElementById('card') as HTMLElement;
const modeEl = document.getElementById('mode') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setClearColor(PAPER, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

// A ruled ground plane, so the figures stand on the page rather than in a void.
const grid = new THREE.GridHelper(40, 40, 0x8fa4d8, 0xc9cfe0);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.5;
scene.add(grid);

const rigs = CHARACTERS.map((def) => {
  const rig = new CharacterRig(def, { hitProxies: false });
  scene.add(rig.group);
  return rig;
});

let selected = 0;
let lineup = false;
let walking = false;
let swinging = false;
let silhouette = false;
let spin = 0;
/** `?still` freezes the turntable face-on, for capturing portraits. */
const still = new URLSearchParams(location.search).has('still');

const turntable = new THREE.Group();
scene.add(turntable);

function layout(): void {
  rigs.forEach((rig, i) => {
    rig.group.visible = lineup || i === selected;
    rig.group.rotation.y = 0;
    if (lineup) {
      // One straight rank of eight, facing camera: the only honest way to
      // compare silhouettes is to see them shoulder to shoulder at one scale.
      rig.group.position.set((i - 3.5) * 1.55, 0, 0);
      if (rig.group.parent !== scene) scene.add(rig.group);
    } else {
      rig.group.position.set(0, 0, 0);
      if (rig.group.parent !== turntable) turntable.add(rig.group);
    }
  });
  modeEl.textContent = lineup
    ? 'LINEUP // ALL EIGHT, ONE SCALE'
    : `TURNTABLE // ${CHARACTERS[selected].name}`;
  renderList();
  renderCard();
}

function renderList(): void {
  listEl.innerHTML = '';
  CHARACTERS.forEach((def, i) => {
    const row = document.createElement('button');
    row.className = 'roster-row' + (i === selected && !lineup ? ' is-active' : '');
    row.style.setProperty('--ink', inkCssFor(def));
    row.innerHTML = `<span class="roster-num">${i + 1}</span>
      <span class="roster-name">${def.name}</span>
      <span class="roster-build">${def.vibe.build}</span>`;
    row.addEventListener('click', () => {
      selected = i;
      lineup = false;
      layout();
    });
    listEl.appendChild(row);
  });
}

function renderCard(): void {
  const def = CHARACTERS[selected];
  cardEl.style.setProperty('--ink', inkCssFor(def));
  cardEl.innerHTML = `
    <div class="card-slot">SHEET ${String(selected + 1).padStart(2, '0')} / 08</div>
    <h1>${def.name}</h1>
    <p class="card-tagline">${def.tagline}</p>
    <p class="card-bio">${def.bio}</p>
    <dl class="card-stats">
      <div><dt>BUILD</dt><dd>${def.vibe.build}</dd></div>
      <div><dt>READS AS</dt><dd>${def.vibe.read}</dd></div>
      <div><dt>DRAWN WITH</dt><dd>${def.vibe.drawnWith}</dd></div>
      <div><dt>LENS</dt><dd>${def.lens.toUpperCase()}</dd></div>
    </dl>
    <p class="card-foot">HITBOX IDENTICAL ACROSS THE ROSTER — COSMETIC ONLY</p>
  `;
}

function setSilhouette(on: boolean): void {
  // Flat fill against the paper: the honest test of whether a design reads.
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material;
    if (!mat || (mat as THREE.MeshBasicMaterial).visible === false) return;
    if (on) {
      mesh.userData.prevMat = mat;
      mesh.material = silhouetteMat;
    } else if (mesh.userData.prevMat) {
      mesh.material = mesh.userData.prevMat;
      mesh.userData.prevMat = null;
    }
  });
}
const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x101828 });

window.addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= CHARACTERS.length) {
    selected = n - 1;
    lineup = false;
    layout();
    return;
  }
  switch (e.key.toLowerCase()) {
    case 'arrowright':
      selected = (selected + 1) % CHARACTERS.length;
      lineup = false;
      layout();
      break;
    case 'arrowleft':
      selected = (selected + CHARACTERS.length - 1) % CHARACTERS.length;
      lineup = false;
      layout();
      break;
    case 'l':
      lineup = !lineup;
      layout();
      break;
    case 'w':
      walking = !walking;
      break;
    case 's':
      swinging = !swinging;
      break;
    case 'f':
      silhouette = !silhouette;
      setSilhouette(silhouette);
      break;
  }
});

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(0.05, clock.getDelta());
  InkShaderMaterial.update(dt);

  const speed = swinging ? 6 : walking ? 4.2 : 0;
  for (const rig of rigs) rig.update(dt, { speed, swinging });

  if (lineup) {
    camera.fov = 46;
    camera.position.set(0, 1.05, 13.2);
    camera.lookAt(0, 0.9, 0);
  } else {
    // Slow turntable, starting face-on so the mask is the first thing you see.
    if (!still) spin += dt * 0.42;
    turntable.rotation.y = spin;
    camera.fov = 32;
    camera.position.set(0, 1.05, 5.6);
    camera.lookAt(0, 0.92, 0);
  }
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resize();
layout();
frame();

// Handy from the console when reviewing: window.__roster.rigs[0].def
(window as unknown as Record<string, unknown>).__roster = { rigs, CHARACTERS };
