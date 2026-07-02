/* ============================================================
   Friendster Clone — DJ Mixer
   Upload two audio files, each shown as a SoundCloud-style
   waveform player (click to seek, moving playhead). BPM is
   auto-detected and adjustable per deck (tempo without pitch,
   via Tone.js GrainPlayer). A crossfader mixes the two, and the
   result can be recorded to a mix (webm) with a timestamp.

   The UI is built without the audio engine; Tone.js nodes are
   created lazily on the first user interaction, so the interface
   always renders even before audio is allowed to start.

   Note: BPM detection is an in-browser approximation — close
   enough to beatmatch, and the tempo slider lets you fine-tune.
   ============================================================ */

const Mixer = (() => {
  /* ---- tiny radix-2 FFT (used for optional key detection) -------- */
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = i + k + len / 2;
          const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  function detectBpm(buffer) {
    const sr = buffer.sampleRate, data = buffer.getChannelData(0), fps = 200;
    const step = Math.max(1, Math.floor(sr / fps));
    const env = [];
    for (let i = 0; i < data.length; i += step) {
      let sum = 0;
      for (let j = 0; j < step && i + j < data.length; j++) sum += data[i + j] * data[i + j];
      env.push(Math.sqrt(sum / step));
    }
    const onset = [];
    for (let i = 1; i < env.length; i++) onset.push(Math.max(0, env[i] - env[i - 1]));
    const minLag = Math.floor((fps * 60) / 200), maxLag = Math.floor((fps * 60) / 60);
    let best = -1, bestLag = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < onset.length; i++) sum += onset[i] * onset[i + lag];
      if (sum > best) { best = sum; bestLag = lag; }
    }
    let bpm = (60 * fps) / bestLag;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return Math.round(bpm);
  }

  function detectKey(buffer) {
    const sr = buffer.sampleRate, data = buffer.getChannelData(0), N = 2048;
    const chroma = new Array(12).fill(0);
    const totalFrames = Math.floor(data.length / N);
    const hop = Math.max(1, Math.floor(totalFrames / 400));
    for (let f = 0; f < totalFrames; f += hop) {
      const off = f * N, re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
        re[i] = (data[off + i] || 0) * w;
      }
      fft(re, im);
      for (let k = 1; k < N / 2; k++) {
        const freq = (k * sr) / N;
        if (freq < 55 || freq > 4000) continue;
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        const pc = ((Math.round(69 + 12 * Math.log2(freq / 440)) % 12) + 12) % 12;
        chroma[pc] += mag;
      }
    }
    function corr(profile, rot) {
      const p = [], c = [];
      for (let i = 0; i < 12; i++) { p.push(profile[i]); c.push(chroma[(i + rot) % 12]); }
      const mp = p.reduce((a, b) => a + b) / 12, mc = c.reduce((a, b) => a + b) / 12;
      let num = 0, dp = 0, dc = 0;
      for (let i = 0; i < 12; i++) { num += (p[i] - mp) * (c[i] - mc); dp += (p[i] - mp) ** 2; dc += (c[i] - mc) ** 2; }
      return num / (Math.sqrt(dp * dc) || 1);
    }
    let best = { score: -2, root: 0, mode: "major" };
    for (let root = 0; root < 12; root++) {
      const maj = corr(MAJOR, root), min = corr(MINOR, root);
      if (maj > best.score) best = { score: maj, root, mode: "major" };
      if (min > best.score) best = { score: min, root, mode: "minor" };
    }
    return { root: best.root, mode: best.mode, name: `${NOTE_NAMES[best.root]} ${best.mode}` };
  }

  /* ---- waveform ---------------------------------------------------- */
  function computePeaks(buffer, buckets) {
    const data = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / buckets));
    const peaks = [];
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      for (let j = 0; j < block; j++) {
        const v = Math.abs(data[i * block + j] || 0);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    return peaks;
  }
  function drawWaveform(canvas, peaks, progress) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!peaks) return;
    const barW = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const bh = Math.max(1, peaks[i] * h * 0.92);
      ctx.fillStyle = i / peaks.length <= progress ? "#ff5500" : "#c3c9d4";
      ctx.fillRect(i * barW, (h - bh) / 2, Math.max(1, barW - 1), bh);
    }
  }
  // higher-resolution peaks (buckets per second) for the zoomed view
  function computePeaksHiRes(buffer, perSec) {
    const data = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(buffer.sampleRate / perSec));
    const peaks = [];
    for (let i = 0; i < data.length; i += block) {
      let max = 0;
      for (let j = 0; j < block && i + j < data.length; j++) {
        const v = Math.abs(data[i + j]);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    return peaks;
  }
  // estimate the phase of the first beat so the grid lines up
  function detectBeatOffset(buffer, bpm) {
    const sr = buffer.sampleRate, data = buffer.getChannelData(0), fps = 200;
    const step = Math.max(1, Math.floor(sr / fps));
    const limit = Math.min(data.length, sr * 6);
    const env = [];
    for (let i = 0; i < limit; i += step) {
      let s = 0;
      for (let j = 0; j < step && i + j < limit; j++) s += data[i + j] * data[i + j];
      env.push(Math.sqrt(s / step));
    }
    let best = 0, bestI = 0;
    for (let i = 1; i < env.length; i++) {
      const on = env[i] - env[i - 1];
      if (on > best) { best = on; bestI = i; }
    }
    const beatInt = 60 / bpm;
    return (bestI / fps) % beatInt;
  }
  function fmtTime(s) {
    if (!isFinite(s)) s = 0;
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }
  function audioContext() {
    if (typeof Tone !== "undefined") return Tone.getContext().rawContext;
    return new (window.AudioContext || window.webkitAudioContext)();
  }

  /* ================================================================
     Deck — one uploaded track + waveform player + tempo/key control
     ================================================================ */
  class Deck {
    constructor(inst, side) {
      this.inst = inst;
      this.side = side; // "a" | "b"
      this.audioBuffer = null;
      this.toneBuffer = null;
      this.player = null;
      this.gain = null; // created lazily by the instance
      this.peaks = null;
      this.duration = 0;
      this.baseBpm = 120;
      this.targetBpm = 120;
      this.key = { root: 0, mode: "major", name: "—" };
      this.keyShift = 0;
      this.title = "";
      this.coverUrl = null; // video thumbnail, when imported from a link
      this.playing = false;
      this.seekOffset = 0;
      this.startCtx = 0;
      this.raf = null;
      this.peaksHi = null;
      this.hiRate = 100; // buckets per second in the zoom view
      this.beatOffset = 0; // seconds — phase of the first beat
      this.zoomWindow = 6; // seconds visible in the zoomed view
      // audio nodes (created lazily by the instance):
      this.vol = null;    // user volume fader
      this.gain = null;   // crossfader gain
      this.fxGain = null; // echo/reverb wet send (0 = off)
      this.delay = null;
      this.reverb = null;
      this._fxTimer = null;
    }

    q(sel) { return this.inst.q(sel); }
    canvas() { return this.q("#mx_wave_" + this.side); }
    zoomCanvas() { return this.q("#mx_zoom_" + this.side); }
    rate() { return this.targetBpm / this.baseBpm; }

    async loadFile(file) {
      this.coverUrl = null;
      const arr = await file.arrayBuffer();
      return this._load(arr, file.name.replace(/\.[^.]+$/, ""));
    }

    async loadUrl(url) {
      const isVideo = /(?:youtube\.com|youtu\.be|soundcloud\.com|vimeo\.com)/i.test(url);
      const endpoint = isVideo ? "/api/youtube-audio?url=" : "/api/fetch-audio?url=";
      const res = await fetch(endpoint + encodeURIComponent(url));
      if (!res.ok) {
        let msg = "Import failed.";
        try { msg = (await res.json()).error || msg; } catch (e) {}
        throw new Error(msg);
      }
      const arr = await res.arrayBuffer();
      let title = isVideo ? "video import" : "imported track";
      this.coverUrl = null;
      if (isVideo) {
        const t = res.headers.get("X-Video-Title");
        if (t) title = decodeURIComponent(t) || title;
        const thumb = res.headers.get("X-Video-Thumbnail");
        if (thumb) this.coverUrl = decodeURIComponent(thumb) || null;
      } else {
        try {
          title = decodeURIComponent(url.split("?")[0].split("/").pop()).replace(/\.[^.]+$/, "") || title;
        } catch (e) {}
      }
      return this._load(arr, title);
    }

    async _load(arr, title) {
      const buf = await audioContext().decodeAudioData(arr.slice(0));
      this.audioBuffer = buf;
      this.duration = buf.duration;
      this.title = title;
      this.baseBpm = detectBpm(buf);
      this.targetBpm = this.baseBpm;
      this.key = detectKey(buf);
      this.keyShift = 0;
      this.seekOffset = 0;
      this.peaks = computePeaks(buf, 500);
      this.peaksHi = computePeaksHiRes(buf, this.hiRate);
      this.beatOffset = detectBeatOffset(buf, this.baseBpm);
      this.render(0);
      // audio nodes for playback (lazy — needs Tone)
      this.inst.ensureAudio();
      if (typeof Tone !== "undefined") {
        this.toneBuffer = new Tone.ToneAudioBuffer(buf);
        this._makePlayer();
      }
      return { bpm: this.baseBpm, key: this.key, duration: this.duration };
    }

    _makePlayer() {
      if (this.player) { try { this.player.stop(); } catch (e) {} this.player.dispose(); }
      this.player = new Tone.GrainPlayer({
        url: this.toneBuffer, loop: false, grainSize: 0.2, overlap: 0.1, detune: this.keyShift * 100,
      });
      this.player.playbackRate = this.rate();
      this.player.connect(this.vol); // player -> volume -> crossfader -> master
    }

    setVolume(v) { if (this.vol) this.vol.gain.value = v; }

    /* 1/8-second delay + reverb "combo" at 20% wet, held for 3 seconds. */
    async triggerFx() {
      try { await Tone.start(); } catch (e) {}
      this.inst.ensureAudio();
      if (!this.fxGain) return;
      const g = this.fxGain.gain;
      const now = Tone.now();
      g.cancelScheduledValues(now);
      g.setValueAtTime(0.2, now);          // 20% wet on
      g.setValueAtTime(0.2, now + 3);      // hold 3 s
      g.linearRampToValueAtTime(0, now + 3.25); // quick release
      const b = this.q("#mx_fx_" + this.side);
      if (b) {
        b.classList.add("active");
        clearTimeout(this._fxTimer);
        this._fxTimer = setTimeout(() => b.classList.remove("active"), 3000);
      }
    }

    currentPos() {
      if (!this.playing) return this.seekOffset;
      let pos = this.seekOffset + (Tone.now() - this.startCtx) * this.rate();
      return Math.min(pos, this.duration);
    }

    setTargetBpm(bpm) {
      const pos = this.currentPos();
      this.targetBpm = bpm;
      if (this.player) this.player.playbackRate = this.rate();
      if (this.playing) { this.seekOffset = pos; this.startCtx = Tone.now(); } // re-baseline, no restart
    }
    setKeyShift(semi) {
      this.keyShift = semi;
      if (this.player) this.player.detune = semi * 100;
    }

    async play() {
      if (!this.player) return;
      await Tone.start();
      if (this.seekOffset >= this.duration) this.seekOffset = 0;
      this.startCtx = Tone.now();
      this.player.start(undefined, this.seekOffset);
      this.playing = true;
      this._animate();
      this.setBtn(true);
      this.spin(true);
    }
    pause() {
      if (!this.playing) return;
      this.seekOffset = this.currentPos();
      try { this.player.stop(); } catch (e) {}
      this.playing = false;
      cancelAnimationFrame(this.raf);
      this.setBtn(false);
      this.spin(false);
      this.render(this.seekOffset);
    }
    toggle() { this.playing ? this.pause() : this.play(); }

    /* Move the playhead to an absolute time without touching the audio
       (used while dragging the zoomed waveform). */
    setSeek(pos) {
      if (!this.audioBuffer) return;
      this.seekOffset = Math.max(0, Math.min(this.duration, pos));
      this.render(this.seekOffset);
      this.inst.updateTime(this.side, this.seekOffset, this.duration);
    }

    /* Relative seek by dt seconds (jog wheel). */
    scrub(dt) {
      if (!this.audioBuffer) return;
      const pos = (this.playing ? this.currentPos() : this.seekOffset) + dt;
      const clamped = Math.max(0, Math.min(this.duration, pos));
      if (this.playing) {
        try { this.player.stop(); } catch (e) {}
        this.seekOffset = clamped;
        this.startCtx = Tone.now();
        this.player.start(undefined, clamped);
        this.render(clamped);
        this.inst.updateTime(this.side, clamped, this.duration);
      } else {
        this.setSeek(clamped);
      }
    }

    beatInterval() { return 60 / this.baseBpm; }
    /* Shift the beat grid. A fine delta moves every line; a whole-beat
       delta re-aligns which line is the downbeat. */
    nudgeGrid(delta) {
      if (!this.audioBuffer) return;
      this.beatOffset += delta;
      this.render(this.currentPos());
    }

    seekFraction(fr) {
      if (!this.audioBuffer) return;
      const off = Math.max(0, Math.min(this.duration, fr * this.duration));
      if (this.playing) {
        try { this.player.stop(); } catch (e) {}
        this.seekOffset = off;
        this.startCtx = Tone.now();
        this.player.start(undefined, off);
      } else {
        this.seekOffset = off;
      }
      this.render(off);
      this.inst.updateTime(this.side, off, this.duration);
    }

    _animate() {
      const tick = () => {
        const pos = this.currentPos();
        this.render(pos);
        this.inst.updateTime(this.side, pos, this.duration);
        if (pos >= this.duration) { this.pause(); this.seekOffset = 0; this.render(0); return; }
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    render(pos) {
      drawWaveform(this.canvas(), this.peaks, this.duration ? pos / this.duration : 0);
      this.drawZoom(pos);
    }

    /* Zoomed, scrolling waveform centered on the playhead, with a beat
       grid (downbeats brighter) and a fixed center playhead line. */
    drawZoom(pos) {
      const cv = this.zoomCanvas();
      if (!cv) return;
      const ctx = cv.getContext("2d");
      const w = cv.width, h = cv.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#eef1f7";
      ctx.fillRect(0, 0, w, h);
      if (!this.peaksHi || !this.duration) return;
      const win = this.zoomWindow, startT = pos - win / 2;
      // waveform
      ctx.fillStyle = "#8a94ab";
      for (let x = 0; x < w; x++) {
        const t = startT + (x / w) * win;
        if (t < 0 || t > this.duration) continue;
        const peak = this.peaksHi[Math.floor(t * this.hiRate)] || 0;
        const bh = Math.max(1, peak * h * 0.9);
        ctx.fillRect(x, (h - bh) / 2, 1, bh);
      }
      // beat grid
      const beatInt = 60 / this.baseBpm;
      if (beatInt > 0) {
        let n = Math.floor((startT - this.beatOffset) / beatInt);
        for (; ; n++) {
          const beatT = this.beatOffset + n * beatInt;
          if (beatT > startT + win) break;
          if (beatT < startT || beatT < 0) continue;
          const x = ((beatT - startT) / win) * w;
          const downbeat = (((n % 4) + 4) % 4) === 0;
          ctx.strokeStyle = downbeat ? "#ff5500" : "rgba(90,100,120,0.45)";
          ctx.lineWidth = downbeat ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
          if (downbeat) {
            ctx.fillStyle = "#ff5500";
            ctx.fillRect(x - 1, 0, 3, 4);
          }
        }
      }
      // center playhead
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
    }
    setBtn(playing) {
      const b = this.q("#mx_play_" + this.side);
      if (b) b.textContent = playing ? "⏸ Pause" : "▶ Play";
    }
    spin(on) {
      const tt = this.q("#mx_tt_" + this.side);
      if (tt) tt.classList.toggle("spinning", on);
    }

    dispose() {
      cancelAnimationFrame(this.raf);
      clearTimeout(this._fxTimer);
      if (this.player) { try { this.player.stop(); } catch (e) {} this.player.dispose(); this.player = null; }
      if (this.toneBuffer) { this.toneBuffer.dispose(); this.toneBuffer = null; }
      ["vol", "gain", "fxGain", "delay", "reverb"].forEach((k) => {
        if (this[k]) { try { this[k].dispose(); } catch (e) {} this[k] = null; }
      });
    }
  }

  /* ================================================================
     Instance — the whole mixer widget
     ================================================================ */
  class Instance {
    constructor(container, opts) {
      this.container = container;
      this.opts = opts || {};
      this.audioReady = false;
      this.deckA = new Deck(this, "a");
      this.deckB = new Deck(this, "b");
      this.recording = false;
      this.recStart = 0;
      this._winListeners = []; // window listeners to remove on dispose
    }

    q(sel) { return this.container.querySelector(sel); }

    ensureAudio() {
      if (this.audioReady || typeof Tone === "undefined") return;
      this.master = new Tone.Gain(1).toDestination();
      this.recorder = new Tone.Recorder();
      this.master.connect(this.recorder);
      [this.deckA, this.deckB].forEach((d) => {
        d.vol = new Tone.Gain(1); // volume fader
        d.gain = new Tone.Gain(1); // crossfader
        d.fxGain = new Tone.Gain(0); // echo/reverb wet send (off)
        d.delay = new Tone.FeedbackDelay({ delayTime: 0.125, feedback: 0.35, wet: 1 });
        d.reverb = new Tone.Reverb({ decay: 1.8, wet: 1 });
        d.vol.connect(d.gain);
        d.gain.connect(this.master); // dry path
        d.gain.connect(d.fxGain); // wet path: crossfader -> send -> delay -> reverb -> master
        d.fxGain.connect(d.delay);
        d.delay.connect(d.reverb);
        d.reverb.connect(this.master);
      });
      const x = (this.q("#mx_xfade") ? +this.q("#mx_xfade").value : 50) / 100;
      this.setCrossfade(x);
      this.audioReady = true;
    }

    setCrossfade(x) {
      if (this.deckA.gain) this.deckA.gain.gain.value = Math.cos((x * Math.PI) / 2);
      if (this.deckB.gain) this.deckB.gain.gain.value = Math.cos(((1 - x) * Math.PI) / 2);
    }

    deckHtml(side) {
      const S = side.toUpperCase();
      return `
        <div class="deck">
          <div class="deck-head">
            <span class="turntable" id="mx_tt_${side}"><span class="tt-record"><span class="tt-label"></span></span></span>
            <img class="mx-cover" id="mx_cover_${side}" alt="cover art" style="display:none">
            <span class="deck-title" id="mx_name_${side}">Deck ${S}</span>
          </div>
          <input type="file" accept="audio/*" id="mx_file_${side}" class="mx-file">
          <div class="mx-url-row">
            <input type="text" id="mx_url_${side}" class="mx-url" placeholder="…or paste an audio URL or YouTube link">
            <button class="btn secondary" id="mx_urlbtn_${side}">Load URL</button>
          </div>
          <canvas class="mx-wave" id="mx_wave_${side}" width="600" height="70"></canvas>
          <canvas class="mx-zoom" id="mx_zoom_${side}" width="600" height="80" title="Drag to scrub"></canvas>
          <div class="mx-grid-ctrl">
            <span>Grid:</span>
            <button class="btn secondary" id="mx_grid_bl_${side}" title="Downbeat back one beat">&laquo;</button>
            <button class="btn secondary" id="mx_grid_fl_${side}" title="Nudge grid left">&lsaquo;</button>
            <button class="btn secondary" id="mx_grid_fr_${side}" title="Nudge grid right">&rsaquo;</button>
            <button class="btn secondary" id="mx_grid_br_${side}" title="Downbeat forward one beat">&raquo;</button>
          </div>
          <div class="mx-hint muted">Overview: click to seek &middot; Beatgrid: drag to scrub &middot; Grid: align the downbeat (orange)</div>
          <div class="mx-time"><span id="mx_read_${side}">No track loaded</span><span id="mx_pos_${side}">0:00 / 0:00</span></div>
          <div class="btn-row">
            <button class="btn" id="mx_play_${side}" disabled>▶ Play</button>
          </div>
          <label class="mx-slider-label">Tempo <b id="mx_bpmval_${side}">—</b> BPM</label>
          <input type="range" id="mx_bpm_${side}" min="60" max="180" value="120" disabled>
          <label class="mx-slider-label">Key <b id="mx_keyval_${side}">0</b> st</label>
          <input type="range" id="mx_key_${side}" min="-6" max="6" value="0" step="1" disabled>
          <div class="mx-vol">
            <label class="mx-slider-label">Volume</label>
            <input type="range" class="mx-vol-fader" id="mx_vol_${side}" min="0" max="100" value="100" orient="vertical">
            <button class="btn mx-fx" id="mx_fx_${side}" title="1/8s echo + reverb at 20%, on for 3s">Echo/Verb</button>
          </div>
        </div>`;
    }

    build() {
      this.container.innerHTML = `
        <div class="mixer">
          <p class="muted">Upload two tracks, then beat-match with the tempo sliders and blend with the crossfader. Hit record to save the mix.</p>
          <div class="decks">${this.deckHtml("a")}${this.deckHtml("b")}</div>
          <div class="mixer-center">
            <button class="btn" id="mx_sync">⇄ Match Deck B to A</button>
            <label class="mx-slider-label">Crossfader</label>
            <input type="range" id="mx_xfade" class="mx-xfade" min="0" max="100" value="50">
            <div class="mx-xlabels"><span>A</span><span>B</span></div>
            <div class="btn-row"><button class="btn" id="mx_rec" disabled>● Record Mix</button></div>
            <div class="mx-rec-status" id="mx_recstatus"></div>
          </div>
        </div>`;
      this.wire();
      drawWaveform(this.q("#mx_wave_a"), null, 0);
      drawWaveform(this.q("#mx_wave_b"), null, 0);
      this.deckA.drawZoom(0);
      this.deckB.drawZoom(0);
    }

    wire() {
      ["a", "b"].forEach((s) => {
        const deck = s === "a" ? this.deckA : this.deckB;
        this.q("#mx_file_" + s).addEventListener("change", (e) => this.importFile(s, e.target.files[0]));
        this.q("#mx_urlbtn_" + s).addEventListener("click", () => this.importUrl(s, this.q("#mx_url_" + s).value.trim()));
        this.q("#mx_play_" + s).addEventListener("click", () => deck.toggle());
        this.q("#mx_bpm_" + s).addEventListener("input", (e) => {
          this.q("#mx_bpmval_" + s).textContent = e.target.value;
          deck.setTargetBpm(+e.target.value);
        });
        this.q("#mx_key_" + s).addEventListener("input", (e) => {
          this.q("#mx_keyval_" + s).textContent = e.target.value;
          deck.setKeyShift(+e.target.value);
        });
        this.q("#mx_vol_" + s).addEventListener("input", (e) => deck.setVolume(e.target.value / 100));
        this.q("#mx_fx_" + s).addEventListener("click", () => deck.triggerFx());
        const cv = this.q("#mx_wave_" + s);
        cv.addEventListener("click", (e) => {
          const r = cv.getBoundingClientRect();
          deck.seekFraction((e.clientX - r.left) / r.width);
        });
        // beat-grid nudge controls
        this.q("#mx_grid_bl_" + s).addEventListener("click", () => deck.nudgeGrid(-deck.beatInterval()));
        this.q("#mx_grid_fl_" + s).addEventListener("click", () => deck.nudgeGrid(-0.01));
        this.q("#mx_grid_fr_" + s).addEventListener("click", () => deck.nudgeGrid(0.01));
        this.q("#mx_grid_br_" + s).addEventListener("click", () => deck.nudgeGrid(deck.beatInterval()));
        // drag the zoomed beatgrid to scrub (pause while dragging, resume on release)
        const zoom = this.q("#mx_zoom_" + s);
        let dragging = false, wasPlaying = false, startX = 0, startPos = 0;
        const down = (e) => {
          if (!deck.audioBuffer) return;
          dragging = true;
          wasPlaying = deck.playing;
          if (deck.playing) deck.pause();
          startX = e.clientX;
          startPos = deck.seekOffset;
          zoom.classList.add("grabbing");
          e.preventDefault();
        };
        const move = (e) => {
          if (!dragging) return;
          const rect = zoom.getBoundingClientRect();
          const dt = -((e.clientX - startX) / rect.width) * deck.zoomWindow;
          deck.setSeek(startPos + dt);
        };
        const up = () => {
          if (!dragging) return;
          dragging = false;
          zoom.classList.remove("grabbing");
          if (wasPlaying) deck.play();
        };
        zoom.addEventListener("pointerdown", down);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        this._winListeners.push(["pointermove", move], ["pointerup", up]);
      });
      this.q("#mx_xfade").addEventListener("input", (e) => this.setCrossfade(e.target.value / 100));
      this.q("#mx_sync").addEventListener("click", () => this.sync());
      this.q("#mx_rec").addEventListener("click", () => this.toggleRecord());
    }

    importFile(s, file) {
      if (!file) return;
      return this._import(s, (deck) => deck.loadFile(file));
    }
    importUrl(s, url) {
      if (!url) return;
      const isVideo = /(?:youtube\.com|youtu\.be|soundcloud\.com|vimeo\.com)/i.test(url);
      const statusLabel = isVideo ? "importing from YouTube… (can take a bit)" : "loading…";
      return this._import(s, (deck) => deck.loadUrl(url), statusLabel);
    }

    async _import(s, loader, statusLabel) {
      const deck = s === "a" ? this.deckA : this.deckB;
      this.q("#mx_read_" + s).textContent = statusLabel || "loading…";
      try {
        await Tone.start();
      } catch (e) {}
      let res;
      try {
        res = await loader(deck);
      } catch (e) {
        this.q("#mx_read_" + s).textContent = e.message || "Couldn't load that audio.";
        return;
      }
      this.q("#mx_read_" + s).textContent = `${res.bpm} BPM · ${res.key.name}`;
      const name = this.q("#mx_name_" + s);
      if (name) name.textContent = deck.title;
      const label = this.q(`#mx_tt_${s} .tt-label`);
      if (label) label.textContent = deck.title.slice(0, 12);
      const cover = this.q("#mx_cover_" + s);
      if (cover) {
        if (deck.coverUrl) {
          cover.src = deck.coverUrl;
          cover.style.display = "";
          cover.onerror = () => { cover.style.display = "none"; };
        } else {
          cover.removeAttribute("src");
          cover.style.display = "none";
        }
      }
      const bpm = this.q("#mx_bpm_" + s);
      bpm.disabled = false; bpm.value = res.bpm;
      this.q("#mx_bpmval_" + s).textContent = res.bpm;
      const key = this.q("#mx_key_" + s);
      key.disabled = false; key.value = 0;
      this.q("#mx_keyval_" + s).textContent = 0;
      this.q("#mx_play_" + s).disabled = false;
      this.updateTime(s, 0, deck.duration);
      // enable recording once at least one deck is loaded
      if (this.deckA.audioBuffer || this.deckB.audioBuffer) this.q("#mx_rec").disabled = false;
    }

    updateTime(s, pos, dur) {
      const el = this.q("#mx_pos_" + s);
      if (el) el.textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`;
    }

    sync() {
      if (!this.deckA.audioBuffer || !this.deckB.audioBuffer) return;
      const targetBpm = Math.round(this.deckA.targetBpm);
      this.deckB.setTargetBpm(targetBpm);
      this.q("#mx_bpm_b").value = targetBpm;
      this.q("#mx_bpmval_b").textContent = targetBpm;
      let diff = this.deckA.key.root - this.deckB.key.root;
      while (diff > 6) diff -= 12;
      while (diff < -6) diff += 12;
      this.deckB.setKeyShift(diff);
      this.q("#mx_key_b").value = diff;
      this.q("#mx_keyval_b").textContent = diff;
    }

    async toggleRecord() {
      const btn = this.q("#mx_rec");
      const status = this.q("#mx_recstatus");
      if (typeof Tone === "undefined") return;
      if (!this.recording) {
        await Tone.start();
        this.ensureAudio();
        this.recorder.start();
        this.recording = true;
        this.recStart = Date.now();
        btn.textContent = "■ Stop & Save";
        btn.classList.add("recording");
        status.textContent = "Recording…";
      } else {
        const blob = await this.recorder.stop();
        this.recording = false;
        btn.textContent = "● Record Mix";
        btn.classList.remove("recording");
        status.textContent = "Saving mix…";
        const mixId = "mix_" + Date.now();
        await MusicStore.put(mixId, blob);
        const mix = {
          id: mixId,
          date: new Date().toISOString(),
          duration: Math.round((Date.now() - this.recStart) / 1000),
          deckA: this.snapshot(this.deckA),
          deckB: this.snapshot(this.deckB),
        };
        status.textContent = "";
        if (this.opts.onSave) this.opts.onSave(mix);
      }
    }

    snapshot(deck) {
      return deck.audioBuffer
        ? {
            title: deck.title,
            baseBpm: deck.baseBpm,
            playBpm: Math.round(deck.targetBpm),
            key: deck.key.name,
            keyShift: deck.keyShift,
          }
        : null;
    }

    dispose() {
      try {
        this._winListeners.forEach(([ev, fn]) => window.removeEventListener(ev, fn));
        this._winListeners = [];
        this.deckA.dispose();
        this.deckB.dispose();
        if (this.recording && this.recorder) this.recorder.stop();
        if (this.recorder) this.recorder.dispose();
        if (this.master) this.master.dispose();
      } catch (e) {}
    }
  }

  let current = null;

  // Functions a MIDI controller (e.g. DDJ-FLX4) can drive. kind:
  //   button = trigger on press, range = 0..1 fader/knob, jog = relative.
  const MIDI_TARGETS = [
    { id: "playA", label: "Deck A · Play/Pause", kind: "button" },
    { id: "playB", label: "Deck B · Play/Pause", kind: "button" },
    { id: "volA", label: "Deck A · Volume", kind: "range" },
    { id: "volB", label: "Deck B · Volume", kind: "range" },
    { id: "cross", label: "Crossfader", kind: "range" },
    { id: "tempoA", label: "Deck A · Tempo", kind: "range" },
    { id: "tempoB", label: "Deck B · Tempo", kind: "range" },
    { id: "keyA", label: "Deck A · Key", kind: "range" },
    { id: "keyB", label: "Deck B · Key", kind: "range" },
    { id: "fxA", label: "Deck A · Echo/Verb", kind: "button" },
    { id: "fxB", label: "Deck B · Echo/Verb", kind: "button" },
    { id: "jogA", label: "Deck A · Jog/Seek", kind: "jog" },
    { id: "jogB", label: "Deck B · Jog/Seek", kind: "jog" },
  ];

  // Apply a control action to the live mixer. v = 0..1 (range),
  // delta = seconds (jog). Also reflects the change in the on-screen control.
  function applyControl(id, v, delta) {
    const inst = current;
    if (!inst) return;
    const q = (sel) => inst.q(sel);
    const A = inst.deckA, B = inst.deckB;
    const setRange = (sel, val) => { const el = q(sel); if (el) el.value = val; };
    const setText = (sel, val) => { const el = q(sel); if (el) el.textContent = val; };
    switch (id) {
      case "playA": A.toggle(); break;
      case "playB": B.toggle(); break;
      case "volA": A.setVolume(v); setRange("#mx_vol_a", v * 100); break;
      case "volB": B.setVolume(v); setRange("#mx_vol_b", v * 100); break;
      case "cross": inst.setCrossfade(v); setRange("#mx_xfade", v * 100); break;
      case "tempoA": { const bpm = Math.round(60 + v * 120); A.setTargetBpm(bpm); setRange("#mx_bpm_a", bpm); setText("#mx_bpmval_a", bpm); break; }
      case "tempoB": { const bpm = Math.round(60 + v * 120); B.setTargetBpm(bpm); setRange("#mx_bpm_b", bpm); setText("#mx_bpmval_b", bpm); break; }
      case "keyA": { const s = Math.round(-6 + v * 12); A.setKeyShift(s); setRange("#mx_key_a", s); setText("#mx_keyval_a", s); break; }
      case "keyB": { const s = Math.round(-6 + v * 12); B.setKeyShift(s); setRange("#mx_key_b", s); setText("#mx_keyval_b", s); break; }
      case "fxA": A.triggerFx(); break;
      case "fxB": B.triggerFx(); break;
      case "jogA": A.scrub(delta); break;
      case "jogB": B.scrub(delta); break;
    }
  }

  return {
    available() { return typeof Tone !== "undefined"; },
    MIDI_TARGETS,
    apply: applyControl,
    mount(container, opts) {
      if (current) current.dispose();
      current = new Instance(container, opts);
      current.build();
      if (!this.available()) {
        const s = container.querySelector("#mx_recstatus");
        if (s) s.textContent = "Playback needs Tone.js (failed to load); waveforms + BPM still work.";
      }
    },
    unmount() { if (current) { current.dispose(); current = null; } },
  };
})();
