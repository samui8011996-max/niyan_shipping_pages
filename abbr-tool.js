// ===================================================================
// 品項簡寫(共用工具分頁):打商品標題,馬上看到出貨單上會印的簡稱。
// 用的就是出貨單本身的規則 —— 蝦皮看品名+規格(shopee-shortcode.js),
// 打的是官網貨號(例如 FATCATF-WHITE-S-GOLD)就改用官網的貨號規則(web-shortcode.js)。
// 一行一個商品,可以一次貼很多行。
// ===================================================================
const ABBR_SKU_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/;   // 長得像貨號:英數字用 - 連起來

function abbrOne(title, spec) {
  const t = String(title || "").trim();
  if (!t) return null;
  if (ABBR_SKU_RE.test(t)) {
    const r = buildWebShortCode({ "商品貨號": t, "數量": 1 });
    return { src: t, code: r.compact.replace(/ x1$/, ""), unknown: r.unknown, by: "官網貨號" };
  }
  const r = buildShortCode({ "商品名稱": t, "規格設定": spec || "", "數量": 1 });
  return { src: t, code: r.compact.replace(/ x1$/, ""), unknown: r.unknown, by: "品名" };
}

function renderAbbr() {
  const lines = document.getElementById("abbrTitle").value.split("\n");
  const spec = document.getElementById("abbrSpec").value;
  const rows = lines.map(l => abbrOne(l, spec)).filter(Boolean);
  const box = document.getElementById("abbrResult");
  if (!rows.length) {
    box.innerHTML = `<div class="problem-empty">在上面打商品標題,這裡會出現簡寫</div>`;
    return;
  }
  box.innerHTML = rows.map(r => `
    <div class="abbr-row${r.unknown ? " unknown" : ""}">
      <div class="abbr-code">${r.unknown ? "⚠ " : ""}${escapeHtml(r.code)}</div>
      <div class="abbr-src">${escapeHtml(r.src)}<span class="abbr-by">${r.by}</span></div>
      <button type="button" class="btn btn-secondary btn-small abbr-copy" data-copy="${escapeHtml(r.code)}"
        onclick="copyAbbr(this)">複製</button>
    </div>`).join("")
    + (rows.some(r => r.unknown)
      ? `<p class="abbr-hint">⚠ 有認不出來的部分(會印成 ?),要加規則請跟管理的人說。</p>` : "");
}

function copyAbbr(btn) {
  navigator.clipboard.writeText(btn.dataset.copy || "").then(() => {
    const t = btn.textContent;
    btn.textContent = "已複製";
    setTimeout(() => { btn.textContent = t; }, 1000);
  });
}

function clearAbbr() {
  document.getElementById("abbrTitle").value = "";
  document.getElementById("abbrSpec").value = "";
  renderAbbr();
  document.getElementById("abbrTitle").focus();
}
