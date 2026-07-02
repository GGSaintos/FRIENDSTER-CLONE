/* ============================================================
   Friendster Clone — database layer (Postgres)
   One row per user: { id, username, data(jsonb) }.
   `data` holds the same shape the client already uses.
   ============================================================ */
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "\n  [db] DATABASE_URL is not set — the API will fail until you provide one.\n" +
      "      Locally:  DATABASE_URL=postgres://user:pass@localhost:5432/friendster node server.js\n"
  );
}

// Managed Postgres (Render/Neon/Supabase) needs SSL; local Postgres does not.
const isLocal =
  !connectionString ||
  /@(localhost|127\.0\.0\.1)/.test(connectionString) ||
  process.env.PGSSL === "off";

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id       TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      data     JSONB NOT NULL
    );
  `);
}

/* Strip secrets before anything leaves the server. */
function publicUser(data) {
  const { password, ...rest } = data || {};
  return rest;
}

async function count() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  return rows[0].n;
}

/* Full world for rendering — passwords removed. */
async function getState() {
  const { rows } = await pool.query("SELECT data FROM users ORDER BY data->>'joined'");
  return { users: rows.map((r) => publicUser(r.data)) };
}

/* Insert seed users only if the world is currently empty. Idempotent. */
async function seed(users) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, username, data)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, String(u.username).toLowerCase(), u]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return getState();
}

/* Create a brand-new user; throws a tagged error on duplicate username. */
async function createUser(user) {
  try {
    await pool.query(
      `INSERT INTO users (id, username, data) VALUES ($1, $2, $3)`,
      [user.id, String(user.username).toLowerCase(), user]
    );
  } catch (e) {
    if (e.code === "23505") {
      const err = new Error("That username is already taken.");
      err.status = 409;
      throw err;
    }
    throw e;
  }
  return publicUser(user);
}

/* Replace one user's data (used for every mutation to that user).
   The public API strips passwords from every user object it hands out
   (see publicUser), so a client PATCH almost never carries one. Never
   let that blank out the stored credential — merge the existing
   password back in whenever the incoming data doesn't include it. */
async function putUser(id, data) {
  if (data && data.password == null) {
    const { rows } = await pool.query(
      "SELECT data->>'password' AS pw FROM users WHERE id = $1",
      [id]
    );
    const pw = rows[0] && rows[0].pw;
    if (pw != null) data = { ...data, password: pw };
  }
  await pool.query(
    `UPDATE users SET username = $2, data = $3 WHERE id = $1`,
    [id, String(data.username).toLowerCase(), data]
  );
}

/* Verify credentials server-side; returns the public user or null. */
async function login(username, password) {
  const { rows } = await pool.query(
    "SELECT data FROM users WHERE username = $1",
    [String(username).toLowerCase()]
  );
  const u = rows[0] && rows[0].data;
  if (!u || u.password !== password) return null;
  return publicUser(u);
}

/* Wipe and re-seed — powers the "reset demo data" button. */
async function reset(users) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE users");
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, username, data) VALUES ($1, $2, $3)`,
        [u.id, String(u.username).toLowerCase(), u]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return getState();
}

module.exports = { init, count, getState, seed, createUser, putUser, login, reset };
