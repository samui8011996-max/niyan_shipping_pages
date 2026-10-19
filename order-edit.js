// ===================================================================
// 預覽清單「編輯品項」(官網、Pinkoi 共用;蝦皮的在 shopee-label.js 自己有一套)
// 自動簡稱總有規則想不到的時候(臨時換贈品、客人加註),讓人直接改要印的文字,
// 改過的會用在出貨單 PDF,也會用在黑貓上傳表的備註。金額不跟著改。
// 重新讀一份報表就全部清掉(換了一批訂單,舊的手改沒有意義)。
// ===================================================================
const ORDER_EDITS = { web: new Map(), pinkoi: new Map() };   // 平台 → (訂單編號 → [一行一個品項])
const orderEditing = { web: null, pinkoi: null };             // 正在編輯哪一筆

// 預覽列畫完要重畫用的函式(各平台自己的 render)
function orderEditRerender(plat) {
  if (plat === "web") renderWebPreview();
  else if (plat === "pinkoi") renderPinkoiPreview();
}

// 這筆訂單實際要印的品項文字(手改過就用手改的)
function orderLines(plat, o) {
  return ORDER_EDITS[plat].get(o.id) || o.items.map(i => i.compact);
}

// 產生 PDF / 黑貓表前,把手改的品項套進去
function withOrderEdits(plat, orders) {
  return orders.map(o => ORDER_EDITS[plat].has(o.id)
    ? { ...o, items: ORDER_EDITS[plat].get(o.id).map(t => ({ compact: t, code: t })) }
    : o);
}

function clearOrderEdits(plat) {
  ORDER_EDITS[plat].clear();
  orderEditing[plat] = null;
}

const oeq = s => escapeHtml(String(s)).replace(/'/g, "\\'");

// 預覽列中間那一格:平常是品項文字 + 編輯鈕;編輯中是文字框 + 儲存/取消/還原
function orderEditCell(plat, o, blockedText) {
  if (blockedText) return `<span class="shopee-code">${escapeHtml(blockedText)}</span>`;
  const edited = ORDER_EDITS[plat].has(o.id);
  if (orderEditing[plat] === o.id) {
    const lines = orderLines(plat, o);
    return `<div class="shopee-edit">
        <textarea id="orderEditBox-${plat}" rows="${Math.max(2, lines.length)}">${escapeHtml(lines.join("\n"))}</textarea>
        <div class="shopee-edit-btns">
          <button class="btn btn-primary btn-small" onclick="saveOrderEdit('${plat}', '${oeq(o.id)}')">儲存</button>
          <button class="btn btn-secondary btn-small" onclick="cancelOrderEdit('${plat}')">取消</button>
          ${edited ? `<button class="btn btn-secondary btn-small" onclick="resetOrderEdit('${plat}', '${oeq(o.id)}')" title="丟掉手改的,回到自動簡稱">還原</button>` : ""}
          <span class="shopee-edit-hint">一行一個品項</span>
        </div>
      </div>`;
  }
  const text = orderLines(plat, o).join("　");
  return `<span class="shopee-code${edited ? " edited" : ""}">${edited ? "✎ " : ""}${escapeHtml(text)}</span>`
    + `<button class="shopee-edit-btn" title="手動改這一筆要印的品項" onclick="startOrderEdit('${plat}', '${oeq(o.id)}')">編輯</button>`;
}

function startOrderEdit(plat, id) {
  orderEditing[plat] = id;
  orderEditRerender(plat);
  const ta = document.getElementById("orderEditBox-" + plat);
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function cancelOrderEdit(plat) {
  orderEditing[plat] = null;
  orderEditRerender(plat);
}

function resetOrderEdit(plat, id) {
  ORDER_EDITS[plat].delete(id);
  orderEditing[plat] = null;
  orderEditRerender(plat);
}

function saveOrderEdit(plat, id) {
  const ta = document.getElementById("orderEditBox-" + plat);
  if (!ta) return;
  const lines = ta.value.split("\n").map(x => x.trim()).filter(Boolean);
  if (lines.length) ORDER_EDITS[plat].set(id, lines); else ORDER_EDITS[plat].delete(id);
  orderEditing[plat] = null;
  orderEditRerender(plat);
  // 字型是切過的子集,打到不在裡面的字會印成 □ —— 當場講
  const bad = unsupportedChars(lines.join(""));
  if (bad.length) {
    setStatus(plat === "web" ? "webStatus" : "pinkoiStatus", "warn", "這些字印不出來,紙上會變成 □:" + bad.join(" "));
  }
}
