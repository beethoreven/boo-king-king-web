/**
 * 後端 API 的唯一入口。所有 fetch 都走這裡，不要在別的模組直接 fetch——
 * session token 的附加、401 的處理、錯誤訊息的取出都集中在這一支，
 * 分散出去就會有地方漏掉。
 */

// 後端位址。同源時留空（前端和 API 同一個 origin，用相對路徑即可）；
// 本機開發前端跑在別的 port 時，用 ?apiBase=http://localhost:5001 覆寫。
//
// zh-cn-to-tw 的對應邏輯要處理「同源 / GitHub Pages / 桌面版」三種情況，
// 這裡只有「靜態託管前端 + Render 後端」一種，所以簡化成一個常數加一個
// 可覆寫的參數。
const API_BASE =
  new URLSearchParams(window.location.search).get('apiBase') ??
  window.__BOOKING_KING_API_BASE__ ??
  '';

const TOKEN_KEY = 'booking_king_session';

// 網址加 ?debug=api 打開呼叫計數，正式使用時不會執行到。
//
// 放在這裡是因為這支是全站唯一的 fetch 出口——每一個模組都走 request()，
// 沒有任何地方自己 fetch。在這一點計數就抓得到全部，不會漏。
//
// 注意這裡數的是「應用程式送出幾次呼叫」。瀏覽器實際送出的 HTTP 請求
// 可能更多：跨來源加上 Authorization 標頭會觸發 OPTIONS 預檢，那是
// 瀏覽器自己發的，這一層看不到。要看實際的請求數要開 DevTools 的
// Network 分頁。
const DEBUG_API = new URLSearchParams(window.location.search).get('debug') === 'api';

const apiStats = { total: 0, byPath: new Map(), startedAt: Date.now() };

/** ?debug=api 時可在 console 呼叫 __apiStats() 看累計結果。 */
function statsSnapshot() {
  const seconds = ((Date.now() - apiStats.startedAt) / 1000).toFixed(1);
  const rows = [...apiStats.byPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ 呼叫: key, 次數: count }));
  console.table(rows);
  console.log(`總計 ${apiStats.total} 次 / ${seconds} 秒`);
  return { total: apiStats.total, seconds: Number(seconds) };
}

if (DEBUG_API) {
  window.__apiStats = statsSnapshot;
  window.__apiReset = () => {
    apiStats.total = 0;
    apiStats.byPath.clear();
    apiStats.startedAt = Date.now();
    console.log('API 計數已歸零');
  };
  console.log('API 計數已開啟：__apiStats() 看統計，__apiReset() 歸零');
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** 401 時要做什麼。main.js 啟動時註冊，避免這一層直接相依於畫面。 */
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request(method, path, { body, query } = {}) {
  const url = new URL(API_BASE + path, window.location.origin);
  if (query) {
    // 空字串一律不送——後端把「有這個參數但是空的」跟「沒有這個參數」
    // 都當成不篩選，但少送幾個參數比較好讀，debug 時也看得出使用者
    // 實際篩了什麼。
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }

  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const startedAt = DEBUG_API ? performance.now() : 0;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (DEBUG_API) {
    // 統計用 path 不含查詢字串——同一支 API 換不同日期查詢，關心的是
    // 「這支被打了幾次」，把每組參數各算一列只會看不出重點。
    const key = `${method} ${path}`;
    apiStats.total += 1;
    apiStats.byPath.set(key, (apiStats.byPath.get(key) ?? 0) + 1);
    const ms = (performance.now() - startedAt).toFixed(0);
    console.log(`[api #${apiStats.total}] ${key} → ${res.status}  ${ms}ms`);
  }

  // 401 = 憑證無效或過期，要重新登入。
  // 403 = 憑證有效但這個帳號沒有權限（被停用、或權限不足）——
  // 這兩種刻意分開處理：403 去重新登入是沒有用的，只會繞一圈之後
  // 得到同樣的結果，該做的是把訊息顯示給使用者看。
  if (res.status === 401) {
    setToken(null);
    onUnauthorized();
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // 不是 JSON（例如 502 之類的閘道錯誤頁），維持 null
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      payload?.error || `請求失敗（${res.status}）`,
      payload,
    );
  }
  return payload;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
};
