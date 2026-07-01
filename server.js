/* Friendster clone server: serves the static app AND a small JSON API
   backed by Postgres, so the whole world is shared between friends. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
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

/* Proxy a remote audio file so the browser can decode it without CORS.
   Basic SSRF guard + size/type limits — this is a hobby app, not a
   hardened open proxy. */
const MAX_AUDIO_BYTES = 60 * 1024 * 1024; // 60 MB (longer tracks/mixes)
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) ||
    h === "::1"
  );
}
async function fetchAudio(target, res) {
  let url;
  try {
    url = new URL(target);
  } catch (e) {
    return sendJSON(res, 400, { error: "Provide a valid audio URL." });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return sendJSON(res, 400, { error: "Only http(s) URLs are allowed." });
  }
  if (isBlockedHost(url.hostname)) {
    return sendJSON(res, 400, { error: "That host isn't allowed." });
  }
  let upstream;
  try {
    upstream = await fetch(url.href, {
      redirect: "follow",
      headers: { "User-Agent": "beefriend-mixer/1.0", Accept: "audio/*,*/*" },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return sendJSON(res, 502, { error: "Couldn't reach that URL." });
  }
  if (!upstream.ok) {
    return sendJSON(res, 502, { error: `Remote returned ${upstream.status}.` });
  }
  const type = upstream.headers.get("content-type") || "application/octet-stream";
  if (/^(text|application\/(json|xml|xhtml|javascript)|image)/i.test(type)) {
    return sendJSON(res, 415, {
      error: "That link isn't a direct audio file (a YouTube page won't work — use a direct .mp3/.wav link).",
    });
  }
  const len = Number(upstream.headers.get("content-length") || 0);
  if (len && len > MAX_AUDIO_BYTES) {
    return sendJSON(res, 413, { error: "That audio file is too large (max 30 MB)." });
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.length > MAX_AUDIO_BYTES) {
    return sendJSON(res, 413, { error: "That audio file is too large (max 30 MB)." });
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length });
  res.end(buf);
}

/* Extract audio from a video page (YouTube, etc.) with yt-dlp + ffmpeg.
   LOCAL USE ONLY: yt-dlp/ffmpeg must be installed, it won't work on hosts
   whose IPs YouTube blocks (Render), and it is against YouTube's ToS. */
function ytAudio(target, res) {
  let url;
  try {
    url = new URL(target);
  } catch (e) {
    return sendJSON(res, 400, { error: "Provide a valid video URL." });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return sendJSON(res, 400, { error: "Only http(s) URLs are allowed." });
  }
  if (isBlockedHost(url.hostname)) {
    return sendJSON(res, 400, { error: "That host isn't allowed." });
  }
  const id = crypto.randomBytes(8).toString("hex");
  const outTmpl = path.join(os.tmpdir(), `bf_${id}.%(ext)s`);
  const outMp3 = path.join(os.tmpdir(), `bf_${id}.mp3`);
  const infoPath = path.join(os.tmpdir(), `bf_${id}.info.json`);
  const cleanup = () => {
    fs.readdir(os.tmpdir(), (e, files) => {
      if (e) return;
      files
        .filter((f) => f.startsWith(`bf_${id}.`))
        .forEach((f) => fs.unlink(path.join(os.tmpdir(), f), () => {}));
    });
  };
  const args = [
    "-x", "--audio-format", "mp3", "--audio-quality", "5",
    "--no-playlist", "--no-progress", "--write-info-json",
    "-o", outTmpl, url.href,
  ];
  console.log(`[yt] extracting: ${url.href}`);
  execFile("yt-dlp", args, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      console.error(`[yt] FAILED ${url.href}\n${String(stderr || err.message).slice(-500)}`);
      cleanup();
      if (err.code === "ENOENT") {
        return sendJSON(res, 501, {
          error: "YouTube import needs yt-dlp installed — it only works when running locally.",
        });
      }
      const tail = String(stderr || err.message).split("\n").filter(Boolean).slice(-2).join(" ");
      const blocked = /Sign in|not a bot|unavailable|Private|blocked|age/i.test(tail);
      return sendJSON(res, 502, {
        error: blocked
          ? "YouTube refused this video (blocked, private, or bot-check). Try another link or run locally."
          : "Extraction failed: " + tail.slice(0, 240),
      });
    }
    fs.readFile(outMp3, (rerr, data) => {
      // read title + thumbnail from the info json before cleanup
      let title = "", thumb = "";
      try {
        const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
        title = info.title || "";
        thumb = info.thumbnail || "";
      } catch (e) {}
      cleanup();
      if (rerr) return sendJSON(res, 502, { error: "Could not read the extracted audio." });
      if (data.length > MAX_AUDIO_BYTES) {
        return sendJSON(res, 413, { error: "That track is too long (over 60 MB of audio)." });
      }
      console.log(`[yt] ok: ${title || url.href} (${(data.length / 1048576).toFixed(1)} MB)`);
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": data.length,
        // header values must be ASCII — URL-encode; the client decodes.
        "X-Video-Title": encodeURIComponent(title),
        "X-Video-Thumbnail": encodeURIComponent(thumb),
      });
      res.end(data);
    });
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

  // GET /api/fetch-audio?url=... -> proxy a remote audio file (avoids CORS)
  if (method === "GET" && urlPath === "/api/fetch-audio") {
    const target = new URL(req.url, "http://localhost").searchParams.get("url");
    return fetchAudio(target, res);
  }

  // GET /api/youtube-audio?url=... -> extract audio via yt-dlp (local only)
  if (method === "GET" && urlPath === "/api/youtube-audio") {
    const target = new URL(req.url, "http://localhost").searchParams.get("url");
    return ytAudio(target, res);
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
  // Liveness probe for Render — cheap, never touches the database.
  if (urlPath === "/healthz") {
    return sendJSON(res, 200, { status: "ok" });
  }
  if (urlPath.startsWith("/api/")) {
    try {
      await handleApi(req, res, urlPath);
    } catch (e) {
      // Log the real cause so it shows up in the Render logs, but only
      // leak a safe message to the browser.
      console.error(`[api] ${req.method} ${urlPath} failed:`, e);
      const status = e.status || 500;
      const message = status === 500 ? "Server error — check the server logs." : e.message;
      sendJSON(res, status, { error: message });
    }
    return;
  }
  serveStatic(res, urlPath);
});

// Start listening right away so the /healthz probe passes even while the
// database is still coming up; initialize the schema in the background.
server.listen(PORT, () => {
  console.log(`\n  friendster clone running at  http://localhost:${PORT}\n  press Ctrl+C to stop\n`);
});

function describeError(e) {
  // Node throws an AggregateError (with an empty message) when it can't
  // reach a host on any address — the real reasons live in e.errors.
  if (e && Array.isArray(e.errors) && e.errors.length) {
    return e.errors.map((x) => x.message || x.code || String(x)).join("; ");
  }
  return e && (e.message || e.code) ? `${e.message || ""}${e.code ? " (" + e.code + ")" : ""}` : String(e);
}

async function initDb(attempt = 1) {
  if (attempt === 1 && !process.env.DATABASE_URL) {
    console.error("  DATABASE_URL is not set — no database is configured for this service.");
  }
  try {
    await db.init();
    console.log("  database ready");
  } catch (e) {
    console.error(`  database init failed (attempt ${attempt}): ${describeError(e)}`);
    if (attempt < 10) setTimeout(() => initDb(attempt + 1), 3000);
  }
}
initDb();
