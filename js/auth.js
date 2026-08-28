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

// 已經登入（Google 驗過身分、手上有 session）但還沒在這個系統註冊的人。
// 這是第三種狀態：既不是「沒登入」，也不是「登入了可以用」。
// 被停權的人不會落在這裡——他註冊過，只是被關掉了，該看到的是別的訊息。
let pendingRegistration = null;

// 登入了、註冊過，但帳號被停權。這是第四種狀態：他進得了畫面，只是
// 什麼都做不了。跟「沒登入」分開，否則他會被丟回登入頁一直重登。
let blockedStatus = null;

export function getUser() {
  return currentUser;
}

/** 已登入但還沒註冊時回傳 { email }，否則 null。 */
export function getPendingRegistration() {
  return pendingRegistration;
}

/** 帳號被停權時回傳狀態字串（目前只有 'deactive'），否則 null。 */
export function getBlockedStatus() {
  return blockedStatus;
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
    // authorized=false 有兩種原因，要分開：
    //   registered=false —— 還沒填聯絡資料，該給他註冊表單
    //   registered=true  —— 註冊過但被停權，重登幾次都一樣，該叫他聯絡店家
    currentUser = status.authorized ? status : null;
    pendingRegistration = (!status.authorized && !status.registered)
      ? { email: status.email } : null;
    blockedStatus = (!status.authorized && status.registered) ? status.status : null;
    return currentUser;
  } catch {
    // 401 已經在 api.js 清掉 token 並觸發 handler
    currentUser = null;
    pendingRegistration = null;
    blockedStatus = null;
    return null;
  }
}

/** 拿 Google ID token 換我們自己的 session token。 */
export async function loginWithGoogle(idToken) {
  const result = await api.post('/auth/login', { id_token: idToken });
  setToken(result.session_token);
  // 沒註冊過的人一樣拿到 session——註冊那一步需要一張憑證來證明「填表的
  // 就是剛才登入的那個 email」。回傳 null 讓呼叫端知道還不能進主畫面，
  // 該走註冊。
  if (result.registered === false) {
    currentUser = null;
    pendingRegistration = { email: result.email };
    blockedStatus = null;
    return null;
  }
  // 被停權的人一樣拿到 session（要讓他進得了畫面看見自己被擋），
  // 但不是一個可以用的使用者。
  if (result.authorized === false) {
    currentUser = null;
    pendingRegistration = null;
    blockedStatus = result.status;
    return null;
  }
  currentUser = { ...result, authorized: true };
  pendingRegistration = null;
  blockedStatus = null;
  return currentUser;
}

/** 送出註冊。成功之後手上那張 session 直接就能用，不必重新登入。 */
export async function register(data) {
  const result = await api.post('/auth/register', data);
  currentUser = { ...result, authorized: true };
  pendingRegistration = null;
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
