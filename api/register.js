const { setup, send, bodyJson, hashPassword, newSalt, signToken } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { send(res, 405, { error: "Method not allowed" }); return; }
  const ctx = await setup(req, res);
  if (!ctx) return;
  let body;
  try { body = await bodyJson(req); } catch { send(res, 400, { error: "入力が正しくありません" }); return; }
  const displayName = String(body.name || "").trim();
  const password = String(body.password || "");
  if (displayName.length < 1 || displayName.length > 32) { send(res, 400, { error: "名前は1〜32文字で入力してください" }); return; }
  if (password.length < 4 || password.length > 128) { send(res, 400, { error: "パスワードは4文字以上で入力してください" }); return; }
  const nameKey = displayName.toLowerCase();
  const existing = await ctx.sql`SELECT name_key FROM accounts WHERE name_key = ${nameKey}`;
  if (existing.length) { send(res, 409, { error: "その名前は既に使われています" }); return; }
  const salt = newSalt();
  const passHash = await hashPassword(password, salt);
  await ctx.sql`INSERT INTO accounts (name_key, display_name, pass_hash, salt) VALUES (${nameKey}, ${displayName}, ${passHash}, ${salt})`;
  send(res, 200, { token: signToken(ctx.secret, nameKey), name: displayName });
};
