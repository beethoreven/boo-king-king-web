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

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

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
