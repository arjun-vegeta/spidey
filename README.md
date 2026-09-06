# 🕷️ Spidey

First-person web-swing shooter set in a hand-drawn notebook city.
Swing between skyscrapers, land on rooftops and terraces, and clear
waves of ink enemies with a pistol, SMG, and scoped sniper rifle.

## Running the Game

```bash
npm install
npm run dev
```

Open http://localhost:3000/ and click ENTER BLUEPRINT CITY & PLAY.

### `npm run dev` vs `npm run play`

- `npm run dev`: Starts the local Vite development server with Hot Module Replacement (HMR) on port 3000. Use during feature development and quick iteration.
- `npm run play`: Runs a production build and serves the minified output strictly on port 3000 (`npm run build && vite preview --port 3000 --strictPort`). Use for QA verification, performance profiling, and milestone playtests to mirror real player runtime performance.

## Controls

- WASD / Arrow keys: Move on ground / pump swing in air
- Mouse: Look (pitch & yaw)
- Hold Right-click or E: Web swing (attach to nearest skyscraper)
- F: Web zip to target anchor / latch
- Left-click or V / Enter: Fire active weapon
- Q or Middle mouse: Aim down sights (ADS) / Sniper scope
- 1 / 2 / 3 or Wheel: Select Pistol / SMG / Sniper
- Shift / C: Reel rope in (shorten tether)
- Ctrl / X: Reel rope out (lengthen tether) / dive assist in air
- Space: Jump / slingshot swing boost / zip-vault cancel
- R: Reload weapon / restart when dead
- N: Toggle minimap radar
- M: Toggle audio mute
- P or Esc: Open pause menu and settings
- 7: Toggle WorldCollider wireframe shells (?showcolliders)
- 8: Toggle web anchor latches visualization (?showlatches)
- 9: Toggle courtyard traversal timing rings & pillars (?debugyard)
- 0: Toggle ballistics target range (?debugrange)

## Settings

Accessible from the pause menu (P or Esc) and the start modal. All settings persist to browser localStorage:

- Sensitivity: 0.50x to 2.00x slider (default 0.80x tuned for trackpads; scales down dynamically during ADS).
- Quality: HIGH (device pixel ratio up to 2.0, 800 ink particles) or LOW (DPR 1.0, 400 ink particles).
- Volume: 0% to 100% audio slider with mute toggle (M).
- Field of View (FOV): 70° to 90° slider (default 75°).
- Minimap: Toggle radar visibility (N, default ON).

## Debug Toggles

Inspection tools can be activated on startup via URL query parameters or toggled live with number keys:

- `7` / `?showcolliders`: Renders translucent wireframe boxes of all `WorldCollider` collision shells (red for walls, blue for floors).
- `8` / `?showlatches`: Visualizes all 320+ web anchor grapple points across the city skyline as cyan octahedrons.
- `9` / `?debugyard`: Overlays 10m, 25m, and 50m concentric ground markings and distance pillars for traversal timing drills.
- `0` / `?debugrange`: Spawns a measured ballistics firing range (10m, 25m, 50m, 75m, 100m) to test bullet falloff and weapon spread.

## Testing and QA Tooling

- Unit Tests: `npm run test` (runs Vitest suite covering physics, weapons, enemy AI, collision shells, city latch density, and performance ceilings).
- Linting: `npm run lint` (runs ESLint over TypeScript source files).
- Production Build: `npm run build` (runs `tsc` typecheck and minified Vite bundle).
- Visual Test Suite: `node scripts/test_visuals.js` (runs Puppeteer automated test suite against an active `localhost:3000` instance, capturing 14 gameplay screenshots into `screenshots/`).
- Headless Diagnostic: `node scripts/diagnose_browser.js` (diagnoses WebGL canvas rendering, DOM layers, and camera matrices in headless Chrome).
- Human Regression Checklist: see `docs/QA-CHECKLIST.md` for the 20-step pre-release verification protocol (R1–R20).
- Performance Budgets: see `docs/PERFLOG.md` for draw call, raycast, enemy, and particle budgets.

## Rules of the Sketch

- The Pistol is the only gun that fires while swinging.
- SMG and Scoped Sniper require solid footing (or completed zip arrival).
- Clearing a wave restores full ammunition and heals +25 HP.
- HP regenerates up to 50 HP after 5 seconds without taking damage.
- Headshots pay extra score. Aerial swing kills and longshots award combo bonuses.
- Watch the red directional damage ring around the reticle: it points directly back at whoever shot you.

## Project Layout

- `src/core`: Game loop, input manager, settings persistence, procedural Web Audio.
- `src/player`: Movement, pendulum physics, weapon manager, viewmodel arms, web shooter.
- `src/weapons`: Pistol, SMG, scoped sniper rifle.
- `src/enemies`: Thug, sniper, drone, wave director.
- `src/world`: Procedural skyscraper district, construction site, collision shells.
- `src/ui`: Combat HUD, minimap, pause menu, death screen.
- `src/shaders`: Ink pen crosshatch and paper sketch GLSL shaders.
- `docs/`: QA checklist (`QA-CHECKLIST.md`) and performance budgets (`PERFLOG.md`).
- `scripts/`: Headless browser test and diagnostic automation.
- `tests/`: Automated Vitest test suites.
- `GAME_PLAN.md`: Complete architecture plan and tuning tables.
