/* Friendster clone server: serves the static app AND a small JSON API
   backed by Postgres, so the whole world is shared between friends. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const db = require("./db");

const PORT = process.env.PORT || 8088;
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 5e6) reject(new Error("payload too large")); // ~5MB guard
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/* ---- API ---------------------------------------------------------- */
async function handleApi(req, res, urlPath) {
  const method = req.method;

  // GET /api/state  -> whole world (no passwords)
  if (method === "GET" && urlPath === "/api/state") {
    return sendJSON(res, 200, await db.getState());
  }

  // POST /api/seed  -> seed the world only if it is empty
  if (method === "POST" && urlPath === "/api/seed") {
    const body = await readBody(req);
    return sendJSON(res, 200, await db.seed(body.users || []));
  }

  // POST /api/login -> { username, password } -> user | 401
  if (method === "POST" && urlPath === "/api/login") {
    const { username, password } = await readBody(req);
    const user = await db.login(username, password);
    if (!user) return sendJSON(res, 401, { error: "Invalid username or password." });
    return sendJSON(res, 200, { user });
  }

  // POST /api/users -> create one user
  if (method === "POST" && urlPath === "/api/users") {
    const body = await readBody(req);
    const user = await db.createUser(body.user);
    return sendJSON(res, 201, { user });
  }

  // PATCH /api/users/:id -> replace one user's data
  const m = urlPath.match(/^\/api\/users\/([^/]+)$/);
  if (method === "PATCH" && m) {
    const body = await readBody(req);
    await db.putUser(decodeURIComponent(m[1]), body.user);
    return sendJSON(res, 200, { ok: true });
  }

  // POST /api/reset -> wipe + re-seed
  if (method === "POST" && urlPath === "/api/reset") {
    const body = await readBody(req);
    return sendJSON(res, 200, await db.reset(body.users || []));
  }

  return sendJSON(res, 404, { error: "Unknown API route" });
}

/* ---- Static files (with SPA fallback to index.html) --------------- */
function serveStatic(res, urlPath) {
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // fall back to the app shell so hash routes still load
      return fs.readFile(path.join(ROOT, "index.html"), (e2, shell) => {
        if (e2) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          return res.end("404 Not Found");
        }
        res.writeHead(200, { "Content-Type": TYPES[".html"] });
        res.end(shell);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath.startsWith("/api/")) {
    try {
      await handleApi(req, res, urlPath);
    } catch (e) {
      sendJSON(res, e.status || 500, { error: e.message || "Server error" });
    }
    return;
  }
  serveStatic(res, urlPath);
});

db.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n  friendster clone running at  http://localhost:${PORT}\n  press Ctrl+C to stop\n`);
    });
  })
  .catch((e) => {
    console.error("Failed to initialize database:", e.message);
    process.exit(1);
  });
