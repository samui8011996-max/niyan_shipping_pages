/**
 * 泥研製所 出貨小幫手 — Cloudflare Pages Function
 * 路由：POST /api （前端 getGsUrl() 回傳 '/api'）
 *
 * 分工：
 *   1. 「包貨字卡」同步（Line禮物 / 離島•郵局 的平台件數）→ 這裡直接寫 D1 niyan-db，
 *      不再繞 Apps Script 的 UrlFetchApp，省掉一趟跨專案往返。
 *   2. 「問題訂單」→ 也直接讀寫 D1（shipping_problems），2026-09-17 起不再用試算表。
 *   3. 「包裹退貨」→ 也直接讀寫 D1（shipping_returns），2026-09-23 起不再用試算表。
 *   4. 「寫廠商試算表」（雷雕/黑熊/永生花/注意品項/盆景公仔組/離島包裹）
 *      → 原封不動轉送給現有的 Apps Script，同事看的那幾張表完全不受影響。
 *
 * D1 綁定名稱：DB（wrangler.toml 的 [[d1_databases]]，Pages Git 部署會自動綁）
 * Apps Script 網址：可用 Cloudflare Pages 環境變數 GS_URL 覆寫，沒設就用下面的預設值
 *   （Apps Script 重新部署拿到新的 /exec 網址時，改環境變數即可，不用動程式碼）
 */

const DEFAULT_GS_URL = 'https://script.google.com/macros/s/AKfycbzPB6LIU4BLk-c_B4eVEILuIYpFD_5jWPDUv34CBO3k3E8y_zYwsELHHL7797dWXkfs/exec';

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
      // 包裹退貨：純 D1，不碰試算表
      case 'addReturn':         return await handleAddReturn(env, body);
      case 'getReturns':        return await handleGetReturns(env);
      case 'removeReturn':      return await handleRemoveReturn(env, body);
      // 其餘（分類訂單 → 廠商試算表）原樣轉送
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

/* ---------- 已同步列的去重表 ----------
 * 一張表管所有「已經算進包貨字卡」的列：日期 + 平台 + 這一列的唯一鍵。
 * 鍵值：離島用「訂單編號」（一張單就是一件）；Line禮物用「商品訂單編號」
 * （同一張訂單可能有好幾個品項列，每列各算一筆，跟字卡的筆數定義一致）。
 * 沒有它的話，重新下載出貨表補幾張新單再按一次上傳，整批都會被重複累加。
 * 用 CREATE TABLE IF NOT EXISTS 就地建表，不必另外跑 migration。
 */
let _tablesReady = false;
async function ensureSyncTables(DB) {
  if (_tablesReady) return;
  await DB.prepare(
    'CREATE TABLE IF NOT EXISTS shipping_card_synced (' +
    '"日期" TEXT NOT NULL, "平台" TEXT NOT NULL, "鍵值" TEXT NOT NULL, ' +
    '"數量" INTEGER NOT NULL DEFAULT 1, "建立時間" TEXT, ' +
    'PRIMARY KEY ("日期","平台","鍵值"))'
  ).run();
  _tablesReady = true;
}

// rows: [{ key, qty, item }] → 回報哪幾列是今天第一次出現（真的要加進字卡的）
async function claimFreshRows(DB, date, platform, rows) {
  await ensureSyncTables(DB);
  const fresh = [];
  let duplicated = 0;
  for (const r of rows) {
    if (!r.key) { fresh.push(r); continue; }     // 沒有唯一鍵就無從去重，照算
    // 離島 2026-09-23 當天是寫在舊的 shipping_offshore_synced，沿用著不搬家，
    // 只在這裡多查一次，免得當天那幾張單被重複加一次
    if (platform === OFFSHORE_PLATFORM) {
      const legacy = await DB.prepare(
        'SELECT 1 FROM shipping_offshore_synced WHERE "日期"=? AND "訂單編號"=?'
      ).bind(date, r.key).first().catch(() => null);
      if (legacy) { duplicated++; continue; }
    }
    const res = await DB.prepare(
      'INSERT OR IGNORE INTO shipping_card_synced ("日期","平台","鍵值","數量","建立時間") VALUES (?,?,?,?,?)'
    ).bind(date, platform, r.key, r.qty || 1, now()).run();
    if (res.meta && res.meta.changes) fresh.push(r); else duplicated++;
  }
  return { fresh, duplicated };
}

// 卡片被刪掉(或今天根本還沒有)→ 之前記的「已同步」就過期了,整組清掉重來。
// 2026-09-23 踩到:包貨那邊把當天的卡片刪掉重傳是日常操作,但去重紀錄還在,
// 56 筆全被當成重複,卡片再也加不回來,看起來就像「完全不會上傳了」。
// 去重的目的只是「同一張卡不要被同一批訂單灌兩次」,卡片不在了就沒有東西要保護。
async function resetClaimsIfCardMissing(DB, date, platform) {
  const row = await getCardRow(DB, date, platform);
  if (row) return false;
  await ensureSyncTables(DB);
  await DB.prepare('DELETE FROM shipping_card_synced WHERE "日期"=? AND "平台"=?')
    .bind(date, platform).run();
  if (platform === OFFSHORE_PLATFORM) {
    // 舊表(2026-09-23 當天的離島紀錄還在裡面)也要一起清,不然離島一樣加不回來
    await DB.prepare('DELETE FROM shipping_offshore_synced WHERE "日期"=?')
      .bind(date).run().catch(() => {});
  }
  return true;
}

async function countClaims(DB, date, platform) {
  await ensureSyncTables(DB);
  const r = await DB.prepare(
    'SELECT COUNT(*) AS n FROM shipping_card_synced WHERE "日期"=? AND "平台"=?'
  ).bind(date, platform).first();
  return (r && r.n) || 0;
}

async function getCardRow(DB, date, platform) {
  return await DB.prepare(
    'SELECT * FROM platform_orders WHERE "日期"=? AND "平台"=? LIMIT 1'
  ).bind(date, platform).first();
}

// [{item:{品項,數量}}] → [{品項,件數}]，同品項加總
function tallyItems(rows) {
  const merged = new Map();
  rows.forEach(r => {
    const it = r.item || {};
    const k = String(it['品項'] || '').trim();
    if (!k) return;
    merged.set(k, (merged.get(k) || 0) + (Number(it['數量']) || Number(r.qty) || 1));
  });
  return [...merged].map(([品項, 件數]) => ({ 品項, 件數 }));
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
      const out = JSON.parse(text);
      // Google 的轉址偶爾會彈回 /exec 本身,於是跑的是 doGet,回來的是「運作中」那句版本訊息。
      // 它一樣是 ok:true 的 JSON,前端會當成上傳成功 —— 但根本沒寫任何東西。
      // 2026-09-23 實測 4 次就中 1 次。認出來當作這次失敗,能重試就重試。
      const isDoGet = out && typeof out.message === 'string' && out.message.indexOf('運作中') >= 0;
      if (!isDoGet) return out;
      last = { ok: false, error: `Apps Script 轉址彈回首頁沒真的執行(試了 ${i} 次)` };
      if (!canRetryAfterRun) break;
      continue;
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

  await resetClaimsIfCardMissing(DB, date, OFFSHORE_PLATFORM);
  const claimed = await claimFreshRows(DB, date, OFFSHORE_PLATFORM, rows.map(r => {
    const key = String(r.orderId || '').trim();
    return { key, qty: parseInt(r.qty, 10) || 1, item: byOrder.get(key) };
  }));
  const fresh = claimed.fresh;
  const skipped = claimed.duplicated;

  // 離島一張單就是一件,件數照數量加總
  const qty = fresh.reduce((s, r) => s + r.qty, 0);
  if (qty <= 0) {
    const row = await getCardRow(DB, date, OFFSHORE_PLATFORM);
    return { skipped: true, duplicated: skipped, updated: false, total: (row && row['總件數']) || 0 };
  }

  // 明細只算這次真的加進去的那幾張單,跟件數用同一批,重複上傳不會只長明細不長件數
  const picking = tallyItems(fresh);

  const r = await upsertPlatform(DB, {
    日期: date, 平台: OFFSHORE_PLATFORM, 物流: OFFSHORE_LOGI, 件數: qty,
    撿貨明細: picking.length ? picking : null,
  });

  // 寫完立刻讀回來,並回報這個資料庫的指紋(總列數)。
  // 2026-09-23 遇到「回報寫入成功、但包貨系統跟 D1 查詢都看不到那一列」的狀況,
  // 這段是用來分辨:到底是根本沒寫進去、還是寫進了另一個 D1。
  let verify = null;
  try {
    const back = await getCardRow(DB, date, OFFSHORE_PLATFORM);
    const fp = await DB.prepare(
      'SELECT (SELECT COUNT(*) FROM platform_orders) AS pf, (SELECT COUNT(*) FROM shipping_card_synced) AS dedup'
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

  const items = Array.isArray(body.items) ? body.items : null;

  // 舊版前端沒送逐列明細 → 維持原本「整批累加」的行為
  if (!items || items.length === 0) {
    if (count <= 0) return json({ ok: true, updated: false, total: 0, skipped: true });
    const r = await upsertPlatform(requireDb(env), {
      日期: date, 平台: LINE_REGULAR_PLATFORM, 物流: LINE_REGULAR_LOGI, 件數: count,
      撿貨明細: Array.isArray(body.picking) ? body.picking : null,
    });
    return json({ ok: true, updated: !!r.updated, total: r.total || 0 });
  }

  // 逐列去重:鍵值用「商品訂單編號」,同一天同一列只算一次,
  // 所以補了幾張新單之後再按一次上傳,字卡只會多那幾筆,不會整批變兩倍
  const DB = requireDb(env);
  await resetClaimsIfCardMissing(DB, date, LINE_REGULAR_PLATFORM);
  const hadClaims = (await countClaims(DB, date, LINE_REGULAR_PLATFORM)) > 0;
  const { fresh, duplicated } = await claimFreshRows(DB, date, LINE_REGULAR_PLATFORM, items.map(it => ({
    key: String(it['鍵值'] || '').trim(),
    qty: Number(it['數量']) || 1,
    item: it,
  })));

  // 字卡的件數一向是「筆數」(一列算一筆),撿貨明細才是照數量加總
  const qty = fresh.length;
  const existing = await getCardRow(DB, date, LINE_REGULAR_PLATFORM);

  // 轉換期:去重上線前這張卡就已經有數字了(同一份出貨表算出來的),
  // 第一次逐列上傳不累加,直接用這次算出來的覆蓋,不然會變兩倍
  const mode = (!hadClaims && existing) ? 'set' : 'add';

  if (qty <= 0) {
    return json({
      ok: true, updated: false, skipped: true, duplicated,
      total: (existing && existing['總件數']) || 0,
    });
  }

  const r = await upsertPlatform(DB, {
    日期: date, 平台: LINE_REGULAR_PLATFORM, 物流: LINE_REGULAR_LOGI, 件數: qty,
    撿貨明細: tallyItems(fresh),
  }, mode);

  return json({ ok: true, updated: !!r.updated, total: r.total || 0, added: qty, duplicated, mode });
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

/* ---------- 包裹退貨（D1 shipping_returns）---------- */
// 2026-09-23 從 Google 試算表搬過來。舊試算表是「同一張工作表橫向並排三個平台區塊」，
// 刪一筆要把底下整塊往上搬（不能 deleteRow，會錯開旁邊平台），列號還會跟著變動。
// 搬到 D1 之後一筆就是一列，平台只是一個欄位，那些位移邏輯全部不需要了。
// 前端原本認的 rowIndex 改成 D1 的 id。
const RETURN_PLATFORMS = ['line禮物', '蝦皮', 'mo'];
// 蝦皮、mo 沒有電聯欄位，那四欄留空即可（欄位本身共用一張表）
const RETURN_FIELDS = [
  ['date', '日期'],
  ['orderId', '訂單編號'],
  ['trackingNo', '託運單號'],
  ['reason', '原因'],
  ['result', '結果'],
  ['contact1', '第一次電聯'],
  ['contact2', '第二次電聯'],
  ['contact3', '第三次電聯'],
  ['contact4', '第四次電聯'],
];

let _returnsReady = false;
async function ensureReturnsTable(DB) {
  if (_returnsReady) return;
  await DB.prepare(
    'CREATE TABLE IF NOT EXISTS shipping_returns (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT, "平台" TEXT NOT NULL, "日期" TEXT, ' +
    '"訂單編號" TEXT, "託運單號" TEXT, "原因" TEXT, "結果" TEXT, ' +
    '"第一次電聯" TEXT, "第二次電聯" TEXT, "第三次電聯" TEXT, "第四次電聯" TEXT, ' +
    '"建立時間" TEXT)'
  ).run();
  // 同平台同訂單編號只會有一筆（重送是更新）。舊試算表的蝦皮/mo 有幾列沒填訂單編號，
  // 所以是「訂單編號不是空的才唯一」的部分索引，不然那幾列會互相擋住匯不進來。
  await DB.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_returns_key ' +
    `ON shipping_returns("平台","訂單編號") WHERE "訂單編號" <> ''`
  ).run();
  _returnsReady = true;
}

function returnValues(record) {
  return RETURN_FIELDS.map(([k]) => String(record[k] ?? '').trim());
}

// 同平台同訂單編號已經有一筆就更新那筆，不新增重複列（沿用舊試算表版 handleAddReturn 的行為）。
// 前端在「編輯」時會把那一筆的 id 一起送回來，改訂單編號才不會變成多出一筆新的。
async function handleAddReturn(env, body) {
  const platform = String(body.platform || '').trim();
  if (!RETURN_PLATFORMS.includes(platform)) return json({ ok: false, error: '未知平台: ' + platform });

  const record = body.record || {};
  const orderId = String(record.orderId || '').trim();
  if (!orderId) return json({ ok: false, error: '缺少訂單編號' });

  const DB = requireDb(env);
  await ensureReturnsTable(DB);

  const values = returnValues({ ...record, orderId });
  const setSql = RETURN_FIELDS.map(([, col]) => `"${col}"=?`).join(',');

  // 編輯既有那一筆
  const editId = parseInt(body.id, 10);
  if (Number.isFinite(editId) && editId > 0) {
    const row = await DB.prepare('SELECT id FROM shipping_returns WHERE id=? AND "平台"=?')
      .bind(editId, platform).first();
    if (row) {
      await DB.prepare(`UPDATE shipping_returns SET ${setSql} WHERE id=?`).bind(...values, editId).run();
      return json({ ok: true, updated: true, id: editId });
    }
  }

  const existing = await DB.prepare(
    'SELECT id FROM shipping_returns WHERE "平台"=? AND "訂單編號"=? LIMIT 1'
  ).bind(platform, orderId).first();
  if (existing) {
    await DB.prepare(`UPDATE shipping_returns SET ${setSql} WHERE id=?`).bind(...values, existing.id).run();
    return json({ ok: true, updated: true, id: existing.id });
  }

  const cols = RETURN_FIELDS.map(([, col]) => `"${col}"`).join(',');
  const marks = RETURN_FIELDS.map(() => '?').join(',');
  const r = await DB.prepare(
    `INSERT INTO shipping_returns ("平台",${cols},"建立時間") VALUES (?,${marks},?)`
  ).bind(platform, ...values, now()).run();
  return json({ ok: true, updated: false, id: (r.meta && r.meta.last_row_id) || null });
}

async function handleGetReturns(env) {
  const DB = requireDb(env);
  await ensureReturnsTable(DB);
  const cols = RETURN_FIELDS.map(([, col]) => `"${col}"`).join(',');
  const rs = await DB.prepare(`SELECT id,"平台",${cols} FROM shipping_returns ORDER BY id`).all();

  const returns = {};
  RETURN_PLATFORMS.forEach(p => { returns[p] = []; });
  (rs.results || []).forEach(row => {
    const platform = String(row['平台'] || '').trim();
    if (!returns[platform]) returns[platform] = [];
    const rec = { id: row.id };
    RETURN_FIELDS.forEach(([k, col]) => { rec[k] = String(row[col] || ''); });
    returns[platform].push(rec);
  });
  return json({ ok: true, returns });
}

// id 與訂單編號雙重確認後才刪，避免清單過期時刪錯一筆
// （舊試算表那幾列沒有訂單編號，所以訂單編號是空的就只認 id）
async function handleRemoveReturn(env, body) {
  const platform = String(body.platform || '').trim();
  const DB = requireDb(env);
  await ensureReturnsTable(DB);

  const id = parseInt(body.id, 10);
  const orderId = String(body.orderId || '').trim();

  if (Number.isFinite(id) && id > 0) {
    const row = await DB.prepare('SELECT "訂單編號","平台" FROM shipping_returns WHERE id=?').bind(id).first();
    const okPlatform = !platform || String(row && row['平台']) === platform;
    const okOrder = !orderId || String((row && row['訂單編號']) || '') === orderId;
    if (row && okPlatform && okOrder) {
      await DB.prepare('DELETE FROM shipping_returns WHERE id=?').bind(id).run();
      return json({ ok: true, deletedId: id });
    }
  }
  if (orderId && platform) {
    const row = await DB.prepare(
      'SELECT id FROM shipping_returns WHERE "平台"=? AND "訂單編號"=? LIMIT 1'
    ).bind(platform, orderId).first();
    if (row) {
      await DB.prepare('DELETE FROM shipping_returns WHERE id=?').bind(row.id).run();
      return json({ ok: true, deletedId: row.id });
    }
  }
  return json({ ok: false, error: '找不到對應的退貨紀錄' });
}

/* ---------- 包貨系統 platform_orders 的 upsert ----------
 * 跟 niyan_packing 的 functions/api.js upsertPlatform 同一套邏輯：
 * 同一天同平台已有紀錄就把件數「累加」進對應物流，沒有才新增一筆，
 * 不整筆覆蓋（包貨系統當天可能已經手動送出同平台的表單）。
 */
async function upsertPlatform(DB, p, mode) {
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

  // mode 'set':把這個物流的件數直接設成 qty(不累加)、撿貨明細整欄換掉。
  // 只有「去重上線前就已經有字卡、這是第一次逐列上傳」那一次會用到 ——
  // 那張卡本來就是同一份出貨表算出來的,再累加一次會變兩倍。
  const setMode = mode === 'set';
  const detail = jparse(existing['明細']);
  let found = false;
  const newDetail = detail.map(d => {
    if (logi && d['物流'] === logi) {
      found = true;
      return { ...d, 件數: setMode ? qty : (Number(d['件數']) || 0) + qty };
    }
    return d;
  });
  if (!found) newDetail.push(logi ? { 物流: logi, 件數: qty } : { 件數: qty });
  const total = newDetail.reduce((s, d) => s + (Number(d['件數']) || 0), 0);

  // 撿貨明細跟件數一樣是累加的 —— 同一天上傳兩批,包貨那邊要看到兩批加起來的量。
  // 這次沒帶明細(算不出來)就整欄不動,不要把已經有的清掉。
  let pickingSql = '';
  const binds = [JSON.stringify(newDetail), total, now()];
  if (picking) {
    let list;
    if (setMode) {
      list = picking;                       // 整欄換掉
    } else {
      const merged = new Map();
      const prev = jparse(existing['撿貨明細']);
      (Array.isArray(prev) ? prev : []).concat(picking).forEach(d => {
        const k = String(d['品項'] || '').trim();
        if (!k) return;
        merged.set(k, (merged.get(k) || 0) + (Number(d['件數']) || 0));
      });
      list = [...merged].map(([品項, 件數]) => ({ 品項, 件數 }));
    }
    pickingSql = ',"撿貨明細"=?';
    binds.push(JSON.stringify(list));
  }
  binds.push(existing.id);

  await DB.prepare(`UPDATE platform_orders SET "明細"=?,"總件數"=?,"更新時間"=?${pickingSql} WHERE id=?`)
    .bind(...binds).run();
  return { updated: true, total, id: existing.id };
}
