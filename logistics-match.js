// ===================================================================
// Tab 2: 物流單號回填 (保留原邏輯)
// ===================================================================
// 未配對訂單手動填號時的「貨運業者代碼」下拉選單(LINE 後台規定的代碼)
const CARRIER_CODES = [
  { code: "T_CAT", name: "黑貓宅急便" },
  { code: "IPOST", name: "中華郵政" },
  { code: "HCT", name: "新竹物流" },
  { code: "KERRY_EXPRESS", name: "嘉里大榮" },
  { code: "ECAN", name: "宅配通" },
  { code: "SF_EXPRESS", name: "順豐速運" },
  { code: "GLOBAL_EXPRESS", name: "全球快遞" },
  { code: "FEDEX", name: "FedEx" },
  { code: "DHL", name: "DHL" },
  { code: "MAPLE", name: "便利帶" },
  { code: "ROUNDDAY", name: "全日物流" },
  { code: "DELIVERY_EXPRESS", name: "其他配送" },
];

async function handleLineTemplate(file) {
  setStatus("logisticsStatus", "loading", "讀取 LINE 模板中…");
  lastUnmatchedOrders = [];
  unmatchedDeleteSet.clear();
  unmatchedManualMap.clear();
  renderUnmatchedSection();
  // 換了一批新的 LINE 模板,昨天手動刪的訂單編號不該留著
  manualDeleteIds.clear();
  renderManualDeleteList();
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array", cellStyles: true });
    const sheetName = wb.SheetNames.includes("Template") ? "Template" : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (aoa.length < 2) throw new Error("LINE 模板沒有訂單");

    const headers = aoa[0];
    const orderIdCol = headers.findIndex(h => String(h).trim() === "訂單編號");
    const carrierCol = headers.findIndex(h => String(h).includes("貨運業者代碼"));
    const trackingCol = headers.findIndex(h => String(h).includes("物流單編號"));
    const productCol = headers.findIndex(h => String(h).includes("商品明細"));

    if (orderIdCol < 0) throw new Error("找不到「訂單編號」欄位");
    if (carrierCol < 0) throw new Error("找不到「貨運業者代碼」欄位");
    if (trackingCol < 0) throw new Error("找不到「物流單編號」欄位");

    const orders = [];
    for (let i = 1; i < aoa.length; i++) {
      const oid = String(aoa[i][orderIdCol] ?? "").trim();
      if (!oid) continue;
      const product = productCol >= 0 ? String(aoa[i][productCol] ?? "").trim() : "";
      orders.push({ rowIdx: i, orderId: oid, product });
    }

    // 留一份原始內容:匯出會把 wb 裡的分頁換成重新排序過的版本,
    // 再匯出一次時若從 wb 重讀,rowIdx 就會指到別筆訂單(單號錯位)
    lineTemplateData = { wb, sheetName, orders, carrierCol, trackingCol, origAoa: aoa, origCols: ws["!cols"] };
    document.getElementById("stat-line-total").textContent = orders.length;
    checkBothLoaded();
    setStatus("logisticsStatus", "success", `✓ LINE 模板已載入 ${orders.length} 筆`);
  } catch (e) {
    lineTemplateData = null;
    setStatus("logisticsStatus", "error", `✗ LINE 模板讀取失敗:${e.message}`);
    document.getElementById("stat-line-total").textContent = "—";
    document.getElementById("logisticsRunBtn").disabled = true;
  }
}

async function handleBcDetail(file) {
  setStatus("logisticsStatus", "loading", "讀取黑貓明細中…");
  lastUnmatchedOrders = [];
  unmatchedDeleteSet.clear();
  unmatchedManualMap.clear();
  renderUnmatchedSection();
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    let headerRow = -1;
    for (let i = 0; i < Math.min(10, aoa.length); i++) {
      const row = aoa[i].map(v => String(v ?? ""));
      if (row.some(v => v.includes("訂單編號")) && row.some(v => v.includes("託運單號"))) {
        headerRow = i;
        break;
      }
    }
    if (headerRow < 0) throw new Error("找不到「訂單編號」+「託運單號」的表頭列");

    const headers = aoa[headerRow].map(v => String(v ?? "").trim());
    const orderIdCol = headers.findIndex(h => h.includes("訂單編號"));
    const trackingCol = headers.findIndex(h => h.includes("託運單號"));

    const map = new Map();
    for (let i = headerRow + 1; i < aoa.length; i++) {
      const oid = String(aoa[i][orderIdCol] ?? "").trim();
      const track = String(aoa[i][trackingCol] ?? "").trim();
      if (oid && track) map.set(oid, track);
    }

    bcDetailData = map;
    checkBothLoaded();
    setStatus("logisticsStatus", "success", `✓ 黑貓明細已載入 ${map.size} 筆託運單號`);
  } catch (e) {
    bcDetailData = null;
    setStatus("logisticsStatus", "error", `✗ 黑貓明細讀取失敗:${e.message}`);
    document.getElementById("logisticsRunBtn").disabled = true;
  }
}

function checkBothLoaded() {
  if (lineTemplateData && bcDetailData) {
    let matched = 0;
    const unmatchedOrders = [];
    lineTemplateData.orders.forEach(o => {
      if (bcDetailData.has(o.orderId)) matched++;
      else unmatchedOrders.push(o);
    });
    const unmatched = unmatchedOrders.length;
    document.getElementById("stat-matched").textContent = matched;
    document.getElementById("stat-unmatched").textContent = unmatched;

    lastUnmatchedOrders = unmatchedOrders;
    // 重新載入檔案時,把勾選記錄限縮到還存在的未配對訂單(避免殘留舊的勾選狀態)
    const stillUnmatchedIds = new Set(unmatchedOrders.map(o => o.orderId));
    unmatchedDeleteSet = new Set([...unmatchedDeleteSet].filter(id => stillUnmatchedIds.has(id)));
    unmatchedManualMap = new Map([...unmatchedManualMap].filter(([id]) => stillUnmatchedIds.has(id)));
    renderUnmatchedSection();

    if (matched > 0 || unmatched > 0) {
      document.getElementById("logisticsRunBtn").disabled = false;
      const msg = unmatched > 0
        ? `✓ 兩個檔案都已載入,配對成功 ${matched} 筆,${unmatched} 筆未配對`
        : `✓ 兩個檔案都已載入,全部 ${matched} 筆配對成功`;
      setStatus("logisticsStatus", unmatched > 0 ? "warn" : "success", msg);
    } else {
      document.getElementById("logisticsRunBtn").disabled = true;
      setStatus("logisticsStatus", "error", "✗ 沒有任何訂單配對成功,檢查兩個檔案是否正確");
    }
  }
}

function renderUnmatchedSection() {
  const section = document.getElementById("unmatchedSection");
  const hint = document.getElementById("unmatchedHint");
  const list = document.getElementById("unmatchedList");

  if (lastUnmatchedOrders.length === 0) {
    section.style.display = "none";
    list.innerHTML = "";
    return;
  }

  section.style.display = "";
  updateUnmatchedHint();

  list.innerHTML = lastUnmatchedOrders.map(o => {
    const safeId = escapeHtml(o.orderId);
    const checked = unmatchedDeleteSet.has(o.orderId) ? "checked" : "";
    const product = cleanFreeText(o.product);
    const manual = unmatchedManualMap.get(o.orderId) || { tracking: "", carrier: CARRIER_CODES[0].code };
    const options = CARRIER_CODES.map(c =>
      `<option value="${c.code}" ${c.code === manual.carrier ? "selected" : ""}>${c.name} ${c.code}</option>`
    ).join("");
    return `
      <div class="problem-item">
        <div class="problem-item-main">
          <div class="problem-item-row1">
            <span class="pi-id">${safeId}</span>
          </div>
          ${product ? `<div class="pi-note">${escapeHtml(product)}</div>` : ""}
        </div>
        <div class="pi-manual-track" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <input type="text" class="form-input" placeholder="物流單號" style="width:170px; padding:7px 10px;"
            data-order-id="${safeId}" value="${escapeHtml(manual.tracking)}" oninput="onUnmatchedManualChange(this)">
          <select class="form-input" style="width:auto; padding:7px 10px; font-family:inherit;"
            data-order-id="${safeId}" onchange="onUnmatchedManualChange(this)">${options}</select>
        </div>
        <label class="pi-delete-check">
          <input type="checkbox" data-order-id="${safeId}" ${checked} onchange="onUnmatchedCheckChange(this)">
          匯出時刪除
        </label>
      </div>
    `;
  }).join("");
}

function updateUnmatchedHint() {
  const parts = [`共 ${lastUnmatchedOrders.length} 筆`];
  if (unmatchedManualMap.size > 0) parts.push(`已手動填號 ${unmatchedManualMap.size} 筆`);
  if (unmatchedDeleteSet.size > 0) parts.push(`已勾選 ${unmatchedDeleteSet.size} 筆待刪除`);
  document.getElementById("unmatchedHint").textContent = parts.join(" · ");
}

function onUnmatchedCheckChange(el) {
  const orderId = el.dataset.orderId;
  if (el.checked) unmatchedDeleteSet.add(orderId);
  else unmatchedDeleteSet.delete(orderId);
  updateUnmatchedHint();
}

// 手動填號/選代碼:不重新渲染清單,避免打字打到一半失去焦點
function onUnmatchedManualChange(el) {
  const orderId = el.dataset.orderId;
  const row = el.closest(".pi-manual-track");
  const tracking = row.querySelector("input").value.trim();
  const carrier = row.querySelector("select").value;
  if (tracking) unmatchedManualMap.set(orderId, { tracking, carrier });
  else unmatchedManualMap.delete(orderId);
  updateUnmatchedHint();
}

function toggleAllUnmatched(checked) {
  if (checked) {
    lastUnmatchedOrders.forEach(o => unmatchedDeleteSet.add(o.orderId));
  } else {
    unmatchedDeleteSet.clear();
  }
  renderUnmatchedSection();
}

// 手動輸入訂單編號刪除:不限「未配對」,已經配對到託運單號的訂單也能直接刪掉
// (客人事後取消、這筆不出貨了)。manualDeleteIds 宣告在 state.js
function addManualDeleteId() {
  const input = document.getElementById("manualDeleteInput");
  const id = input.value.trim();
  if (!id) return;
  manualDeleteIds.add(id);
  input.value = "";
  const hint = document.getElementById("manualDeleteHint");
  hint.textContent = (lineTemplateData && !lineTemplateData.orders.some(o => o.orderId === id))
    ? `⚠ 目前載入的 LINE 模板裡找不到「${id}」,留著沒關係,匯出時找到同編號一樣會刪掉`
    : "";
  renderManualDeleteList();
  input.focus();
}

function removeManualDeleteId(id) {
  manualDeleteIds.delete(id);
  renderManualDeleteList();
}

function renderManualDeleteList() {
  const box = document.getElementById("manualDeleteList");
  if (!box) return;
  if (manualDeleteIds.size === 0) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = [...manualDeleteIds].map(id => {
    const safeId = escapeHtml(id);
    return `
      <div class="problem-item">
        <div class="problem-item-main">
          <div class="problem-item-row1"><span class="pi-id">${safeId}</span></div>
        </div>
        <div class="problem-item-btns">
          <button class="pi-edit" data-order-id="${safeId}" onclick="removeManualDeleteId(this.dataset.orderId)">取消刪除</button>
        </div>
      </div>`;
  }).join("");
}

function generateLogistics() {
  if (!lineTemplateData || !bcDetailData) return;
  setStatus("logisticsStatus", "loading", "產生 LINE 物流單號表中…");

  setTimeout(() => {
    try {
      const { wb, sheetName, orders, carrierCol, trackingCol, origAoa: aoa, origCols } = lineTemplateData;
      const headerRow = aoa[0];
      const colCount = headerRow.length;

      const matched = [];
      const unmatched = [];
      let deletedCount = 0;
      let manualDeletedCount = 0;
      let manualCount = 0;
      orders.forEach(o => {
        if (manualDeleteIds.has(o.orderId)) {
          // 手動輸入訂單編號要刪除的,不管有沒有配對到託運單號都直接跳過
          manualDeletedCount++;
          return;
        }
        const track = bcDetailData.get(o.orderId);
        const manual = track ? null : unmatchedManualMap.get(o.orderId);
        if (!track && unmatchedDeleteSet.has(o.orderId)) {
          // 使用者勾選「匯出時刪除」的未配對訂單,直接跳過、不寫進檔案
          deletedCount++;
          return;
        }

        const rowData = aoa[o.rowIdx].slice();
        while (rowData.length < colCount) rowData.push("");

        if (track) {
          rowData[carrierCol] = "T_CAT";
          rowData[trackingCol] = String(track);
          matched.push(rowData);
        } else if (manual) {
          // 未配對但使用者手動填了物流單號 + 代碼
          rowData[carrierCol] = manual.carrier;
          rowData[trackingCol] = manual.tracking;
          matched.push(rowData);
          manualCount++;
        } else {
          rowData[carrierCol] = "";
          rowData[trackingCol] = "";
          unmatched.push(rowData);
        }
      });

      const newAoa = [headerRow, ...matched, ...unmatched];
      const newWs = XLSX.utils.aoa_to_sheet(newAoa);

      const redFill = { patternType: "solid", fgColor: { rgb: "FFCDD2" } };
      const redFont = { color: { rgb: "B71C1C" }, bold: true };

      for (let i = 0; i < unmatched.length; i++) {
        const excelRow = matched.length + 1 + i;
        for (let c = 0; c < colCount; c++) {
          const addr = XLSX.utils.encode_cell({ r: excelRow, c });
          if (!newWs[addr]) newWs[addr] = { t: "s", v: "" };
          newWs[addr].s = { fill: redFill, font: redFont };
        }
      }

      if (origCols) newWs["!cols"] = origCols;
      newWs["!freeze"] = { xSplit: 0, ySplit: 1 };
      wb.Sheets[sheetName] = newWs;

      const today = todayStr();
      const filename = `LINE物流單號_${today}.xlsx`;
      XLSX.writeFile(wb, filename, { cellStyles: true, bookType: "xlsx" });

      let msg = `✓ 已下載:${filename}  (填入 ${matched.length} 筆${manualCount > 0 ? `,其中 ${manualCount} 筆手動填號` : ""})`;
      if (unmatched.length > 0) msg += `,另有 ${unmatched.length} 筆未對應(已紅色反白排在最下面)`;
      if (deletedCount > 0) msg += `,已刪除 ${deletedCount} 筆勾選的未配對訂單`;
      if (manualDeletedCount > 0) msg += `,已刪除 ${manualDeletedCount} 筆手動輸入編號的訂單`;
      setStatus("logisticsStatus", "success", msg);
    } catch (e) {
      setStatus("logisticsStatus", "error", `✗ 匯出失敗:${e.message}`);
      console.error(e);
    }
  }, 50);
}

