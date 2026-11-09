const { setup, send, authName } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { send(res, 405, { error: "Method not allowed" }); return; }
  const ctx = await setup(req, res);
  if (!ctx) return;
  const nameKey = await authName(req, res, ctx);
  if (!nameKey) return;
  const rows = await ctx.sql`SELECT save, updated_at FROM accounts WHERE name_key = ${nameKey}`;
  if (!rows.length) { send(res, 401, { error: "ログインが必要です" }); return; }
  send(res, 200, { save: rows[0].save, updatedAt: rows[0].updated_at });
};
