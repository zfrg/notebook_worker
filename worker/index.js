const SALT = "notebook-salt-2026";

// ---- Auto-migration: runs on first D1 access ----
let dbInitialized = false;

async function ensureDB(db) {
  if (dbInitialized) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    userId INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    userId INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  )`).run();
  try {
    await db.prepare("ALTER TABLE notes ADD COLUMN userId INTEGER NOT NULL DEFAULT 0").run();
  } catch (e) {
    // Column already exists on existing databases, ignore
  }
  dbInitialized = true;
}
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function hashPassword(password) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(password + SALT));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  return crypto.randomUUID();
}

async function getAuthUser(env, request) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (env.DB) {
    const row = await env.DB.prepare("SELECT userId FROM sessions WHERE token = ?").bind(token).first();
    return row ? row.userId : null;
  }
  if (env.KV) {
    const raw = await env.KV.get(`session:${token}`);
    if (!raw) return null;
    return JSON.parse(raw).userId;
  }
  return null;
}

// ---- D1 auth ----

async function registerD1(db, username, pw) {
  const existing = await db.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) throw new Error("Username already exists");
  await db.prepare("INSERT INTO users (username, password, createdAt) VALUES (?, ?, ?)")
    .bind(username, pw, Date.now()).run();
  const user = await db.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  const token = generateToken();
  await db.prepare("INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)")
    .bind(token, user.id, Date.now()).run();
  return token;
}

async function loginD1(db, username, pw) {
  const user = await db.prepare("SELECT id FROM users WHERE username = ? AND password = ?")
    .bind(username, pw).first();
  if (!user) throw new Error("Invalid username or password");
  const token = generateToken();
  await db.prepare("INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)")
    .bind(token, user.id, Date.now()).run();
  return token;
}

async function logoutD1(db, token) {
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

// ---- KV auth ----

async function registerKV(kv, username, pw) {
  const existing = await kv.get(`user:${username}`);
  if (existing) throw new Error("Username already exists");
  await kv.put(`user:${username}`, JSON.stringify({ password: pw, createdAt: Date.now() }));
  const token = generateToken();
  await kv.put(`session:${token}`, JSON.stringify({ userId: username, createdAt: Date.now() }), {
    expirationTtl: 604800,
  });
  return token;
}

async function loginKV(kv, username, pw) {
  const raw = await kv.get(`user:${username}`);
  if (!raw) throw new Error("Invalid username or password");
  const user = JSON.parse(raw);
  if (user.password !== pw) throw new Error("Invalid username or password");
  const token = generateToken();
  await kv.put(`session:${token}`, JSON.stringify({ userId: username, createdAt: Date.now() }), {
    expirationTtl: 604800,
  });
  return token;
}

async function logoutKV(kv, token) {
  await kv.delete(`session:${token}`);
}

// ---- D1 notes ----

async function getAllNotesD1(db, userId) {
  const { results } = await db
    .prepare("SELECT id, title, content, createdAt FROM notes WHERE userId = ? ORDER BY createdAt DESC")
    .bind(userId)
    .all();
  return results;
}

async function updateNoteD1(db, userId, id, note) {
  await db
    .prepare("INSERT OR REPLACE INTO notes (id, userId, title, content, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(id, userId, note.title, note.content, note.createdAt || Date.now())
    .run();
  return { ...note, id };
}

async function deleteNoteD1(db, userId, id) {
  await db.prepare("DELETE FROM notes WHERE id = ? AND userId = ?").bind(id, userId).run();
}

// ---- KV notes ----

async function getAllNotesKV(kv, userId) {
  const raw = await kv.get(`notes:${userId}`, "json");
  return Array.isArray(raw) ? raw : [];
}

async function updateNoteKV(kv, userId, id, note) {
  const notes = await getAllNotesKV(kv, userId);
  const idx = notes.findIndex((n) => n.id === id);
  if (idx !== -1) {
    notes[idx] = { ...notes[idx], title: note.title, content: note.content };
  } else {
    notes.push({ id, title: note.title, content: note.content, createdAt: note.createdAt || Date.now() });
  }
  await kv.put(`notes:${userId}`, JSON.stringify(notes));
  return { ...note, id };
}

async function deleteNoteKV(kv, userId, id) {
  const notes = await getAllNotesKV(kv, userId);
  await kv.put(`notes:${userId}`, JSON.stringify(notes.filter((n) => n.id !== id)));
}

// ---- Request handler ----

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const { method } = request;

  const ALLOW_REGISTRATION = env.ALLOW_REGISTRATION !== "false";
  const API_BASE = env.API_BASE || "";

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Inject config into HTML for SPA
  if (method === "GET" && url.pathname !== "/api/config" && !url.pathname.startsWith("/api/")) {
    const response = await env.ASSETS.fetch(request);
    if (response.headers.get("Content-Type")?.includes("text/html")) {
      const body = await response.text();
      const configScript = `<script>window.__CONFIG__ = ${JSON.stringify({ API_BASE, ALLOW_REGISTRATION: env.ALLOW_REGISTRATION !== "false" })}</script>`;
      const injected = body.replace("</head>", `${configScript}</head>`);
      return new Response(injected, response);
    }
    return response;
  }

  try {
    if (env.DB) await ensureDB(env.DB);
    // Auth routes
    if (url.pathname === "/api/auth/register" && method === "POST") {
      if (env.ALLOW_REGISTRATION === "false") {
        return json({ error: "Registration is disabled" }, 403);
      }
      const { username, password } = await request.json();
      if (!username || !password) return json({ error: "Username and password required" }, 400);
      if (password.length < 4) return json({ error: "Password must be at least 4 characters" }, 400);
      const pw = await hashPassword(password);
      const token = env.DB ? await registerD1(env.DB, username, pw) : await registerKV(env.KV, username, pw);
      return json({ token }, 201);
    }

    if (url.pathname === "/api/auth/login" && method === "POST") {
      const { username, password } = await request.json();
      if (!username || !password) return json({ error: "Username and password required" }, 400);
      const pw = await hashPassword(password);
      const token = env.DB ? await loginD1(env.DB, username, pw) : await loginKV(env.KV, username, pw);
      return json({ token });
    }

    if (url.pathname === "/api/auth/logout" && method === "POST") {
      const auth = request.headers.get("Authorization");
      if (!auth || !auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const token = auth.slice(7);
      if (env.DB) await logoutD1(env.DB, token);
      else await logoutKV(env.KV, token);
      return json({ ok: true });
    }

    // Protected notes routes
    const userId = await getAuthUser(env, request);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    if (url.pathname === "/api/notes" && method === "GET") {
      const notes = env.DB ? await getAllNotesD1(env.DB, userId) : await getAllNotesKV(env.KV, userId);
      return json(notes);
    }

    const match = url.pathname.match(/^\/api\/notes\/(\d+)$/);
    if (match) {
      const id = Number(match[1]);

      if (method === "PUT") {
        const note = await request.json();
        const updated = env.DB ? await updateNoteD1(env.DB, userId, id, note) : await updateNoteKV(env.KV, userId, id, note);
        return json(updated);
      }

      if (method === "DELETE") {
        if (env.DB) await deleteNoteD1(env.DB, userId, id);
        else await deleteNoteKV(env.KV, userId, id);
        return new Response(null, { status: 204, headers: corsHeaders });
      }
    }

    return json({ error: "Not Found" }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
