/**
 * 應用程式進入點：啟動、頂端列、畫面切換。
 *
 * 「畫面」目前有三個：預約（所有人）、主持人介面（role<=2）、
 * 管理員介面（role=1）。切換純粹是替換 #app 裡的內容，沒有網址路由——
 * 這個規模不需要，而且沒有路由就不會有「重新整理後停在一個沒權限的
 * 頁面」這種要額外處理的狀態。
 */

import { setUnauthorizedHandler } from './api.js';
import { refreshStatus, logout, getUser, hasRole, renderGoogleButton,
         getPendingRegistration } from './auth.js';
import { el, clear, toast } from './ui.js';
import { createBookingView } from './booking.js';
import { createHostView } from './host.js';
import { createAdminView } from './admin.js';
import { createRegisterView } from './register.js';

const app = document.getElementById('app');

const VIEWS = {
  booking: { label: '預約', minRole: 3, build: () => createBookingView() },
  host: { label: '主持人介面', minRole: 2, build: () => createHostView() },
  admin: { label: '管理員介面', minRole: 1, build: () => createAdminView() },
};

let currentView = 'booking';

/**
 * 頂欄的品牌圖，來源是 brand-mark.png。
 *
 * 要換圖就直接覆蓋那個檔案，這裡不用動——尺寸與對齊都由 CSS 的
 * .topbar__mark 決定。圖請做成透明背景：頂欄是 #14120F 的深色，
 * 白底方塊會很突兀。
 */
function brandIcon() {
  return el('img', { class: 'topbar__mark', src: 'brand-mark.png', alt: '', 'aria-hidden': 'true' });
}

function renderTopbar() {
  const user = getUser();
  const actions = [];

  if (user) {
    // 切換入口：只顯示「不是目前這個」而且權限夠的。
    // role 3 兩個都看不到，所以完全沒有切換點。
    for (const [key, view] of Object.entries(VIEWS)) {
      if (key === currentView) continue;
      if (!hasRole(view.minRole)) continue;
      // 從子介面只能回到預約畫面，不能互跳——管理員介面與主持人
      // 介面之間直接切換沒有實際用途，也讓「我現在在哪」變模糊。
      if (currentView !== 'booking' && key !== 'booking') continue;
      actions.push(
        el('button', {
          class: 'btn btn--ghost btn--small',
          onClick: () => switchView(key),
        }, key === 'booking' ? '回到預約' : view.label),
      );
    }
    actions.push(
      el('button', {
        class: 'btn btn--ghost btn--small',
        onClick: async () => { await logout(); start(); },
      }, '登出'),
    );
  }

  return el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar__brand' }, [brandIcon(), '步經徑']),
    el('div', { class: 'topbar__actions' }, actions),
  ]);
}

function switchView(key) {
  currentView = key;
  renderApp();
}

function renderApp() {
  clear(app);
  app.append(renderTopbar());
  const view = VIEWS[currentView];
  if (!hasRole(view.minRole)) {
    // 權限在切換之後才改變（例如管理員把自己降級）的保險
    currentView = 'booking';
    app.append(VIEWS.booking.build());
    return;
  }
  app.append(view.build());
}

function renderLogin(message) {
  clear(app);
  app.append(renderTopbar());
  const buttonHolder = el('div', { style: 'display:flex;justify-content:center;padding:24px 0' });
  app.append(
    el('div', { class: 'section', style: 'padding-top:48px;text-align:center' }, [
      el('div', { style: 'font-size:20px;font-weight:700' }, '劇本殺預約'),
      el('div', { class: 'field__hint' }, message || '請使用 Google 帳號登入'),
      buttonHolder,
    ]),
  );
  renderGoogleButton(buttonHolder, (user, err) => {
    if (err) {
      // 403 只剩一種原因了：帳號被停權。沒在名單裡的人現在會拿到 session
      // 並走註冊流程，不再被擋在這裡。叫他再登一次沒有用，那只會繞一圈
      // 得到同樣的結果。
      renderLogin(err.status === 403
        ? '此帳號已被停用，請聯絡店家' : err.message);
      return;
    }
    // 登入成功但還沒註冊：留在這一頁，把註冊表單接在下面。
    if (!user) { renderRegister(); return; }
    toast(`歡迎，${user.name || user.email}`);
    currentView = 'booking';
    renderApp();
  });
}

/**
 * 登入完成、但還沒註冊時的畫面。
 *
 * 刻意保留上面那個標題區塊，讓它看起來是同一頁往下長出表單，而不是被
 * 丟到另一個地方——使用者剛按完 Google 登入，畫面整個換掉會像是出錯了。
 */
function renderRegister() {
  const pending = getPendingRegistration();
  if (!pending) { renderLogin(); return; }

  clear(app);
  app.append(
    el('div', { class: 'topbar' }, [
      el('div', { class: 'topbar__brand' }, [brandIcon(), '步經徑']),
      el('div', { class: 'topbar__actions' }, [
        // 取消 = 登出。表單填一半不想註冊了，該回到登入頁，
        // 而不是留著一張半吊子的 session。
        el('button', {
          class: 'btn btn--ghost btn--small',
          onClick: async () => { await logout(); start(); },
        }, '取消'),
      ]),
    ]),
    el('div', { class: 'section', style: 'padding-top:32px;text-align:center' }, [
      el('div', { style: 'font-size:20px;font-weight:700' }, '完成註冊'),
    ]),
    createRegisterView(pending.email, () => {
      currentView = 'booking';
      renderApp();
    }),
  );
}

async function start() {
  clear(app);
  app.append(el('div', { class: 'loading' }, '載入中…'));
  const user = await refreshStatus();
  if (user) renderApp();
  else if (getPendingRegistration()) renderRegister();
  else renderLogin();
}

setUnauthorizedHandler(() => {
  toast('登入已過期，請重新登入', { error: true });
  renderLogin();
});

start();
