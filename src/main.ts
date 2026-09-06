import './ui/hud.css';
import { Game } from './core/Game';
import { soundManager } from './core/SoundManager';

window.addEventListener('error', (e) => {
  try {
    Game.showBootError(e.error ?? e.message);
  } catch { /* overlay itself must never throw */ }
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    Game.showBootError(e.reason);
  } catch { /* ignore */ }
});

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();

  const modal = document.getElementById('instructions-modal');
  const playBtn = document.getElementById('play-button') as HTMLButtonElement | null;

  const startGame = () => {
    if (game.player.isDead) game.restart();
    soundManager.ensureContext();
    game.input.requestPointerLock();
    game.start();
    if (modal && game.input.isLocked) {
      modal.style.display = 'none';
    } else if (modal && document.pointerLockElement) {
      modal.style.display = 'none';
    }
  };

  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startGame();
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      startGame();
    });
  }

  // Honor a PLAY click that landed before this code arrived (slow first load):
  // start now; pointer lock follows on the next user gesture if it was too early.
  if ((window as unknown as { __spideyWantPlay?: boolean }).__spideyWantPlay) {
    (window as unknown as { __spideyWantPlay?: boolean }).__spideyWantPlay = false;
    startGame();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
      if (modal) {
        modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
      }
    }
    if ((e.key === 'r' || e.key === 'R') && game.player.isDead) {
      startGame();
    }
    if (e.key === 'm' || e.key === 'M') {
      soundManager.toggleMute();
    }
    if (e.key === 'n' || e.key === 'N') {
      game.toggleMinimap();
    }
  });
});
