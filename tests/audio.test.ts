import { describe, it, expect } from 'vitest';
import { soundManager } from '../src/core/SoundManager';

describe('SoundManager - cue guards without an AudioContext', () => {
  it('all combat cues no-op instead of throwing', () => {
    expect(() => {
      soundManager.playAggro();
      soundManager.playThugAimClick();
      soundManager.playPredive();
      soundManager.playWhistle();
      soundManager.playKillStreak(4);
      soundManager.playKillStreak(1);
      soundManager.playPistolShot();
      soundManager.playHitMarker(true);
      soundManager.playWaveStart(2);
      soundManager.toggleMute();
      soundManager.toggleMute();
      soundManager.setVolume(0.3);
      soundManager.setVolume(0.7);
    }).not.toThrow();
  });
});
