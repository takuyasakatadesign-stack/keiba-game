// Shared helpers for the account API (not a route: underscore-prefixed).
const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

let _sql = null;
function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  if (!_sql) _sql = neon(url);
  return _sql;
}

let _ready = null;
function ready(sql) {
  if (!_ready) {
    _ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS accounts (
        name_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        save JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`;
    })().catch((e) => { _ready = null; throw e; });
  }
  return _ready;
}

async function getSecret(sql) {
  const rows = await sql`SELECT value FROM meta WHERE key = 'auth_secret'`;
  if (rows.length) return rows[0].value;
  const secret = crypto.randomBytes(32).toString("hex");
  await sql`INSERT INTO meta (key, value) VALUES ('auth_secret', ${secret}) ON CONFLICT (key) DO NOTHING`;
  const again = await sql`SELECT value FROM meta WHERE key = 'auth_secret'`;
  return again[0].value;
}

// Password hashing: scrypt with a per-user salt.
function hashPassword(password, saltHex) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, Buffer.from(saltHex, "hex"), 64, (err, key) => {
      if (err) reject(err); else resolve(key.toString("hex"));
    });
  });
}
function newSalt() { return crypto.randomBytes(16).toString("hex"); }

function verifyPassword(password, saltHex, expectedHex) {
  return hashPassword(password, saltHex).then((actualHex) => {
    const a = Buffer.from(actualHex, "hex");
    const b = Buffer.from(expectedHex, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

// Session tokens: base64url(payload).base64url(HMAC-SHA256(payload)).
function b64u(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signToken(secret, nameKey) {
  const payload = b64u(JSON.stringify({ n: nameKey, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }));
  const sig = b64u(crypto.createHmac("sha256", secret).update(payload).digest());
  return payload + "." + sig;
}
function verifyToken(secret, token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = b64u(crypto.createHmac("sha256", secret).update(payload).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch { return null; }
  if (!data.n || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
  return data.n;
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

async function bodyJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
}

// Common preamble: returns {sql, secret} or sends an error and returns null.
async function setup(req, res) {
  const sql = db();
  if (!sql) { send(res, 503, { error: "データベースが未設定です" }); return null; }
  try {
    await ready(sql);
    const secret = await getSecret(sql);
    return { sql, secret };
  } catch (e) {
    send(res, 500, { error: "サーバーエラーが発生しました" });
    return null;
  }
}

async function authName(req, res, ctx) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const nameKey = verifyToken(ctx.secret, token);
  if (!nameKey) { send(res, 401, { error: "ログインが必要です" }); return null; }
  return nameKey;
}

module.exports = { db, ready, getSecret, hashPassword, newSalt, verifyPassword, signToken, verifyToken, send, bodyJson, setup, authName };
