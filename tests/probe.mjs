// 在「假裝是某個網址的瀏覽器」裡載入 js/api.js 與 js/auth.js，回報它們把請求
// 送去哪裡、用哪一個 Google 用戶端 ID。由 dev-params.test.mjs 呼叫，每個情境
// 開一個新的行程跑這一支：
//
//     node tests/probe.mjs <這一頁的主機名稱> <這一頁的查詢字串>
//
// ★ 一個情境一個行程，不是在同一個行程裡換設定重跑：這兩支模組在**載入當下**
//   就讀網址並把結果存成常數，而模組只會載入一次。同一個行程裡換了網址再
//   import，拿到的還是第一次算好的那一份——測試會全部通過，卻什麼都沒測到。

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [hostname, search = ''] = process.argv.slice(2);
const JS = path.resolve(import.meta.dirname, '../js');

const requests = [];
const clientIds = [];
const stored = new Map([['boo_king_king_session', 'test-session-token']]);

const fakeWindow = {
  location: { hostname, search, origin: `https://${hostname}` },
  // index.html 部署時填的那幾個值。
  __BOO_KING_KING_API_HOST__: 'https://backend.example',
  __BOO_KING_KING_VARIANT__: 'shop',
  __GOOGLE_CLIENT_ID__: 'deployed-client-id',
  // Google 的登入元件：只記下它被交代用哪一個用戶端 ID。
  google: {
    accounts: {
      id: {
        initialize: (config) => clientIds.push(config.client_id),
        renderButton: () => {},
      },
    },
  },
};

// 用 defineProperty：有些版本的 Node 自己就有 localStorage，直接指派蓋不掉。
for (const [name, value] of Object.entries({
  window: fakeWindow,
  localStorage: {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, v) => stored.set(key, v),
    removeItem: (key) => stored.delete(key),
  },
  fetch: async (url, init = {}) => {
    requests.push({
      url: String(url),
      // 只記「有沒有帶」。帶去哪裡看 url。
      carriesToken: Boolean(init.headers?.Authorization),
    });
    return { ok: true, status: 200, json: async () => ({}) };
  },
})) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const { api } = await import(pathToFileURL(path.join(JS, 'api.js')).href);
const { renderGoogleButton } = await import(pathToFileURL(path.join(JS, 'auth.js')).href);

// 頁面一載入就會做的那個請求（main.js 的 refreshStatus），以及畫出登入按鈕。
await api.get('/auth/status');
renderGoogleButton({}, () => {});

console.log(JSON.stringify({ requests, clientId: clientIds[0] ?? null }));
