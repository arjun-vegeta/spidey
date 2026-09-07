import { describe, it, expect } from 'vitest';
import { CityBuilder } from '../src/world/CityBuilder';

// Replicates Player.resolveWithShells ground-snap condition verbatim (Player.ts)
describe('winch snap repro', () => {
  it('falling 10m above street does NOT teleport to street', () => {
    const cb = new CityBuilder();
    const coll = cb.getWorldCollider();
    const halfH = 0.9;
    const pY = 10.5; // feet at 9.6, ~9m above street top 0.5
    const feetY = pY - halfH;
    const velY = -5.0;
    const dt = 0.016;
    const isFalling = velY <= 0.5;
    const fallSweep = isFalling ? Math.max(0.55, Math.min(2.5, -velY * dt + 0.4)) : 0.55;
    const top = coll.groundAt(0, feetY, 20, fallSweep);
    console.log('groundAt top =', top, 'feetY =', feetY, 'sweep =', fallSweep);
    const wouldSnap =
      top !== null &&
      isFalling &&
      (feetY <= (top as number) + 0.2 &&
        feetY >= (top as number) - fallSweep);
    console.log('WOULD SNAP (teleport down ' + (feetY - (top ?? 0)).toFixed(2) + 'm):', wouldSnap);
    expect(wouldSnap).toBe(false);
  });
});
