// ===================================================================
// 頁面載入後的 DOM 事件綁定(必須排在最後,確保用到的函式都已載入)
// ===================================================================
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSettings();
});

document.getElementById("returnDate").value = todayStr("-");

document.getElementById("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setFileDisplays(file.name);
  handleFile(file);
});
document.getElementById("zonedFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setFileDisplays(file.name);
  handleFile(file, "zonedStatus");
});
document.getElementById("zonedPdfInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const d = document.getElementById("zonedPdfDisplay");
  d.textContent = file.name;
  d.classList.remove("empty"); d.classList.add("has-file");
  handleZonedPdf(file);
});
document.getElementById("lineTemplateInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const d = document.getElementById("lineTemplateDisplay");
  d.textContent = file.name;
  d.classList.remove("empty"); d.classList.add("has-file");
  handleLineTemplate(file);
});
document.getElementById("bcDetailInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const d = document.getElementById("bcDetailDisplay");
  d.textContent = file.name;
  d.classList.remove("empty"); d.classList.add("has-file");
  handleBcDetail(file);
});

// 蝦皮出貨(BETA):裝箱單和熱感應單共用一個欄位,依副檔名自己分。
// 檔名顯示由 shopee-label.js 自己處理(要順便顯示筆數/頁數),
// 所以這裡不用 setFileDisplays —— 那支是給 tab1/分區列印共用同一份總表用的
document.getElementById("shopeeInput").addEventListener("change", (e) => {
  onShopeeFiles(e.target.files);
});

// ---------------------------------------------------------------
// 拖曳上傳:每個檔案欄位所在的整張卡片都能放。
// 副檔名不對會擋下來並在該分頁的狀態列說明,不會安靜地什麼都沒發生 ——
// 沒有回饋的話,人只會以為系統壞了,然後再拖一次。
// ---------------------------------------------------------------
const DROP_ZONES = [
  { input: "fileInput",         accept: [".xlsx", ".xls"], status: "status" },
  { input: "zonedFileInput",    accept: [".xlsx", ".xls"], status: "zonedStatus" },
  { input: "zonedPdfInput",     accept: [".pdf"],          status: "zonedStatus" },
  { input: "lineTemplateInput", accept: [".xlsx"],         status: "logisticsStatus" },
  { input: "bcDetailInput",     accept: [".xlsx", ".xls"], status: "logisticsStatus" },
  { input: "shopeeInput",       accept: [".xlsx", ".xls", ".pdf"], status: "shopeeStatus" },
];

DROP_ZONES.forEach(({ input, accept, status }) => {
  const el = document.getElementById(input);
  if (!el) return;
  const card = el.closest(".card") || el.parentElement;
  setupDropZone(card, {
    accept,
    // 丟進來的檔案直接餵回原本的 input,後面的 change 處理就完全共用,
    // 不用為了拖曳再寫一套載入流程
    onFiles: (files) => {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      el.files = dt.files;
      el.dispatchEvent(new Event("change"));
    },
    onReject: (names) => {
      const box = document.getElementById(status);
      if (!box) return;
      box.textContent = "這幾個檔案格式不對,只收 " + accept.join(" / ") + ":" + names.join("、");
      box.className = "status error";
    },
  });
});
