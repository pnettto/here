// HERE — generative music
// A warm drone, slow chords that breathe with the visuals, and rare bells.

(function(){
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // D major / lydian colours, voiced low and open
  const CHORDS = [
    [38, 50, 57, 61, 64, 66],   // Dmaj9
    [35, 47, 54, 57, 61, 62],   // Bm(add9)
    [31, 43, 50, 54, 57, 61],   // Gmaj7#11-ish
    [33, 45, 52, 59, 61, 64],   // A(add9)
    [40, 52, 55, 59, 62, 66],   // Em9
    [31, 43, 50, 57, 59, 62],   // G6/9
  ];
  // woody voice: D major pentatonic, mid register (A3 … E5)
  const WOOD = [57, 59, 62, 64, 66, 69, 71, 74, 76];

  class Music {
    constructor(){
      this.ctx = null;
      this.muted = false;
      this.onBell = null;
      this.chordIndex = 0;
    }

    start(){
      if(this.ctx) return;
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

      this.master = ctx.createGain();
      this.master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.6;
      this.master.connect(comp).connect(ctx.destination);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(9, 2.6);
      const wet = ctx.createGain(); wet.gain.value = 0.85;
      this.reverb.connect(wet).connect(this.master);

      this.bus = ctx.createGain(); this.bus.gain.value = 0.55;
      this.bus.connect(this.master);
      this.bus.connect(this.reverb);

      this.padFilter = ctx.createBiquadFilter();
      this.padFilter.type = 'lowpass';
      this.padFilter.frequency.value = 700;
      this.padFilter.Q.value = 0.4;
      this.padFilter.connect(this.bus);

      this.drone();
      this.master.gain.setValueAtTime(0, ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 1.0, ctx.currentTime + 10);

      this.nextChordAt = ctx.currentTime + 0.5;
      this.nextBellAt = ctx.currentTime + 7;
      this.timer = setInterval(() => this.tick(), 200);
    }

    impulse(seconds, decay){
      const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * seconds);
      const buf = ctx.createBuffer(2, len, rate);
      for(let ch = 0; ch < 2; ch++){
        const d = buf.getChannelData(ch);
        let lp = 0;
        for(let i = 0; i < len; i++){
          const x = i / len;
          lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4; // slightly darker tail
          d[i] = lp * Math.pow(1 - x, decay) * (i < rate * 0.02 ? i / (rate * 0.02) : 1);
        }
      }
      return buf;
    }

    drone(){
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.10, ctx.currentTime + 14);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
      g.connect(f).connect(this.bus);
      [[mtof(26), 0], [mtof(38), 3], [mtof(38), -4], [mtof(45), 2]].forEach(([fr, cents], i) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = fr; o.detune.value = cents;
        const og = ctx.createGain(); og.gain.value = i === 0 ? 0.9 : 0.35;
        // slow swell
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + i * 0.011;
        const lg = ctx.createGain(); lg.gain.value = 0.15;
        lfo.connect(lg).connect(og.gain);
        o.connect(og).connect(g);
        o.start(); lfo.start();
      });
    }

    pad(chord, when, dur){
      const ctx = this.ctx;
      chord.forEach((m, i) => {
        const fr = mtof(m);
        const env = ctx.createGain();
        const peak = (i === 0 ? 0.05 : 0.035) * (m > 60 ? 0.7 : 1);
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(peak, when + 6 + Math.random() * 2);
        env.gain.setValueAtTime(peak, when + dur - 1);
        env.gain.linearRampToValueAtTime(0, when + dur + 8);
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if(pan){ pan.pan.value = (Math.random() * 2 - 1) * 0.6; env.connect(pan).connect(this.padFilter); }
        else env.connect(this.padFilter);
        [-6, 6].forEach((det, k) => {
          const o = ctx.createOscillator();
          o.type = k === 0 ? 'sawtooth' : 'triangle';
          o.frequency.value = fr;
          o.detune.value = det + (Math.random() - 0.5) * 4;
          const og = ctx.createGain(); og.gain.value = k === 0 ? 0.35 : 0.8;
          o.connect(og).connect(env);
          o.start(when); o.stop(when + dur + 9);
        });
      });
    }

    // a soft mallet on a wooden bar: partials at 1 : 4 : 10 (as on a tuned marimba bar),
    // the upper ones fading fast; a felt "thump" of filtered noise; a warm low-pass over it all
    bell(when, note){
      const ctx = this.ctx;
      const m = note !== undefined ? note : WOOD[Math.floor(Math.random() * WOOD.length)];
      const fr = mtof(m);
      const vel = 0.75 + Math.random() * 0.25;

      const out = ctx.createGain(); out.gain.value = 0.085 * vel;
      const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 1800 + 900 * vel; warm.Q.value = 0.4;
      out.connect(warm);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if(pan){ pan.pan.value = (Math.random() * 2 - 1) * 0.7; warm.connect(pan).connect(this.bus); }
      else warm.connect(this.bus);

      [[1.0, 1.0, 2.6], [3.98, 0.20 * vel, 0.45], [9.85, 0.05 * vel, 0.12]].forEach(([ratio, amp, decay], i) => {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(fr * ratio * (i === 0 ? 1.012 : 1), when);       // the bar settles into pitch
        o.frequency.exponentialRampToValueAtTime(fr * ratio, when + 0.06);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(amp, when + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
        o.connect(g).connect(out);
        o.start(when); o.stop(when + decay + 0.1);
      });

      // the mallet
      if(!this.noiseBuf){
        const len = Math.floor(ctx.sampleRate * 0.06);
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for(let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      const nz = ctx.createBufferSource(); nz.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(fr * 2.2, 2500); bp.Q.value = 1.2;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, when);
      ng.gain.linearRampToValueAtTime(0.10 * vel, when + 0.002);
      ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
      nz.connect(bp).connect(ng).connect(out);
      nz.start(when); nz.stop(when + 0.06);

      const delay = Math.max(0, (when - ctx.currentTime) * 1000);
      setTimeout(() => this.onBell && this.onBell(), delay);
    }

    tick(){
      const ctx = this.ctx; if(!ctx) return;
      const now = ctx.currentTime;
      if(now + 0.5 >= this.nextChordAt){
        const dur = 14 + Math.random() * 4;
        this.pad(CHORDS[this.chordIndex], this.nextChordAt, dur);
        // wander, but mostly forward
        this.chordIndex = (this.chordIndex + (Math.random() < 0.75 ? 1 : 2)) % CHORDS.length;
        this.nextChordAt += dur;
      }
      if(now + 0.5 >= this.nextBellAt){
        const r = Math.random();
        if(r < 0.2){
          // a small falling figure
          const i0 = 3 + Math.floor(Math.random() * (WOOD.length - 3));
          [0, 1, 2].forEach(k => this.bell(this.nextBellAt + k * 0.42, WOOD[Math.max(0, i0 - k * (1 + (Math.random() < 0.5 ? 1 : 0)))]));
        } else {
          this.bell(this.nextBellAt);
          if(r < 0.45) this.bell(this.nextBellAt + 0.5 + Math.random() * 1.0);
        }
        this.nextBellAt += 4 + Math.random() * 9;
      }
    }

    // called every frame with the shared breath value, 0..1
    breathe(b){
      if(!this.ctx) return;
      this.padFilter.frequency.setTargetAtTime(450 + 1100 * b * b, this.ctx.currentTime, 0.3);
    }

    setMuted(m){
      this.muted = m;
      if(!this.ctx) return;
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(m ? 0 : 1.0, now + 2);
    }

    resume(){ if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  }

  window.HereMusic = Music;
})();
