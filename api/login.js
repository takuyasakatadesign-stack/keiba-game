const { setup, send, bodyJson, verifyPassword, signToken } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { send(res, 405, { error: "Method not allowed" }); return; }
  const ctx = await setup(req, res);
  if (!ctx) return;
  let body;
  try { body = await bodyJson(req); } catch { send(res, 400, { error: "入力が正しくありません" }); return; }
  const nameKey = String(body.name || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!nameKey || !password) { send(res, 400, { error: "名前とパスワードを入力してください" }); return; }
  const rows = await ctx.sql`SELECT display_name, pass_hash, salt, save, updated_at FROM accounts WHERE name_key = ${nameKey}`;
  if (!rows.length) { send(res, 401, { error: "名前またはパスワードが違います" }); return; }
  const row = rows[0];
  const ok = await verifyPassword(password, row.salt, row.pass_hash);
  if (!ok) { send(res, 401, { error: "名前またはパスワードが違います" }); return; }
  send(res, 200, {
    token: signToken(ctx.secret, nameKey),
    name: row.display_name,
    save: row.save,
    updatedAt: row.updated_at
  });
};
