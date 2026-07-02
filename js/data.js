/* ============================================================
   Friendster Clone — data layer
   Handles seed data + persistence via localStorage.
   ============================================================ */

const DB_KEY = "friendster_db_v1";
const SESSION_KEY = "friendster_session_v1";

/* ---- Seed users -------------------------------------------------- */
function seedDB() {
  const users = [
    {
      id: "u1",
      username: "tom",
      password: "password",
      name: "Tom",
      headline: "Always here to be your first friend.",
      gender: "Male",
      age: 29,
      location: "Mountain View, CA",
      status: "Single",
      avatar: avatarFor("Tom", "#4a76c4"),
      about: "I help everyone get started. Welcome to Friendster!",
      interests: "music, photography, meeting new people",
      music: "The Strokes, Daft Punk, OutKast",
      tv: "The Office, Lost",
      joined: "2003-03-21",
      friends: ["u2", "u3", "u4", "u5"],
      songs: [],
      testimonials: [
        { from: "u2", date: "2003-04-02", text: "Tom is the nicest guy on the whole network! 5 stars." },
      ],
      bulletins: [],
    },
    {
      id: "u2",
      username: "jenny",
      password: "password",
      name: "Jenny Kim",
      headline: "Coffee, cameras, and good company.",
      gender: "Female",
      age: 26,
      location: "San Francisco, CA",
      status: "In a relationship",
      avatar: avatarFor("Jenny Kim", "#e0729b"),
      about: "Barista by day, film photographer by night.",
      interests: "espresso, 35mm film, vinyl records",
      music: "Fleetwood Mac, Sade",
      tv: "Friends",
      joined: "2003-05-11",
      friends: ["u1", "u3", "u5"],
      testimonials: [
        { from: "u3", date: "2003-06-01", text: "Jenny takes the best photos. A real one!" },
      ],
      bulletins: [
        { date: "2003-06-10", text: "Photo walk this Saturday — who's in?" },
      ],
    },
    {
      id: "u3",
      username: "marco",
      password: "password",
      name: "Marco Reyes",
      headline: "Skateboards & synthesizers.",
      gender: "Male",
      age: 24,
      location: "Los Angeles, CA",
      status: "Single",
      avatar: avatarFor("Marco Reyes", "#3fae8e"),
      about: "If it has wheels or knobs, I'm interested.",
      interests: "skating, modular synths, tacos",
      music: "Boards of Canada, Aphex Twin",
      tv: "Jackass",
      joined: "2003-07-19",
      friends: ["u1", "u2", "u4"],
      testimonials: [],
      bulletins: [],
    },
    {
      id: "u4",
      username: "aisha",
      password: "password",
      name: "Aisha Patel",
      headline: "Books > everything.",
      gender: "Female",
      age: 28,
      location: "Seattle, WA",
      status: "It's complicated",
      avatar: avatarFor("Aisha Patel", "#c98a3b"),
      about: "Reading my way through the classics, one rainy day at a time.",
      interests: "novels, tea, long walks",
      music: "Nina Simone, Radiohead",
      tv: "Twin Peaks",
      joined: "2003-08-02",
      friends: ["u1", "u3"],
      testimonials: [],
      bulletins: [],
    },
    {
      id: "u5",
      username: "deej",
      password: "password",
      name: "DJ Cool",
      headline: "Spinning records since '99.",
      gender: "Male",
      age: 31,
      location: "Oakland, CA",
      status: "Single",
      avatar: avatarFor("DJ Cool", "#7a59c4"),
      about: "Bringing the party wherever I go.",
      interests: "turntables, crate digging, late nights",
      music: "everything with a beat",
      tv: "MTV",
      joined: "2003-09-15",
      friends: ["u1", "u2"],
      testimonials: [],
      bulletins: [],
    },
  ];
  return { users };
}

/* Simple inline SVG avatar so we have no external assets. */
function avatarFor(name, color) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
    <rect width='160' height='160' fill='${color}'/>
    <text x='50%' y='50%' dy='.35em' text-anchor='middle'
      font-family='Verdana,Arial,sans-serif' font-size='64' fill='#ffffff'>${initials}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

/* ---- Storage API -------------------------------------------------
   Data lives in a shared Postgres database behind a tiny JSON API
   (see server.js / db.js). The client keeps an in-memory cache so the
   rest of the app can keep reading synchronously; writes update the
   cache immediately and are persisted to the server in the background.
   ------------------------------------------------------------------- */

/* Small fetch helper. Throws Error(message) on non-2xx responses. */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body is fine */
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

const DB = {
  _cache: { users: [] },

  _normalize(db) {
    db.users.forEach((u) => {
      if (!Array.isArray(u.friends)) u.friends = [];
      if (!Array.isArray(u.requestsIn)) u.requestsIn = []; // incoming pending requests
      if (!Array.isArray(u.songs)) u.songs = [];
      if (!Array.isArray(u.mixes)) u.mixes = [];
      if (typeof u.autoplay !== "boolean") u.autoplay = true;
      if (typeof u.bgColor !== "string") u.bgColor = "";
      if (typeof u.bgImage !== "string") u.bgImage = "";
    });
    return db;
  },

  /* Boot: pull the shared world; seed it the first time it's empty. */
  async init() {
    let state = await api("GET", "/api/state");
    if (!state.users.length) {
      state = await api("POST", "/api/seed", seedDB());
    }
    this._cache = this._normalize(state);
    return this._cache;
  },

  /* Re-pull the world in the background so friends' changes show up
     on the next navigation. Failures are non-fatal. */
  async refresh() {
    try {
      const state = await api("GET", "/api/state");
      this._cache = this._normalize(state);
    } catch (e) {
      console.warn("[db] refresh failed:", e.message);
    }
  },

  /* Persist one cached user to the server (fire-and-forget). */
  _sync(id) {
    const u = this.getUser(id);
    if (!u) return;
    api("PATCH", "/api/users/" + encodeURIComponent(id), { user: u }).catch(
      (e) => console.warn("[db] sync failed for " + id + ":", e.message)
    );
  },

  load() {
    return this._cache;
  },

  async reset() {
    const state = await api("POST", "/api/reset", seedDB());
    this._cache = this._normalize(state);
    localStorage.removeItem(SESSION_KEY);
  },

  getUser(id) {
    return this._cache.users.find((u) => u.id === id) || null;
  },
  getUserByUsername(username) {
    return (
      this._cache.users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase()
      ) || null
    );
  },
  allUsers() {
    return this._cache.users;
  },

  /* Create a new account. Persists to the server before returning so a
     username clash surfaces as a thrown error. */
  async createUser(fields) {
    const id = "u" + Date.now() + Math.floor(Math.random() * 1000);
    const user = {
      id,
      username: fields.username,
      password: fields.password,
      name: fields.name,
      headline: fields.headline || "New to Friendster!",
      gender: fields.gender || "",
      age: fields.age || "",
      location: fields.location || "",
      status: fields.status || "Single",
      avatar: avatarFor(fields.name || fields.username, "#4a76c4"),
      about: fields.about || "",
      interests: fields.interests || "",
      music: "",
      tv: "",
      joined: new Date().toISOString().slice(0, 10),
      friends: ["u1"], // Tom befriends everyone
      requestsIn: [], // incoming pending friend requests
      testimonials: [],
      bulletins: [],
      songs: [],
      mixes: [],
      autoplay: true,
      bgColor: "",
      bgImage: "",
    };
    await api("POST", "/api/users", { user }); // throws on duplicate username
    this._cache.users.push(user);
    // Tom adds them back
    const tom = this.getUser("u1");
    if (tom && !tom.friends.includes(id)) {
      tom.friends.push(id);
      this._sync("u1");
    }
    return user;
  },

  updateUser(id, fields) {
    const u = this.getUser(id);
    if (!u) return;
    Object.assign(u, fields);
    this._sync(id);
  },

  addFriend(aId, bId) {
    if (aId === bId) return;
    const a = this.getUser(aId);
    const b = this.getUser(bId);
    if (!a || !b) return;
    if (!a.friends.includes(bId)) a.friends.push(bId);
    if (!b.friends.includes(aId)) b.friends.push(aId);
    this._sync(aId);
    this._sync(bId);
  },

  removeFriend(aId, bId) {
    const a = this.getUser(aId);
    const b = this.getUser(bId);
    if (a) a.friends = a.friends.filter((f) => f !== bId);
    if (b) b.friends = b.friends.filter((f) => f !== aId);
    if (a) this._sync(aId);
    if (b) this._sync(bId);
  },

  /* ---- Friend requests --------------------------------------------
     A request is a sender id parked in the recipient's `requestsIn`.
     Accepting turns it into a mutual friendship; rejecting/cancelling
     just drops it. ------------------------------------------------- */

  /* fromId asks toId to be friends. */
  sendRequest(fromId, toId) {
    if (fromId === toId) return;
    const from = this.getUser(fromId);
    const to = this.getUser(toId);
    if (!from || !to) return;
    if (from.friends.includes(toId)) return; // already friends
    // If they already asked me, treat this as accepting rather than stacking.
    if ((from.requestsIn || []).includes(toId)) return this.acceptRequest(fromId, toId);
    if (!Array.isArray(to.requestsIn)) to.requestsIn = [];
    if (!to.requestsIn.includes(fromId)) {
      to.requestsIn.push(fromId);
      this._sync(toId);
    }
  },

  /* meId accepts the pending request from fromId. */
  acceptRequest(meId, fromId) {
    const me = this.getUser(meId);
    if (!me || !(me.requestsIn || []).includes(fromId)) return;
    me.requestsIn = me.requestsIn.filter((x) => x !== fromId);
    this.addFriend(meId, fromId); // links both sides and syncs both (incl. my requestsIn)
  },

  /* meId declines the pending request from fromId. */
  rejectRequest(meId, fromId) {
    const me = this.getUser(meId);
    if (!me) return;
    me.requestsIn = (me.requestsIn || []).filter((x) => x !== fromId);
    this._sync(meId);
  },

  /* fromId withdraws a request they sent to toId. */
  cancelRequest(fromId, toId) {
    const to = this.getUser(toId);
    if (!to) return;
    to.requestsIn = (to.requestsIn || []).filter((x) => x !== fromId);
    this._sync(toId);
  },

  addTestimonial(targetId, fromId, text) {
    const t = this.getUser(targetId);
    if (!t) return;
    t.testimonials.unshift({
      from: fromId,
      date: new Date().toISOString().slice(0, 10),
      text,
    });
    this._sync(targetId);
  },

  // How long after posting a bulletin its author may still delete it.
  BULLETIN_DELETE_MS: 60 * 1000, // 1 minute

  addBulletin(userId, text, image, mix) {
    const u = this.getUser(userId);
    if (!u) return;
    u.bulletins.unshift({
      ts: Date.now(), // full timestamp; also the delete key
      date: new Date().toISOString().slice(0, 10),
      text,
      image: image || "",
      mix: mix || null,
    });
    this._sync(userId);
  },

  /* Author-only, time-limited bulletin delete. Returns true if it was
     removed, false if it's missing or the 1-minute window has passed. */
  deleteBulletin(userId, ts) {
    const u = this.getUser(userId);
    if (!u || !Array.isArray(u.bulletins)) return false;
    const b = u.bulletins.find((x) => x.ts === ts);
    if (!b || !b.ts || Date.now() - b.ts > this.BULLETIN_DELETE_MS) return false;
    u.bulletins = u.bulletins.filter((x) => x.ts !== ts);
    this._sync(userId);
    return true;
  },

  addSong(userId, song) {
    const u = this.getUser(userId);
    if (!u) return;
    if (!Array.isArray(u.songs)) u.songs = [];
    u.songs.push(song); // { id, title, artist }
    this._sync(userId);
  },

  removeSong(userId, songId) {
    const u = this.getUser(userId);
    if (!u) return;
    u.songs = (u.songs || []).filter((s) => s.id !== songId);
    this._sync(userId);
  },

  addMix(userId, mix) {
    const u = this.getUser(userId);
    if (!u) return;
    if (!Array.isArray(u.mixes)) u.mixes = [];
    u.mixes.unshift(mix); // { id, date, duration, deckA, deckB }
    this._sync(userId);
  },

  removeMix(userId, mixId) {
    const u = this.getUser(userId);
    if (!u) return;
    u.mixes = (u.mixes || []).filter((m) => m.id !== mixId);
    this._sync(userId);
  },
};

/* ---- Session API -------------------------------------------------
   The session pointer (who is logged in on this device) stays in
   localStorage; credentials are verified server-side.
   ------------------------------------------------------------------- */
const Session = {
  current() {
    const id = localStorage.getItem(SESSION_KEY);
    return id ? DB.getUser(id) : null;
  },
  async login(username, password) {
    const { user } = await api("POST", "/api/login", { username, password });
    // make sure the freshly-verified user is present in the cache
    const i = DB._cache.users.findIndex((u) => u.id === user.id);
    if (i === -1) DB._cache.users.push(user);
    else DB._cache.users[i] = user;
    localStorage.setItem(SESSION_KEY, user.id);
    return user;
  },
  logout() {
    localStorage.removeItem(SESSION_KEY);
  },
};
