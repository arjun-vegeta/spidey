# 🕷️ Spidey

First-person web-swing shooter set in a hand-drawn notebook city.
Swing between skyscrapers, land on rooftops and terraces, and clear
waves of ink enemies with a pistol, SMG, and scoped sniper rifle.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and click ENTER BLUEPRINT CITY & PLAY.

Other commands: `npm run test` (unit tests), `npm run build` (production
build), `npm run lint`.

## Controls

- WASD: move / pump the swing
- Mouse: look
- Hold Right-click or E: web swing
- F: web zip to target
- Left-click or V: fire
- Q or middle mouse: aim / scope
- 1 / 2 / 3 or wheel: pistol / SMG / sniper
- Shift / Ctrl: reel rope in / out
- R: reload (restart when dead)
- M: mute, N: minimap, P: pause menu

## Rules of the sketch

- The pistol is the only gun that fires while swinging.
- SMG and sniper need solid ground (or a finished zip).
- Clearing a wave refills ammo and restores 25 HP.
- HP slowly regenerates up to 50 after 5 seconds without damage.
- Headshots pay extra. Swing kills and longshots pay more.
- Red marker = enemy weak point. Watch the damage ring: it points
  back at whoever shot you.

## Layout

- `src/core`: game loop, input, procedural audio
- `src/player`: movement, swing physics, weapons, viewmodel arms
- `src/weapons`: pistol, SMG, sniper
- `src/enemies`: thug, sniper, drone, wave manager
- `src/world`: city, construction site, collision shells
- `src/ui`: HUD, minimap
- `GAME_PLAN.md`: the full improvement plan and tuning tables
