# Spidey — QA Regression Checklist (Section 36)

This document translates Section 36 of `GAME_PLAN.md` into a repeatable, runnable regression verification protocol for human QA testers and release engineers.

## Execution Policy
- Run this checklist in sequence from R1 through R20 before every milestone build.
- **Strict Stop-the-Line Rule**: If any single test fails, the milestone is blocked. The defect must be resolved and the full regression suite rerun from R1 to R20 (no partial passes allowed).
- Record all runs in the Milestone Results Table at the bottom of this document.

---

## Test Cases (R1 – R20)

### R1 — Boot and Initialization
- **Plan Ref**: [36 / M0]
- **Setup**: Open browser in Incognito / Private mode (clean profile, cleared `localStorage`). Navigate to `http://localhost:3000/`.
- **Steps**:
  1. Trigger a hard reload (`Ctrl+F5` or `Cmd+Shift+R`).
  2. Verify that the blueprint city rendered in the background behind the start modal in under 3 seconds.
  3. Open DevTools Console (`F12`) and verify zero uncaught errors or boot warnings.
  4. Click `ENTER BLUEPRINT CITY & PLAY`.
- **Pass Criteria**:
  - City renders in under 3 seconds.
  - Zero console errors or unhandled exceptions.
  - Canvas responds immediately to input.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R2 — Menu and Pause State Transitions
- **Plan Ref**: [36 / 16.2 / M6]
- **Setup**: Active game session.
- **Steps**:
  1. Confirm instructions modal displays controls layout before entering.
  2. Click `ENTER BLUEPRINT CITY & PLAY` and verify modal hides and pointer lock engages.
  3. Press `Escape` or `P` to trigger pause state.
  4. Verify the pause card displays with Resume, Restart, Quit, sensitivity, quality, volume, FOV, and minimap settings.
  5. Click Resume or press `Escape` to return to active play.
- **Pass Criteria**:
  - Start modal displays full keymap and disappears on Play.
  - Pause menu reliably halts simulation, frees pointer lock, and resumes cleanly without camera snap.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R3 — Ground Movement and Traversal
- **Plan Ref**: [36 / 6.1 / M1]
- **Setup**: Ground level or construction deck slab.
- **Steps**:
  1. Walk continuously for 10 seconds using `W`, `A`, `S`, `D`.
  2. Navigate over curbs, wooden pallets, and steel stair edges.
  3. Listen for procedural rhythmic footsteps.
- **Pass Criteria**:
  - Zero collision snagging, zero floor clipping, and zero unexpected stops.
  - Footstep audio cues trigger at correct cadence.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R4 — Jump Buffer and Coyote Timing
- **Plan Ref**: [36 / 6.1 / M1]
- **Setup**: Running toward floor slab edge.
- **Steps**:
  1. Run off the edge of a construction slab and press `Space` within 100ms after leaving the ground (coyote time).
  2. Approach a landing and press `Space` 100ms before touching down (jump buffering).
  3. Repeat 3 times to verify consistency.
- **Pass Criteria**:
  - Jump executes 3/3 times across both coyote time and jump buffer tests without eating input.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R5 — Web Swing Mechanics and Momentum
- **Plan Ref**: [36 / 6.3 / 6.7 / M1]
- **Setup**: Airborne or falling near skyscrapers.
- **Steps**:
  1. Aim crosshair toward a skyscraper face and press/hold `Right-Click` or `E`.
  2. Confirm web line attaches on the first attempt with visible blue web line.
  3. Swing continuously for at least 10 seconds, pumping momentum with `W`.
  4. Release web at apex and press `Space` for the slingshot boost.
- **Pass Criteria**:
  - Web attaches smoothly without tether jitter.
  - Pumping increases angular velocity.
  - Apex release delivers forward and vertical boost.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R6 — Web Reeling and HUD Hints
- **Plan Ref**: [36 / 6.2 / 6.7]
- **Setup**: In an active web swing.
- **Steps**:
  1. While swinging, hold `Shift` (or `C`) to reel rope in. Observe tether shortening and speed increase.
  2. Hold `Ctrl` (or `X`) to reel rope out. Observe tether lengthening.
  3. Check the bottom-right HUD badge for reel state hints.
- **Pass Criteria**:
  - Rope length dynamically shortens/lengthens at configured rates (16 m/s in, 14 m/s out).
  - HUD badge updates state accordingly.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R7 — Web Zip to Latch and Terrace Mantle
- **Plan Ref**: [36 / 6.4 / 9 / M3]
- **Setup**: Facing a skyscraper parapet, cornice, or terrace latch marker.
- **Steps**:
  1. Target a visible grapple anchor within 90m until the web reticle brackets lock on.
  2. Press `F` to web zip.
  3. Observe the laser-straight cyan zip line and arrival ease-out in the final 5 meters.
  4. Arrive at the ledge and verify player mantles onto the terrace into a stable standing posture.
- **Pass Criteria**:
  - Zip pulls directly to anchor with ease-out deceleration.
  - Mantle landing leaves player upright on solid ground without jitter or clipping through wall.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R8 — Wall Collision and Wall Run Transition
- **Plan Ref**: [36 / 6.1 / 8 / M1]
- **Setup**: High-speed swing directed into a flat skyscraper wall.
- **Steps**:
  1. Swing diagonally into a building facade at speed.
  2. Observe collision resolution against the simplified box collider shell.
  3. Press forward along the wall to engage wall-slide / wall-run response.
- **Pass Criteria**:
  - Player does not clip inside the skyscraper interior.
  - Tangential momentum is preserved (sliding instead of dead stop).
  - Soft impact audio cue plays.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R9 — Weapon Handling, Convergence, and Reloading
- **Plan Ref**: [36 / 12 / 13 / M2]
- **Setup**: Safe ground area with visible architectural targets or target dummies.
- **Steps**:
  1. Fire a full magazine from the Pistol (`1`), SMG (`2`), and Scoped Sniper (`3`).
  2. Observe muzzle flash particles at the barrel tip, tracer paths converging to crosshair center, and recoil animations.
  3. Press `R` to reload each weapon and confirm reload timing and ammo refill.
- **Pass Criteria**:
  - Tracers converge accurately to the center crosshair point of aim.
  - Recoil is purely visual and does not displace point of aim.
  - Magazine counters and tally marks update accurately.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R10 — Aerial Weapon Firing Constraints
- **Plan Ref**: [36 / 12 / 24.2]
- **Setup**: In an active web swing.
- **Steps**:
  1. Equip Pistol (`1`) while swinging and fire with `Left-Click` or `V`.
  2. Switch to SMG (`2`) and attempt to fire while swinging.
  3. Switch to Sniper (`3`) and attempt to fire while swinging.
- **Pass Criteria**:
  - Pistol fires cleanly during aerial swinging.
  - SMG and Sniper cannot fire while swinging, and HUD displays lock explanation notification.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R11 — Aim Down Sights (ADS) and Sniper Scope
- **Plan Ref**: [36 / 12.4 / 13.3 / M2]
- **Setup**: Grounded standing position.
- **Steps**:
  1. Equip SMG (`2`) and hold `Q` (or Middle Mouse). Verify holographic sight aligns on center.
  2. Equip Sniper (`3`) and hold `Q`. Verify full-screen blueprint scope overlay engages with 3.5x magnification.
  3. Observe sway effect while scoped, then hold `Shift` to test steady breath holding.
- **Pass Criteria**:
  - SMG holographic sight centers smoothly.
  - Sniper scope overlay covers screen with blueprint reticle; mouse sensitivity scales down proportionally.
  - Holding breath stabilizes scope sway.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R12 — Wave 1 Combat Progression
- **Plan Ref**: [36 / 15 / 24.4 / M5]
- **Setup**: Wave 1 start on construction site.
- **Steps**:
  1. Engage and defeat all 5 initial ink thugs using tactical weapons.
  2. Observe wave announcement banner at start.
  3. Track ink splash particles, hit sound effects, and floating score popups upon kills.
  4. Eliminate the 5th thug and observe the wave clear fanfare, +25 HP recovery, and ammo refill.
  5. Check top-right wave preview during the 3.5s intermission.
- **Pass Criteria**:
  - 5 thugs spawn via staggered trickle.
  - Wave clear restores 25 HP, refills all weapon ammo, and displays next-wave preview.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R13 — Directional Damage Ring Accuracy
- **Plan Ref**: [36 / 11 / M4]
- **Setup**: In combat with enemies positioned at known relative bearings.
- **Steps**:
  1. Take incoming projectile fire from 4 distinct relative directions (Ahead, Right, Behind, Left).
  2. Observe the red arc on `#dmg-ring` around the crosshair and the edge vignette glows.
- **Pass Criteria**:
  - The directional damage indicator rotates accurately, pointing back toward the shooter position (4/4 calls correct).
  - Indicator decays smoothly over 1.2 seconds.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R14 — Minimap Target Acquisition
- **Plan Ref**: [36 / 10 / M4]
- **Setup**: Mid-wave combat with one distant surviving enemy.
- **Steps**:
  1. Use only the bottom-center minimap radar (`#minimap`) to locate the remaining enemy blip.
  2. Navigate to the enemy based on minimap heading and elevation cues within 15 seconds.
- **Pass Criteria**:
  - Minimap displays player arrow, building footprint outlines, and red enemy dots.
  - Last remaining hostile can be located and engaged in under 15 seconds.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R15 — Death Screen and Killer Recap
- **Plan Ref**: [36 / 16.3 / M6]
- **Setup**: Stand in hostile enemy fire until HP reaches 0.
- **Steps**:
  1. Allow health to deplete to 0.
  2. Verify death screen overlay `#death-screen` appears displaying `SKETCHED OUT`.
  3. Inspect killer recap text (e.g., `THUG · 18m · AHEAD`).
  4. Press `R` or click to restart.
- **Pass Criteria**:
  - Death screen shows final score and accurate killer recap string.
  - Pressing `R` instantly resets player, waves, and score without reload error.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R16 — Mid-Swing Restart Resilience
- **Plan Ref**: [36 / 21]
- **Setup**: Active swinging in mid-air at high velocity.
- **Steps**:
  1. While in the middle of a swing at high speed, trigger restart via pause menu or after fatal impact.
  2. Observe player respawn at construction site foundation `(0, 4, 18)`.
- **Pass Criteria**:
  - Zero stuck web ropes, zero null anchor references, and zero residual velocity carryover.
  - Fresh Wave 1 starts cleanly.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R17 — Audio Mute and Settings Persistence
- **Plan Ref**: [36 / 18 / 20 / M6]
- **Setup**: Active game session.
- **Steps**:
  1. Press `M` to toggle mute. Confirm all audio stops.
  2. Open pause menu, adjust Mouse Sensitivity and FOV sliders.
  3. Hard reload the browser page (`Cmd+Shift+R` / `Ctrl+F5`).
  4. Inspect pause menu and verify adjusted settings were preserved.
- **Pass Criteria**:
  - Mute key `M` silences audio immediately.
  - Settings persist across page reload via `localStorage`.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R18 — Sustained Performance and Frame Rate
- **Plan Ref**: [36 / 19 / M6]
- **Setup**: Continuous 60-second high-speed swing and combat session.
- **Steps**:
  1. Swing past multiple skyscraper blocks at maximum speed for 60 seconds with active enemies.
  2. Monitor FPS using browser DevTools or performance overlay.
- **Pass Criteria**:
  - Median FPS >= 60 on target test hardware.
  - Zero sustained frame rate dips below 45 FPS.
  - Zero on-screen error banner overlays.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R19 — Visual Test Suite Regression
- **Plan Ref**: [36 / 21]
- **Setup**: Local preview server running on `http://localhost:3000/`.
- **Steps**:
  1. Execute `node scripts/test_visuals.js`.
  2. Inspect captured PNG screenshots in `screenshots/`:
     - `test_1_pistol.png`
     - `test_2_smg.png`
     - `test_3_smg_ads.png`
     - `test_4_sniper.png`
     - `test_5_sniper_scoped.png`
     - `test_6_jumping.png`
     - `test_7_web_swinging.png`
     - `test_8_firing.png`
     - `test_9_minimap.png`
     - `test_10_damage_ring.png`
     - `test_11_terrace_vista.png`
     - `test_12_onboarding_hint.png`
     - `test_13_pause_menu.png`
     - `test_14_death_screen.png`
  3. Verify visual elements match reference layout.
- **Pass Criteria**:
  - Script completes with zero browser console errors and generates all 14 screenshots.
  - Visual inspection confirms all gameplay HUD and viewmodel states render properly.
- **Result**: `[ ] PASS    [ ] FAIL`

---

### R20 — Automated Tooling Green Gate
- **Plan Ref**: [36 / 21 / 25]
- **Setup**: Terminal in repo root.
- **Steps**:
  1. Run `npx tsc --noEmit`.
  2. Run `npm run lint`.
  3. Run `npm run test`.
  4. Run `npm run build`.
- **Pass Criteria**:
  - TypeScript compiler exits with code 0 (zero type errors).
  - ESLint exits with code 0 (zero lint errors or warnings).
  - Vitest test suite passes 100% of tests.
  - Vite production build succeeds without errors or unexpected size bloat.
- **Result**: `[ ] PASS    [ ] FAIL`

---

## Milestone Regression Results Table

Record the results of each milestone run in the table below:

| Date | Build ID | Tester | Hardware / OS | Median FPS | 1% Min FPS | Total Passed | Verdict | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| YYYY-MM-DD | YYYYMMDDHHMMSS | Tester Name | e.g. M1 Mac / Chrome | 60 | 54 | 20 / 20 | PASS | Clean baseline sign-off |
