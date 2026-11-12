// ===================================================================
// 印單教學(2026-11-11):點右邊的小助手貓就打開。
// 依平台分頁,每個平台從「先看客服」照順序做到最後一步。
// 打開時預設停在目前所在的平台;不是這幾個平台就停在「開始前」。
// 內容跟 Claude Docs 的「印單流程教學手冊」同一份,改流程時兩邊一起改。
// 取代原本貓的 6 條輪播小提醒(使用者 2026-11-11:那些提示不用了)。
// ===================================================================

const PG_INVOICE_URL = "https://web3.einvoice.com.tw/login";
const PG_TCAT_URL = "https://www.t-cat.com.tw/contract/business.aspx";

// 步驟裡的【地點】標籤
const pgAt = (w) => `<span class="pg-at">${w}</span>`;

const PG_TABS = [
  {
    id: "start", name: "開始前",
    html: `
      <p class="pg-lead">每個平台一個分頁,從第 1 步照順序做到最後一步就完成。
        <b>每個平台的第 1 步都是先看客服、回訊息</b>,沒看就印可能會寄錯。</p>
      <h3>每天開始前</h3>
      <ul>
        <li>用電腦開出貨小幫手正式網址(不要從檔案總管直接點 index.html)</li>
        <li>開好包貨網站和<a href="${PG_TCAT_URL}" target="_blank" rel="noopener noreferrer">黑貓契客後台 ↗</a></li>
        <li>熱感應印表機放好紙</li>
      </ul>
      <p>上方是各平台的按鈕,點一個就進那個平台的頁面。頁面最上面會寫「要不要印發票」,並有「開啟後台」按鈕;功能卡片上的 <b>?</b> 可以叫出附截圖的說明。</p>
      <h3>紙張格式</h3>
      <p>產生按鈕旁的小箭頭 ⌄ 可以切換,要跟印表機裡的紙一樣。</p>
      <table class="pg-table">
        <tr><th>格式</th><th>尺寸</th><th>用在</th></tr>
        <tr><td>黑貓熱感應 95×193</td><td>95 × 193 mm,中間預印區不印字</td><td>Pinkoi、官網出貨單</td></tr>
        <tr><td>4×6</td><td>101.6 × 152.4 mm</td><td>蝦皮出貨單、超商的單、離島郵局貼紙</td></tr>
      </table>
      <h3>要不要開發票</h3>
      <p><b>蝦皮、Pinkoi、官網</b>要開發票,其他平台不用。印完到
        <a href="${PG_INVOICE_URL}" target="_blank" rel="noopener noreferrer">電子發票平台 ↗</a>開立。</p>`
  },
  {
    id: "printer", name: "印表機設定",
    html: `
      <p class="pg-lead"><b>黑貓託運單(HotPrint.pdf)不要在瀏覽器裡直接印</b>,要從資料夾打開、用 Adobe 檢視軟體印,尺寸才會對。<b>超商的單(4×6)</b>直接用瀏覽器印就可以(看最下面)。</p>
      <h3>打開黑貓單</h3>
      <ol>
        <li>黑貓後台按「列印託運單」後,會下載一個檔名結尾是 <b>HotPrint.pdf</b> 的檔。</li>
        <li>按瀏覽器右上角的下載記錄,在那個檔旁邊按<b>資料夾圖示</b>(在資料夾中顯示)。</li>
        <li>在資料夾裡對檔案按右鍵 → 開啟檔案 → 選 <b>Adobe Acrobat</b>(紅色圖示)。</li>
        <li>在 Adobe 裡按列印(Ctrl+P)。</li>
      </ol>
      <h3>列印視窗設定</h3>
      <table class="pg-table">
        <tr><th>項目</th><th>設成</th></tr>
        <tr><td>印表機</td><td>Xprinter XP-490B</td></tr>
        <tr><td>列印的頁數</td><td>所有頁面</td></tr>
        <tr><td>頁面大小調整和處理</td><td>按「大小」→ 選「縮小超過大小的頁面」</td></tr>
        <tr><td>依 PDF 頁面大小選擇紙張來源</td><td>打勾</td></tr>
        <tr><td>方向</td><td>自動</td></tr>
        <tr><td>以灰階列印、節省墨水</td><td>不勾</td></tr>
      </table>
      <p>右邊預覽要看到「比例:100%」,整張託運單完整出現在框內。</p>
      <h3>印表機內容(第一次設定或印歪時檢查)</h3>
      <p>列印視窗按印表機旁的「內容」→「頁面設定」分頁:</p>
      <table class="pg-table">
        <tr><th>項目</th><th>設成</th></tr>
        <tr><td>標籤樣式名稱</td><td>郵政物流 (100.0 mm x 180.0 mm)</td></tr>
        <tr><td>方向</td><td>直向 180</td></tr>
        <tr><td>效果</td><td>鏡映影像、反白都不勾</td></tr>
      </table>
      <h3>超商的單(4×6):直接用瀏覽器印</h3>
      <p>超商的單(4×6 貼紙)不用存檔,在瀏覽器按列印(Ctrl+P)就可以:</p>
      <table class="pg-table">
        <tr><th>項目</th><th>設成</th></tr>
        <tr><td>目的地</td><td>Xprinter XP-490B</td></tr>
        <tr><td>頁面</td><td>全部</td></tr>
        <tr><td>紙張大小</td><td>4 x 6(在「顯示更多」裡)</td></tr>
        <tr><td>每張工作表頁數</td><td>1</td></tr>
        <tr><td>縮放比例</td><td>自訂 120</td></tr>
      </table>`
  },
  {
    id: "line", name: "LINE禮物",
    html: `
      <p class="pg-lead">不用開發票。小幫手點「LINE禮物」,用上方膠囊鈕切換「出貨單產生/物流單號回填/分區列印」。</p>
      <h3>印單</h3>
      <ol>
        <li>${pgAt("LINE 後台")}<b>看客服、回訊息</b>:首頁「待處理」的「未回覆的問題」有數字,先回覆客人。</li>
        <li>${pgAt("小幫手")}<b>登記問題訂單</b>:客人要改顏色/規格、收件資料、配送時間或抽單的,到「問題訂單」填訂單編號、選類別 →「送出問題訂單」。</li>
        <li>${pgAt("LINE 後台")}<b>確認「待出貨」是 0</b>:不是 0 代表有舊單沒處理,先處理掉。</li>
        <li>${pgAt("LINE 後台")}<b>確認新訂單</b>:「待確認」→ 全選 →「確認已選取訂單」。確認後客人就不能自己取消。</li>
        <li>${pgAt("LINE 後台")}<b>下載訂單 Excel</b>:按「下載Excel檔案」,檔名像 Order.To_Ship.日期。</li>
        <li>${pgAt("小幫手")}<b>載入訂單</b>:「出貨單產生」的「LINE 訂單總表」選剛下載的 Excel。</li>
        <li>${pgAt("小幫手")}<b>處理問題訂單</b>:跳出紅色「偵測到 N 筆問題訂單」時,到「改備註」卡片:
          <ul>
            <li>要修改 → 改「黑貓出貨表備註」那格 →「存」</li>
            <li>今天不出 → 紅色「刪除」(刪錯到最下面「已刪除」按「還原」)</li>
            <li>地址、電話這裡改不了,要回 LINE 後台改好、重下載 Excel,從第 6 步重來</li>
          </ul></li>
        <li>${pgAt("小幫手")}<b>檢查統計</b>:
          <ul>
            <li>黑熊有數字 →「廠商對照」按複製,貼給廠商</li>
            <li>注意品項有數字 → 先跟包貨人員說</li>
            <li>雷雕 → 確認數量對不對</li>
          </ul></li>
        <li>${pgAt("小幫手")}<b>下載黑貓出貨表</b>:按「下載黑貓出貨表」。有離島訂單再按「產離島貼紙 PDF」印出來(改郵局寄)。</li>
        <li>${pgAt("小幫手")}<b>上傳</b>:按「上傳包貨平台與試算表」,到包貨網站看字卡有沒有進去。</li>
        <li>${pgAt("黑貓後台")}<b>印託運單</b>:物流 → 線上印單 → 多筆匯入 → 瀏覽選第 9 步的檔 → 送出(一檔最多 100 筆)。都在「正常區」後 →「單頁全選」→「列印託運單」。
          <ul><li>下載的 HotPrint.pdf <b>從資料夾用 Adobe 打開再印</b>,設定看<a href="#" onclick="showPrintGuideTab('printer'); return false;">印表機設定</a></li><li>「異常區」有資料:多半是地址錯字,看錯誤說明;看不出來就問黑貓客服或打給客人</li></ul></li>
      </ol>
      <h3>選用:分區列印</h3>
      <p>想讓託運單照品項分堆、方便撿貨時,第 11 步改成:</p>
      <ol>
        <li>黑貓後台印託運單時先存成 PDF(不直接印)。</li>
        <li>小幫手「分區列印」:選 LINE 訂單總表 + 黑貓託運單 PDF。</li>
        <li>「合併門檻」預設 3:同品項超過 3 個獨立一份,其餘併成「其他合併」。</li>
        <li>每組各自下載列印,或「全部下載」。「已印單數」會記住印過的。</li>
      </ol>
      <h3>出貨後:物流單號回填</h3>
      <ol>
        <li>${pgAt("LINE 後台")}待出貨 → 批次出貨 →「全部訂單資訊」→「下載批次出貨範本」。</li>
        <li>${pgAt("黑貓後台")}線上印單 → 匯出託運單資料 → 選出貨日 → 匯出資料。</li>
        <li>${pgAt("小幫手")}「物流單號回填」:① 放 LINE 範本、② 放黑貓出貨明細表,看配對統計。不出貨的單在未配對清單打勾,或在 ③ 輸入編號「刪除這筆」。</li>
        <li>${pgAt("小幫手")}「下載 LINE 物流單號表」。</li>
        <li>${pgAt("LINE 後台")}待出貨 → 批次出貨 → 步驟二「批次出貨」→「新增Excel檔案」上傳,訂單變成配送中。</li>
      </ol>`
  },
  {
    id: "shopee", name: "蝦皮",
    html: `
      <p class="pg-lead"><b>要開發票。</b>小幫手會把裝箱單品項縮成代號,和原本的熱感應標籤合成一張出貨單。</p>
      <ol>
        <li>${pgAt("蝦皮後台")}<b>看聊聊、回訊息</b>:小助手貓會在 9、11、13、15、17 點變橘色提醒。客人要改或取消的,先在後台處理好。</li>
        <li>${pgAt("蝦皮後台")}<b>進批次出貨</b>:我的銷售 → 待出貨 → 右邊「批次出貨」。</li>
        <li>${pgAt("蝦皮後台")}<b>下載出貨文件</b>:切到「下載出貨文件」,訂單狀態選「已處理」、物流方式選有數字的那種、勾選訂單;右邊勾「寄件單」(一般列印)和「裝箱單」(PDF)→「下載所選文件」。每種有數字的物流方式都要下載。</li>
        <li>${pgAt("瀏覽器")}<b>存檔</b>:PDF 開在新分頁,右鍵 → 另存新檔。</li>
        <li>${pgAt("小幫手")}<b>丟檔</b>:點「蝦皮」,把全部 PDF 拖進「把當天的檔案丟進來」(或按「選擇檔案」)。分批丟會累加,要重來按「清除」。</li>
        <li>${pgAt("小幫手")}<b>檢查預覽</b>:看「逐頁預覽」每張的品項代號。
          <ul>
            <li>代號不對 → 按「編輯」改</li>
            <li>送禮不想露價錢 → 勾那張的「不印發票」</li>
            <li>不要印的 → 按 ✕(右上「復原」可救回)</li>
          </ul></li>
        <li>${pgAt("小幫手")}<b>印出貨單</b>:紙張選「4×6」(預設就是)→「產生出貨單」,全部合成一個 PDF 列印(4×6 會把品項明細和標籤分成兩張)。</li>
        <li><b>手寫金額</b>:金額格留空(有人用蝦幣折抵,報表金額對不上),印好後手寫。</li>
        <li>${pgAt("蝦皮後台")}<b>印超商單</b>:7-ELEVEN、全家…的訂單,在「我的銷售」找到那筆 → 右邊「列印寄件單」。</li>
        <li>${pgAt("電子發票平台")}<b>開發票</b>:到<a href="${PG_INVOICE_URL}" target="_blank" rel="noopener noreferrer">電子發票平台 ↗</a>開立。</li>
      </ol>
      <p class="pg-note"><b>黑貓宅急便的蝦皮訂單:託運單改手寫。</b>這種單沒有熱感應條碼,小幫手只會印一張「蝦皮黑貓」加大字物流單號的頁。標籤印歪才需要調「位置微調」(mm,正數往上)。</p>`
  },
  {
    id: "pinkoi", name: "Pinkoi",
    html: `
      <p class="pg-lead"><b>要開發票。</b>宅配的單走黑貓,超商的單在 Pinkoi 後台印寄件單。</p>
      <ol>
        <li>${pgAt("Pinkoi 後台")}<b>看訊息、回客服</b>:客人要改或取消的,先在後台處理好。</li>
        <li>${pgAt("Pinkoi 後台")}<b>匯出訂單報表</b>:檔名像 20261019-0901-cement-niyan.csv。</li>
        <li>${pgAt("小幫手")}<b>載入報表</b>:點「Pinkoi」,選剛下載的檔。看訂單預覽,⛔ 的不會印(全額退款、已取消)。</li>
        <li>${pgAt("小幫手")}<b>印出貨單</b>:選紙張 →「產生出貨單 PDF」列印。有載具的不印金額;有統編的會印統編和抬頭。</li>
        <li>${pgAt("小幫手 → 黑貓後台")}<b>宅配單</b>:有黑貓宅配(或順豐寄台灣)的單,按「下載黑貓出貨表」,到黑貓後台多筆匯入、列印託運單(同 LINE禮物第 11 步)。</li>
        <li>${pgAt("Pinkoi 後台")}<b>印超商單</b>:7-11、全家、取貨付款的單,在 Pinkoi 後台列印超商寄件單。</li>
        <li>${pgAt("電子發票平台")}<b>開發票</b>。</li>
      </ol>
      <p class="pg-note">跨境直送、國際包裹只印出貨單。</p>`
  },
  {
    id: "other", name: "其他平台",
    html: `
      <p class="pg-lead">每個平台一樣<b>先看客服、回訊息</b>再印單。</p>
      <h3>官網(Shopline)— 要開發票</h3>
      <ol>
        <li>${pgAt("Gmail")}看有沒有新訂單通知信;${pgAt("官網後台")}回客服。</li>
        <li>${pgAt("官網後台")}匯出「訂單報表」(niyancement_orders_….xls)。</li>
        <li>${pgAt("小幫手")}點「官網後台」,選檔,看預覽(未付款、已取消會擋下;貨到付款不算未付)。</li>
        <li>${pgAt("小幫手")}「產生出貨單 PDF」列印。</li>
        <li>${pgAt("小幫手 → 黑貓後台")}「下載黑貓出貨表」→ 多筆匯入 → 列印託運單。</li>
        <li>${pgAt("電子發票平台")}開發票。</li>
      </ol>
      <h3>瑪黑 — 不用開發票</h3>
      <ol>
        <li>${pgAt("Gmail")}看新訂單通知信;${pgAt("瑪黑後台")}回客服。</li>
        <li>${pgAt("瑪黑後台")}「下載訂單」報表(.xlsx)。</li>
        <li>${pgAt("小幫手 → 黑貓後台")}點「瑪黑」選檔 →「下載黑貓出貨表」→ 多筆匯入 → 列印託運單。</li>
        <li><b>出貨後</b>:同一頁「物流單號回填」丟黑貓出貨明細 →「下載瑪黑物流回填表」→ 上傳回瑪黑。</li>
      </ol>
      <h3>MO+、樂天、博客來、酷澎 — 不用開發票</h3>
      <p>小幫手沒有自動印單。看客服後,按平台頁「開啟後台」直接在平台上印。樂天、博客來新訂單會寄 Gmail;MO+ 不寄信,要自己登入看。</p>`
  },
  {
    id: "faq", name: "遇到問題",
    html: `
      <table class="pg-table">
        <tr><th>狀況</th><th>怎麼辦</th></tr>
        <tr><td>黑貓「異常區」有資料</td><td>多半地址錯字;看不出來問黑貓客服或打給客人</td></tr>
        <tr><td>黑貓出貨表超過 100 筆</td><td>分批匯入</td></tr>
        <tr><td>LINE 重複上傳字卡沒變</td><td>正常不重算;要整批重來先按「重算今天字卡」</td></tr>
        <tr><td>LINE 訂單 Excel 不見了</td><td>只保留 24 小時,重新匯出</td></tr>
        <tr><td>印出來尺寸不對</td><td>檢查紙張格式跟印表機裡的紙一樣</td></tr>
        <tr><td>蝦皮代號印成「□」</td><td>預覽按「編輯」換個寫法,並回報</td></tr>
        <tr><td>包裹被退回</td><td>共用工具「包裹退貨」登記</td></tr>
      </table>`
  },
];

// 小幫手目前的分頁 → 教學要先打開哪一頁
function pgDefaultTab() {
  const active = document.querySelector(".tab.active");
  const t = active ? active.dataset.tab : "";
  if (t === "line" || t === "shopee" || t === "pinkoi") return t;
  if (["web", "marais", "momo", "rakuten", "books", "coupang"].includes(t)) return "other";
  return "start";
}

let pgCurrent = "start";

function pgEnsureModal() {
  if (document.getElementById("printGuideModal")) return;
  const style = document.createElement("style");
  style.textContent = `
    .pg-modal { max-width: 760px; }
    .pg-tabs { flex-wrap: wrap; margin: 4px 0 14px; }
    .pg-body { font-size: 14px; line-height: 1.85; color: var(--text); max-height: 62vh; overflow-y: auto; padding-right: 6px; }
    .pg-body h3 { font-size: 15px; font-weight: 700; color: var(--accent); margin: 18px 0 6px; }
    .pg-body p { margin: 0 0 10px; }
    .pg-body ol, .pg-body ul { margin: 0 0 12px; padding-left: 22px; }
    .pg-body li { margin-bottom: 6px; }
    .pg-body li ul { margin: 4px 0 0; }
    .pg-body b { font-weight: 700; }
    .pg-body a { color: var(--accent); }
    .pg-lead { padding: 10px 12px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; }
    .pg-note { font-size: 13px; color: var(--text-dim); }
    .pg-at { display: inline-block; font-size: 12px; font-weight: 600; padding: 0 7px; margin-right: 6px; border-radius: 999px;
             border: 1px solid var(--accent); color: var(--accent); line-height: 1.6; vertical-align: 1px; }
    .pg-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px; }
    .pg-table th, .pg-table td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; vertical-align: top; }
    .pg-table th { background: var(--bg-input); font-weight: 600; }`;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "printGuideModal";
  box.className = "modal-backdrop";
  box.addEventListener("click", (e) => { if (e.target === box) closePrintGuide(); });
  box.innerHTML = `
    <div class="modal pg-modal" role="dialog" aria-labelledby="pgTitle">
      <h2 id="pgTitle">印單教學</h2>
      <div class="fmt-pills pg-tabs" role="tablist">
        ${PG_TABS.map(t => `<button type="button" class="fmt-pill" role="tab" data-pg="${t.id}"
            onclick="showPrintGuideTab('${t.id}')">${t.name}</button>`).join("")}
      </div>
      <div id="pgBody" class="pg-body"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closePrintGuide()">知道了</button>
      </div>
    </div>`;
  document.body.appendChild(box);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && box.classList.contains("show")) closePrintGuide();
  });
}

function showPrintGuideTab(id) {
  const tab = PG_TABS.find(t => t.id === id) || PG_TABS[0];
  pgCurrent = tab.id;
  document.querySelectorAll("#printGuideModal [data-pg]").forEach(b => {
    const on = b.dataset.pg === tab.id;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
  });
  const body = document.getElementById("pgBody");
  body.innerHTML = tab.html;
  body.scrollTop = 0;
}

function openPrintGuide(id) {
  pgEnsureModal();
  showPrintGuideTab(id || pgDefaultTab());
  document.getElementById("printGuideModal").classList.add("show");
}

function closePrintGuide() {
  const m = document.getElementById("printGuideModal");
  if (m) m.classList.remove("show");
}
