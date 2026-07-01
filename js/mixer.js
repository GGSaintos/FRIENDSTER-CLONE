/* ============================================================
   Friendster Clone — DJ Mixer
   Two decks, independent BPM (tempo) and key (pitch) via Tone.js
   GrainPlayer, a crossfader, auto BPM + key detection, and mix
   recording. The recorded mix is a webm audio blob (stored in the
   IndexedDB MusicStore); its metadata lives on the user record.

   Note: BPM/key detection are approximations done in the browser —
   good enough to beatmatch, not studio-accurate (key especially).
   ============================================================ */

const Mixer = (() => {
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  // Krumhansl–Schmuckler key profiles.
  const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  /* ---- tiny in-place radix-2 FFT (magnitudes only needed) -------- */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = i + k + len / 2;
          const vr = re[b] * cr - im[b] * ci;
          const vi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - vr; im[b] = im[a] - vi;
          re[a] += vr; im[a] += vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  /* ---- BPM via onset-envelope autocorrelation -------------------- */
  function detectBpm(buffer) {
    const sr = buffer.sampleRate;
    const data = buffer.getChannelData(0);
    const fps = 200;
    const step = Math.max(1, Math.floor(sr / fps));
    const env = [];
    for (let i = 0; i < data.length; i += step) {
      let sum = 0;
      for (let j = 0; j < step && i + j < data.length; j++) sum += data[i + j] * data[i + j];
      env.push(Math.sqrt(sum / step));
    }
    const onset = [];
    for (let i = 1; i < env.length; i++) onset.push(Math.max(0, env[i] - env[i - 1]));
    const minLag = Math.floor((fps * 60) / 200); // 200 bpm
    const maxLag = Math.floor((fps * 60) / 60); //  60 bpm
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

  /* ---- Key via averaged chroma + profile correlation ------------- */
  function detectKey(buffer) {
    const sr = buffer.sampleRate;
    const data = buffer.getChannelData(0);
    const N = 2048;
    const chroma = new Array(12).fill(0);
    const totalFrames = Math.floor(data.length / N);
    const maxFrames = 400;
    const hop = Math.max(1, Math.floor(totalFrames / maxFrames));
    for (let f = 0; f < totalFrames; f += hop) {
      const off = f * N;
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        // Hann window
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
        re[i] = (data[off + i] || 0) * w;
      }
      fft(re, im);
      for (let k = 1; k < N / 2; k++) {
        const freq = (k * sr) / N;
        if (freq < 55 || freq > 4000) continue;
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        const midi = 69 + 12 * Math.log2(freq / 440);
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        chroma[pc] += mag;
      }
    }
    // correlate against all 24 keys
    function corr(profile, rot) {
      const p = [], c = [];
      for (let i = 0; i < 12; i++) { p.push(profile[i]); c.push(chroma[(i + rot) % 12]); }
      const mp = p.reduce((a, b) => a + b) / 12;
      const mc = c.reduce((a, b) => a + b) / 12;
      let num = 0, dp = 0, dc = 0;
      for (let i = 0; i < 12; i++) {
        num += (p[i] - mp) * (c[i] - mc);
        dp += (p[i] - mp) ** 2;
        dc += (c[i] - mc) ** 2;
      }
      return num / (Math.sqrt(dp * dc) || 1);
    }
    let best = { score: -2, root: 0, mode: "major" };
    for (let root = 0; root < 12; root++) {
      const maj = corr(MAJOR, root);
      const min = corr(MINOR, root);
      if (maj > best.score) best = { score: maj, root, mode: "major" };
      if (min > best.score) best = { score: min, root, mode: "minor" };
    }
    return {
      root: best.root,
      mode: best.mode,
      name: `${NOTE_NAMES[best.root]} ${best.mode}`,
    };
  }

  /* ---- decode an object URL into a Tone buffer + AudioBuffer ----- */
  async function loadBuffer(url) {
    const tb = new Tone.ToneAudioBuffer();
    await tb.load(url);
    return tb; // tb.get() -> underlying AudioBuffer
  }

  /* ================================================================
     A single deck: GrainPlayer -> gain -> (crossfade) -> master
     ================================================================ */
  class Deck {
    constructor(side, ui) {
      this.side = side;
      this.ui = ui;
      this.player = null;
      this.buffer = null;
      this.gain = new Tone.Gain(1);
      this.baseBpm = 120;
      this.targetBpm = 120;
      this.key = { root: 0, mode: "major", name: "—" };
      this.keyShift = 0;
      this.song = null;
    }

    async load(song, url) {
      this.dispose();
      this.song = song;
      const tb = await loadBuffer(url);
      this.buffer = tb;
      const audioBuf = tb.get();
      this.baseBpm = detectBpm(audioBuf);
      this.targetBpm = this.baseBpm;
      this.key = detectKey(audioBuf);
      this.keyShift = 0;
      this.player = new Tone.GrainPlayer({
        url: tb,
        loop: true,
        grainSize: 0.2,
        overlap: 0.1,
        detune: 0,
        playbackRate: 1,
      });
      this.player.connect(this.gain);
      return { bpm: this.baseBpm, key: this.key };
    }

    setTargetBpm(bpm) {
      this.targetBpm = bpm;
      if (this.player) this.player.playbackRate = bpm / this.baseBpm;
    }
    setKeyShift(semitones) {
      this.keyShift = semitones;
      if (this.player) this.player.detune = semitones * 100;
    }
    play() { if (this.player && this.player.state !== "started") this.player.start(); }
    stop() { if (this.player && this.player.state === "started") this.player.stop(); }
    isPlaying() { return this.player && this.player.state === "started"; }

    dispose() {
      if (this.player) { try { this.player.stop(); } catch (e) {} this.player.dispose(); this.player = null; }
      if (this.buffer) { this.buffer.dispose(); this.buffer = null; }
    }
  }

  /* ================================================================
     The mounted mixer instance (owns the DOM + Tone graph)
     ================================================================ */
  class Instance {
    constructor(container, songs, opts) {
      this.container = container;
      this.songs = songs || [];
      this.opts = opts || {};
      this.master = new Tone.Gain(1).toDestination();
      this.recorder = new Tone.Recorder();
      this.master.connect(this.recorder);
      this.deckA = new Deck("A");
      this.deckB = new Deck("B");
      this.deckA.gain.connect(this.master);
      this.deckB.gain.connect(this.master);
      this.recording = false;
      this.recStart = 0;
      this.setCrossfade(0.5);
    }

    setCrossfade(x) {
      // equal-power crossfade
      this.deckA.gain.gain.value = Math.cos((x * Math.PI) / 2);
      this.deckB.gain.gain.value = Math.cos(((1 - x) * Math.PI) / 2);
    }

    songOptions(selectedId) {
      const opts = ['<option value="">— choose a track —</option>'];
      this.songs.forEach((s) => {
        const sel = s.id === selectedId ? " selected" : "";
        opts.push(`<option value="${esc(s.id)}"${sel}>${esc(s.title)}${s.artist ? " — " + esc(s.artist) : ""}</option>`);
      });
      return opts.join("");
    }

    deckHtml(side) {
      const s = side.toLowerCase();
      return `
        <div class="deck deck-${s}">
          <div class="deck-title">Deck ${side}</div>
          <div class="turntable" id="mx_tt_${s}"><div class="tt-record"><div class="tt-label"></div></div></div>
          <select id="mx_song_${s}" class="mx-select">${this.songOptions("")}</select>
          <button class="btn" id="mx_load_${s}">Load</button>
          <div class="mx-readout" id="mx_read_${s}">BPM: — · Key: —</div>
          <label class="mx-slider-label">Tempo <span id="mx_bpmval_${s}">—</span> BPM</label>
          <input type="range" id="mx_bpm_${s}" min="60" max="180" value="120" disabled>
          <label class="mx-slider-label">Key <span id="mx_keyval_${s}">0</span> st</label>
          <input type="range" id="mx_key_${s}" min="-6" max="6" value="0" step="1" disabled>
          <div class="btn-row">
            <button class="btn secondary" id="mx_play_${s}" disabled>Play</button>
            <button class="btn secondary" id="mx_stop_${s}" disabled>Stop</button>
          </div>
        </div>`;
    }

    build() {
      const noSongs = this.songs.length < 2;
      this.container.innerHTML = `
        <div class="mixer">
          ${noSongs ? `<p class="muted">Add at least two songs to your profile to start mixing.</p>` : ""}
          <div class="decks">
            ${this.deckHtml("A")}
            ${this.deckHtml("B")}
          </div>
          <div class="mixer-center">
            <button class="btn" id="mx_sync">⇄ Sync B to A</button>
            <label class="mx-slider-label">Crossfader</label>
            <input type="range" id="mx_xfade" min="0" max="100" value="50">
            <div class="mx-xlabels"><span>A</span><span>B</span></div>
            <div class="btn-row">
              <button class="btn" id="mx_rec">● Record Mix</button>
            </div>
            <div class="mx-rec-status" id="mx_recstatus"></div>
          </div>
        </div>`;
      this.wire();
    }

    wire() {
      const $ = (id) => this.container.querySelector("#" + id);
      ["a", "b"].forEach((s) => {
        const deck = s === "a" ? this.deckA : this.deckB;
        $("mx_load_" + s).addEventListener("click", () => this.loadDeck(s));
        $("mx_play_" + s).addEventListener("click", () => this.playDeck(s));
        $("mx_stop_" + s).addEventListener("click", () => this.stopDeck(s));
        $("mx_bpm_" + s).addEventListener("input", (e) => {
          const v = +e.target.value;
          $("mx_bpmval_" + s).textContent = v;
          deck.setTargetBpm(v);
        });
        $("mx_key_" + s).addEventListener("input", (e) => {
          const v = +e.target.value;
          $("mx_keyval_" + s).textContent = v;
          deck.setKeyShift(v);
        });
      });
      $("mx_xfade").addEventListener("input", (e) => this.setCrossfade(e.target.value / 100));
      $("mx_sync").addEventListener("click", () => this.sync());
      $("mx_rec").addEventListener("click", () => this.toggleRecord());
    }

    async loadDeck(s) {
      const $ = (id) => this.container.querySelector("#" + id);
      const sel = $("mx_song_" + s);
      const songId = sel.value;
      if (!songId) return;
      const song = this.songs.find((x) => x.id === songId);
      const url = await MusicStore.url(songId);
      if (!url) { alert("That track's audio isn't on this device."); return; }
      await Tone.start();
      $("mx_read_" + s).textContent = "analyzing…";
      const deck = s === "a" ? this.deckA : this.deckB;
      const { bpm, key } = await deck.load(song, url);
      $("mx_read_" + s).textContent = `BPM: ${bpm} · Key: ${key.name}`;
      const bpmSlider = $("mx_bpm_" + s);
      bpmSlider.disabled = false; bpmSlider.value = bpm;
      $("mx_bpmval_" + s).textContent = bpm;
      const keySlider = $("mx_key_" + s);
      keySlider.disabled = false; keySlider.value = 0;
      $("mx_keyval_" + s).textContent = 0;
      $("mx_play_" + s).disabled = false;
      $("mx_stop_" + s).disabled = false;
      const label = this.container.querySelector(`#mx_tt_${s} .tt-label`);
      if (label) label.textContent = song.title;
    }

    async playDeck(s) {
      await Tone.start();
      const deck = s === "a" ? this.deckA : this.deckB;
      deck.play();
      const tt = this.container.querySelector("#mx_tt_" + s);
      if (tt) tt.classList.add("spinning");
    }
    stopDeck(s) {
      const deck = s === "a" ? this.deckA : this.deckB;
      deck.stop();
      const tt = this.container.querySelector("#mx_tt_" + s);
      if (tt) tt.classList.remove("spinning");
    }

    sync() {
      const $ = (id) => this.container.querySelector("#" + id);
      if (!this.deckA.player || !this.deckB.player) return;
      // match B's tempo to A's current target BPM
      const targetBpm = this.deckA.targetBpm;
      this.deckB.setTargetBpm(targetBpm);
      $("mx_bpm_b").value = Math.round(targetBpm);
      $("mx_bpmval_b").textContent = Math.round(targetBpm);
      // shift B's key toward A's (nearest within ±6 semitones)
      let diff = this.deckA.key.root - this.deckB.key.root;
      while (diff > 6) diff -= 12;
      while (diff < -6) diff += 12;
      this.deckB.setKeyShift(diff);
      $("mx_key_b").value = diff;
      $("mx_keyval_b").textContent = diff;
    }

    async toggleRecord() {
      const $ = (id) => this.container.querySelector("#" + id);
      const btn = $("mx_rec");
      if (!this.recording) {
        await Tone.start();
        this.recorder.start();
        this.recording = true;
        this.recStart = Date.now();
        btn.textContent = "■ Stop & Save";
        btn.classList.add("recording");
        $("mx_recstatus").textContent = "Recording…";
      } else {
        const blob = await this.recorder.stop();
        this.recording = false;
        btn.textContent = "● Record Mix";
        btn.classList.remove("recording");
        const duration = Math.round((Date.now() - this.recStart) / 1000);
        $("mx_recstatus").textContent = "Saving mix…";
        const mixId = "mix_" + Date.now();
        await MusicStore.put(mixId, blob);
        const mix = {
          id: mixId,
          date: new Date().toISOString(),
          duration,
          deckA: this.deckSnapshot(this.deckA),
          deckB: this.deckSnapshot(this.deckB),
        };
        if (this.opts.onSave) this.opts.onSave(mix);
      }
    }

    deckSnapshot(deck) {
      return deck.song
        ? {
            songId: deck.song.id,
            title: deck.song.title,
            artist: deck.song.artist || "",
            baseBpm: deck.baseBpm,
            playBpm: Math.round(deck.targetBpm),
            key: deck.key.name,
            keyShift: deck.keyShift,
          }
        : null;
    }

    dispose() {
      try {
        this.deckA.dispose();
        this.deckB.dispose();
        if (this.recording) this.recorder.stop();
        this.recorder.dispose();
        this.master.dispose();
      } catch (e) {
        /* ignore teardown errors */
      }
    }
  }

  let current = null;
  return {
    available() { return typeof Tone !== "undefined"; },
    async mount(container, songs, opts) {
      if (!this.available()) {
        container.innerHTML = `<p class="muted">The mixer needs Tone.js, which failed to load (check your connection).</p>`;
        return;
      }
      if (current) current.dispose();
      current = new Instance(container, songs, opts);
      current.build();
    },
    unmount() {
      if (current) { current.dispose(); current = null; }
    },
  };
})();
