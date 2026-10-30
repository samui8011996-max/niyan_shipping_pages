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

-- 已同步進包貨字卡的列(離島•郵局 / Line禮物 共用)。
-- 鍵值:離島用「訂單編號」(一張單一件);Line禮物用「商品訂單編號」(同一張訂單可能有好幾個
-- 品項列,每列各算一筆,跟字卡件數的定義一致)。沒有它的話,重新下載出貨表補幾張新單再按
-- 一次上傳,整批都會被重複累加(56 筆按兩次 = 112)。
-- 程式會 CREATE TABLE IF NOT EXISTS 就地建表,不必另外跑 migration。
-- 上面的 shipping_offshore_synced 是它的前身,2026-09-23 當天的離島紀錄還在那裡,
-- 所以離島去重時會多查它一次,不搬家。
CREATE TABLE IF NOT EXISTS shipping_card_synced (
  "日期" TEXT NOT NULL,
  "平台" TEXT NOT NULL,
  "鍵值" TEXT NOT NULL,
  "數量" INTEGER NOT NULL DEFAULT 1,
  "建立時間" TEXT,
  PRIMARY KEY ("日期", "平台", "鍵值")
);

-- 包裹退貨:2026-09-23 從 Google 試算表搬過來,舊試算表不再使用。
-- 舊表是「同一張工作表橫向並排三個平台區塊(line禮物 A、蝦皮 J、mo P)」,刪一筆要把
-- 底下整塊往上搬才不會錯開旁邊平台;搬到 D1 後一筆就是一列,平台只是一個欄位。
-- 蝦皮/mo 沒有電聯欄位,那四欄留空(三個平台共用同一張表)。
CREATE TABLE IF NOT EXISTS shipping_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "平台" TEXT NOT NULL,
  "日期" TEXT,
  "訂單編號" TEXT,
  "託運單號" TEXT,
  "原因" TEXT,
  "結果" TEXT,
  "第一次電聯" TEXT,
  "第二次電聯" TEXT,
  "第三次電聯" TEXT,
  "第四次電聯" TEXT,
  "建立時間" TEXT,
  "重寄託運單號" TEXT   -- 2026-10-16 加:退貨後重寄的託運單號(既有的表由 api.js 自動 ALTER 補上)
);
-- 同平台同訂單編號只會有一筆(重送是更新)。舊試算表的蝦皮/mo 有幾列根本沒填訂單編號,
-- 所以做成「訂單編號不是空的才唯一」的部分索引,不然那幾列會互相擋住匯不進來。
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_returns_key
  ON shipping_returns("平台","訂單編號") WHERE "訂單編號" <> '';

-- 雷雕訂單:2026-10-21 起取代「雷雕試算表」。出貨小幫手上傳時寫入,雷雕網站(niyan-laser-pages)直接讀。
-- 只存做圖需要的欄位,不存姓名/電話/地址。鍵值 = LINE「商品訂單編號」,重複上傳是更新。
-- 超過 14 天的資料由 api.js 在每次讀寫時刪掉。程式會 CREATE TABLE IF NOT EXISTS 就地建表。
CREATE TABLE IF NOT EXISTS laser_orders (
  "鍵值" TEXT PRIMARY KEY,
  "訂單編號" TEXT,
  "品項" TEXT,      -- 完整備註(雷雕網站從這裡抓星座/顏色/刻印圖案)
  "類型" TEXT,      -- 【一對小】【星座貓雷雕】【辦公室一對(中)】…
  "刻印文字" TEXT,
  "日期" TEXT,      -- 上傳日期 YYYY/MM/DD,雷雕網站「只生成指定日期」用
  "建立時間" TEXT NOT NULL
);

-- 雷雕參數參考表(功率/速度):雷雕網站「雷雕模擬」頁可新增/修改,存這裡。程式會 CREATE TABLE IF NOT EXISTS 就地建表,
-- 空表時自動塞預設兩列(一對小&星座貓 40/80、辦公室系列 30/50)。
CREATE TABLE IF NOT EXISTS laser_params (
  "排序" INTEGER NOT NULL,
  "名稱" TEXT NOT NULL,
  "功率" TEXT,
  "速度" TEXT
);

-- 星座貓X蛋糕(起士公爵出貨):2026-10-30 起。廠商直接出貨、不寫試算表,出貨小幫手上傳時寫入,
-- 統計字卡點開來看。只存訂單編號/品項/數量,不存姓名/電話/地址。鍵值 = LINE「商品訂單編號」。
-- 資料不會自動刪(使用者 2026-10-30)。程式會 CREATE TABLE IF NOT EXISTS 就地建表。
CREATE TABLE IF NOT EXISTS cake_orders (
  "鍵值" TEXT PRIMARY KEY,
  "訂單編號" TEXT,
  "品項" TEXT,      -- 星座貓X蛋糕 規格:天蠍-敢愛敢恨
  "數量" INTEGER NOT NULL DEFAULT 1,
  "日期" TEXT,      -- 上傳日期 YYYY/MM/DD
  "建立時間" TEXT NOT NULL
);
