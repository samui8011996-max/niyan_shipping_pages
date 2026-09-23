/**
 * 泥研製所 出貨小幫手 — Cloudflare Pages Function
 * 路由：POST /api （前端 getGsUrl() 回傳 '/api'）
 *
 * 分工：
 *   1. 「包貨字卡」同步（Line禮物 / 離島•郵局 的平台件數）→ 這裡直接寫 D1 niyan-db，
 *      不再繞 Apps Script 的 UrlFetchApp，省掉一趟跨專案往返。
 *   2. 「問題訂單」→ 也直接讀寫 D1（shipping_problems），2026-09-17 起不再用試算表。
 *   3. 「寫廠商試算表」（雷雕/黑熊/永生花/注意品項/盆景公仔組/離島包裹/包裹退貨）
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
      // 問題訂單：純 D1，不碰試算表
      case 'addProblem':        return await handleAddProblem(env, body);
      case 'getProblems':       return await handleGetProblems(env);
      case 'removeProblem':     return await handleRemoveProblem(env, body);
      // 包裹退貨：還是試算表的事，原樣轉送
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
function requireDb(env) {
  if (!env || !env.DB) throw new Error('D1 尚未綁定(DB)');
  return env.DB;
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
  // 舊版 Apps Script（v5）自己也會同步（回傳裡帶 packingSync），為了不讓同一批件數
  // 被灌兩次，它同步成功時這裡就不重複加。
  // ⚠ 只認「同步成功」(packingSync.ok)，不能只看有沒有 packingSync 這個欄位：
  // v5 的 PACKING_API_URL 寫死在 Apps Script 裡，包貨系統搬到 Cloudflare 後那個舊網址
  // 已經失效，v5 會回 packingSync.ok=false；舊的判斷式把「失敗」也當成「已經同步過」而跳過，
  // 結果 Apps Script 和 Cloudflare 兩邊都沒寫，離島件數整個掉了。
  // （Line禮物字卡不經過 Apps Script，所以那張卡一直正常，只有離島•郵局壞掉。）
  const offshoreRows = (body.targets || {})[OFFSHORE_PLATFORM];
  const gasResult = (gas.results || {})[OFFSHORE_PLATFORM];
  const gasSyncedOk = !!(gasResult && gasResult.packingSync && gasResult.packingSync.ok);
  if (Array.isArray(offshoreRows) && offshoreRows.length > 0 && gasResult && gasResult.ok && !gasSyncedOk) {
    const qty = offshoreRows.reduce((s, r) => s + (parseInt(r.qty, 10) || 1), 0);
    try {
      const synced = await upsertPlatform(env.DB, {
        日期: todayTw(), 平台: OFFSHORE_PLATFORM, 物流: OFFSHORE_LOGI, 件數: qty,
        // 離島這幾件的撿貨分組(前端算好送過來的),讓包貨那邊點「離島•郵局」字卡
        // 也看得到郵局這批要撿什麼 —— 以前只有 Line禮物 字卡有明細,離島卡點開是空的。
        撿貨明細: Array.isArray(body.offshorePicking) ? body.offshorePicking : null,
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
    // 分區列印算出來的撿貨分組,一起帶過去給包貨系統點字卡看。舊版前端不會送這個欄位
    撿貨明細: Array.isArray(body.picking) ? body.picking : null,
  });
  return json({ ok: true, updated: !!r.updated, total: r.total || 0 });
}

/* ---------- 問題訂單（D1 shipping_problems）---------- */
// 同一張訂單只會有一筆問題紀錄：訂單編號已存在就更新，不新增重複列
// （沿用舊試算表版 handleAddProblem 的行為，前端流程不用改）
async function handleAddProblem(env, body) {
  const p = body.problem || {};
  const orderId = String(p.orderId || '').trim();
  const type = String(p.type || p.action || '').trim() || '其他';
  const note = String(p.note || '').trim();
  if (!orderId) return json({ ok: false, error: '缺少訂單編號' });

  const DB = requireDb(env);
  const stamp = tw(16).replace(/-/g, '/');   // yyyy/MM/dd HH:mm，跟舊試算表同格式
  const existing = await DB.prepare('SELECT id FROM shipping_problems WHERE "訂單編號"=? LIMIT 1')
    .bind(orderId).first();

  if (existing) {
    await DB.prepare('UPDATE shipping_problems SET "問題類別"=?,"備註"=?,"建立時間"=? WHERE id=?')
      .bind(type, note, stamp, existing.id).run();
    return json({ ok: true, updated: true, id: existing.id });
  }

  const r = await DB.prepare(
    'INSERT INTO shipping_problems ("訂單編號","問題類別","備註","建立時間") VALUES (?,?,?,?)'
  ).bind(orderId, type, note, stamp).run();
  return json({ ok: true, updated: false, id: (r.meta && r.meta.last_row_id) || null });
}

async function handleGetProblems(env) {
  const DB = requireDb(env);
  const rs = await DB.prepare(
    'SELECT id,"訂單編號","問題類別","備註","建立時間" FROM shipping_problems ORDER BY id'
  ).all();
  const problems = (rs.results || []).map(r => ({
    id: r.id,
    orderId: String(r['訂單編號'] || ''),
    type: String(r['問題類別'] || ''),
    note: String(r['備註'] || ''),
    createdAt: String(r['建立時間'] || ''),
  }));
  return json({ ok: true, problems });
}

// id 與訂單編號雙重確認後才刪，避免清單過期時刪錯一筆
async function handleRemoveProblem(env, body) {
  const DB = requireDb(env);
  const id = parseInt(body.id, 10);
  const orderId = String(body.orderId || '').trim();

  if (Number.isFinite(id) && id > 0) {
    const row = await DB.prepare('SELECT "訂單編號" FROM shipping_problems WHERE id=?').bind(id).first();
    if (row && (!orderId || String(row['訂單編號']) === orderId)) {
      await DB.prepare('DELETE FROM shipping_problems WHERE id=?').bind(id).run();
      return json({ ok: true, deletedId: id });
    }
  }
  if (orderId) {
    const row = await DB.prepare('SELECT id FROM shipping_problems WHERE "訂單編號"=? LIMIT 1')
      .bind(orderId).first();
    if (row) {
      await DB.prepare('DELETE FROM shipping_problems WHERE id=?').bind(row.id).run();
      return json({ ok: true, deletedId: row.id });
    }
  }
  return json({ ok: false, error: '找不到對應的問題訂單' });
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

  // 撿貨分組明細(分區列印算出來的),給包貨系統點字卡時看。沒帶就整欄不動
  const picking = Array.isArray(p['撿貨明細']) ? p['撿貨明細'] : null;

  if (!existing) {
    const id = newId('L'), n = now();
    const detail = logi ? [{ 物流: logi, 件數: qty }] : [];
    await DB.prepare(
      'INSERT INTO platform_orders (id,"日期","平台","明細","總件數","已完成","完成日期","備註","建立時間","更新時間","來源平台","完成物流","撿貨明細") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(id, date, platform, JSON.stringify(detail), qty, '', '', '', n, n, '', '',
           picking ? JSON.stringify(picking) : null).run();
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

  // 撿貨明細跟件數一樣是累加的 —— 同一天上傳兩批,包貨那邊要看到兩批加起來的量。
  // 這次沒帶明細(算不出來)就整欄不動,不要把已經有的清掉。
  let pickingSql = '';
  const binds = [JSON.stringify(newDetail), total, now()];
  if (picking) {
    const merged = new Map();
    const prev = jparse(existing['撿貨明細']);
    (Array.isArray(prev) ? prev : []).concat(picking).forEach(d => {
      const k = String(d['品項'] || '').trim();
      if (!k) return;
      merged.set(k, (merged.get(k) || 0) + (Number(d['件數']) || 0));
    });
    pickingSql = ',"撿貨明細"=?';
    binds.push(JSON.stringify([...merged].map(([品項, 件數]) => ({ 品項, 件數 }))));
  }
  binds.push(existing.id);

  await DB.prepare(`UPDATE platform_orders SET "明細"=?,"總件數"=?,"更新時間"=?${pickingSql} WHERE id=?`)
    .bind(...binds).run();
  return { updated: true, total, id: existing.id };
}
