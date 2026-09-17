-- 出貨小幫手自己的資料表(其餘 niyan-db 的表由包貨/製造/零用金 App 管理)
--
-- 問題訂單:2026-09-17 從 Google 試算表搬過來,舊試算表不再使用。
-- 「訂單編號」設 UNIQUE,因為同一張單只會有一筆問題紀錄(重送是更新不是新增)。
CREATE TABLE IF NOT EXISTS shipping_problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "訂單編號" TEXT NOT NULL UNIQUE,
  "問題類別" TEXT,
  "備註" TEXT,
  "建立時間" TEXT
);
