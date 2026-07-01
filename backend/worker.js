/**
 * 市場組工作進度追蹤 — Cloudflare Worker 後端
 * - GET  /api/state            取得本週項目與進度（全組共用）
 * - POST /api/update           更新單一項目 {id, progress?, hours?, owner?}
 * - GET  /api/history          取得歷史週次清單
 * - GET  /api/history/:week    取得某一週的封存快照
 * - POST /api/reset            （管理用）手動觸發換週封存
 * - 每週三 00:00（台灣）自動換頁：封存上週、進度歸零（Cron: Tue 16:00 UTC）
 *
 * 儲存：Cloudflare KV（binding 名稱 KV）
 *   key "current"           -> { week, items:[...] }
 *   key "history:index"     -> [ "2026/06/24~06/30", ... ]
 *   key "history:<week>"    -> { week, items:[...] }
 */

const TEAMS = {
  '美國': ['聿緯', '張譯', '貞貞', 'Abbie', 'Arthur'],
  '亞洲': ['皓皓', 'Kevin'],
};

const SOURCE_IDS = {
  美國企場: '1KzQ7RU2qQw8Lc_ZYVyGxE55zBkL2u-_laxQfLXvSPTQ',
  亞洲市場企劃: '1Q1RQwv8pzL4mhwtKnYFzfGH0UpfdOxJEYoRyyo-rS6w',
  美國辦公室_Arthur: '1XBHQSeVshYaNkENI8yOiSp9aQJJwqKsflp9pv5QzaOI',
};

// 初始項目（與前端一致；換週時項目保留、進度歸零）
// [團隊, 負責人, 標籤, 工作項目, 預計工時, 備註]
const SEED = [
  ['美國','聿緯','SSS','遊戲提交',null,'06/30 全面提交鷹速致富；提前釋出美國戰神500-Dara'],
  ['美國','聿緯','SSS','遊戲數據週報',null,'週二虎機、週五魚機'],
  ['美國','聿緯','SSS','遊戲文件更新',null,'惡魔之火 BonusCoin'],
  ['美國','聿緯','SSS','JILIUS Logo 輸出',null,''],
  ['美國','聿緯','SSS','Alea 數值設定',null,''],
  ['美國','聿緯','SSS','4LeafTechnologies 數值設定',null,''],
  ['美國','聿緯','SSS','Blazesoft 數值設定',null,''],
  ['美國','聿緯','SSS','Obsidian 研究',null,''],
  ['美國','聿緯','中艦','06/26 送審協助',null,''],
  ['美國','聿緯','中艦','主題活動任務',null,'美國戰神500'],
  ['美國','聿緯','大玩咖','端午養成主題活動第三週數值',null,'07/01~07/07'],
  ['美國','聿緯','大玩咖','淘氣鯊勳章主題活動送審數值',null,''],
  ['美國','張譯','SSS','AM 負責項目',null,'Casimba、GameTech、中國廠商、Dara'],
  ['美國','張譯','SSS','合約/客戶資料/法規追蹤',null,''],
  ['美國','張譯','OC','遊戲上線觀察',null,''],
  ['美國','張譯','OC','合約處理',null,''],
  ['美國','張譯','其他','虎機競品研究',null,'下次會議 6/29(一)15:30'],
  ['美國','貞貞','SSS','AM 負責項目',null,'Patrianna、Blazesoft'],
  ['美國','貞貞','SSS','財務對帳',null,''],
  ['美國','貞貞','SSS','數據報告',null,'日報 + 海外報告'],
  ['美國','貞貞','SSS','海外會議報告',null,'6/30 海外會議，週四下午看報告'],
  ['美國','貞貞','SSS','站台流量 / 市場動態追蹤',null,''],
  ['美國','Abbie','賽馬','資訊站建立',null,'網站結構與內文規劃'],
  ['美國','Abbie','賽馬','網紅資源與行銷討論',null,''],
  ['美國','Abbie','賽馬','白牌商瞭解',null,'HP約會議中｜PS評估完成｜AW評估完成'],
  ['美國','Abbie','賽馬','遊戲商 AM 負責項目',null,'Horseplay、Potent Systems、AmWest'],
  ['美國','Abbie','賽馬','遊戲商合約簽立 (TaDaUS)',null,'HP等回簽｜PS等亞瑟改｜AW等回簽'],
  ['美國','Abbie','賽馬','遊戲商財務對帳',null,'HP催帳款｜PS尚未收款｜AW等回簽'],
  ['美國','Abbie','SSS','AM 負責項目',null,'Alea、Legendz'],
  ['美國','Arthur','SSS','新廠商開發',null,''],
  ['美國','Arthur','SSS','合約與相關資料補齊',null,''],
  ['美國','Arthur','賽馬','廠商溝通項目與追蹤',null,''],
  ['美國','Arthur','OC','EM 溝通項目與追蹤',null,'MPA'],
  ['美國','Arthur','OC','站台商溝通',null,'建群推進、遊戲上線時間確認'],
  ['美國','Arthur','其他','美國銀行帳戶',null,''],
  ['美國','Arthur','其他','美國公司',null,''],
  ['亞洲','皓皓','企劃','Z Gaming Demo',2,''],
  ['亞洲','皓皓','會議','Demo 會前討論',1,''],
  ['亞洲','皓皓','企劃','系統商 / 營運商競品研究',5,''],
  ['亞洲','皓皓','企劃','菲律賓合規執照資料查詢',4,''],
  ['亞洲','皓皓','企劃','主題活動自動化工具規劃',4,''],
  ['亞洲','皓皓','營運','營運社團報告',4,''],
  ['亞洲','皓皓','會議','代理商會議',1,''],
  ['亞洲','皓皓','營運','每日平台數據',5,''],
  ['亞洲','皓皓','H5','H5 即時活動設定',2,''],
  ['亞洲','皓皓','H5','H5 Telegram 社群維護',2,''],
  ['亞洲','皓皓','H5','H5 行銷資源製作 & 發文設定',4,''],
  ['亞洲','皓皓','例行','週二例行測試',2,'H5 測試'],
  ['亞洲','皓皓','例行','週三維護測試',2,'H5 測試'],
  ['亞洲','皓皓','例行','例行會議',2,'早會/工作會議/策略會議/工作會前會'],
  ['亞洲','皓皓','例行','剩餘時間',0,''],
  ['亞洲','Kevin','飛鷹','大玩咖交接',16,'財會遞延文件/數值更新表單巨集/發文公告工具/客服文件/VIP Q群活動'],
  ['亞洲','Kevin','主活動','【主】端午養成主題活動第三週數值 07/01~07/07',2,'數值設定、公告設定'],
  ['亞洲','Kevin','主活動','【主】BINGO 活動工具功能新增與優化',1.5,'功能驗證'],
  ['亞洲','Kevin','主活動','【主】DWK 七夕情緣主題活動送審數值＆集字換皮＆資源 ingame',2,'協助飛鷹'],
  ['亞洲','Kevin','主活動','【主】IR & B7 網頁活動設定',1.5,'活動數值設定、虛寶卡資源更新'],
  ['亞洲','Kevin','主活動','IR & B7 活動 / 禮包數值調整',1.5,'數據追蹤、調整'],
  ['亞洲','Kevin','主活動','IR & B7 主題活動數值更新',1,'實體獎白名單撈取、掉落物權重調整'],
  ['亞洲','Kevin','例行','例行廳館排序調整',1,''],
  ['亞洲','Kevin','例行','例行 APP 推播',1.5,''],
  ['亞洲','Kevin','例行','週二例行測試',3,''],
  ['亞洲','Kevin','例行','週三維護測試',2,''],
  ['亞洲','Kevin','例行','例行會議',1,''],
  ['亞洲','Kevin','例行','剩餘時間',6,''],
];

const TZ_OFFSET = 8 * 60; // 台灣 UTC+8（分鐘）

function nowTW() {
  return new Date(Date.now() + TZ_OFFSET * 60 * 1000);
}
function pad(n){ return String(n).padStart(2,'0'); }
function fmtMD(d){ return `${pad(d.getUTCMonth()+1)}/${pad(d.getUTCDate())}`; }

// 以台灣時間計算「週三~隔週二」週期
function cycleTW(base) {
  const d = base || nowTW();
  const day = d.getUTCDay();           // 用 UTC 取值（d 已是 TW 時間）
  const diff = (day - 3 + 7) % 7;
  const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6);
  return { s, e, label: `${s.getUTCFullYear()}/${fmtMD(s)}~${fmtMD(e)}` };
}

function seedItems() {
  return SEED.map((r, i) => ({
    id: `${i}_${r[1]}_${r[3]}`.slice(0, 80),
    team: r[0], owner: r[1], tag: r[2], title: r[3],
    plannedHours: r[4], note: r[5] || '',
    progress: 0, hours: r[4], updated: '',
  }));
}

async function getCurrent(env) {
  let cur = await env.KV.get('current', 'json');
  const wk = cycleTW().label;
  if (!cur) {
    cur = { week: wk, items: seedItems() };
    await env.KV.put('current', JSON.stringify(cur));
  }
  return cur;
}

async function rollover(env) {
  const cur = await getCurrent(env);
  const newWk = cycleTW().label;
  if (cur.week === newWk) return { rolled: false, week: newWk };
  // 封存上一週
  await env.KV.put(`history:${cur.week}`, JSON.stringify(cur));
  const idx = (await env.KV.get('history:index', 'json')) || [];
  if (!idx.includes(cur.week)) { idx.unshift(cur.week); await env.KV.put('history:index', JSON.stringify(idx)); }
  // 開新一週：項目保留、進度歸零
  const items = cur.items.map(it => ({ ...it, progress: 0, updated: '' }));
  const next = { week: newWk, items };
  await env.KV.put('current', JSON.stringify(next));
  return { rolled: true, week: newWk, archived: cur.week };
}

// ===== Telegram 提醒 =====
const WKD = ['日','一','二','三','四','五','六'];
function reminderMsg(cur) {
  const t = nowTW();
  const todayMD = fmtMD(t);
  const items = cur.items || [];
  const overall = items.length ? Math.round(items.reduce((s,it)=>s+(it.progress||0),0)/items.length) : 0;
  const lines = [
    `📋 工作進度提醒 (${t.getUTCMonth()+1}/${t.getUTCDate()} 週${WKD[t.getUTCDay()]})`,
    `本週 ${cur.week}　全組平均 ${overall}%`,
  ];
  for (const team of Object.keys(TEAMS)) {
    lines.push(`──── ${team} ────`);
    for (const m of TEAMS[team]) {
      const mine = items.filter(it => it.owner === m);
      if (!mine.length) continue;
      const avg = Math.round(mine.reduce((s,it)=>s+(it.progress||0),0)/mine.length);
      const dot = avg >= 100 ? '✅' : avg > 0 ? '🔵' : '🔴';
      const updatedToday = mine.some(it => it.updated && it.updated.startsWith(todayMD + ' '));
      lines.push(`${dot} ${m}　${avg}%${updatedToday ? '' : '　⚠️今日未更新'}`);
    }
  }
  lines.push('👉 https://igs-wesleyyang.github.io/work-progress-tracker/');
  return lines.join('\n');
}
async function tgSend(env, text) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return { ok: false, reason: '尚未設定 TG_BOT_TOKEN / TG_CHAT_ID' };
  const r = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text, disable_web_page_preview: true }),
  });
  return await r.json();
}
async function sendReminder(env) {
  await rollover(env);              // 順手檢查是否該換週
  const cur = await getCurrent(env);
  return await tgSend(env, reminderMsg(cur));
}

// 查台灣官方行事曆（含補班/補假），判斷某天是否為假日
async function isHolidayTW(env) {
  const t = nowTW();
  const y = t.getUTCFullYear();
  const key = 'cal:' + y;
  let cal = await env.KV.get(key, 'json');
  if (!cal) {
    try {
      const r = await fetch('https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/' + y + '.json');
      if (r.ok) { cal = await r.json(); await env.KV.put(key, JSON.stringify(cal), { expirationTtl: 2592000 }); }
    } catch (e) {}
  }
  if (!Array.isArray(cal)) return false;   // 取不到資料就保守照常發
  const ymd = '' + y + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate());
  const d = cal.find(x => x.date === ymd);
  return d ? !!d.isHoliday : false;
}

// ===== 統計：每日完成度 + 每週「提醒後未更新」次數 =====
async function getStats(env) {
  return (await env.KV.get('stats', 'json')) || { daily: [], misses: {} };
}
// 記錄當日整體完成度（每天 21:00 收工後）
async function recordDaily(env) {
  const cur = await getCurrent(env);
  const t = nowTW();
  const date = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  const overall = cur.items.length ? Math.round(cur.items.reduce((s, it) => s + (it.progress || 0), 0) / cur.items.length) : 0;
  const stats = await getStats(env);
  const ex = stats.daily.find(d => d.date === date);
  if (ex) ex.overall = overall; else stats.daily.push({ date, overall });
  if (stats.daily.length > 120) stats.daily = stats.daily.slice(-120);
  await env.KV.put('stats', JSON.stringify(stats));
}
// 提醒時點：記錄「今天尚未更新」的人（每人每週累計）
async function recordMisses(env) {
  const cur = await getCurrent(env);
  const t = nowTW();
  const todayMD = fmtMD(t);
  const stats = await getStats(env);
  const wk = cur.week;
  stats.misses[wk] = stats.misses[wk] || {};
  for (const team of Object.keys(TEAMS)) {
    for (const m of TEAMS[team]) {
      const mine = cur.items.filter(it => it.owner === m);
      if (!mine.length) continue;
      if (!(m in stats.misses[wk])) stats.misses[wk][m] = 0;
      const updatedToday = mine.some(it => it.updated && it.updated.startsWith(todayMD + ' '));
      if (!updatedToday) stats.misses[wk][m] += 1;
    }
  }
  // 只保留最近 12 週
  const weeks = Object.keys(stats.misses);
  if (weeks.length > 12) { weeks.slice(0, weeks.length - 12).forEach(w => delete stats.misses[w]); }
  await env.KV.put('stats', JSON.stringify(stats));
}

// ===== Google 服務帳號驗證 + 讀表 =====
function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
let _gtoken = null, _gexp = 0;
async function gToken(env) {
  if (_gtoken && Date.now() < _gexp - 60000) return _gtoken;
  if (!env.GS_CLIENT_EMAIL || !env.GS_PRIVATE_KEY) throw new Error('尚未設定 GS_CLIENT_EMAIL / GS_PRIVATE_KEY');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: env.GS_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(env.GS_PRIVATE_KEY.replace(/\\n/g, '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64url(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token error: ' + JSON.stringify(j).slice(0, 200));
  _gtoken = j.access_token; _gexp = Date.now() + (j.expires_in || 3600) * 1000;
  return _gtoken;
}
async function sheetValues(env, sheetId, range) {
  const tok = await gToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json();
  if (j.error) throw new Error('sheets api: ' + JSON.stringify(j.error).slice(0, 200));
  return j.values || [];
}

// ===== 從來源表解析「最近一週」各人項目 =====
function asiaTag(title) {
  if (/^【主】/.test(title)) return '主活動';
  if (/例行|週二|週三|剩餘/.test(title)) return '例行';
  if (/H5/.test(title)) return 'H5';
  if (/會議/.test(title)) return '會議';
  return '企劃';
}
// 美國企場：人名在 A 欄當區塊標題，項目列 B=標籤 C=工作項目 D=備註；取每人「最後一次出現」的區塊
async function parseUS(env) {
  const rows = await sheetValues(env, SOURCE_IDS.美國企場, '美國企場每週工作!A1:D');
  const BOUND = new Set(['10', '聿緯', '張譯', '貞貞', 'Abbie', '亞瑟']);
  const OUT = { '聿緯': '聿緯', '張譯': '張譯', '貞貞': '貞貞', 'Abbie': 'Abbie', '亞瑟': 'Arthur' };
  const lastIdx = {};
  rows.forEach((r, i) => { const a = ((r[0] || '') + '').trim(); if (BOUND.has(a)) lastIdx[a] = i; });
  const items = [];
  for (const name of Object.keys(OUT)) {
    const s = lastIdx[name]; if (s == null) continue;
    let empties = 0;
    for (let i = s + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const a = ((r[0] || '') + '').trim();
      if (BOUND.has(a)) break;
      if (/\d{1,4}[-/]\d{1,2}[-/]?\d{0,2}\s*~/.test(a)) break;   // 週區間標題
      const tag = ((r[1] || '') + '').trim(), title = ((r[2] || '') + '').trim(), note = ((r[3] || '') + '').trim();
      if (!tag && !title && !note) { if (++empties >= 4) break; continue; }
      empties = 0;
      if (!title) continue;
      items.push({ team: '美國', owner: OUT[name], tag, title, hours: null, note });
    }
  }
  return items;
}
// 亞洲企劃：人名在 B 欄當標題，項目列 B=工作項目 C=工時 D=工作內容
async function parseAsia(env) {
  const rows = await sheetValues(env, SOURCE_IDS.亞洲市場企劃, '企劃工作總攬!A1:D');
  const BOUND = new Set(['皓皓', 'Kevin']);
  const lastIdx = {};
  rows.forEach((r, i) => { const b = ((r[1] || '') + '').trim(); if (BOUND.has(b)) lastIdx[b] = i; });
  const items = [];
  for (const name of ['皓皓', 'Kevin']) {
    const s = lastIdx[name]; if (s == null) continue;
    let empties = 0;
    for (let i = s + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const b = ((r[1] || '') + '').trim();
      if (BOUND.has(b)) break;
      const title = b, hraw = ((r[2] || '') + '').trim(), note = ((r[3] || '') + '').trim();
      if (!title && !hraw && !note) { if (++empties >= 4) break; continue; }
      empties = 0;
      if (!title) continue;
      const h = parseFloat(hraw);
      items.push({ team: '亞洲', owner: name, tag: asiaTag(title), title, hours: isNaN(h) ? null : h, note });
    }
  }
  return items;
}
function stableId(owner, title) { return (owner + '_' + title).replace(/\s+/g, '').slice(0, 90); }
// 把某團隊的項目用解析結果覆蓋，並以 (負責人+項目) 比對保留既有進度/工時
async function syncSource(env, which) {
  const parsed = which === 'us' ? await parseUS(env) : await parseAsia(env);
  const teamName = which === 'us' ? '美國' : '亞洲';
  const cur = await getCurrent(env);
  const old = cur.items;
  const merged = parsed.map(p => {
    const o = old.find(x => x.owner === p.owner && x.title === p.title);
    return {
      id: stableId(p.owner, p.title),
      team: p.team, owner: p.owner, tag: p.tag || '', title: p.title,
      plannedHours: p.hours != null ? p.hours : (o ? o.plannedHours : null),
      note: p.note || '',
      progress: o ? (o.progress || 0) : 0,
      hours: (o && o.hours != null) ? o.hours : p.hours,
      updated: o ? (o.updated || '') : '',
    };
  });
  cur.items = old.filter(it => it.team !== teamName).concat(merged);
  await env.KV.put('current', JSON.stringify(cur));
  return { synced: which, count: merged.length, owners: [...new Set(merged.map(m => m.owner))] };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (path === '/api/state' && request.method === 'GET') {
        await rollover(env);                 // 開頁時順手檢查是否該換週
        const cur = await getCurrent(env);
        return json({ ...cur, teams: TEAMS });
      }

      if (path === '/api/update' && request.method === 'POST') {
        const body = await request.json();
        const cur = await getCurrent(env);
        const it = cur.items.find(x => x.id === body.id);
        if (!it) return json({ error: 'item not found' }, 404);
        if (body.progress != null) it.progress = Math.max(0, Math.min(100, parseInt(body.progress) || 0));
        if (body.hours !== undefined) it.hours = body.hours === '' || body.hours == null ? null : parseFloat(body.hours);
        if (body.owner != null) it.owner = body.owner;
        const t = nowTW();
        it.updated = `${fmtMD(t)} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
        await env.KV.put('current', JSON.stringify(cur));
        return json({ ok: true, item: it });
      }

      if (path === '/api/stats' && request.method === 'GET') {
        const cur = await getCurrent(env);
        const stats = await getStats(env);
        return json({ daily: stats.daily || [], misses: stats.misses || {}, teams: TEAMS, currentWeek: cur.week });
      }

      if (path === '/api/history' && request.method === 'GET') {
        const idx = (await env.KV.get('history:index', 'json')) || [];
        return json({ weeks: idx });
      }

      const mh = path.match(/^\/api\/history\/(.+)$/);
      if (mh && request.method === 'GET') {
        const wk = decodeURIComponent(mh[1]);
        const snap = await env.KV.get(`history:${wk}`, 'json');
        return snap ? json(snap) : json({ error: 'not found' }, 404);
      }

      if (path === '/api/reset' && request.method === 'POST') {
        const r = await rollover(env);
        return json(r);
      }

      if (path === '/api/send-reminder' && request.method === 'POST') {
        const r = await sendReminder(env);
        return json(r);
      }

      if (path === '/api/sync' && request.method === 'POST') {
        const which = url.searchParams.get('src') || 'all';
        if (which === 'all') {
          const us = await syncSource(env, 'us');
          const asia = await syncSource(env, 'asia');
          return json({ ok: true, us, asia });
        }
        const r = await syncSource(env, which);
        return json({ ok: true, ...r });
      }

      if (path === '/api/holiday' && request.method === 'GET') {
        const t = nowTW();
        return json({ date: `${t.getUTCFullYear()}/${pad(t.getUTCMonth()+1)}/${pad(t.getUTCDate())}`, isHoliday: await isHolidayTW(env) });
      }

      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },

  async scheduled(event, env) {
    // 以台灣時間判斷星期與時段（不依賴 cron 的星期語意）
    const t = nowTW();
    const dow = t.getUTCDay();        // 0=日 1=一 … 6=六（台灣當地）
    const hh = t.getUTCHours();       // 台灣當地小時
    const mm = t.getUTCMinutes();
    if (hh === 21) {                       // 21:00：自動重讀來源表 + 記錄當日完成度
      await syncSource(env, 'us');
      await syncSource(env, 'asia');
      await recordDaily(env);
      return;
    }
    // 提醒：週一二 20:00、週三四五 17:30
    const isReminder =
      (hh === 20 && mm < 30 && (dow === 1 || dow === 2)) ||
      (hh === 17 && (dow === 3 || dow === 4 || dow === 5));
    // 未更新檢查（提醒後 30 分）：週一二 20:30、週三四五 18:00
    const isMissCheck =
      (hh === 20 && mm >= 30 && (dow === 1 || dow === 2)) ||
      (hh === 18 && (dow === 3 || dow === 4 || dow === 5));
    if (isReminder) {
      if (await isHolidayTW(env)) { await rollover(env); return; }  // 例假日不提醒
      await sendReminder(env);
    } else if (isMissCheck) {
      if (await isHolidayTW(env)) return;   // 例假日不計未更新
      await recordMisses(env);              // 提醒後仍未更新才 +1
    } else {
      await rollover(env);
    }
  },
};
