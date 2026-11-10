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

// ── 「我是誰」：四種狀態，一次只會是其中一種 ──────────────────────
//
//   { kind: 'signedOut' }                                 沒登入
//   { kind: 'unregistered', email }                       Google 驗過、手上有 session，
//                                                         但還沒在這個系統註冊——該給註冊表單
//   { kind: 'blocked', status, bannedUntil, adminName }   註冊過但被關掉——進得了畫面、
//                                                         什麼都做不了；跟「沒登入」分開，
//                                                         否則他會被丟回登入頁一直重登
//   { kind: 'signedIn', user }                            可以用
//
// ★ 為什麼是一個變數而不是三個（2026-11-10 改）：原本是 currentUser、
//   pendingRegistration、blockedStatus 三個各自可為空的變數，組合有 8 種、
//   合法的只有 4 種，每一個寫入點都得記得三個一起設。實際咬過兩次：
//     - 登出只清了 currentUser，註冊畫面按「取消」又被畫回來（2026-09-21）
//     - blockedStatus 從 /auth/status 來是物件、從登入來是字串 'banned'，
//       剛登入的停權者看到的是「未授權，請聯絡店家」而不是停權到幾點
//   一個變數的話，不合法的組合寫不出來；停權資訊也只剩 blockedFrom() 一個來源。
//
// blocked 的 status 是 'deactive'（店家關的，只能聯絡店家）、'banned'（系統判定，
// 有到期時間可以告訴他）或 'deleted'。bannedUntil 只有 banned 才有值，null 代表
// 無限期，只能等管理員手動解。
const SIGNED_OUT = Object.freeze({ kind: 'signedOut' });
let identity = SIGNED_OUT;

/** /auth/status 的回應 → 停權狀態。停權資訊只從這裡組，不在別處各拼一份。 */
function blockedFrom(status) {
  return {
    kind: 'blocked',
    status: status.status,
    bannedUntil: status.banned_until ?? null,
    adminName: status.admin_name ?? null,
  };
}

/** /auth/status 的回應 → 四種狀態之一。 */
function identityFrom(status) {
  // authorized=false 有兩種原因，要分開：
  //   registered=false —— 還沒填聯絡資料，該給他註冊表單
  //   registered=true  —— 註冊過但被停權，重登幾次都一樣，該叫他聯絡店家
  if (status.authorized) return { kind: 'signedIn', user: status };
  if (!status.registered) return { kind: 'unregistered', email: status.email };
  return blockedFrom(status);
}

export function getUser() {
  return identity.kind === 'signedIn' ? identity.user : null;
}

/** 已登入但還沒註冊時回傳 { email }，否則 null。 */
export function getPendingRegistration() {
  return identity.kind === 'unregistered' ? { email: identity.email } : null;
}

/** 帳號被停權時回傳 { status, bannedUntil, adminName }，否則 null。 */
export function getBlockedStatus() {
  if (identity.kind !== 'blocked') return null;
  const { status, bannedUntil, adminName } = identity;
  return { status, bannedUntil, adminName };
}

/** 目前登入者是否至少有這個等級的權限（1 管理員 ⊃ 2 主持人 ⊃ 3 玩家）。 */
export function hasRole(minimum) {
  const user = getUser();
  return Boolean(user && user.role <= minimum);
}

/**
 * 用現有的 token 問後端「我是誰」。
 * 沒有 token、或 token 已失效，回傳 null。
 */
export async function refreshStatus() {
  if (!getToken()) {
    identity = SIGNED_OUT;
    return null;
  }
  try {
    identity = identityFrom(await api.get('/auth/status'));
  } catch {
    // 401 已經在 api.js 清掉 token 並觸發 handler
    identity = SIGNED_OUT;
  }
  return getUser();
}

/** 拿 Google ID token 換我們自己的 session token。 */
async function loginWithGoogle(idToken) {
  const result = await api.post('/auth/login', { id_token: idToken });
  setToken(result.session_token);
  // 沒註冊過的人一樣拿到 session——註冊那一步需要一張憑證來證明「填表的
  // 就是剛才登入的那個 email」。回傳 null 讓呼叫端知道還不能進主畫面，
  // 該走註冊。
  if (result.registered === false) {
    identity = { kind: 'unregistered', email: result.email };
    return null;
  }
  // 被停權的人一樣拿到 session（要讓他進得了畫面看見自己被擋），但登入的
  // 回應只說了 status，沒有到期時間與管理員名字。拿剛到手的 session 問一次
  // /auth/status，讓停權畫面只有一個資料來源——跟重新整理之後看到的一模一樣。
  // 只有被停權的人會多這一次請求。
  if (result.authorized === false) {
    return refreshStatus();
  }
  identity = { kind: 'signedIn', user: { ...result, authorized: true } };
  return getUser();
}

/** 送出註冊。成功之後手上那張 session 直接就能用，不必重新登入。 */
export async function register(data) {
  const result = await api.post('/auth/register', data);
  identity = { kind: 'signedIn', user: { ...result, authorized: true } };
  return getUser();
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    // 後端說不行也沒關係——本地清掉 token，登出的目的就達成了
  }
  setToken(null);
  identity = SIGNED_OUT;
  // Google 那一側能做的只有這一件事：關掉「下次自動用同一個帳號登入」。
  // 我們登不出使用者的 Google 帳號，那是瀏覽器裡 Google 自己的登入狀態。
  //
  // ★ 目前 initialize() 沒有開 auto_select、也沒有用 One Tap，所以這一行
  //   現在是空跑；哪天要開 One Tap，少了它就會變成「按了登出又被自動登回來」。
  try {
    window.google?.accounts?.id?.disableAutoSelect?.();
  } catch {
    // Google 的 script 還沒載到就算了，本地狀態已經清乾淨
  }
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
