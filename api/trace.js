// 段階ビーコンの受け口（アカウント処理の切り分け用・追記専用ログ）。
//
// ゲーム側 acctTraceBeacon の契約：
//   ・POST /api/trace ― body は JSON 文字列 {stage, at, lite}（text/plain）
//   ・GET  /api/trace?s=<stage>&t=<at> ― 画像ビーコンのフォールバック
//   ・GET  /api/trace?recent=1 ― 保存済み記録の確認（新しい順・最大100件）
//
// 端末内（localStorage／Cookie）に残らなかった段階をサーバー側で追える
// ようにするためのもので、accounts とは別の追記専用テーブル acct_trace に
// 1件ずつ INSERT するだけ。認証は付けない（段階名と時刻だけの無害な
// 診断データで、クライアントは応答を見ない前提）。
// DB 接続は既存の api/_lib.js の db() を再利用する。
const { db, send, bodyJson } = require("./_lib");

let _ready = null;
function readyTrace(sql) {
  if (!_ready) {
    _ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS acct_trace (
        id BIGSERIAL PRIMARY KEY,
        stage TEXT NOT NULL,
        at_ms BIGINT,
        lite INT,
        ua TEXT,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    })().catch((e) => { _ready = null; throw e; });
  }
  return _ready;
}

const GIF_1PX = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function cleanStage(v) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
}
function cleanAt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

module.exports = async function handler(req, res) {
  const sql = db();
  if (!sql) { send(res, 503, { error: "データベースが未設定です" }); return; }
  try {
    await readyTrace(sql);
  } catch (e) {
    send(res, 500, { error: "サーバーエラーが発生しました" });
    return;
  }
  const url = new URL(req.url, "http://localhost");
  const ua = String(req.headers["user-agent"] || "").slice(0, 200);

  try {
    if (req.method === "POST") {
      let data = {};
      try { data = await bodyJson(req); } catch (e) { data = {}; }
      const stage = cleanStage(data && data.stage);
      if (!stage) { send(res, 400, { error: "stage が必要です" }); return; }
      const at = cleanAt(data.at);
      const lite = data.lite ? 1 : 0;
      await sql`INSERT INTO acct_trace (stage, at_ms, lite, ua) VALUES (${stage}, ${at}, ${lite}, ${ua})`;
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === "GET") {
      const s = url.searchParams.get("s");
      if (s != null && s !== "") {
        // 画像フォールバック：記録して 1x1 GIF を返す
        const stage = cleanStage(s);
        if (stage) {
          const at = cleanAt(url.searchParams.get("t"));
          await sql`INSERT INTO acct_trace (stage, at_ms, lite, ua) VALUES (${stage}, ${at}, ${0}, ${ua})`;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/gif");
        res.setHeader("Cache-Control", "no-store");
        res.end(GIF_1PX);
        return;
      }
      // 記録の確認：新しい順に最大100件
      const rows = await sql`SELECT stage, at_ms, lite, received_at FROM acct_trace ORDER BY id DESC LIMIT 100`;
      send(res, 200, {
        records: rows.map((r) => ({
          stage: r.stage,
          at: r.at_ms != null ? Number(r.at_ms) : null,
          lite: r.lite,
          receivedAt: r.received_at,
        })),
      });
      return;
    }
    send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    send(res, 500, { error: "サーバーエラーが発生しました" });
  }
};
