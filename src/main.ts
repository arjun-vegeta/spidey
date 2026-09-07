import './ui/hud.css';
import { Game } from './core/Game';
import { soundManager } from './core/SoundManager';
import { LoadingScreen } from './ui/LoadingScreen';
import { MultiplayerMenu } from './ui/MultiplayerMenu';
import type { NetSession } from './net/NetSession';

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
    const menu = new MultiplayerMenu();
    // Mirrors `window.__spidey`: lets the verification script and a console
    // observe the lobby, which lives on the menu before a match hands the
    // session over to the game.
    (window as unknown as { __spideyMenu?: MultiplayerMenu }).__spideyMenu = menu;

    // The front door is the menu now, so quitting must land there rather than
    // on the solo instructions card.
    game.suppressInstructionsOnReset = true;

    const hideModal = () => {
      if (modal) modal.style.display = 'none';
    };

    /** Classic single-player launch, unchanged from before multiplayer existed. */
    const startSolo = () => {
      if (game.player.isDead) game.restart();
      soundManager.ensureContext();
      game.input.requestPointerLock();
      game.start();
      hideModal();
      document.body.classList.add('in-game');
    };

    const enterMatch = (session: NetSession) => {
      soundManager.ensureContext();
      hideModal();
      menu.close();
      game.enterMultiplayer(session);
      game.start();
      game.input.requestPointerLock();
      document.body.classList.add('in-game');
    };

    /** Abandons a deathmatch and returns the player to the menu's home screen. */
    const leaveMatch = () => {
      game.exitMultiplayer();
      game.resetToMenu();
      hideModal();
      menu.returnToLobby();
      menu.open();
    };

    menu.onSolo = () => {
      // Solo keeps the original two-step: read the controls, then press ENTER.
      if (modal) modal.style.display = 'flex';
    };
    menu.onEnterMatch = enterMatch;
    menu.onLeaveSession = () => {
      game.exitMultiplayer();
      hideModal();
    };

    game.onLeaveMatchRequest = leaveMatch;
    // Quitting from the in-game pause menu behaves the same way.
    game.hud.onQuitRequest = () => {
      const wasMultiplayer = game.isMultiplayer;
      game.resetToMenu();
      hideModal();
      if (wasMultiplayer) menu.returnToLobby();
      menu.open();
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

    // Dismiss loading screen and smoothly reveal the menu
    await loadingScreen.finish();
    menu.open();

    // Honor an early ENTER press that landed before this code arrived (slow first load):
    // it now opens the menu rather than launching straight into a solo run.
    if ((window as unknown as { __spideyWantPlay?: boolean }).__spideyWantPlay) {
      (window as unknown as { __spideyWantPlay?: boolean }).__spideyWantPlay = false;
    }

    window.addEventListener('keydown', (e) => {
      // The menu owns ENTER whenever it is on screen (drop-in gate, mostly).
      if (e.key === 'Enter' || e.code === 'Enter') {
        if (menu.isOpen()) {
          if (menu.handleEnterKey()) e.preventDefault();
          return;
        }
        // ENTER on the leaderboard is the host's shortcut to a rematch.
        if (game.mpHud.isEndVisible) {
          if (game.net?.isHost) {
            e.preventDefault();
            game.net.requestRematch();
          }
          return;
        }
        if (modal && modal.style.display !== 'none') {
          e.preventDefault();
          (document.activeElement as HTMLElement)?.blur?.();
          startSolo();
          return;
        }
        const pauseMenu = document.getElementById('pause-menu');
        if (pauseMenu && pauseMenu.style.display === 'flex') {
          e.preventDefault();
          game.input.requestPointerLock();
          return;
        }
      }

      // Hold TAB for the live scoreboard. Must be swallowed or the browser
      // walks focus through the HUD while you are trying to read it.
      if (e.code === 'Tab' && game.isMultiplayer) {
        e.preventDefault();
        if (!e.repeat) game.mpHud.setScoreboardPinned(true);
        return;
      }

      if (menu.isOpen()) return;

      if (e.key === 'p' || e.key === 'P') {
        if (modal && !game.isMultiplayer) {
          modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
        }
      }
      // R restarts a solo run; in deathmatch the respawn timer owns that.
      if ((e.key === 'r' || e.key === 'R') && game.player.isDead && !game.isMultiplayer) {
        startSolo();
      }
      if (e.key === 'm' || e.key === 'M') {
        game.toggleMute();
      }
      if (e.key === 'n' || e.key === 'N') {
        game.toggleMinimap();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        game.mpHud.setScoreboardPinned(false);
      }
    });

    // Losing focus while holding TAB would otherwise stick the board open.
    window.addEventListener('blur', () => game.mpHud.setScoreboardPinned(false));

    // Leaving the page mid-match should not leave a ghost in the room.
    window.addEventListener('pagehide', () => game.net?.leave());
  } catch (err) {
    loadingScreen.showError(err);
    Game.showBootError(err);
  }
});
