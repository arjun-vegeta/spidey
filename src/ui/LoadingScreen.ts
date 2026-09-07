/**
 * LoadingScreen.ts
 * Manages the hand-drawn notebook blueprint loading screen lifecycle.
 * Prevents FOUC (Flash of Unstyled Content) and provides a smooth doodle-themed
 * loading transition into the game menu.
 */

export interface LoadingStep {
  threshold: number;
  text: string;
}

export class LoadingScreen {
  private overlay: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private barFill: HTMLElement | null = null;
  private percentEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;

  private currentProgress: number = 5;
  private targetProgress: number = 15;
  private animFrameId: number | null = null;
  private startTime: number = performance.now();
  private isFinished: boolean = false;
  private isDestroyed: boolean = false;

  private static readonly MIN_DISPLAY_MS = 850;

  private static readonly STEPS: LoadingStep[] = [
    { threshold: 25, text: '✏️ Priming ballpoint pens & drafting notebook...' },
    { threshold: 50, text: '📐 Drafting skyscraper blueprint geometry...' },
    { threshold: 72, text: '🕷️ Spinning tensile web physics & anchors...' },
    { threshold: 88, text: '🎯 Calibrating wrist web-shooters & sights...' },
    { threshold: 98, text: '📓 Binding drafting notebook...' },
    { threshold: 100, text: '⚡ Blueprint ready! Opening drafting table...' },
  ];

  constructor() {
    this.overlay = document.getElementById('loading-screen');
    this.card = document.getElementById('loading-card');
    this.barFill = document.getElementById('loading-bar-fill');
    this.percentEl = document.getElementById('loading-percentage');
    this.statusEl = document.getElementById('loading-status-text');
    this.modalEl = document.getElementById('instructions-modal');

    // Read any progress already set by early inline script
    if (this.percentEl) {
      const parsed = parseInt(this.percentEl.textContent || '0', 10);
      if (!isNaN(parsed) && parsed > 0) {
        this.currentProgress = parsed;
        this.targetProgress = Math.max(this.targetProgress, parsed);
      }
    }

    this.startProgressLoop();
  }

  /**
   * Set target progress percentage (0 - 100).
   */
  public setProgress(target: number, immediateText?: string): void {
    this.targetProgress = Math.min(100, Math.max(this.currentProgress, target));
    if (immediateText && this.statusEl) {
      this.statusEl.textContent = immediateText;
    }
  }

  /**
   * Smooth progress animation loop.
   */
  private startProgressLoop(): void {
    const tick = () => {
      if (this.isDestroyed) return;

      // Smoothly interpolate current towards target
      if (this.currentProgress < this.targetProgress) {
        const delta = Math.max(0.5, (this.targetProgress - this.currentProgress) * 0.12);
        this.currentProgress = Math.min(this.targetProgress, this.currentProgress + delta);
        this.renderProgress(this.currentProgress);
      }

      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  /**
   * Updates DOM elements for progress.
   */
  private renderProgress(progress: number): void {
    const rounded = Math.round(progress);
    if (this.barFill) {
      this.barFill.style.width = `${rounded}%`;
    }
    if (this.percentEl) {
      this.percentEl.textContent = `${rounded}%`;
    }

    if (this.statusEl) {
      for (const step of LoadingScreen.STEPS) {
        if (rounded <= step.threshold) {
          if (this.statusEl.textContent !== step.text) {
            this.statusEl.textContent = step.text;
          }
          break;
        }
      }
    }
  }

  /**
   * Called when Game and all assets are fully initialized.
   * Ensures minimum display duration so the doodle animation is smooth and enjoyable.
   */
  public async finish(): Promise<void> {
    if (this.isFinished) return;
    this.isFinished = true;

    // Push progress to 100%
    this.targetProgress = 100;

    // Wait for fonts to be loaded
    if ('fonts' in document) {
      try {
        await document.fonts.ready;
      } catch { /* proceed if fonts fail */ }
    }

    // Ensure minimum display time
    const elapsed = performance.now() - this.startTime;
    const remaining = Math.max(0, LoadingScreen.MIN_DISPLAY_MS - elapsed);
    if (remaining > 0) {
      await new Promise((r) => setTimeout(r, remaining));
    }

    // Force 100% progress render
    this.currentProgress = 100;
    this.renderProgress(100);

    if (this.statusEl) {
      this.statusEl.textContent = '⚡ Blueprint ready! Opening drafting table...';
    }

    // Small delay so user sees 100% completion
    await new Promise((r) => setTimeout(r, 220));

    // Reveal instructions modal
    if (this.modalEl) {
      this.modalEl.classList.remove('loading-hidden');
      this.modalEl.classList.add('ready');
      this.modalEl.style.display = 'flex';
      this.modalEl.style.opacity = '1';
    }

    // Fade out loading screen
    if (this.overlay) {
      this.overlay.classList.add('loaded');
      // Wait for CSS transition to finish
      await new Promise((r) => setTimeout(r, 450));
      this.overlay.style.display = 'none';
    }

    this.destroy();
  }

  /**
   * Show error on the doodle loading card.
   */
  public showError(err: unknown): void {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    if (this.statusEl) {
      this.statusEl.textContent = '❌ BLUEPRINT LOAD ERROR';
      this.statusEl.style.color = '#d63031';
    }
    if (this.card) {
      const existing = document.getElementById('loading-error-box');
      if (!existing) {
        const errorBox = document.createElement('div');
        errorBox.id = 'loading-error-box';
        errorBox.style.cssText = 'margin-top:16px;padding:12px;background:rgba(214,48,49,0.1);border:2px dashed #d63031;color:#d63031;font-family:monospace;font-size:12px;text-align:left;white-space:pre-wrap;max-height:160px;overflow:auto;';
        errorBox.textContent = `Drafting engine failed:\n${msg}\n\nClick below to retry.`;
        
        const retryBtn = document.createElement('button');
        retryBtn.textContent = 'RELOAD BLUEPRINT';
        retryBtn.style.cssText = 'display:block;margin:10px auto 0 auto;padding:8px 18px;background:#d63031;color:#f5eedd;border:2px solid #152778;font-weight:900;cursor:pointer;font-family:inherit;';
        retryBtn.onclick = () => window.location.reload();
        errorBox.appendChild(retryBtn);

        this.card.appendChild(errorBox);
      }
    }
  }

  private destroy(): void {
    this.isDestroyed = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
