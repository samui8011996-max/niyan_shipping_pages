/**
 * 泥研製所 出貨小幫手 — Cloudflare Pages Function
 * 路由：POST /api （前端 getGsUrl() 回傳 '/api'）
 *
 * 分工：
 *   1. 「包貨字卡」同步（Line禮物 / 離島•郵局 的平台件數）→ 這裡直接寫 D1 niyan-db，
 *      不再繞 Apps Script 的 UrlFetchApp，省掉一趟跨專案往返。
 *   2. 「寫廠商試算表」（雷雕/黑熊/永生花/注意品項/盆景公仔組/離島包裹/問題訂單/包裹退貨）
 *      → 原封不動轉送給現有的 Apps Script，同事看的試算表完全不受影響。
 *
 * D1 綁定名稱：DB（wrangler.toml 的 [[d1_databases]]，Pages Git 部署會自動綁）
 * Apps Script 網址：可用 Cloudflare Pages 環境變數 GS_URL 覆寫，沒設就用下面的預設值
 *   （Apps Script 重新部署拿到新的 /exec 網址時，改環境變數即可，不用動程式碼）
 */

const DEFAULT_GS_URL = 'https://script.google.com/macros/s/AKfycbwidq0nCtNOnMGlMDRXwb_oeRKl6N2TvaQ7McfS0eGOguff5c7Q_xAHQsPqIyj1lE8V/exec';

// 出貨小幫手上傳後要填進包貨系統的兩張平台字卡
const LINE_REGULAR_PLATFORM = 'Line禮物';
const LINE_REGULAR_LOGI = '黑貓';
const OFFSHORE_PLATFORM = '離島•郵局';
const OFFSHORE_LOGI = '郵局';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet() {
  return json({ ok: true, message: '出貨小幫手接收端運作中(Cloudflare Pages)' });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = {};
  try { body = JSON.parse(await request.text()); } catch (_) {}
  const action = body.action || 'append';

  try {
    switch (action) {
      // 一般訂單筆數 → 包貨系統「Line禮物(黑貓)」字卡：純 D1，不碰試算表
      case 'uploadLineRegular': return await handleUploadLineRegular(env, body);
      // 分類訂單 → 廠商試算表（Apps Script），離島那批順便填包貨「離島•郵局(郵局)」字卡
      case 'append':            return await handleAppend(env, body);
      // 問題訂單 / 包裹退貨：全部是試算表的事，原樣轉送
      default:                  return json(await callGas(env, body));
    }
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) });
  }
}

/* ---------- 工具 ---------- */
function json(o) {
  return new Response(JSON.stringify(o), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function tw(len) {                       // 台灣時間
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, len).replace('T', ' ');
}
const now = () => tw(19);                // yyyy-MM-dd HH:mm:ss
const todayTw = () => tw(10);            // yyyy-MM-dd
let _seq = 0;
function newId(prefix) {
  return prefix + Date.now() + ((_seq++ % 1000) * 1000 + Math.floor(Math.random() * 1000));
}
function jparse(v) {
  if (typeof v === 'string' && v) { try { return JSON.parse(v); } catch (_) { return []; } }
  return Array.isArray(v) ? v : [];
}

/* ---------- 轉送 Apps Script（只負責寫 Google 試算表）---------- */
async function callGas(env, body) {
  const url = (env && env.GS_URL) || DEFAULT_GS_URL;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    // Apps Script 掛掉/沒授權時會回 HTML 錯誤頁，直接 JSON.parse 會炸在
    // "Unexpected token '<'"，這裡轉成看得懂的訊息
    return { ok: false, error: `Apps Script 回傳非 JSON（HTTP ${res.status}），請確認網址與部署權限` };
  }
}

/* ---------- 分類訂單：寫試算表 + 離島字卡 ---------- */
async function handleAppend(env, body) {
  const gas = await callGas(env, body);
  if (!gas || !gas.ok) return json(gas || { ok: false, error: '未知錯誤' });

  // 離島那批寫進試算表成功後，順手把件數累加進包貨系統的「離島•郵局」平台字卡。
  // 舊版 Apps Script 自己會同步（回傳裡帶 packingSync），若偵測到就不重複加，
  // 避免 Apps Script 還沒換成新版時同一批件數被灌兩次。
  const offshoreRows = (body.targets || {})[OFFSHORE_PLATFORM];
  const gasResult = (gas.results || {})[OFFSHORE_PLATFORM];
  if (Array.isArray(offshoreRows) && offshoreRows.length > 0 && gasResult && gasResult.ok && !gasResult.packingSync) {
    const qty = offshoreRows.reduce((s, r) => s + (parseInt(r.qty, 10) || 1), 0);
    try {
      const synced = await upsertPlatform(env.DB, {
        日期: todayTw(), 平台: OFFSHORE_PLATFORM, 物流: OFFSHORE_LOGI, 件數: qty,
      });
      gasResult.packingSync = { ok: true, ...synced };
    } catch (err) {
      gasResult.packingSync = { ok: false, error: err.message || String(err) };
    }
  }
  return json(gas);
}

/* ---------- 一般訂單筆數 → 包貨「Line禮物」字卡 ---------- */
async function handleUploadLineRegular(env, body) {
  const date = String(body.date || '').trim();
  const count = parseInt(body.count, 10) || 0;
  if (!date) return json({ ok: false, error: '缺少日期' });
  if (count <= 0) return json({ ok: true, updated: false, total: 0, skipped: true });

  const r = await upsertPlatform(env.DB, {
    日期: date, 平台: LINE_REGULAR_PLATFORM, 物流: LINE_REGULAR_LOGI, 件數: count,
  });
  return json({ ok: true, updated: !!r.updated, total: r.total || 0 });
}

/* ---------- 包貨系統 platform_orders 的 upsert ----------
 * 跟 niyan_packing 的 functions/api.js upsertPlatform 同一套邏輯：
 * 同一天同平台已有紀錄就把件數「累加」進對應物流，沒有才新增一筆，
 * 不整筆覆蓋（包貨系統當天可能已經手動送出同平台的表單）。
 */
async function upsertPlatform(DB, p) {
  const date = String(p['日期'] || '').trim();
  const platform = String(p['平台'] || '').trim();
  const logi = String(p['物流'] || '').trim();
  const qty = Number(p['件數']) || 0;
  if (!DB) throw new Error('D1 尚未綁定(DB)');
  if (!date || !platform || qty <= 0) return { skipped: true, updated: false, total: 0 };

  const existing = await DB.prepare(
    'SELECT * FROM platform_orders WHERE "日期"=? AND "平台"=? LIMIT 1'
  ).bind(date, platform).first();

  if (!existing) {
    const id = newId('L'), n = now();
    const detail = logi ? [{ 物流: logi, 件數: qty }] : [];
    await DB.prepare(
      'INSERT INTO platform_orders (id,"日期","平台","明細","總件數","已完成","完成日期","備註","建立時間","更新時間","來源平台","完成物流") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(id, date, platform, JSON.stringify(detail), qty, '', '', '', n, n, '', '').run();
    return { updated: false, total: qty, id };
  }

  const detail = jparse(existing['明細']);
  let found = false;
  const newDetail = detail.map(d => {
    if (logi && d['物流'] === logi) { found = true; return { ...d, 件數: (Number(d['件數']) || 0) + qty }; }
    return d;
  });
  if (!found) newDetail.push(logi ? { 物流: logi, 件數: qty } : { 件數: qty });
  const total = newDetail.reduce((s, d) => s + (Number(d['件數']) || 0), 0);
  await DB.prepare('UPDATE platform_orders SET "明細"=?,"總件數"=?,"更新時間"=? WHERE id=?')
    .bind(JSON.stringify(newDetail), total, now(), existing.id).run();
  return { updated: true, total, id: existing.id };
}
