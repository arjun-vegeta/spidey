import { describe, it, expect } from 'vitest';
import { soundManager } from '../src/core/SoundManager';

describe('SoundManager - cue guards without an AudioContext', () => {
  it('all combat cues no-op instead of throwing', () => {
    expect(() => {
      soundManager.playAggro();
      soundManager.playAggro(12.5);
      soundManager.playAggro(45.0);
      soundManager.playThugAimClick();
      soundManager.playPredive();
      soundManager.playWhistle();
      soundManager.playSniperRelocate();
      soundManager.playSpawnIn();
      soundManager.startSniperCharge();
      soundManager.updateSniperCharge(0.4);
      soundManager.updateSniperCharge(1.0);
      soundManager.stopSniperCharge();
      soundManager.playKillStreak(4);
      soundManager.playKillStreak(1);
      soundManager.playPistolShot();
      soundManager.playHitMarker(true);
      soundManager.playWaveStart(2);
      soundManager.toggleMute();
      soundManager.toggleMute();
      soundManager.setVolume(0.3);
      soundManager.setVolume(0.7);

      // Player-side audio cues (plan 17 leftovers)
      soundManager.playFootstep();
      soundManager.playLandSoft();
      soundManager.playLandHard();
      soundManager.playPlayerHurt(-0.5);
      soundManager.playPlayerHurt();
      soundManager.setHeartbeat(true);
      soundManager.setHeartbeat(false);
      soundManager.playNearMissWhiz();
      soundManager.playDryWeb();
      soundManager.updateRopeStrain(true, 30, 1.0);
      soundManager.updateRopeStrain(false, 0, 0);
      soundManager.stopRopeStrain();
      soundManager.stopAllLoops();
    }).not.toThrow();
  });
});
