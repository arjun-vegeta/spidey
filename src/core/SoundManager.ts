/**
 * SoundManager - Procedural Web Audio synthesizer for hand-drawn ink sketch FPS
 * Zero external audio assets needed. Generates authentic pen scratching, mechanical gunshots,
 * web thwips, wind rushing, and comic ink impact sounds entirely in real-time.
 */

export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  
  // Wind rush procedural audio nodes
  private windNode: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  // Sniper charge procedural audio nodes
  private sniperChargeOsc: OscillatorNode | null = null;
  private sniperChargeGain: GainNode | null = null;
  private sniperChargeFilter: BiquadFilterNode | null = null;

  // Rope strain loop procedural audio nodes
  private ropeStrainOsc: OscillatorNode | null = null;
  private ropeStrainGain: GainNode | null = null;
  private ropeStrainFilter: BiquadFilterNode | null = null;

  // Heartbeat loop state (<30 HP)
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isHeartbeatRunning: boolean = false;

  private isMuted: boolean = false;
  private initialized: boolean = false;
  private volume: number = 0.7;

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    this.applyVolume();
    return this.isMuted;
  }

  public get muted(): boolean { return this.isMuted; }

  /** Persisted master volume 0..1, applied live if context exists. */
  public setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.masterGain && this.ctx) {
      const target = this.isMuted ? 0 : this.volume;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }
  }

  constructor() {
    // AudioContext will be initialized on first user interaction
  }

  public init(): void {
    if (typeof window === 'undefined' || this.initialized) return;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Final mix pass: master DynamicsCompressor to prevent digital clipping under full-auto gunfire & layered SFX
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-3.0, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(6.0, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(12.0, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.1, this.ctx.currentTime);
      this.compressor.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(0.75, this.ctx.currentTime);
      this.sfxGain.connect(this.compressor);

      this.initWindSynth();
      this.initialized = true;

      // Resume context if suspended
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    } catch (e) {
      console.warn('Web Audio API not supported or blocked:', e);
    }
  }

  public ensureContext(): void {
    if (!this.initialized) {
      this.init();
    } else if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Initializes looping procedural wind rush noise
   */
  private initWindSynth(): void {
    if (!this.ctx || !this.masterGain) return;

    // Create 3 seconds of pink/brown noise buffer
    const bufferSize = this.ctx.sampleRate * 3;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.06;
      b6 = white * 0.115926;
    }

    this.windNode = this.ctx.createBufferSource();
    this.windNode.buffer = noiseBuffer;
    this.windNode.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.setValueAtTime(250, this.ctx.currentTime);
    this.windFilter.Q.setValueAtTime(1.5, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.001, this.ctx.currentTime);

    this.windNode.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    this.windNode.start();
  }

  /**
   * Updates wind rush intensity based on player velocity magnitude
   */
  public updateWind(speed: number, maxSpeed: number = 40): void {
    if (!this.windGain || !this.windFilter || !this.ctx) return;

    const normalized = Math.min(Math.max((speed - 6) / (maxSpeed - 6), 0), 1);
    const targetGain = normalized * normalized * 0.45;
    const targetFreq = 250 + normalized * 1800;

    const now = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(targetGain, now, 0.08);
    this.windFilter.frequency.setTargetAtTime(targetFreq, now, 0.08);
  }

  /**
   * Classic comic book "THWIP!" web shooter sound
   */
  public playWebShoot(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    // High frequency chirp osc
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.12);

    oscGain.gain.setValueAtTime(0.35, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    // Filtered noise snap
    const noise = this.createNoiseBuffer(0.08);
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.Q.setValueAtTime(4.0, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(oscGain);
    oscGain.connect(this.sfxGain);
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.13);
    noiseSource.start(now);
    noiseSource.stop(now + 0.09);
  }

  /**
   * Sound played when web latches onto a building surface
   */
  public playWebLatch(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(550, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.09);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  /**
   * Web release slingshot pop
   */
  public playWebRelease(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(720, now + 0.07);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.09);
  }

  /**
   * Pistol Gunshot - snappy, punchy, crisp ballpoint pen revolver
   */
  public playPistolShot(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    // Bass punch
    const punch = this.ctx.createOscillator();
    const punchGain = this.ctx.createGain();
    punch.type = 'sine';
    punch.frequency.setValueAtTime(260, now);
    punch.frequency.exponentialRampToValueAtTime(45, now + 0.15);

    punchGain.gain.setValueAtTime(0.6, now);
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    // Mechanical snap/crack noise
    const noise = this.createNoiseBuffer(0.12);
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1000, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.7, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    punch.connect(punchGain);
    punchGain.connect(this.sfxGain);
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);

    punch.start(now);
    punch.stop(now + 0.16);
    noiseSource.start(now);
    noiseSource.stop(now + 0.13);
  }

  /**
   * SMG Gunshot - rapid, metallic, rhythmic
   */
  public playSMGShot(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    const punch = this.ctx.createOscillator();
    const punchGain = this.ctx.createGain();
    punch.type = 'triangle';
    punch.frequency.setValueAtTime(320, now);
    punch.frequency.exponentialRampToValueAtTime(60, now + 0.07);

    punchGain.gain.setValueAtTime(0.45, now);
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    const noise = this.createNoiseBuffer(0.06);
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.Q.setValueAtTime(2.0, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    punch.connect(punchGain);
    punchGain.connect(this.sfxGain);
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);

    punch.start(now);
    punch.stop(now + 0.08);
    noiseSource.start(now);
    noiseSource.stop(now + 0.07);
  }

  /**
   * Sniper Gunshot - massive thunderous crack, deep sub punch, long reverb decay
   */
  public playSniperShot(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    // Sub-bass boom
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(180, now);
    sub.frequency.exponentialRampToValueAtTime(30, now + 0.5);

    subGain.gain.setValueAtTime(0.9, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    // Explosive crack noise
    const noise = this.createNoiseBuffer(0.4);
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.35);
    filter.Q.setValueAtTime(1.5, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.95, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);

    sub.start(now);
    sub.stop(now + 0.55);
    noiseSource.start(now);
    noiseSource.stop(now + 0.42);

    // Bolt action mechanical cycle click after 0.4s
    setTimeout(() => {
      this.playBoltCycle();
    }, 380);
  }

  /**
   * Sniper bolt action cycle click
   */
  public playBoltCycle(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.setValueAtTime(1400, now + 0.05);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.11);
  }

  /**
   * Katana / Sword Slash - crisp whistling swoosh through air (inspired by inspiration)
   */
  public playKatanaSwing(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const dur = 0.20;
    const noise = this.createNoiseBuffer(dur);
    const src = this.ctx.createBufferSource();
    src.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(3000, now + dur);
    filter.Q.setValueAtTime(1.5, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    src.start(now);
    src.stop(now + dur + 0.02);
  }

  /**
   * Katana / Sword Hit - crunchy, meaty ink slice impact (inspired by inspiration)
   */
  public playKatanaHit(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    // Deep blade body impact tone
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.12);
    oscGain.gain.setValueAtTime(0.55, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    // Meaty lowpass thud
    const noise1 = this.createNoiseBuffer(0.14);
    const src1 = this.ctx.createBufferSource();
    src1.buffer = noise1;
    const filter1 = this.ctx.createBiquadFilter();
    filter1.type = 'lowpass';
    filter1.frequency.setValueAtTime(900, now);
    filter1.frequency.exponentialRampToValueAtTime(200, now + 0.14);
    const gain1 = this.ctx.createGain();
    gain1.gain.setValueAtTime(0.65, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    // Sharp ink slice friction
    const noise2 = this.createNoiseBuffer(0.10);
    const src2 = this.ctx.createBufferSource();
    src2.buffer = noise2;
    const filter2 = this.ctx.createBiquadFilter();
    filter2.type = 'bandpass';
    filter2.frequency.setValueAtTime(2500, now);
    filter2.Q.setValueAtTime(0.6, now);
    const gain2 = this.ctx.createGain();
    gain2.gain.setValueAtTime(0.40, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.10);

    osc.connect(oscGain);
    oscGain.connect(this.sfxGain);
    src1.connect(filter1);
    filter1.connect(gain1);
    gain1.connect(this.sfxGain);
    src2.connect(filter2);
    filter2.connect(gain2);
    gain2.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.14);
    src1.start(now);
    src1.stop(now + 0.15);
    src2.start(now);
    src2.stop(now + 0.11);
  }

  /**
   * Sniper optical scope in/out mechanical click
   */
  public playSniperScope(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.06);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.09);
  }

  /**
   * Bullet impact on architecture (concrete / steel)
   */
  public playImpactWall(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    const noise = this.createNoiseBuffer(0.05);
    const source = this.ctx.createBufferSource();
    source.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2200, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    source.start(now);
    source.stop(now + 0.06);
  }

  /**
   * Enemy hit indicator - satisfying high register pen scratch ding!
   */
  public playHitMarker(isHeadshot: boolean = false): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';

    if (isHeadshot) {
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(2100, now + 0.09);
      gain.gain.setValueAtTime(0.4, now);
    } else {
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1150, now + 0.07);
      gain.gain.setValueAtTime(0.25, now);
    }

    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.11);
  }

  /**
   * Enemy death - paper rip + ink splatter
   */
  public playEnemyDeath(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    // Low squelch
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.2);

    oscGain.gain.setValueAtTime(0.25, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    // Paper tear noise
    const noise = this.createNoiseBuffer(0.18);
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.Q.setValueAtTime(3.0, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(oscGain);
    oscGain.connect(this.sfxGain);
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.22);
    noiseSource.start(now);
    noiseSource.stop(now + 0.2);
  }

  /**
   * Weapon switch pen scribble / holster click
   */
  public playWeaponSwitch(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(350, now + 0.08);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.09);
  }

  /**
   * Dry fire / empty ammo click
   */
  public playEmptyClick(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(950, now);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.04);
  }

  /**
   * Reload sequence: mag out, mag in, slide pull
   */
  public playReload(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;

    // Mag eject at 0.05s
    this.playClick(now + 0.05, 450, 0.15);
    // Mag insert at 0.55s
    this.playClick(now + 0.55, 650, 0.25);
    // Slide rack at 0.95s
    this.playClick(now + 0.95, 850, 0.3);
  }

  private playClick(time: number, freq: number, volume: number): void {
    if (!this.ctx || !this.sfxGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, time + 0.06);

    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(time);
    osc.stop(time + 0.07);
  }

  /**
   * Enemy alert ping when a new enemy aggros (positional-ish, quiet, distance-attenuated)
   */
  public playAggro(dist?: number): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.setValueAtTime(830, now + 0.07);

    let vol = 0.12;
    if (dist !== undefined) {
      const norm = Math.max(0, Math.min(1, (dist - 4) / 46));
      vol = 0.15 - norm * 0.12; // ranges from 0.15 down to 0.03
    }

    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /**
   * Sniper reposition telegraph: rising tick sound at current perch before dash
   */
  public playSniperRelocate(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(900 + i * 350, t);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.07);
    }
  }

  /**
   * Enemy sketch-in spawn sound (pencil hatching / pen scratch)
   */
  public playSpawnIn(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const noise = this.createNoiseBuffer(0.18);
    const source = this.ctx.createBufferSource();
    source.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + 0.16);
    filter.Q.setValueAtTime(3.0, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    source.start(now);
    source.stop(now + 0.19);
  }

  /**
   * Starts sniper charge whine (pitch rises with chargeTimer)
   */
  public startSniperCharge(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    this.stopSniperCharge();

    const now = this.ctx.currentTime;
    this.sniperChargeOsc = this.ctx.createOscillator();
    this.sniperChargeGain = this.ctx.createGain();
    this.sniperChargeFilter = this.ctx.createBiquadFilter();

    this.sniperChargeOsc.type = 'sawtooth';
    this.sniperChargeOsc.frequency.setValueAtTime(320, now);

    this.sniperChargeFilter.type = 'lowpass';
    this.sniperChargeFilter.frequency.setValueAtTime(2000, now);

    this.sniperChargeGain.gain.setValueAtTime(0.02, now);

    this.sniperChargeOsc.connect(this.sniperChargeFilter);
    this.sniperChargeFilter.connect(this.sniperChargeGain);
    this.sniperChargeGain.connect(this.sfxGain);

    this.sniperChargeOsc.start(now);
  }

  /**
   * Updates rising sniper charge pitch and volume
   */
  public updateSniperCharge(progress: number): void {
    if (!this.ctx || !this.sniperChargeOsc || !this.sniperChargeGain) return;
    const clamped = Math.min(1, Math.max(0, progress));
    const now = this.ctx.currentTime;
    const freq = 320 + Math.pow(clamped, 1.8) * 1480;
    this.sniperChargeOsc.frequency.setTargetAtTime(freq, now, 0.03);
    const gain = 0.02 + clamped * 0.14;
    this.sniperChargeGain.gain.setTargetAtTime(gain, now, 0.03);
  }

  /**
   * Stops sniper charge whine on firing or cancel
   */
  public stopSniperCharge(): void {
    if (!this.sniperChargeOsc || !this.ctx) {
      this.sniperChargeOsc = null;
      this.sniperChargeGain = null;
      this.sniperChargeFilter = null;
      return;
    }
    try {
      this.sniperChargeGain?.gain.setTargetAtTime(0.001, this.ctx.currentTime, 0.02);
      const osc = this.sniperChargeOsc;
      this.sniperChargeOsc = null;
      this.sniperChargeGain = null;
      this.sniperChargeFilter = null;
      setTimeout(() => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // Ignored if already stopped
        }
      }, 50);
    } catch {
      this.sniperChargeOsc = null;
      this.sniperChargeGain = null;
      this.sniperChargeFilter = null;
    }
  }

  /**
   * Thug pre-burst aim click (0.4s fairness warning before bullets)
   */
  public playThugAimClick(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1500, now);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  /**
   * Drone pre-dive whine (0.5s telegraph before darts)
   */
  public playPredive(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.45);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.52);
  }

  /**
   * Falling whistle for drone deaths
   */
  public playWhistle(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.65);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.72);
  }

  /**
   * Kill-streak chime, pitch ladders with streak
   */
  public playKillStreak(streak: number): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain || streak < 2) return;
    const now = this.ctx.currentTime;
    const base = 660 * Math.pow(1.122, Math.min(streak, 8));
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.setValueAtTime(base * 1.5, now + 0.08);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.27);
  }

  /**
   * Wave start / fanfare chord
   */  public playWaveStart(waveNumber: number): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const root = 220 * Math.pow(1.05946, (waveNumber % 12));
    const chord = [root, root * 1.25, root * 1.5, root * 2.0];

    chord.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.18, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.6);

      osc.connect(gain);
      gain.connect(this.sfxGain!);

      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.65);
    });
  }

  /**
   * Footstep sound on ground (paper scuff / crisp sole tap)
   */
  public playFootstep(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const noise = this.createNoiseBuffer(0.04);
    const src = this.ctx.createBufferSource();
    src.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(750, now);
    filter.Q.setValueAtTime(2.0, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.065, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    src.start(now);
    src.stop(now + 0.045);
  }

  /**
   * Soft landing floor thud (-8 m/s to -25 m/s fall speed)
   */
  public playLandSoft(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.09);
  }

  /**
   * Hard landing floor thud (>25 m/s fall speed)
   */
  public playLandHard(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    // Sub-bass heavy thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(85, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.18);

    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.19);

    // Dust/concrete crunch overlay
    const noise = this.createNoiseBuffer(0.12);
    const src = this.ctx.createBufferSource();
    src.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.22, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.sfxGain);

    src.start(now);
    src.stop(now + 0.13);
  }

  /**
   * Player hurt impact thud with optional directional stereo pan (-1 left .. +1 right)
   */
  public playPlayerHurt(pan?: number): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    let targetNode: AudioNode = this.sfxGain;
    if (typeof pan === 'number' && typeof this.ctx.createStereoPanner === 'function') {
      try {
        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);
        panner.connect(this.sfxGain);
        targetNode = panner;
      } catch {
        targetNode = this.sfxGain;
      }
    }

    // Heavy directional body thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.15);

    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(targetNode);

    osc.start(now);
    osc.stop(now + 0.16);

    // Grunt-ish ink splatter noise
    const noise = this.createNoiseBuffer(0.08);
    const src = this.ctx.createBufferSource();
    src.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(650, now);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.25, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(targetNode);

    src.start(now);
    src.stop(now + 0.09);
  }

  /**
   * Sub-30 HP tension heartbeat loop (starts/stops on threshold)
   */
  public setHeartbeat(active: boolean): void {
    if (!active) {
      if (this.heartbeatTimer !== null) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.isHeartbeatRunning = false;
      return;
    }

    if (this.isHeartbeatRunning) return;
    this.isHeartbeatRunning = true;

    const pulse = () => {
      if (!this.ctx || !this.sfxGain || !this.isHeartbeatRunning) return;
      const now = this.ctx.currentTime;

      // Lub: first thump
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(58, now);
      osc1.frequency.exponentialRampToValueAtTime(40, now + 0.07);

      gain1.gain.setValueAtTime(0.22, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc1.connect(gain1);
      gain1.connect(this.sfxGain);

      osc1.start(now);
      osc1.stop(now + 0.08);

      // Dub: second heavier thump 0.12s later
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(50, now + 0.12);
      osc2.frequency.exponentialRampToValueAtTime(32, now + 0.22);

      gain2.gain.setValueAtTime(0.28, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc2.connect(gain2);
      gain2.connect(this.sfxGain);

      osc2.start(now + 0.12);
      osc2.stop(now + 0.23);
    };

    pulse();
    this.heartbeatTimer = setInterval(pulse, 820);
  }

  /**
   * Near-miss whiz when an enemy projectile passes <2m
   */
  public playNearMissWhiz(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, now);
    osc.frequency.exponentialRampToValueAtTime(450, now + 0.11);

    gain.gain.setValueAtTime(0.02, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.12);
  }

  /**
   * Failed web feedback: dry "thwip" / empty click sound
   */
  public playDryWeb(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.04);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.05);

    const noise = this.createNoiseBuffer(0.03);
    const src = this.ctx.createBufferSource();
    src.buffer = noise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1600, now);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.18, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.sfxGain);

    src.start(now);
    src.stop(now + 0.035);
  }

  /**
   * Rope strain loop while swinging, pitched by speed & tension
   */
  public updateRopeStrain(isSwinging: boolean, speed: number, tension: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    if (!isSwinging) {
      if (this.ropeStrainGain) {
        this.ropeStrainGain.gain.setTargetAtTime(0.0001, now, 0.04);
      }
      return;
    }

    if (!this.ropeStrainOsc || !this.ropeStrainGain || !this.ropeStrainFilter) {
      this.ropeStrainOsc = this.ctx.createOscillator();
      this.ropeStrainGain = this.ctx.createGain();
      this.ropeStrainFilter = this.ctx.createBiquadFilter();

      this.ropeStrainOsc.type = 'triangle';
      this.ropeStrainOsc.frequency.setValueAtTime(120, now);

      this.ropeStrainFilter.type = 'bandpass';
      this.ropeStrainFilter.frequency.setValueAtTime(240, now);
      this.ropeStrainFilter.Q.setValueAtTime(2.5, now);

      this.ropeStrainGain.gain.setValueAtTime(0.001, now);

      this.ropeStrainOsc.connect(this.ropeStrainFilter);
      this.ropeStrainFilter.connect(this.ropeStrainGain);
      this.ropeStrainGain.connect(this.sfxGain);

      this.ropeStrainOsc.start(now);
    }

    const t = Math.max(0, Math.min(1, tension));
    const targetFreq = 100 + Math.min(speed, 65) * 3.2 + t * 90;
    const targetVol = Math.min(0.14, 0.02 + (Math.min(speed, 65) / 45) * 0.08 * t);

    this.ropeStrainOsc.frequency.setTargetAtTime(targetFreq, now, 0.05);
    this.ropeStrainFilter.frequency.setTargetAtTime(targetFreq * 1.5, now, 0.05);
    this.ropeStrainGain.gain.setTargetAtTime(targetVol, now, 0.05);
  }

  public stopRopeStrain(): void {
    if (this.ropeStrainGain && this.ctx) {
      this.ropeStrainGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Stops all looping sounds (wind, heartbeat, rope strain, sniper charge)
   */
  public stopAllLoops(): void {
    this.setHeartbeat(false);
    this.stopRopeStrain();
    this.stopSniperCharge();
    this.updateWind(0, 45);
  }

  /**
   * Helper: Generate a short white noise AudioBuffer
   */
  private createNoiseBuffer(seconds: number): AudioBuffer {
    const rate = this.ctx ? this.ctx.sampleRate : 44100;
    const length = Math.floor(rate * seconds);
    const buffer = this.ctx!.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}

export const soundManager = new SoundManager();
