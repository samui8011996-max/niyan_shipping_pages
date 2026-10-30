// ===================================================================
// 遊戲名單(官網分頁,2026-10-30)
// niyan-game.pages.dev 的小遊戲領券時會留 Email,存在另一個 D1(game 資料庫的 game_leads 表)。
// 這裡只負責看:按「載入名單」→ /api getGameLeads → 列出來,可以複製全部信箱 / 下載 CSV。
//
// 信箱是客人個資,出貨小幫手又是誰都打得開的網址,所以要密碼(使用者 2026-10-30 選的):
// 密碼設在 Cloudflare Pages 的環境變數 LEADS_KEY,後端比對;這台瀏覽器輸入過一次就記在 localStorage。
// ===================================================================
const LEADS_KEY_STORE = "niyan-leads-key";
const LEADS_GAME_NAMES = { catch: "接東西", zodiac: "星座", guess: "猜猜", other: "其他" };
let leadsCache = [];

function leadsGetKey() {
  try { return localStorage.getItem(LEADS_KEY_STORE) || ""; } catch (e) { return ""; }
}
function leadsSetKey(k) {
  try { k ? localStorage.setItem(LEADS_KEY_STORE, k) : localStorage.removeItem(LEADS_KEY_STORE); } catch (e) {}
}

function leadsTime(ms) {
  const d = new Date(Number(ms) || 0);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadGameLeads() {
  let key = leadsGetKey();
  if (!key) {
    key = (prompt("遊戲名單密碼(Cloudflare 設定的 LEADS_KEY):") || "").trim();
    if (!key) return;
  }
  setStatus("leadsStatus", "loading", "讀取中…");
  try {
    const res = await fetch(getGsUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "getGameLeads", key }),
    });
    const data = await res.json();
    if (!data.ok) {
      if (data.badKey) leadsSetKey("");   // 密碼錯就忘掉,下次再問
      throw new Error(data.error || "未知錯誤");
    }
    leadsSetKey(key);
    leadsCache = data.leads || [];
    renderGameLeads();
    setStatus("leadsStatus", "success", `✓ 共 ${leadsCache.length} 個信箱`);
  } catch (e) {
    setStatus("leadsStatus", "error", "✗ " + e.message);
  }
}

function renderGameLeads() {
  const box = document.getElementById("leadsList");
  document.getElementById("leadsCopyBtn").disabled = !leadsCache.length;
  document.getElementById("leadsCsvBtn").disabled = !leadsCache.length;
  box.innerHTML = leadsCache.length ? leadsCache.map(l => `
    <div class="attn-row leads-row">
      <span class="attn-date">${escapeHtml(leadsTime(l.created_at))}</span>
      <span class="attn-note">${escapeHtml(l.email)}</span>
      <span class="attn-sn">${escapeHtml(LEADS_GAME_NAMES[l.game] || l.game || "")} · ${escapeHtml(l.score)} 分${l.src ? " · " + escapeHtml(l.src) : ""}${l.consent ? "" : " · 不收電子報"}</span>
    </div>`).join("") : `<div class="attn-empty">還沒有人留信箱</div>`;
}

// 複製只給「同意收電子報」的信箱,一行一個,直接貼進電子報後台
function copyGameLeads() {
  const list = leadsCache.filter(l => l.consent).map(l => l.email);
  navigator.clipboard.writeText(list.join("\n")).then(
    () => setStatus("leadsStatus", "success", `✓ 已複製 ${list.length} 個信箱(只含同意收電子報的)`),
    () => setStatus("leadsStatus", "error", "✗ 複製失敗,瀏覽器不讓寫剪貼簿"));
}

function downloadGameLeadsCsv() {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Email", "遊戲", "最高分", "來源", "同意電子報", "第一次領券"]]
    .concat(leadsCache.map(l => [l.email, LEADS_GAME_NAMES[l.game] || l.game, l.score, l.src || "", l.consent ? "是" : "否", leadsTime(l.created_at)]));
  const blob = new Blob(["﻿" + rows.map(r => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `遊戲名單_${todayStr()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
