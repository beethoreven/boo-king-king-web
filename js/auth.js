/**
 * Google 登入與登入狀態。
 *
 * 流程：Google 只在登入當下驗證一次身分，換到我們自己簽發的 session
 * token，之後所有 API 都帶那個 token。Google 的 ID token 效期固定約
 * 一小時，拿它當長效憑證會讓使用者每小時被打斷一次——對預約系統來說
 * 最糟的觸發時機就是玩家填完資料按下送出的那一刻。
 */

import { api, setToken, getToken } from './api.js';

// Google OAuth 用戶端 ID。部署時由 index.html 的 window.__GOOGLE_CLIENT_ID__
// 提供，本機開發可以用 ?googleClientId= 覆寫。
const CLIENT_ID =
  new URLSearchParams(window.location.search).get('googleClientId') ??
  window.__GOOGLE_CLIENT_ID__ ??
  '';

let currentUser = null;

export function getUser() {
  return currentUser;
}

/** 目前登入者是否至少有這個等級的權限（1 管理員 ⊃ 2 主持人 ⊃ 3 玩家）。 */
export function hasRole(minimum) {
  return Boolean(currentUser && currentUser.role <= minimum);
}

/**
 * 用現有的 token 問後端「我是誰」。
 * 沒有 token、或 token 已失效，回傳 null。
 */
export async function refreshStatus() {
  if (!getToken()) {
    currentUser = null;
    return null;
  }
  try {
    const status = await api.get('/auth/status');
    // authorized=false 代表 token 有效但帳號被停用——這不是「沒登入」，
    // 訊息要跟「請重新登入」分開，不然使用者會一直重登卻永遠進不去。
    currentUser = status.authorized ? status : null;
    return currentUser;
  } catch {
    // 401 已經在 api.js 清掉 token 並觸發 handler
    currentUser = null;
    return null;
  }
}

/** 拿 Google ID token 換我們自己的 session token。 */
export async function loginWithGoogle(idToken) {
  const result = await api.post('/auth/login', { id_token: idToken });
  setToken(result.session_token);
  currentUser = { ...result, authorized: true };
  return currentUser;
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    // 後端說不行也沒關係——本地清掉 token，登出的目的就達成了
  }
  setToken(null);
  currentUser = null;
}

/**
 * 掛載 Google 登入按鈕。
 *
 * Google Identity Services 的 script 由 index.html 載入；這裡等它就緒
 * 再初始化，避免因為載入順序而拿不到 window.google。
 */
export function renderGoogleButton(container, onSuccess) {
  if (!CLIENT_ID) {
    container.textContent = '尚未設定 Google 用戶端 ID';
    return;
  }

  const start = () => {
    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (response) => {
        try {
          const user = await loginWithGoogle(response.credential);
          onSuccess(user);
        } catch (err) {
          onSuccess(null, err);
        }
      },
    });
    window.google.accounts.id.renderButton(container, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
      locale: 'zh_TW',
    });
  };

  if (window.google?.accounts?.id) {
    start();
    return;
  }
  // script 還沒載完，等它。輪詢比監聽 load 事件簡單，而且這段只在
  // 登入畫面跑一次。
  const timer = setInterval(() => {
    if (window.google?.accounts?.id) {
      clearInterval(timer);
      start();
    }
  }, 100);
  setTimeout(() => clearInterval(timer), 10000);
}
