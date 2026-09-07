import './ui/hud.css';
import { Game } from './core/Game';
import { soundManager } from './core/SoundManager';
import { LoadingScreen } from './ui/LoadingScreen';

const loadingScreen = new LoadingScreen();

window.addEventListener('error', (e) => {
  try {
    loadingScreen.showError(e.error ?? e.message);
    Game.showBootError(e.error ?? e.message);
  } catch { /* overlay itself must never throw */ }
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    loadingScreen.showError(e.reason);
    Game.showBootError(e.reason);
  } catch { /* ignore */ }
});

window.addEventListener('DOMContentLoaded', async () => {
  try {
    loadingScreen.setProgress(35, '📐 Drafting skyscraper blueprint geometry...');
    const game = new Game();
    loadingScreen.setProgress(85, '🎯 Calibrating wrist web-shooters & sights...');

    const modal = document.getElementById('instructions-modal');
    const playBtn = document.getElementById('play-button') as HTMLButtonElement | null;

    const startGame = () => {
      if (game.player.isDead) game.restart();
      soundManager.ensureContext();
      game.input.requestPointerLock();
      game.start();
      if (modal) {
        modal.style.display = 'none';
      }
      if (typeof document !== 'undefined') {
        document.body.classList.add('in-game');
      }
    };

    const flashEnterPrompt = () => {
      const promptBox = document.getElementById('play-button');
      const hint = document.getElementById('play-action-hint');
      if (promptBox) {
        promptBox.classList.remove('enter-shake');
        void promptBox.offsetWidth; // trigger reflow
        promptBox.classList.add('enter-shake');
      }
      if (hint) {
        hint.classList.add('hint-highlight');
        setTimeout(() => hint.classList.remove('hint-highlight'), 1200);
      }
    };

    // Clicking does NOT start the game; prompts the player to press ENTER
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        flashEnterPrompt();
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('input') || target.closest('label') || target.closest('select')) return;
        flashEnterPrompt();
      });
    }

    // Dismiss loading screen and smoothly reveal styled instructions modal
    await loadingScreen.finish();

    // Honor an early ENTER press that landed before this code arrived (slow first load):
    if ((window as unknown as { __spideyWantPlay?: boolean }).__spideyWantPlay) {
      (window as unknown as { __spideyWantPlay?: boolean }).__spideyWantPlay = false;
      startGame();
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.code === 'Enter') {
        if (modal && modal.style.display !== 'none') {
          e.preventDefault();
          (document.activeElement as HTMLElement)?.blur?.();
          startGame();
          return;
        }
        const pauseMenu = document.getElementById('pause-menu');
        if (pauseMenu && pauseMenu.style.display === 'flex') {
          e.preventDefault();
          game.input.requestPointerLock();
          return;
        }
      }
      if (e.key === 'p' || e.key === 'P') {
        if (modal) {
          modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
        }
      }
      if ((e.key === 'r' || e.key === 'R' || e.key === 'Enter' || e.code === 'Enter') && game.player.isDead) {
        startGame();
      }
      if (e.key === 'm' || e.key === 'M') {
        game.toggleMute();
      }
      if (e.key === 'n' || e.key === 'N') {
        game.toggleMinimap();
      }
    });
  } catch (err) {
    loadingScreen.showError(err);
    Game.showBootError(err);
  }
});

