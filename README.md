# 出貨小幫手 V6(Cloudflare Pages 版)

LINE 禮物訂單分類、廠商試算表自動上傳、物流對單、問題訂單、包裹退貨、分區列印。

---

## 架構

```
瀏覽器 ──► Cloudflare Pages(這個 repo)
              ├─ 靜態前端 index.html + *.js
              └─ functions/api.js  ← 唯一的後端入口 /api
                    ├─ 填包貨字卡 ──────────► D1「niyan-db」platform_orders(直接寫,很快)
                    ├─ 問題訂單 ────────────► D1「niyan-db」shipping_problems(直接寫,很快)
                    └─ 寫 Google 試算表 ────► Apps Script(Code.gs)──► 同事看的那幾張試算表
```

搬家前是「前端(GitHub Pages)→ Apps Script → 試算表 + 包貨系統」,
搬家後把「填包貨字卡」這段從 Apps Script 拿掉,改由 Cloudflare 直接寫 D1,
少一趟跨專案往返,上傳明顯變快。**寫試算表的部分完全沒動,同事那邊無感。**

| 東西 | 放哪 |
|---|---|
| 前端 + Pages Function | 這個 repo,推 `main` 自動部署 |
| D1 資料庫 `niyan-db` | `wrangler.toml` 的 `[[d1_databases]]`,Pages Git 部署會自動綁,不用去後台設定 |
| Apps Script `/exec` 網址 | Cloudflare Pages 專案的環境變數 `GS_URL`(沒設就用 `functions/api.js` 裡的預設值) |
| 各試算表「點字卡開啟」的網址 | 寫死在 `sheet-sync.js` 的 `SHEET_URLS`,不再開放設定 |
| 深色/淺色偏好 | 瀏覽器 `localStorage`(`niyan_theme`,⚙ 設定裡切換) |
| Logo | 內嵌在 `index.html` 的 SVG(從 `LOGO.png` 描出來的向量版),漸層吃 `--logo-1`/`--logo-2` 兩個變數。扳手是 `fill-rule="evenodd"` 的鏤空,所以深淺兩種模式都不用換圖。`LOGO.png` 留著當原始素材,頁面已經沒在用了 |
| 試算表 ID | `Code.gs` 裡的 `SHEETS` |

---

## 後端動作一覽(`POST /api`)

| action | 誰處理 | 做什麼 |
|---|---|---|
| `uploadLineRegular` | Cloudflare(D1) | 一般訂單筆數累加進包貨系統當天「Line禮物(黑貓)」平台字卡 |
| `append` | Apps Script + Cloudflare | 分類訂單寫進廠商試算表;離島那批再累加進「離島•郵局(郵局)」字卡 |
| `addProblem` / `getProblems` / `removeProblem` | Cloudflare(D1) | 問題訂單(`shipping_problems`),2026-09-17 起不再用試算表 |
| `addReturn` / `getReturns` / `removeReturn` | Apps Script | 包裹退貨試算表 |

包貨字卡一律是**累加**不是覆蓋(同一天同平台已有紀錄就把件數加上去),
所以同一天上傳多次不會把包貨系統手動送出的數字蓋掉。

> **不要把包貨同步加回 `Code.gs`。** 若 Apps Script 自己也同步一次,同一批件數會被灌兩次。
> `functions/api.js` 會偵測 Apps Script 回傳裡有沒有 `packingSync`,有的話就跳過自己這次同步
> (這是為了 Apps Script 還沒換成 v6 的過渡期,不是讓兩邊並存的設計)。

---

## 分區列印:黑貓託運單 PDF 分頁

舊流程是「每組下載一份黑貓出貨表 xlsx → 一份一份丟進黑貓系統」,很花時間。
新流程可以改成:

1. 出貨單產生分頁一次倒出全部訂單 → 丟進黑貓系統
2. 黑貓吐回一份含全部託運單的 PDF
3. 把那份 PDF 丟進分區列印的「黑貓託運單 PDF」欄位
4. 清單上每一組會多一顆「⬇ 託運單」,或按「▶ 全部下載託運單(每組一檔)」一次全出

對應方式是每頁託運單上印的 18 碼訂單編號,跟當天的 LINE 訂單總表比對。
頁序照該組的撿貨順序排,撿貨人拿到的一疊就是那一組的單。

**LINE 訂單總表和託運單 PDF 兩個都要選**才會分組 —— 分組規則(商品編號、別名、
尺寸、雷雕歸類…)全部來自訂單總表,PDF 上只有訂單編號。只選其中一個時,
畫面會直接說還缺哪一個,不會產生半套的結果。

> 曾經做過「只靠託運單備註欄分組、不用訂單總表」的版本,但備註欄的文字
> 抓得不夠穩,分出來的組跟有總表時對不起來,所以移除了。要再做的話,
> git 記錄裡有(commit a0ee69c、300ec88)。

沒被分區清單吃到的頁不會消失,會另外歸類成獨立的檔:

| 情況 | 產生的檔 |
|---|---|
| 訂單表裡有,但分區排除(黑熊/盆景公仔組/離島) | 依類別各一檔,例如 `託運單_黑熊.pdf` |
| 訂單表裡找不到,或抓不到訂單編號 | `託運單_未對應.pdf` |
| 訂單表裡有、PDF 裡卻沒有託運單 | 不會產生檔,改在狀態列提示「⚠ N 筆訂單找不到對應的託運單」 |

原本每組下載 xlsx 的按鈕沒有拿掉,兩條路並存。

`pdf.js`(讀文字)和 `pdf-lib`(重組頁面)都是**用到才載**,沒要分 PDF 的人不會付那 1.9MB 的載入成本。

---

## 部署

### A. Cloudflare Pages

1. 把這個 repo 推到 GitHub。
2. Cloudflare Pages → Create project → Connect to Git → 選這個 repo
   - Framework preset:**None**
   - Build command:**留空**
   - Build output directory:**留空**(用 `wrangler.toml` 的 `pages_build_output_dir = "."`)
3. 專案建好後到 Settings → Environment variables 新增 `GS_URL` = Apps Script 的 `/exec` 網址。

### B. Apps Script(只負責寫試算表)

1. 把 `Code.gs` 全部貼進原本那個 Apps Script 專案(覆蓋舊的 v5)。
2. 部署 → 管理部署 → 編輯 → 版本選「新版本」→ 部署。
   - 執行身分:**我**
   - 誰可存取:**任何人**
3. 網址若有變,回頭更新 Cloudflare 的 `GS_URL` 環境變數。

### C. 本機測試

```bash
npx wrangler d1 execute niyan-db --local --command 'CREATE TABLE IF NOT EXISTS platform_orders ("id" TEXT PRIMARY KEY,"日期" TEXT,"平台" TEXT,"明細" TEXT,"總件數" INTEGER,"已完成" TEXT,"完成日期" TEXT,"備註" TEXT,"建立時間" TEXT,"更新時間" TEXT,"來源平台" TEXT,"完成物流" TEXT)'
npx wrangler pages dev . --binding GS_URL=<測試用網址>
```

測試時 `GS_URL` 記得指到假的接收端,不要指到正式 Apps Script,否則會真的寫進同事的試算表。

---

## 試算表欄位

分類試算表(雷雕/黑熊/注意品項/盆景公仔組):

```
日期  姓名  地址  電話  備注  訂單編號  數量
```

永生花(多一欄,由「規格設定」判斷公仔顏色):

```
日期  姓名  地址  電話  備注  訂單編號  黃金數量  粉福數量
```

離島包裹:

```
日期  姓名  地址  電話  備注  訂單編號  數量  離島縣市
```

問題訂單已經不在試算表了,改存 D1 的 `shipping_problems`(欄位見 `schema.sql`)。
「訂單編號」是 UNIQUE —— 同一張單重送是更新那筆,不會產生第二筆。

包裹退貨:同一張工作表裡橫向並排三個平台區塊(line禮物 A 欄起、蝦皮 J 欄起、mo P 欄起),
**不能用整列刪除**,會把旁邊平台的資料錯位。

---

## 永生花顏色判斷規則

| 規格設定包含關鍵字 | 計入欄位 |
|---|---|
| 黃金運、黃金 | 黃金數量 |
| 粉招福、粉招、粉福 | 粉福數量 |
| 粉色(舊資料) | 粉福數量 |
| 藍色(舊資料) | 黃金數量 |
| 都不符合 | 黃金數量(預設) |

---

## 離島•郵局

地址含澎湖/金門/連江/馬祖/綠島/蘭嶼/琉球(且後面接正式行政區尾碼,避免「金門街」這種路名誤判)
的訂單改用郵局寄,獨立上傳到離島包裹試算表,並另外印 100x150mm 出貨貼紙。
