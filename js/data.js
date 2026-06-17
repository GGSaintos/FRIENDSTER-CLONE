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

/* ---- Storage API ------------------------------------------------- */
const DB = {
  load() {
    let raw = localStorage.getItem(DB_KEY);
    if (!raw) {
      const seeded = seedDB();
      localStorage.setItem(DB_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const db = JSON.parse(raw);
    // normalize older records that predate the music feature
    db.users.forEach((u) => {
      if (!Array.isArray(u.songs)) u.songs = [];
      if (typeof u.autoplay !== "boolean") u.autoplay = true;
      if (typeof u.bgColor !== "string") u.bgColor = "";
      if (typeof u.bgImage !== "string") u.bgImage = "";
    });
    return db;
  },
  save(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  },
  reset() {
    localStorage.removeItem(DB_KEY);
    localStorage.removeItem(SESSION_KEY);
  },

  getUser(id) {
    return this.load().users.find((u) => u.id === id) || null;
  },
  getUserByUsername(username) {
    return (
      this.load().users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase()
      ) || null
    );
  },
  allUsers() {
    return this.load().users;
  },

  createUser(fields) {
    const db = this.load();
    if (this.getUserByUsername(fields.username)) {
      throw new Error("That username is already taken.");
    }
    const id = "u" + (db.users.length + 1) + "_" + Date.now();
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
      testimonials: [],
      bulletins: [],
      songs: [],
      autoplay: true,
      bgColor: "",
      bgImage: "",
    };
    db.users.push(user);
    // Tom adds them back
    const tom = db.users.find((u) => u.id === "u1");
    if (tom && !tom.friends.includes(id)) tom.friends.push(id);
    this.save(db);
    return user;
  },

  updateUser(id, fields) {
    const db = this.load();
    const u = db.users.find((x) => x.id === id);
    if (!u) return;
    Object.assign(u, fields);
    this.save(db);
  },

  addFriend(aId, bId) {
    if (aId === bId) return;
    const db = this.load();
    const a = db.users.find((u) => u.id === aId);
    const b = db.users.find((u) => u.id === bId);
    if (!a || !b) return;
    if (!a.friends.includes(bId)) a.friends.push(bId);
    if (!b.friends.includes(aId)) b.friends.push(aId);
    this.save(db);
  },

  removeFriend(aId, bId) {
    const db = this.load();
    const a = db.users.find((u) => u.id === aId);
    const b = db.users.find((u) => u.id === bId);
    if (a) a.friends = a.friends.filter((f) => f !== bId);
    if (b) b.friends = b.friends.filter((f) => f !== aId);
    this.save(db);
  },

  addTestimonial(targetId, fromId, text) {
    const db = this.load();
    const t = db.users.find((u) => u.id === targetId);
    if (!t) return;
    t.testimonials.unshift({
      from: fromId,
      date: new Date().toISOString().slice(0, 10),
      text,
    });
    this.save(db);
  },

  addBulletin(userId, text) {
    const db = this.load();
    const u = db.users.find((x) => x.id === userId);
    if (!u) return;
    u.bulletins.unshift({
      date: new Date().toISOString().slice(0, 10),
      text,
    });
    this.save(db);
  },

  addSong(userId, song) {
    const db = this.load();
    const u = db.users.find((x) => x.id === userId);
    if (!u) return;
    if (!Array.isArray(u.songs)) u.songs = [];
    u.songs.push(song); // { id, title, artist }
    this.save(db);
  },

  removeSong(userId, songId) {
    const db = this.load();
    const u = db.users.find((x) => x.id === userId);
    if (!u) return;
    u.songs = (u.songs || []).filter((s) => s.id !== songId);
    this.save(db);
  },
};

/* ---- Session API ------------------------------------------------- */
const Session = {
  current() {
    const id = localStorage.getItem(SESSION_KEY);
    return id ? DB.getUser(id) : null;
  },
  login(username, password) {
    const u = DB.getUserByUsername(username);
    if (!u || u.password !== password) {
      throw new Error("Invalid username or password.");
    }
    localStorage.setItem(SESSION_KEY, u.id);
    return u;
  },
  logout() {
    localStorage.removeItem(SESSION_KEY);
  },
};
