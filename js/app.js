/* ============================================================
   Friendster Clone — app shell, router, and views
   ============================================================ */

const app = document.getElementById("app");

/* ---- helpers ---------------------------------------------------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function go(hash) { location.hash = hash; }
function fmtDate(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function userLink(u) {
  return `<a href="#/profile/${u.id}">${esc(u.name)}</a>`;
}
/* Only allow real image links so a bulletin can't inject javascript: URLs. */
function safeImageUrl(url) {
  const u = String(url == null ? "" : url).trim();
  return /^https?:\/\//i.test(u) || /^data:image\//i.test(u) ? u : "";
}
/* Shared bulletin body: optional text + optional image. */
function bulletinBody(b) {
  const text = b.text ? `<div>${esc(b.text)}</div>` : "";
  const img = safeImageUrl(b.image);
  const image = img
    ? `<div class="bulletin-img"><img src="${esc(img)}" alt="" loading="lazy" onerror="this.parentNode.style.display='none'"></div>`
    : "";
  return text + image;
}

/* The compose box: a caption, an image URL, or an uploaded photo.
   Reused by the Home and Bulletins views (only one renders at a time). */
function bulletinComposer(placeholder, onPost) {
  return `
    <textarea id="newBulletin" placeholder="${esc(placeholder)}"></textarea>
    <input type="text" id="newBulletinImg" class="bulletin-url" placeholder="Paste an image URL (optional)" oninput="previewBulletinImg()" />
    <div class="bulletin-upload">
      or upload a photo:
      <input type="file" accept="image/*" id="newBulletinFile" onchange="onBulletinFile(this)" />
    </div>
    <div id="newBulletinPreview" class="bulletin-preview"></div>
    <div class="btn-row"><button class="btn" onclick="${onPost}()">Post Bulletin</button></div>`;
}

/* Read the chosen fields; returns { text, image } or null if empty. */
function readBulletinInput() {
  const text = document.getElementById("newBulletin").value.trim();
  const image = safeImageUrl(document.getElementById("newBulletinImg").value);
  if (!text && !image) return null;
  return { text, image };
}

function previewBulletinImg() {
  const url = safeImageUrl(document.getElementById("newBulletinImg").value);
  const p = document.getElementById("newBulletinPreview");
  p.innerHTML = url ? `<img src="${esc(url)}" alt="" onerror="this.style.display='none'">` : "";
}

/* Turn an uploaded file into a downscaled data: URL so it fits in the
   shared database without a separate file store. */
function onBulletinFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const s = MAX / Math.max(width, height);
        width = Math.round(width * s);
        height = Math.round(height * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      document.getElementById("newBulletinImg").value = dataUrl;
      previewBulletinImg();
    };
    img.onerror = () => alert("That file could not be read as an image.");
    img.src = reader.result;
  };
  reader.onerror = () => alert("That file could not be read.");
  reader.readAsDataURL(file);
}

/* ---- chrome (header + nav) -------------------------------------- */
function chrome(activeTab, bodyHtml) {
  const me = Session.current();
  const userArea = me
    ? `Hi, <a href="#/profile/${me.id}">${esc(me.name)}</a> &nbsp;|&nbsp;
       <a href="#/settings">Settings</a> &nbsp;|&nbsp;
       <a href="#" onclick="doLogout();return false">Log Out</a>`
    : `<a href="#/login">Login</a>`;

  const tabs = me
    ? [
        ["Home", "#/home"],
        ["My Profile", `#/profile/${me.id}`],
        ["Friends", `#/friends/${me.id}`],
        ["Search", "#/search"],
        ["Bulletins", "#/bulletins"],
      ]
    : [["Login", "#/login"], ["Sign Up", "#/signup"]];

  const nav = tabs
    .map(
      ([label, href]) =>
        `<a href="${href}" class="${activeTab === label ? "active" : ""}">${label}</a>`
    )
    .join("");

  return `
    <div class="topbar">
      <div class="topbar-inner">
        <div class="logo" onclick="go('${me ? "#/home" : "#/login"}')"><span>bee</span>friend</div>
        <div class="topbar-user">${userArea}</div>
      </div>
    </div>
    <div class="navbar"><div class="navbar-inner">${nav}</div></div>
    <div class="wrap">${bodyHtml}</div>
    <div class="footer">beefriend &middot; a nostalgic recreation &middot; ${new Date().getFullYear()}</div>
  `;
}

function requireLogin() {
  if (!Session.current()) { go("#/login"); return false; }
  return true;
}

/* ================================================================
   VIEWS
   ================================================================ */

/* ---- Login ------------------------------------------------------ */
function viewLogin() {
  const body = `
    <div class="center-wrap">
      <div class="box">
        <div class="box-title">Member Login</div>
        <div class="box-body">
          <div id="formMsg"></div>
          <label class="field">Username</label>
          <input type="text" id="li_user" placeholder="tom" />
          <label class="field">Password</label>
          <input type="password" id="li_pass" placeholder="password" />
          <div class="btn-row">
            <button class="btn" onclick="doLogin()">Login</button>
            <a class="btn secondary" href="#/signup">Sign Up</a>
          </div>
          <div class="welcome-tag">
            Try the demo account &mdash; <b>tom</b> / <b>password</b><br/>
            (every seeded member uses the password <b>password</b>)
          </div>
        </div>
      </div>
    </div>`;
  app.innerHTML = chrome("Login", body);
}

async function doLogin() {
  const u = document.getElementById("li_user").value.trim();
  const p = document.getElementById("li_pass").value;
  try {
    await Session.login(u, p);
    go("#/home");
  } catch (e) {
    document.getElementById("formMsg").innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}
function doLogout() { Session.logout(); go("#/login"); }

/* ---- Sign up ---------------------------------------------------- */
function viewSignup() {
  const body = `
    <div class="center-wrap">
      <div class="box">
        <div class="box-title">Join beefriend</div>
        <div class="box-body">
          <div id="formMsg"></div>
          <label class="field">Full Name <span class="req">*</span></label>
          <input type="text" id="su_name" />
          <label class="field">Username <span class="req">*</span></label>
          <input type="text" id="su_user" />
          <label class="field">Password <span class="req">*</span></label>
          <input type="password" id="su_pass" />
          <label class="field">Headline <span class="opt">(optional)</span></label>
          <input type="text" id="su_headline" placeholder="Say something about yourself" />
          <label class="field">Location <span class="opt">(optional)</span></label>
          <input type="text" id="su_location" />
          <div class="form-note"><span class="req">*</span> required</div>
          <div class="btn-row">
            <button class="btn" onclick="doSignup()">Create Account</button>
            <a class="btn secondary" href="#/login">Cancel</a>
          </div>
        </div>
      </div>
    </div>`;
  app.innerHTML = chrome("Sign Up", body);
}

async function doSignup() {
  const fields = {
    name: document.getElementById("su_name").value.trim(),
    username: document.getElementById("su_user").value.trim(),
    password: document.getElementById("su_pass").value,
    headline: document.getElementById("su_headline").value.trim(),
    location: document.getElementById("su_location").value.trim(),
  };
  const msg = document.getElementById("formMsg");
  if (!fields.name || !fields.username || !fields.password) {
    msg.innerHTML = `<div class="error">Name, username, and password are required.</div>`;
    return;
  }
  try {
    const u = await DB.createUser(fields);
    await Session.login(u.username, fields.password);
    go("#/home");
  } catch (e) {
    msg.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

/* ---- Home / feed ------------------------------------------------ */
function viewHome() {
  if (!requireLogin()) return;
  const me = Session.current();

  // Bulletin feed from me + friends
  const ids = [me.id, ...me.friends];
  let feed = [];
  ids.forEach((id) => {
    const u = DB.getUser(id);
    if (!u) return;
    u.bulletins.forEach((b) => feed.push({ user: u, ...b }));
  });
  feed.sort((a, b) => new Date(b.date) - new Date(a.date));

  const feedHtml = feed.length
    ? feed
        .map(
          (b) => `
        <div class="bulletin">
          <img src="${b.user.avatar}" alt="">
          <div>
            <div>${userLink(b.user)} <span class="meta">&middot; ${fmtDate(b.date)}</span></div>
            ${bulletinBody(b)}
          </div>
        </div>`
        )
        .join("")
    : `<p class="muted">No bulletins yet. Be the first to post one!</p>`;

  // Friend suggestions: members you aren't friends with
  const suggestions = DB.allUsers()
    .filter((u) => u.id !== me.id && !me.friends.includes(u.id))
    .slice(0, 4);

  const sugHtml = suggestions.length
    ? `<div class="friend-grid">${suggestions
        .map(
          (u) => `<div class="friend-cell">
            <a href="#/profile/${u.id}"><img src="${u.avatar}" alt=""></a>
            <a href="#/profile/${u.id}">${esc(u.name)}</a>
          </div>`
        )
        .join("")}</div>`
    : `<p class="muted">You know everyone already!</p>`;

  const body = `
    <div class="columns">
      <div class="col-left">
        <div class="box">
          <div class="box-title">My beefriend</div>
          <div class="box-body" style="text-align:center">
            <a href="#/profile/${me.id}"><img src="${me.avatar}" style="width:100px;height:100px;border:1px solid #9fb6dc;padding:3px"></a>
            <div style="margin-top:6px;font-weight:bold">${esc(me.name)}</div>
            <div class="muted">${esc(me.headline)}</div>
          </div>
        </div>
        <div class="box stats">
          <div class="box-title">Network</div>
          <div class="box-body">
            <div class="num">${me.friends.length}</div> Friends<br/>
            <div class="num">${me.testimonials.length}</div> Testimonials
          </div>
        </div>
        <div class="box">
          <div class="box-title">Who You Should Add</div>
          <div class="box-body">${sugHtml}</div>
        </div>
      </div>

      <div class="col-main">
        <div class="box">
          <div class="box-title">Post a Bulletin</div>
          <div class="box-body">
            ${bulletinComposer(`What's on your mind, ${me.name}?`, "postBulletin")}
          </div>
        </div>
        <div class="box">
          <div class="box-title">Bulletin Board</div>
          <div class="box-body">${feedHtml}</div>
        </div>
      </div>
    </div>`;
  app.innerHTML = chrome("Home", body);
}

function postBulletin() {
  const me = Session.current();
  const input = readBulletinInput();
  if (!input) return;
  DB.addBulletin(me.id, input.text, input.image);
  viewHome();
}

/* ---- Profile ---------------------------------------------------- */
function viewProfile(id) {
  if (!requireLogin()) return;
  const me = Session.current();
  const u = DB.getUser(id);
  if (!u) { app.innerHTML = chrome("", `<div class="box"><div class="box-body">User not found.</div></div>`); return; }

  const isMe = u.id === me.id;
  const isFriend = me.friends.includes(u.id);

  let friendBtn = "";
  if (!isMe) {
    friendBtn = isFriend
      ? `<button class="btn danger" onclick="unfriend('${u.id}')">Remove Friend</button>`
      : `<button class="btn" onclick="friend('${u.id}')">Add as Friend</button>`;
  } else {
    friendBtn = `<a class="btn secondary" href="#/settings">Edit Profile</a>`;
  }

  // friends preview
  const fpreview = u.friends
    .slice(0, 8)
    .map((fid) => DB.getUser(fid))
    .filter(Boolean)
    .map(
      (f) => `<div class="friend-cell">
        <a href="#/profile/${f.id}"><img src="${f.avatar}" alt=""></a>
        <a href="#/profile/${f.id}">${esc(f.name)}</a>
      </div>`
    )
    .join("");

  // testimonials
  const testiHtml = u.testimonials.length
    ? u.testimonials
        .map((t) => {
          const from = DB.getUser(t.from);
          return `<div class="testi">
            <img src="${from ? from.avatar : ""}" alt="">
            <div>
              <div class="who">${from ? userLink(from) : "Someone"} <span class="when">&middot; ${fmtDate(t.date)}</span></div>
              <div class="text">${esc(t.text)}</div>
            </div>
          </div>`;
        })
        .join("")
    : `<p class="muted">No testimonials yet.</p>`;

  const testiForm = !isMe
    ? `<hr class="sep">
       <label class="field">Write ${esc(u.name)} a testimonial</label>
       <textarea id="newTesti" placeholder="Say something nice..."></textarea>
       <div class="btn-row"><button class="btn" onclick="postTestimonial('${u.id}')">Submit Testimonial</button></div>`
    : "";

  // music — audio elements are hydrated from IndexedDB after render
  const songs = u.songs || [];
  const autoplayOn = u.autoplay !== false;
  const songsHtml = songs.length
    ? songs
        .map((s, i) => {
          const isProfileSong = i === 0;
          const auto = isProfileSong && autoplayOn;
          return `<div class="song">
            <div class="song-info">
              &#9835; <span class="song-title">${esc(s.title)}</span>${
            s.artist ? ` <span class="song-artist">&mdash; ${esc(s.artist)}</span>` : ""
          }${isProfileSong ? ` <span class="muted">(profile song${autoplayOn ? " &middot; autoplays" : ""})</span>` : ""}
            </div>
            <audio controls preload="${auto ? "auto" : "none"}" data-song-id="${esc(s.id)}"${
            auto ? ' data-autoplay="1"' : ""
          }></audio>
            <span class="muted autoplay-hint" id="hint-${esc(s.id)}"></span>
            ${isMe ? `<div class="btn-row"><button class="btn danger" onclick="deleteSong('${u.id}','${esc(s.id)}')">Delete</button></div>` : ""}
          </div>`;
        })
        .join("")
    : `<p class="muted">No songs yet.</p>`;

  const autoplayToggle =
    isMe && songs.length
      ? `<div class="autoplay-toggle">
           <label><input type="checkbox" id="autoplayChk" ${autoplayOn ? "checked" : ""}
             onchange="toggleAutoplay('${u.id}')">
           Automatically play my profile song when someone visits</label>
           <div class="muted">${autoplayOn ? "Automatic — plays on load." : "Manual — visitors press play."}</div>
         </div>
         <hr class="sep">`
      : "";

  const musicForm = isMe
    ? `<hr class="sep">
       <label class="field">Add a song to your profile</label>
       <input type="file" id="songFile" accept="audio/*">
       <label class="field">Title</label>
       <input type="text" id="songTitle" placeholder="Song title (defaults to file name)">
       <label class="field">Artist</label>
       <input type="text" id="songArtist" placeholder="Artist (optional)">
       <div id="songMsg"></div>
       <div class="btn-row"><button class="btn" onclick="uploadSong('${u.id}')">Upload Song</button></div>`
    : "";

  // recorded mixes (Spotify-style entries with a timestamp)
  const mixes = u.mixes || [];
  const mixDeckHtml = (d) =>
    d
      ? `<div class="mix-rec">
           <div class="mix-vinyl"></div>
           <div>
             <div class="mix-track">${esc(d.title)}</div>
             ${d.artist ? `<div class="muted">${esc(d.artist)}</div>` : ""}
             <div class="mix-meta">${d.playBpm || d.baseBpm || "?"} BPM &middot; ${esc(d.key || "—")}${
          d.keyShift ? ` (${d.keyShift > 0 ? "+" : ""}${d.keyShift} st)` : ""
        }</div>
           </div>
         </div>`
      : `<div class="mix-rec muted">(empty deck)</div>`;
  const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");
  const mixesHtml = mixes.length
    ? mixes
        .map(
          (m) => `<div class="mix-card">
            <div class="mix-head"><b>Mix</b> <span class="meta">&middot; ${fmtDateTime(m.date)}${
            m.duration ? " &middot; " + fmtDur(m.duration) : ""
          }</span></div>
            <div class="mix-decks">${mixDeckHtml(m.deckA)}<span class="mix-plus">&#43;</span>${mixDeckHtml(m.deckB)}</div>
            <audio controls preload="none" data-song-id="${esc(m.id)}"></audio>
            ${isMe ? `<div class="btn-row"><button class="btn danger" onclick="deleteMix('${u.id}','${esc(m.id)}')">Delete</button></div>` : ""}
          </div>`
        )
        .join("")
    : `<p class="muted">No mixes yet.</p>`;

  const mixerBox = isMe
    ? `<div class="box">
         <div class="box-title">DJ Mixer</div>
         <div class="box-body"><div id="djMixer"><p class="muted">Loading mixer…</p></div></div>
       </div>`
    : "";

  const body = `
    <div class="columns">
      <div class="col-left">
        <div class="box">
          <div class="box-title">${esc(u.username)}</div>
          <div class="box-body" style="text-align:center">
            <div class="profile-photo" style="margin:0 auto;width:140px;height:140px">
              <img src="${u.avatar}" alt="">
            </div>
            <div class="btn-row" style="justify-content:center">${friendBtn}</div>
          </div>
        </div>
        <div class="box stats">
          <div class="box-title">Stats</div>
          <div class="box-body">
            <div class="num">${u.friends.length}</div> Friends<br/>
            <div class="num">${u.testimonials.length}</div> Testimonials
          </div>
        </div>
      </div>

      <div class="col-main">
        <div class="box">
          <div class="box-title">About ${esc(u.name)}</div>
          <div class="box-body">
            <div class="profile-name">${esc(u.name)}</div>
            <div class="profile-headline">&ldquo;${esc(u.headline)}&rdquo;</div>
            <div class="fact"><b>Gender:</b> ${esc(u.gender) || "&mdash;"}</div>
            <div class="fact"><b>Age:</b> ${esc(u.age) || "&mdash;"}</div>
            <div class="fact"><b>Location:</b> ${esc(u.location) || "&mdash;"}</div>
            <div class="fact"><b>Status:</b> ${esc(u.status) || "&mdash;"}</div>
            <div class="fact"><b>Member since:</b> ${fmtDate(u.joined)}</div>
          </div>
        </div>

        <div class="box">
          <div class="box-title">More About Me</div>
          <div class="box-body">
            <div class="fact"><b>About me:</b> ${esc(u.about) || "&mdash;"}</div>
            <div class="fact"><b>Interests:</b> ${esc(u.interests) || "&mdash;"}</div>
            <div class="fact"><b>Music:</b> ${esc(u.music) || "&mdash;"}</div>
            <div class="fact"><b>TV:</b> ${esc(u.tv) || "&mdash;"}</div>
          </div>
        </div>

        <div class="box">
          <div class="box-title">${esc(u.name)}'s Music</div>
          <div class="box-body">
            ${autoplayToggle}
            ${songsHtml}
            ${musicForm}
          </div>
        </div>

        ${mixerBox}

        <div class="box">
          <div class="box-title">${esc(u.name)}'s Mixes</div>
          <div class="box-body">${mixesHtml}</div>
        </div>

        <div class="box">
          <div class="box-title">${esc(u.name)}'s Friends (${u.friends.length})</div>
          <div class="box-body">
            <div class="friend-grid">${fpreview || '<span class="muted">No friends yet.</span>'}</div>
            <hr class="sep">
            <a href="#/friends/${u.id}">See all friends &raquo;</a>
          </div>
        </div>

        <div class="box">
          <div class="box-title">Testimonials for ${esc(u.name)}</div>
          <div class="box-body">
            ${testiHtml}
            ${testiForm}
          </div>
        </div>
      </div>
    </div>`;
  app.innerHTML = chrome(isMe ? "My Profile" : "", body);
  applyBg(u.bgColor, u.bgImage); // this profile's custom background
  hydrateAudio();
  if (isMe && typeof Mixer !== "undefined") {
    const el = document.getElementById("djMixer");
    if (el) {
      Mixer.mount(el, u.songs || [], {
        onSave: (mix) => {
          DB.addMix(u.id, mix);
          viewProfile(u.id); // re-render so the new mix appears
        },
      });
    }
  }
}

/* Load each track's blob from IndexedDB and wire it to its <audio>. */
function hydrateAudio() {
  document.querySelectorAll("audio[data-song-id]").forEach(async (el) => {
    if (el.src) return;
    try {
      const url = await MusicStore.url(el.dataset.songId);
      if (url) {
        el.src = url;
        if (el.dataset.autoplay === "1") {
          const hint = document.getElementById("hint-" + el.dataset.songId);
          // Try to start with sound. If the browser blocks that on a
          // no-interaction load, fall back to MUTED autoplay — which every
          // browser allows — so the song still starts the instant the page
          // loads. The native speaker button turns sound on.
          el.play().catch(() => {
            el.muted = true;
            el.play().then(() => {
              if (hint) hint.textContent = "🔇 Started muted (browser rule) — click 🔊 on the player for sound.";
            }).catch(() => {});
          });
        }
      } else {
        el.insertAdjacentHTML("afterend", '<div class="muted">(audio file not found)</div>');
      }
    } catch (e) {
      el.insertAdjacentHTML("afterend", '<div class="muted">(could not load audio)</div>');
    }
  });
}

async function uploadSong(userId) {
  const fileEl = document.getElementById("songFile");
  const msg = document.getElementById("songMsg");
  const file = fileEl.files[0];
  if (!file) { msg.innerHTML = '<div class="error">Choose an audio file first.</div>'; return; }
  if (!file.type.startsWith("audio/")) {
    msg.innerHTML = '<div class="error">That doesn\'t look like an audio file.</div>'; return;
  }
  if (file.size > 20 * 1024 * 1024) {
    msg.innerHTML = '<div class="error">Please keep files under 20 MB.</div>'; return;
  }
  const title =
    document.getElementById("songTitle").value.trim() || file.name.replace(/\.[^.]+$/, "");
  const artist = document.getElementById("songArtist").value.trim();
  const id = "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  msg.innerHTML = '<div class="notice">Uploading&hellip;</div>';
  try {
    await MusicStore.put(id, file);
    DB.addSong(userId, { id, title, artist });
    viewProfile(userId);
  } catch (e) {
    msg.innerHTML = '<div class="error">Could not save: ' + esc(e.message) + "</div>";
  }
}

function toggleAutoplay(userId) {
  const chk = document.getElementById("autoplayChk");
  DB.updateUser(userId, { autoplay: chk.checked });
  viewProfile(userId);
}

async function deleteSong(userId, songId) {
  if (!confirm("Remove this song?")) return;
  try { await MusicStore.remove(songId); } catch (e) {}
  DB.removeSong(userId, songId);
  viewProfile(userId);
}

async function deleteMix(userId, mixId) {
  if (!confirm("Delete this mix?")) return;
  try { await MusicStore.remove(mixId); } catch (e) {}
  DB.removeMix(userId, mixId);
  viewProfile(userId);
}

function friend(id) { DB.addFriend(Session.current().id, id); viewProfile(id); }
function unfriend(id) { DB.removeFriend(Session.current().id, id); viewProfile(id); }
function postTestimonial(id) {
  const text = document.getElementById("newTesti").value.trim();
  if (!text) return;
  DB.addTestimonial(id, Session.current().id, text);
  viewProfile(id);
}

/* ---- Friends list ---------------------------------------------- */
function viewFriends(id) {
  if (!requireLogin()) return;
  const me = Session.current();
  const u = DB.getUser(id);
  if (!u) { go("#/home"); return; }

  const list = u.friends
    .map((fid) => DB.getUser(fid))
    .filter(Boolean)
    .map((f) => {
      const canRemove = u.id === me.id;
      return `<div class="member-row">
        <a href="#/profile/${f.id}"><img src="${f.avatar}" alt=""></a>
        <div style="flex:1">
          <div class="name"><a href="#/profile/${f.id}">${esc(f.name)}</a></div>
          <div class="muted">${esc(f.location)}</div>
          <div>${esc(f.headline)}</div>
        </div>
        ${canRemove ? `<button class="btn danger" onclick="unfriendList('${f.id}','${u.id}')">Remove</button>` : ""}
      </div>`;
    })
    .join("");

  const body = `
    <div class="box">
      <div class="box-title">${esc(u.name)}'s Friends (${u.friends.length})</div>
      <div class="box-body">${list || '<p class="muted">No friends yet.</p>'}</div>
    </div>`;
  app.innerHTML = chrome(u.id === me.id ? "Friends" : "", body);
}
function unfriendList(fid, ownerId) {
  DB.removeFriend(Session.current().id, fid);
  viewFriends(ownerId);
}

/* ---- Search ----------------------------------------------------- */
function viewSearch(q) {
  if (!requireLogin()) return;
  const me = Session.current();
  q = (q || "").trim();

  let results = DB.allUsers().filter((u) => u.id !== me.id);
  if (q) {
    const ql = q.toLowerCase();
    results = results.filter(
      (u) =>
        u.name.toLowerCase().includes(ql) ||
        (u.location || "").toLowerCase().includes(ql) ||
        (u.interests || "").toLowerCase().includes(ql)
    );
  }

  const rows = results
    .map((u) => {
      const isFriend = me.friends.includes(u.id);
      return `<div class="member-row">
        <a href="#/profile/${u.id}"><img src="${u.avatar}" alt=""></a>
        <div style="flex:1">
          <div class="name"><a href="#/profile/${u.id}">${esc(u.name)}</a></div>
          <div class="muted">${esc(u.location)} ${u.age ? "&middot; " + u.age : ""}</div>
          <div>${esc(u.headline)}</div>
        </div>
        ${
          isFriend
            ? `<span class="muted">&#10004; Friend</span>`
            : `<button class="btn" onclick="friendFromSearch('${u.id}', '${esc(q)}')">Add Friend</button>`
        }
      </div>`;
    })
    .join("");

  const body = `
    <div class="box">
      <div class="box-title">Search Members</div>
      <div class="box-body">
        <div style="display:flex;gap:8px">
          <input type="text" id="searchQ" value="${esc(q)}" placeholder="name, city, or interest"
            onkeydown="if(event.key==='Enter')runSearch()">
          <button class="btn" onclick="runSearch()">Search</button>
        </div>
      </div>
    </div>
    <div class="box">
      <div class="box-title">${q ? `Results for "${esc(q)}"` : "All Members"} (${results.length})</div>
      <div class="box-body">${rows || '<p class="muted">No members found.</p>'}</div>
    </div>`;
  app.innerHTML = chrome("Search", body);
}
function runSearch() {
  const q = document.getElementById("searchQ").value.trim();
  go("#/search" + (q ? "/" + encodeURIComponent(q) : ""));
}
function friendFromSearch(id, q) {
  DB.addFriend(Session.current().id, id);
  viewSearch(q);
}

/* ---- Bulletins (compose + all) --------------------------------- */
function viewBulletins() {
  if (!requireLogin()) return;
  const me = Session.current();
  const ids = [me.id, ...me.friends];
  let feed = [];
  ids.forEach((id) => {
    const u = DB.getUser(id);
    if (!u) return;
    u.bulletins.forEach((b) => feed.push({ user: u, ...b }));
  });
  feed.sort((a, b) => new Date(b.date) - new Date(a.date));

  const feedHtml = feed.length
    ? feed
        .map(
          (b) => `<div class="bulletin">
            <img src="${b.user.avatar}" alt="">
            <div>
              <div>${userLink(b.user)} <span class="meta">&middot; ${fmtDate(b.date)}</span></div>
              ${bulletinBody(b)}
            </div>
          </div>`
        )
        .join("")
    : `<p class="muted">No bulletins from you or your friends yet.</p>`;

  const body = `
    <div class="box">
      <div class="box-title">Post a Bulletin</div>
      <div class="box-body">
        ${bulletinComposer("Broadcast to all your friends...", "postBulletinB")}
      </div>
    </div>
    <div class="box">
      <div class="box-title">All Bulletins</div>
      <div class="box-body">${feedHtml}</div>
    </div>`;
  app.innerHTML = chrome("Bulletins", body);
}
function postBulletinB() {
  const input = readBulletinInput();
  if (!input) return;
  DB.addBulletin(Session.current().id, input.text, input.image);
  viewBulletins();
}

/* ---- Settings / edit profile ----------------------------------- */
function viewSettings() {
  if (!requireLogin()) return;
  const u = Session.current();
  const f = (id, label, val, type = "text") =>
    `<label class="field">${label}</label><input type="${type}" id="${id}" value="${esc(val)}">`;

  const body = `
    <div class="box">
      <div class="box-title">Edit My Profile</div>
      <div class="box-body">
        <div id="formMsg"></div>
        ${f("se_name", "Full Name", u.name)}
        ${f("se_headline", "Headline", u.headline)}
        ${f("se_gender", "Gender", u.gender)}
        ${f("se_age", "Age", u.age, "number")}
        ${f("se_location", "Location", u.location)}
        <label class="field">Relationship Status</label>
        <select id="se_status">
          ${["Single", "In a relationship", "It's complicated", "Married"]
            .map((s) => `<option ${s === u.status ? "selected" : ""}>${s}</option>`)
            .join("")}
        </select>
        <label class="field">About Me</label>
        <textarea id="se_about">${esc(u.about)}</textarea>
        ${f("se_interests", "Interests", u.interests)}
        ${f("se_music", "Music", u.music)}
        ${f("se_tv", "TV Shows", u.tv)}

        <hr class="sep">
        <div class="box-title" style="margin:0 -10px 8px">Profile Picture</div>
        <div style="display:flex;gap:12px;align-items:flex-start">
          <img id="pfpPreview" src="${u.avatar}" alt=""
            style="width:90px;height:90px;border:1px solid #9fb6dc;padding:3px;background:#fff;flex:none">
          <div style="flex:1">
            <label class="field">Upload a photo</label>
            <input type="file" id="se_pfpfile" accept="image/*" onchange="pfpFromFile()">
            <label class="field">…or paste an image URL</label>
            <input type="text" id="se_pfpurl" placeholder="https://...jpg" oninput="pfpFromUrl()">
            <div id="pfpMsg" class="muted">Uploads are auto-resized to 160×160 so they fit.</div>
          </div>
        </div>

        <hr class="sep">
        <div class="box-title" style="margin:0 -10px 8px">Customize My Background</div>
        <label class="field">Background Color</label>
        <input type="color" id="se_bgcolor" value="${u.bgColor && u.bgColor[0] === "#" ? u.bgColor : "#e8eef7"}"
          oninput="bgPreview()">
        <label class="field">Background Image URL (optional)</label>
        <input type="text" id="se_bgimage" value="${esc(u.bgImage)}" placeholder="https://...jpg  (covers the page)"
          oninput="bgPreview()">
        <div class="muted">Tip: in <b>Google Images</b>, click a photo, then right-click it → <b>Copy image address</b> and paste it here. A search-page link won't work — the URL should end in .jpg, .png, etc.</div>
        <div class="muted">Quick picks:</div>
        <div class="bg-presets" id="bgPresets"></div>
        <div class="btn-row"><button class="btn secondary" onclick="bgClear()">Clear Background</button></div>

        <div class="btn-row">
          <button class="btn" onclick="saveSettings()">Save Changes</button>
          <a class="btn secondary" href="#/profile/${u.id}">Cancel</a>
        </div>
        <hr class="sep">
        <button class="btn danger" onclick="resetEverything()">Reset Demo Data</button>
      </div>
    </div>`;
  app.innerHTML = chrome("", body);
  renderBgPresets();
  // restore a saved gradient/pattern color (the color input only holds hex)
  if (u.bgColor && u.bgColor[0] !== "#") {
    document.getElementById("se_bgcolor").dataset.css = u.bgColor;
  }
  bgPreview(); // show current background while editing
}

/* ---- Profile picture -------------------------------------------- */
/* Downscale an uploaded image to a small square data URL so it fits in
   localStorage and loads fast everywhere the avatar appears. */
function fileToAvatarDataURL(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 160;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(size / img.width, size / img.height); // cover crop
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not load image")); };
    img.src = url;
  });
}

async function pfpFromFile() {
  const f = document.getElementById("se_pfpfile").files[0];
  const msg = document.getElementById("pfpMsg");
  if (!f) return;
  if (!f.type.startsWith("image/")) { msg.textContent = "That isn't an image file."; return; }
  try {
    const data = await fileToAvatarDataURL(f);
    document.getElementById("pfpPreview").src = data;
    document.getElementById("se_pfpurl").value = "";
    msg.textContent = "Looks good! Click Save Changes to keep it.";
  } catch (e) {
    msg.textContent = "Could not read that image.";
  }
}

function pfpFromUrl() {
  const url = document.getElementById("se_pfpurl").value.trim();
  if (url) document.getElementById("pfpPreview").src = url;
}

/* ---- Background customization ---------------------------------- */
const BG_PRESETS = [
  { label: "Friendster Blue", color: "#e8eef7" },
  { label: "Hot Pink", color: "#ffd6ec" },
  { label: "Lime", color: "#e7f7c6" },
  { label: "Sunset", color: "linear-gradient(160deg,#ff9a5a,#ffd24a)" },
  { label: "Ocean", color: "linear-gradient(160deg,#3d6bb5,#7fd4e0)" },
  { label: "Midnight", color: "linear-gradient(160deg,#1c2540,#3d3a6b)" },
  { label: "Polka Dots", color: "#fff7d6", image: dotsTile("#e0c84a") },
  { label: "Stars", color: "#1c2540", image: starsTile("#ffd24a") },
];

function dotsTile(c) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='6' cy='6' r='3' fill='${c}'/><circle cx='18' cy='18' r='3' fill='${c}'/></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
function starsTile(c) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><text x='8' y='18' font-size='14' fill='${c}'>★</text><text x='26' y='36' font-size='10' fill='${c}'>★</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function renderBgPresets() {
  const wrap = document.getElementById("bgPresets");
  if (!wrap) return;
  wrap.innerHTML = BG_PRESETS.map((p, i) => {
    const style = p.image
      ? `background:${p.color} url("${p.image}") repeat`
      : `background:${p.color}`;
    return `<button type="button" class="bg-swatch" title="${esc(p.label)}"
      style="${style}" onclick="bgUsePreset(${i})"></button>`;
  }).join("");
}

function bgUsePreset(i) {
  const p = BG_PRESETS[i];
  // gradients/patterns are stored in the image/color text; the color input
  // only holds solid hex, so stash non-hex backgrounds in a data attribute.
  const colorEl = document.getElementById("se_bgcolor");
  const imgEl = document.getElementById("se_bgimage");
  if (p.color && p.color[0] === "#") { colorEl.value = p.color; colorEl.dataset.css = ""; }
  else { colorEl.dataset.css = p.color; }
  imgEl.value = p.image || "";
  bgPreview();
}

/* read the chosen background from the form */
function bgCurrent() {
  const colorEl = document.getElementById("se_bgcolor");
  const imgEl = document.getElementById("se_bgimage");
  const color = colorEl.dataset.css ? colorEl.dataset.css : colorEl.value;
  return { color, image: imgEl.value.trim() };
}
function bgPreview() {
  const { color, image } = bgCurrent();
  applyBg(color, image);
}
function bgClear() {
  const colorEl = document.getElementById("se_bgcolor");
  colorEl.value = "#e8eef7";
  colorEl.dataset.css = "";
  document.getElementById("se_bgimage").value = "";
  bgPreview();
}

/* apply a background to the page */
function applyBg(color, image) {
  const b = document.body;
  b.style.background = color || "#e8eef7";
  if (image) {
    const safe = image.replace(/"/g, "%22");
    b.style.backgroundImage = `url("${safe}")`;
    if (image.startsWith("data:")) {
      b.style.backgroundRepeat = "repeat";
      b.style.backgroundSize = "auto";
    } else {
      b.style.backgroundRepeat = "no-repeat";
      b.style.backgroundSize = "cover";
      b.style.backgroundAttachment = "fixed";
      b.style.backgroundPosition = "center";
    }
  } else {
    b.style.backgroundImage = "";
  }
}
function resetBg() {
  const b = document.body;
  b.style.background = "";
  b.style.backgroundImage = "";
}

function saveSettings() {
  const u = Session.current();
  const bg = bgCurrent();
  DB.updateUser(u.id, {
    name: document.getElementById("se_name").value.trim(),
    headline: document.getElementById("se_headline").value.trim(),
    gender: document.getElementById("se_gender").value.trim(),
    age: document.getElementById("se_age").value.trim(),
    location: document.getElementById("se_location").value.trim(),
    status: document.getElementById("se_status").value,
    about: document.getElementById("se_about").value.trim(),
    interests: document.getElementById("se_interests").value.trim(),
    music: document.getElementById("se_music").value.trim(),
    tv: document.getElementById("se_tv").value.trim(),
    avatar: document.getElementById("pfpPreview").src,
    bgColor: bg.color,
    bgImage: bg.image,
  });
  go("#/profile/" + u.id);
}
async function resetEverything() {
  if (confirm("Reset ALL shared data for everyone and log out?")) {
    try {
      await DB.reset();
    } catch (e) {
      alert("Reset failed: " + e.message);
      return;
    }
    go("#/login");
    location.reload();
  }
}

/* ================================================================
   ROUTER
   ================================================================ */
function router() {
  const hash = location.hash || "#/login";
  const parts = hash.replace(/^#\//, "").split("/");
  const route = parts[0];

  resetBg(); // default background; profile/settings views re-apply as needed
  if (typeof Mixer !== "undefined") Mixer.unmount(); // stop any deck audio when leaving

  switch (route) {
    case "login": return viewLogin();
    case "signup": return viewSignup();
    case "home": return viewHome();
    case "profile": return viewProfile(parts[1]);
    case "friends": return viewFriends(parts[1]);
    case "search": return viewSearch(parts[1] ? decodeURIComponent(parts[1]) : "");
    case "bulletins": return viewBulletins();
    case "settings": return viewSettings();
    default:
      return Session.current() ? viewHome() : viewLogin();
  }
}

window.addEventListener("hashchange", router);
window.addEventListener("load", () => {
  DB.load(); // ensure seeded
  if (!location.hash) location.hash = Session.current() ? "#/home" : "#/login";
  router();
});
