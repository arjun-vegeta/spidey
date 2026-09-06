# Spidey — Performance Budgets and Measurement Log (Section 19)

60 FPS is a feature. In a high-speed momentum-based web-swinging shooter, frame drops break swing timing, disrupt input responsiveness, and degrade the hand-drawn ink aesthetic. This document outlines the hard resource ceilings, measurement protocols, and milestone verification logs.

---

## Performance Budgets Table

| Metric | Target / Ceiling | Subsystem | Enforcement Mechanism |
| :--- | :--- | :--- | :--- |
| **Draw Calls** | < 350 per frame | Renderer / World | Shared `InkShaderMaterial` instances across all skyscrapers; merged static geometry trims; zero shadow map passes. |
| **Raycasts per Frame** | <= 8 average (webs 6 + LOS) | Physics & AI | Web latch scan <= 6 candidate rays; gunshot raycasts on-fire-only; enemy LOS checks throttled (0.2s–0.3s intervals); projectile collision broadphase filters to nearby meshes before raycasting. |
| **Active Enemies** | 12 maximum alive | AI / Waves | Wave queue holds surplus enemies; staggered 0.5s trickle spawn releases replacements only when active count drops below 12. |
| **Live Projectiles** | 60 maximum active | Combat Manager | Hard cap of 60 projectiles in simulation; attempts to spawn beyond ceiling are dropped; expired projectiles culled immediately. |
| **Ink Particles** | 800 particles (400 on Low) | Particle System | Fixed circular particle pool; old particles recycled; low quality setting halves particle spawn density. |
| **Weapon Tracers** | 48 active tracers | Weapons | Pre-allocated tracer line geometry pool; immediate recycling upon completion. |
| **Shadow Maps** | OFF (Zero passes) | Lighting | Dynamic shadow mapping is explicitly disabled. Ink hatching and outline shaders provide ambient depth without multi-pass shadow cost. |
| **Display Pixel Ratio (DPR)** | min(window.devicePixelRatio, 2.0) | Renderer | Capped at 2.0 on high quality; drops to 1.0 on low quality setting. |
| **Heap Allocations** | 0 new objects in hot loops | Core Game Loop | Zero `new THREE.Vector3()`, `new THREE.Matrix4()`, or object allocations in per-frame update ticks. All math operations use scratch variables. |
| **Target Frame Rate** | 60 FPS median (>= 45 FPS 1% low) | Full Stack | Sustained performance target on integrated Intel/Apple Silicon GPUs. |

---

## How to Measure Each Metric

### 1. Draw Calls
- **Method**: Inspect Three.js internal render stats from the browser console:
  ```javascript
  window.__spidey.renderer.info.render.calls
  ```
- **Alternative**: Use the Chrome DevTools WebGL inspector or the Spector.js extension to capture a frame at the spawn point and during high-speed swinging past the skyscraper district.
- **Acceptance**: Frame draw call count must not exceed 350 in any standard gameplay view.

### 2. Raycasts per Frame
- **Method**: Profile using the Chrome DevTools Performance tab (record 5 seconds of active swinging and combat).
- **Metric**: Filter the Bottom-Up call tree for `THREE.Raycaster.intersectObjects` or `intersectObject`.
- **Target**: Average count of raycast operations per frame should remain <= 8. Web scanner evaluates at most 6 rays; AI line-of-sight checks run on staggered timers (thug: 0.3s, sniper: 0.2s); projectile architecture checks only test meshes within 30m horizontal / 60m vertical distance.

### 3. Active Enemies
- **Method**: Query the active enemy array in the console:
  ```javascript
  window.__spidey.enemyManager.enemies.length
  ```
- **Verification**: Run `npm run test` (executes `tests/perf.test.ts`), which stresses Wave 5 (20 enemies queued) and verifies that active alive count never exceeds 12 at any tick during simulation.

### 4. Active Projectiles
- **Method**: Query the projectile array in the console:
  ```javascript
  window.__spidey.enemyManager.projectiles.length
  ```
- **Verification**: Automated stress test in `tests/perf.test.ts` fires 100 consecutive projectiles and asserts the array length clamps strictly at 60.

### 5. Ink Particles and Tracers
- **Method**: Inspect particle count via console:
  ```javascript
  window.__spidey.particles.getGroup().children.length
  ```
- **Verification**: Ensure particle emitter throttles when maximum pool size (800) is reached.

### 6. Heap Allocations (Garbage Collection Audit)
- **Method**: Open Chrome DevTools -> Memory -> Select "Allocation instrumentation on timeline" -> Record 10 seconds of gameplay.
- **Acceptance**: Memory timeline must exhibit a flat sawtooth profile with zero recurring allocations from `update()`, `SwingPhysics.update()`, `Player.update()`, or `EnemyManager.update()`.

### 7. Frame Rate and 1% Lows
- **Method**: Record 60 seconds of high-speed traversal through the city and construction site using DevTools Performance tab or `requestAnimationFrame` delta logger.
- **Metrics**:
  - `Median FPS = 1000 / median(frame_delta_ms)`
  - `1% Low FPS = 1000 / 99th_percentile(frame_delta_ms)`
- **Acceptance**: Median >= 60 FPS, 1% Low >= 45 FPS on reference test hardware.

---

## Milestone Performance Log Results Table

Record milestone benchmark measurements below:

| Milestone | Date | Build ID | Platform / GPU | Median FPS | 1% Low FPS | Draw Calls | Raycasts/Frame | Max Enemies | Max Projectiles | Particles | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **M0** | 2026-09-06 | Baseline | M1 Mac / Chrome | 60 | 58 | 185 | 4 | 0 | 0 | 0 | PASS | First-frame boot render |
| **M1** | | | | | | | | | | | | Traversal & collision |
| **M2** | | | | | | | | | | | | Gunfeel & viewmodel |
| **M3** | | | | | | | | | | | | Terraces & latches |
| **M4** | | | | | | | | | | | | Minimap & awareness |
| **M5** | | | | | | | | | | | | Wave AI & director |
| **M6** | | | | | | | | | | | | Menus & final release |
