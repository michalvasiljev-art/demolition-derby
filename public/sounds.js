// Web Audio sound engine — no external files needed

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bgGain = null;
    this.sfxGain = null;
    this.bgInterval = null;
    this.nextBeatTime = 0;
    this.beatIdx = 0;
    this.ready = false;
  }

  init() {
    if (this.ready) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();

      // Compressor for punch
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 6;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      comp.connect(this.ctx.destination);

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(comp);

      this.bgGain = this.ctx.createGain();
      this.bgGain.gain.value = 0.45;
      this.bgGain.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 1.0;
      this.sfxGain.connect(this.master);

      this.ready = true;
      this._startBackground();
    } catch (e) {
      console.warn('Audio init failed:', e);
    }
  }

  _noise(duration) {
    const n = Math.ceil(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  // ─── Background: engine drone + industrial beat ───────────────────────────

  _startBackground() {
    // Engine drone — 3 detuned oscillators
    for (let i = 0; i < 3; i++) {
      const osc  = this.ctx.createOscillator();
      const filt = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = i === 0 ? 'sawtooth' : 'square';
      osc.frequency.value = 55 * (i + 1) + i * 1.8;
      filt.type = 'lowpass';
      filt.frequency.value = 180 + i * 50;
      gain.gain.value = 0.07 / (i + 1);
      osc.connect(filt); filt.connect(gain); gain.connect(this.bgGain);
      osc.start();
    }

    // LFO — engine "breathing"
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    lfo.frequency.value = 0.7;
    lfoG.gain.value = 0.015;
    lfo.connect(lfoG); lfoG.connect(this.bgGain.gain);
    lfo.start();

    // Beat scheduler (lookahead pattern — drift-free)
    const BPM = 130;
    const beat = 60 / BPM;
    this.nextBeatTime = this.ctx.currentTime + 0.15;
    this.beatIdx = 0;
    this.bgInterval = setInterval(() => {
      while (this.nextBeatTime < this.ctx.currentTime + 0.25) {
        this._scheduleBeat(this.beatIdx, this.nextBeatTime, beat);
        this.nextBeatTime += beat;
        this.beatIdx = (this.beatIdx + 1) % 8;
      }
    }, 40);
  }

  _scheduleBeat(idx, t, beat) {
    if (idx === 0 || idx === 4) this._kick(t);
    if (idx === 2 || idx === 6) this._snare(t);
    this._hihat(t, idx % 2 === 0 ? 0.3 : 0.15);
    if (idx === 1 || idx === 5) this._hihat(t + beat * 0.5, 0.1);
  }

  _kick(t) {
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.35);
    gain.gain.setValueAtTime(0.85, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    osc.connect(gain); gain.connect(this.bgGain);
    osc.start(t); osc.stop(t + 0.42);
  }

  _snare(t) {
    const n    = this._noise(0.2);
    const filt = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filt.type = 'bandpass'; filt.frequency.value = 1400; filt.Q.value = 0.7;
    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(filt); filt.connect(gain); gain.connect(this.bgGain);
    n.start(t);

    const osc = this.ctx.createOscillator();
    const g2  = this.ctx.createGain();
    osc.frequency.value = 185;
    g2.gain.setValueAtTime(0.18, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(g2); g2.connect(this.bgGain);
    osc.start(t); osc.stop(t + 0.07);
  }

  _hihat(t, vol = 0.2) {
    const n    = this._noise(0.06);
    const filt = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filt.type = 'highpass'; filt.frequency.value = 7000;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    n.connect(filt); filt.connect(gain); gain.connect(this.bgGain);
    n.start(t);
  }

  // ─── SFX ─────────────────────────────────────────────────────────────────

  playHit(intensity = 1.0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;

    // Metal clang (noise burst)
    const n    = this._noise(0.2);
    const filt = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filt.type = 'bandpass';
    filt.frequency.value = 350 + intensity * 700;
    filt.Q.value = 1.2;
    gain.gain.setValueAtTime(intensity * 0.65, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(filt); filt.connect(gain); gain.connect(this.sfxGain);
    n.start(t);

    // Low thud
    const osc = this.ctx.createOscillator();
    const g2  = this.ctx.createGain();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(18, t + 0.13);
    g2.gain.setValueAtTime(intensity * 0.55, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g2); g2.connect(this.sfxGain);
    osc.start(t); osc.stop(t + 0.14);
  }

  playExplosion() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;

    // Deep boom
    const osc = this.ctx.createOscillator();
    const g   = this.ctx.createGain();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(18, t + 0.55);
    g.gain.setValueAtTime(1.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(t); osc.stop(t + 0.85);

    // Body noise (rumble)
    const n    = this._noise(1.3);
    const filt = this.ctx.createBiquadFilter();
    const g2   = this.ctx.createGain();
    filt.type = 'lowpass'; filt.frequency.value = 700;
    g2.gain.setValueAtTime(1.6, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    n.connect(filt); filt.connect(g2); g2.connect(this.sfxGain);
    n.start(t);

    // High crackle
    const n2    = this._noise(0.4);
    const filt2 = this.ctx.createBiquadFilter();
    const g3    = this.ctx.createGain();
    filt2.type = 'highpass'; filt2.frequency.value = 2500;
    g3.gain.setValueAtTime(0.55, t);
    g3.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n2.connect(filt2); filt2.connect(g3); g3.connect(this.sfxGain);
    n2.start(t);
  }

  playVictory() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // C major ascending fanfare
    [261.63, 329.63, 392, 523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc  = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      const s = t + i * 0.135;
      gain.gain.setValueAtTime(0, s);
      gain.gain.linearRampToValueAtTime(0.22, s + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.22);
      osc.connect(gain); gain.connect(this.sfxGain);
      osc.start(s); osc.stop(s + 0.25);
    });
  }

  playDefeat() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // Descending sad notes
    [392, 349.23, 311.13, 261.63].forEach((freq, i) => {
      const osc  = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const s = t + i * 0.24;
      gain.gain.setValueAtTime(0, s);
      gain.gain.linearRampToValueAtTime(0.2, s + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.28);
      osc.connect(gain); gain.connect(this.sfxGain);
      osc.start(s); osc.stop(s + 0.3);
    });
  }

  // Engine roar when turbo activates
  playEngineRev() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;

    // Rising engine pitch sweep
    const osc  = this.ctx.createOscillator();
    const filt = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.55);
    filt.type = 'lowpass'; filt.frequency.value = 900;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.55, t + 0.06);
    gain.gain.setValueAtTime(0.55, t + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(filt); filt.connect(gain); gain.connect(this.sfxGain);
    osc.start(t); osc.stop(t + 0.7);

    // Second harmonic for richness
    const osc2 = this.ctx.createOscillator();
    const g2   = this.ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(140, t);
    osc2.frequency.exponentialRampToValueAtTime(1040, t + 0.55);
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.18, t + 0.06);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc2.connect(g2); g2.connect(this.sfxGain);
    osc2.start(t); osc2.stop(t + 0.6);
  }

  // Tire squeal + engine drop when turbo deactivates
  playBrake() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;

    // Tire squeal (bandpass noise with descending frequency)
    const n    = this._noise(0.7);
    const filt = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(3200, t);
    filt.frequency.exponentialRampToValueAtTime(600, t + 0.55);
    filt.Q.value = 10;
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    n.connect(filt); filt.connect(gain); gain.connect(this.sfxGain);
    n.start(t);

    // Engine drop (descending sawtooth)
    const osc  = this.ctx.createOscillator();
    const f2   = this.ctx.createBiquadFilter();
    const g2   = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.55);
    f2.type = 'lowpass'; f2.frequency.value = 700;
    g2.gain.setValueAtTime(0.4, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.connect(f2); f2.connect(g2); g2.connect(this.sfxGain);
    osc.start(t); osc.stop(t + 0.55);
  }

  stop() {
    if (this.bgInterval) clearInterval(this.bgInterval);
  }
}

const Sound = new SoundEngine();
