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

-- 離島已同步清單:哪幾張離島訂單的件數已經填進包貨系統的「離島•郵局」字卡。
-- 重新下載出貨表、補幾張新單後再按一次一鍵上傳是日常操作,沒有這張表的話字卡會被
-- 整批重複累加(3 件按兩次變 6 件)。key 是「日期 + 訂單編號」——
-- 同一張單隔天真的又出一次(補寄)還是算新的一筆,不會被吃掉。
CREATE TABLE IF NOT EXISTS shipping_offshore_synced (
  "日期" TEXT NOT NULL,
  "訂單編號" TEXT NOT NULL,
  "件數" INTEGER NOT NULL DEFAULT 1,
  "建立時間" TEXT,
  PRIMARY KEY ("日期", "訂單編號")
);
