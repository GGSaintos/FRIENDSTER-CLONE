/* ============================================================
   Friendster Clone — MIDI controller support (Web MIDI API)
   Connect a USB DJ controller (e.g. Pioneer/AlphaTheta DDJ-FLX4)
   and bind its knobs, faders, jog wheels and buttons to the mixer
   using MIDI Learn. Control-only: audio still plays through the
   computer's normal output (a web page can't use the controller's
   sound card). Works in Chrome/Edge; Safari/Firefox lack Web MIDI.
   ============================================================ */

const MIDIControl = (() => {
  const MAP_KEY = "friendster_midi_map_v1";
  let access = null; // MIDIAccess
  let inputs = []; // bound MIDIInput objects
  let container = null;
  let map = loadMap(); // identity string -> target id
  let armed = null; // target id currently learning

  function loadMap() {
    try { return JSON.parse(localStorage.getItem(MAP_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveMap() {
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
  }
  function targetById(id) {
    return (typeof Mixer !== "undefined" ? Mixer.MIDI_TARGETS : []).find((t) => t.id === id);
  }
  function bindingFor(id) {
    return Object.keys(map).find((k) => map[k] === id) || null;
  }

  /* Turn a raw MIDI message into a stable identity + interpretation. */
  function parse(data) {
    const status = data[0], type = status & 0xf0, ch = status & 0x0f;
    const d1 = data[1] || 0, d2 = data[2] || 0;
    if (type === 0x90 && d2 > 0) return { kind: "note", id: `note:${ch}:${d1}`, press: true, value: d2 / 127 };
    if (type === 0x80 || (type === 0x90 && d2 === 0)) return { kind: "noteoff", id: `note:${ch}:${d1}`, press: false };
    if (type === 0xb0) return { kind: "cc", id: `cc:${ch}:${d1}`, value: d2 / 127, raw: d2 };
    if (type === 0xe0) return { kind: "pb", id: `pb:${ch}:0`, value: ((d2 << 7) | d1) / 16383 };
    return null;
  }

  function onMessage(e) {
    const m = parse(e.data);
    if (!m) return;

    // MIDI Learn: first usable message binds to the armed target
    if (armed && m.kind !== "noteoff") {
      // don't let the same physical control map to two targets
      Object.keys(map).forEach((k) => { if (map[k] === armed) delete map[k]; });
      map[m.id] = armed;
      armed = null;
      saveMap();
      render();
      return;
    }

    const targetId = map[m.id];
    if (!targetId || typeof Mixer === "undefined") return;
    const target = targetById(targetId);
    if (!target) return;

    if (target.kind === "button") {
      if (m.kind === "note" || (m.kind === "cc" && m.raw >= 64)) Mixer.apply(targetId, 1);
    } else if (target.kind === "range") {
      Mixer.apply(targetId, m.value);
    } else if (target.kind === "jog") {
      // relative jog: many controllers center at 64 (>64 forward, <64 back)
      if (m.kind !== "cc") return;
      const step = m.raw - 64;
      const delta = Math.max(-10, Math.min(10, step)) * 0.02;
      Mixer.apply(targetId, null, delta);
    }
  }

  function bindInputs() {
    inputs.forEach((i) => (i.onmidimessage = null));
    inputs = [];
    if (!access) return;
    access.inputs.forEach((input) => {
      input.onmidimessage = onMessage;
      inputs.push(input);
    });
  }

  async function connect() {
    if (!navigator.requestMIDIAccess) {
      status("Web MIDI isn't supported in this browser — use Chrome or Edge.");
      return;
    }
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      status("MIDI access was blocked: " + e.message);
      return;
    }
    access.onstatechange = () => { bindInputs(); render(); };
    bindInputs();
    render();
  }

  function deviceNames() {
    if (!access) return [];
    const names = [];
    access.inputs.forEach((i) => names.push(i.name || "unknown"));
    return names;
  }

  function status(msg) {
    const el = container && container.querySelector("#midi_status");
    if (el) el.textContent = msg;
  }

  function render() {
    if (!container) return;
    const supported = !!navigator.requestMIDIAccess;
    const devices = deviceNames();
    const targets = typeof Mixer !== "undefined" ? Mixer.MIDI_TARGETS : [];
    const rows = targets
      .map((t) => {
        const bound = bindingFor(t.id);
        const isArmed = armed === t.id;
        const badge = isArmed
          ? `<span class="midi-armed">move a control…</span>`
          : bound
          ? `<span class="midi-bound">${bound}</span>`
          : `<span class="midi-unbound">unmapped</span>`;
        return `<tr>
          <td>${t.label}</td>
          <td>${badge}</td>
          <td>
            <button class="btn secondary midi-learn" data-id="${t.id}">${isArmed ? "Cancel" : "Learn"}</button>
            ${bound ? `<button class="btn secondary midi-clear" data-id="${t.id}">Clear</button>` : ""}
          </td>
        </tr>`;
      })
      .join("");

    container.innerHTML = `
      <div class="midi-panel">
        ${!supported ? `<p class="error">This browser doesn't support Web MIDI. Use <b>Chrome</b> or <b>Edge</b>.</p>` : ""}
        <div class="btn-row">
          <button class="btn" id="midi_connect">${access ? "Reconnect" : "Connect Controller"}</button>
          <span id="midi_status" class="muted">${
            access
              ? devices.length
                ? "Connected: " + devices.map((n) => esc(n)).join(", ")
                : "No MIDI inputs found — plug in your FLX4 (and close rekordbox/Serato)."
              : "Not connected."
          }</span>
        </div>
        <p class="muted" style="font-size:11px">Click <b>Learn</b> next to a function, then move that control on the FLX4 to bind it. Load a track and click Play once first so audio can start.</p>
        <table class="midi-table"><tbody>${rows}</tbody></table>
      </div>`;

    container.querySelector("#midi_connect").addEventListener("click", connect);
    container.querySelectorAll(".midi-learn").forEach((b) =>
      b.addEventListener("click", () => {
        armed = armed === b.dataset.id ? null : b.dataset.id;
        render();
      })
    );
    container.querySelectorAll(".midi-clear").forEach((b) =>
      b.addEventListener("click", () => {
        const k = bindingFor(b.dataset.id);
        if (k) { delete map[k]; saveMap(); render(); }
      })
    );
  }

  return {
    mount(el) {
      container = el;
      armed = null;
      render();
    },
  };
})();
