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
      // 只補「離島•郵局」字卡，完全不碰試算表：
      // 試算表已經寫好、但字卡沒進去時用這個重送，不會在試算表留下重複列。
      // body.rows = [{orderId, qty}]，body.items = [{訂單編號,品項,件數}]（可省略）
      case 'syncOffshoreCard':  return json({ ok: true, ...(await syncOffshoreToCard(env, body.rows || [], body.items)) });
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
// Apps Script 的 /exec POST 會先回 302，轉到 script.googleusercontent.com 的一次性網址
// 才拿得到內容。2026-09-23 實測：同一個網址連打三次，一次 200、兩次那段轉址 404。
// 重點是 404 發生在「腳本已經跑完、列已經寫進試算表」之後 —— 所以不能無腦重試，
// 會把同一批訂單寫兩次。規則：
//   1. 還沒轉址就失敗(res.url 還在 script.google.com) → 腳本沒跑到，重試絕對安全
//   2. 已經轉址才失敗 → 只有 Apps Script 部署成 v7 以上(支援 requestId 去重)才敢重試
// v7 的 doGet 訊息裡有 requestId 這個字，拿它當特徵，探一次就記在 isolate 裡。
let _gasIdempotent = null;
async function gasSupportsRequestId(env) {
  if (_gasIdempotent !== null) return _gasIdempotent;
  try {
    const res = await fetch((env && env.GS_URL) || DEFAULT_GS_URL, { method: 'GET' });
    _gasIdempotent = /requestId/.test(await res.text());
  } catch (_) {
    _gasIdempotent = false;
  }
  return _gasIdempotent;
}

async function callGas(env, body) {
  const url = (env && env.GS_URL) || DEFAULT_GS_URL;
  // 重試時沿用同一個 requestId，v7 才認得出「這批我跑過了」，直接回上次的結果不重寫
  const payload = JSON.stringify({ ...body, requestId: body.requestId || newId('R') });
  const canRetryAfterRun = await gasSupportsRequestId(env);
  let last = null;

  for (let i = 1; i <= 3; i++) {
    let res, text;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: payload,
      });
      text = await res.text();
    } catch (err) {
      // 連不上：腳本一定沒跑到，直接重試
      last = { ok: false, error: `連不到 Apps Script：${err.message || String(err)}（試了 ${i} 次）` };
      continue;
    }

    try {
      return JSON.parse(text);
    } catch (_) {
      // Apps Script 掛掉/沒授權/轉址 404 時會回 HTML，直接 JSON.parse 會炸在 "Unexpected token '<'"
      const redirected = /googleusercontent\.com/.test(res.url || '');
      last = {
        ok: false,
        error: `Apps Script 回傳非 JSON（HTTP ${res.status}，試了 ${i} 次）` +
               (redirected && !canRetryAfterRun
                 ? '。腳本可能已經寫進試算表了，請先確認試算表再決定要不要重送'
                 : '，請確認網址與部署權限'),
      };
      if (redirected && !canRetryAfterRun) break;   // 已經寫進去了又不能去重，不敢再送
    }
  }
  return last;
}

/* ---------- 分類訂單：寫試算表 + 離島字卡 ---------- */
// 這裡是兩件互相獨立的事：
//   1. 把分類訂單轉送給 Apps Script 寫 Google 試算表（同事看的那幾張表）
//   2. 把離島那批的件數填進包貨系統的「離島•郵局」平台字卡（D1）
// 以前第 2 件事綁在第 1 件成功之後才做，結果只要試算表那邊出一點狀況
// （權限、配額、被搬動的工作表…），Apps Script 回 results["離島•郵局"].ok=false，
// 包貨的離島字卡就整天空白沒人知道 —— 但那批貨明明已經出了。
// 現在改成兩邊各做各的，試算表失敗不影響字卡，前端會分開回報兩個結果。
async function handleAppend(env, body) {
  const offshoreRows = (body.targets || {})[OFFSHORE_PLATFORM];
  // Apps Script 連不上/逾時會 throw,不能讓它把下面的字卡同步一起拖下水
  let gas;
  try {
    gas = await callGas(env, body);
  } catch (err) {
    gas = { ok: false, error: `試算表轉送失敗:${err.message || String(err)}` };
  }

  let packingSync = null;
  if (Array.isArray(offshoreRows) && offshoreRows.length > 0) {
    // 舊版 Apps Script（v5）自己也會同步（回傳帶 packingSync），它成功時就不要重複加
    const gasResult = (gas && gas.results || {})[OFFSHORE_PLATFORM];
    const gasSyncedOk = !!(gasResult && gasResult.packingSync && gasResult.packingSync.ok);
    if (!gasSyncedOk) {
      try {
        packingSync = { ok: true, ...(await syncOffshoreToCard(env, offshoreRows, body.offshoreItems)) };
      } catch (err) {
        packingSync = { ok: false, error: err.message || String(err) };
      }
    }
  }

  const out = (gas && typeof gas === 'object') ? gas : { ok: false, error: '未知錯誤' };
  if (packingSync) {
    // 試算表整包失敗時 results 可能根本沒有這個分類，還是要讓前端看得到字卡的結果
    out.results = out.results || {};
    out.results[OFFSHORE_PLATFORM] = { ...(out.results[OFFSHORE_PLATFORM] || {}), packingSync };
    out.packingSync = packingSync;
  }
  return json(out);
}

// 離島件數 → 包貨「離島•郵局」字卡。
// 同一天同一張訂單只算一次：重新下載出貨表、補上幾張新單後再按一次一鍵上傳是日常操作，
// 舊的寫法是整批累加，按第二次就會變成雙倍（3 件按兩次 = 6 件）。所以先把訂單編號寫進
// shipping_offshore_synced，只有真的第一次出現的那幾張才加進字卡。
async function syncOffshoreToCard(env, rows, items) {
  const DB = requireDb(env);
  const date = todayTw();
  const byOrder = new Map();
  (Array.isArray(items) ? items : []).forEach(it => {
    const id = String(it['訂單編號'] || '').trim();
    if (id) byOrder.set(id, it);
  });

  const fresh = [];
  let skipped = 0;
  for (const r of rows) {
    const orderId = String(r.orderId || '').trim();
    const qty = parseInt(r.qty, 10) || 1;
    if (!orderId) { fresh.push({ orderId, qty }); continue; }   // 沒訂單編號就無從去重，照算
    const res = await DB.prepare(
      'INSERT OR IGNORE INTO shipping_offshore_synced ("日期","訂單編號","件數","建立時間") VALUES (?,?,?,?)'
    ).bind(date, orderId, qty, now()).run();
    if (res.meta && res.meta.changes) fresh.push({ orderId, qty });
    else skipped++;
  }

  const qty = fresh.reduce((s, r) => s + r.qty, 0);
  if (qty <= 0) return { skipped: true, duplicated: skipped, updated: false, total: 0 };

  // 明細只算這次真的加進去的那幾張單，跟件數用同一批，重複上傳不會只長明細不長件數
  const picking = [];
  const merged = new Map();
  fresh.forEach(f => {
    const it = byOrder.get(f.orderId);
    if (!it) return;
    const k = String(it['品項'] || '').trim();
    if (!k) return;
    merged.set(k, (merged.get(k) || 0) + (Number(it['件數']) || f.qty));
  });
  merged.forEach((件數, 品項) => picking.push({ 品項, 件數 }));

  const r = await upsertPlatform(DB, {
    日期: date, 平台: OFFSHORE_PLATFORM, 物流: OFFSHORE_LOGI, 件數: qty,
    撿貨明細: picking.length ? picking : null,
  });

  // 寫完立刻讀回來,並回報這個資料庫的指紋(總列數)。
  // 2026-09-23 遇到「回報寫入成功、但包貨系統跟 D1 查詢都看不到那一列」的狀況,
  // 這段是用來分辨:到底是根本沒寫進去、還是寫進了另一個 D1。
  let verify = null;
  try {
    const back = await DB.prepare(
      'SELECT id,"總件數" FROM platform_orders WHERE "日期"=? AND "平台"=? LIMIT 1'
    ).bind(date, OFFSHORE_PLATFORM).first();
    const fp = await DB.prepare(
      'SELECT (SELECT COUNT(*) FROM platform_orders) AS pf, (SELECT COUNT(*) FROM shipping_offshore_synced) AS dedup'
    ).first();
    verify = {
      found: !!back,
      qty: back ? back['總件數'] : 0,
      id: back ? back.id : null,
      pf: fp ? fp.pf : null,
      dedup: fp ? fp.dedup : null,
    };
  } catch (err) {
    verify = { error: err.message || String(err) };
  }

  return { ...r, added: qty, duplicated: skipped, verify };
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
