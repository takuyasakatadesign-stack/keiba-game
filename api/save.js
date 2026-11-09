const { setup, send, bodyJson, authName } = require("./_lib");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { send(res, 405, { error: "Method not allowed" }); return; }
  const ctx = await setup(req, res);
  if (!ctx) return;
  const nameKey = await authName(req, res, ctx);
  if (!nameKey) return;
  let body;
  try { body = await bodyJson(req); } catch { send(res, 400, { error: "入力が正しくありません" }); return; }
  const save = body.save;
  if (!save || typeof save !== "object") { send(res, 400, { error: "セーブデータがありません" }); return; }
  if (JSON.stringify(save).length > 2 * 1024 * 1024) { send(res, 413, { error: "セーブデータが大きすぎます" }); return; }
  const rows = await ctx.sql`UPDATE accounts SET save = ${JSON.stringify(save)}::jsonb, updated_at = now() WHERE name_key = ${nameKey} RETURNING updated_at`;
  if (!rows.length) { send(res, 401, { error: "ログインが必要です" }); return; }
  send(res, 200, { ok: true, updatedAt: rows[0].updated_at });
};
