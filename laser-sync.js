// ===================================================================
// 雷雕訂單 → D1(2026-10-21 起取代「雷雕試算表」)
// 按「上傳包貨平台與試算表」時,雷雕類的訂單不再寫 Google 試算表,改寫進 D1 的 laser_orders,
// 雷雕網站(niyan-laser-pages)打開時直接讀。超過 14 天的資料後端會自己刪(functions/api.js)。
// 每筆只送:訂單編號、品項(原本的完整備註,雷雕網站從這裡抓星座/顏色/刻印圖案)、類型、刻印文字。
// 姓名、電話、地址都不送(使用者 2026-10-21)。
//
// 「類型」照雷雕網站判斷檔名類別的同一套規則算(niyan_Laser 的 fnCategoryFor + FILENAME_RULES):
//   辦公室一對(中) / 辦公室單隻(中) / 一對小 / 雷雕大、木片大 / 星座貓雷雕小 / 星座小卡
// 雷雕網站那邊改規則的話,這裡也要跟著改,兩邊才會一樣。
// ===================================================================
const LASER_SITE_URL = "https://niyan-laser-pages.pages.dev/";

function laserParseNote(note) {
  const s = String(note || "").replace(/\s*[xX×]\d+\s*$/, "");
  let zodiac = (s.match(/星座[:：]\s*(.+?)\s*(?=刻印文字|[,，]|$)/) || [])[1]?.trim() || "";
  zodiac = zodiac.replace(/[(（][^)）]*[)）]/g, "").trim();
  const pattern = (s.match(/刻印圖案[:：]\s*([^,，\/]+?)\s*(?=[,，\/]|\s\S+[:：]|$)/) || [])[1]?.trim() || "";
  const text = (s.match(/刻印文字[:：]\s*(.+)$/) || [])[1]?.trim() || "";
  return { zodiac, pattern, text };
}

function laserTypeFor(note) {
  const t = String(note || "");
  const o = laserParseNote(t);
  const size = (t.match(/[(（]([小中大])[)）]/) || [])[1] || "";
  if (t.includes("玻璃球") && (o.zodiac || /座/.test(o.pattern))) return "星座小卡";
  if (t.includes("辦公室")) return (t.includes("一對") ? "辦公室一對" : "辦公室單隻") + (size ? "(" + size + ")" : "");
  if (t.includes("胖胖貓") && t.includes("一對")) return "一對" + size;
  if (t.includes("胖胖招財貓") && !t.includes("招福")) return (o.text ? "雷雕" : "木片") + size;
  if (o.zodiac) return "星座貓雷雕" + size;
  return "";
}

function buildLaserRows(rows, date) {
  return rows.filter(r => (r["_類別列表"] || []).includes("雷雕")).map(r => {
    const item = r["_備註完整"] ?? r["_備註"] ?? "";
    const type = laserTypeFor(item);
    return {
      key: String(r["商品訂單編號"] || "").trim() || (String(r["訂單編號"] || "") + "|" + item),
      orderId: String(r["訂單編號"] || "").trim(),
      item,
      type: type ? "【" + type + "】" : "",
      text: laserParseNote(item).text,
      date,
    };
  });
}

// 回傳一行給狀態列用的摘要(失敗不擋後面的試算表/字卡上傳)
async function uploadLaserOrders(laserRows) {
  if (!laserRows.length) return "";
  try {
    const res = await fetch(getGsUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "addLaserOrders", rows: laserRows }),
    });
    const data = await res.json();
    console.log("[雷雕上傳回應]", data);
    return data.ok ? `雷雕 ${data.count}(已送到雷雕網站)` : `雷雕上傳失敗(${data.error || "未知錯誤"})`;
  } catch (e) {
    return `雷雕上傳失敗(${e.message})`;
  }
}

function openLaserSite() { window.open(LASER_SITE_URL, "_blank"); }

if (typeof module !== "undefined" && module.exports) {
  module.exports = { laserTypeFor, laserParseNote, buildLaserRows };
}
