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
         getPendingRegistration, getBlockedStatus } from './auth.js';
import { el, clear, toast } from './ui.js';
import { createBookingView } from './booking.js';
import { createHostView } from './host.js';
import { createAdminView } from './admin.js';
import { createRegisterView } from './register.js';
import { createProfileView } from './profile.js';

const app = document.getElementById('app');

const VIEWS = {
  booking: { label: '預約', minRole: 3, build: () => createBookingView() },
  host: { label: '主持人介面', minRole: 2, build: () => createHostView() },
  admin: { label: '管理員介面', minRole: 1, build: () => createAdminView() },
  // 選單裡的頁面。不放進頂欄的切換按鈕，所以 minRole 只是形式上的下限。
  profile: {
    label: '使用者資料', minRole: 3,
    // 只從選單進得去，不在頂欄放切換按鈕——那一列是工作區域的切換，
    // 「我的帳號」不屬於那個層級。
    menuOnly: true,
    build: () => createProfileView(async () => {
      // 帳號刪掉了，那張憑證後端也已經作廢，回到登入畫面。
      toast('帳號已刪除');
      await logout();
      start();
    }),
  },
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

/**
 * 右上角的使用者選單。
 *
 * 「主持人介面」「管理員介面」刻意留在外面當獨立按鈕：那是切換工作區域，
 * 跟「我的帳號」是兩回事，混在同一個選單裡會讓管理員每次切換都多兩步。
 *
 * 被停權的人只會拿到「登出」——他什麼都做不了，選單裡放著點不動的項目
 * 只是讓他反覆確認自己被擋住。
 */
function userMenu() {
  const user = getUser();
  const items = [];

  if (user) {
    items.push(['使用者資料', () => switchView('profile')]);
    items.push(['我預定的場次', () => toast('這個功能還在做')]);
  }
  items.push(['登出', async () => { await logout(); start(); }]);

  const panel = el('div', { class: 'menu__panel', hidden: true },
    items.map(([label, onClick]) =>
      el('button', {
        class: 'menu__item',
        onClick: () => { panel.hidden = true; onClick(); },
      }, label),
    ),
  );

  const toggle = el('button', {
    class: 'btn btn--ghost btn--small menu__toggle',
    'aria-label': '選單',
    'aria-haspopup': 'true',
    onClick: (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; },
  }, menuIcon());

  // 點別的地方就收起來。綁在 document 上而不是遮罩層：遮罩會擋住底下的
  // 內容，而這個選單小到不需要把整頁鎖起來。
  document.addEventListener('click', () => { panel.hidden = true; });

  return el('div', { class: 'menu' }, [toggle, panel]);
}

function menuIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const y of [7, 12, 17]) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '4'); line.setAttribute('x2', '20');
    line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
    svg.append(line);
  }
  return svg;
}

function renderTopbar() {
  const user = getUser();
  const actions = [];

  if (user) {
    // 切換入口：只顯示「不是目前這個」而且權限夠的。
    // role 3 兩個都看不到，所以完全沒有切換點。
    for (const [key, view] of Object.entries(VIEWS)) {
      if (key === currentView) continue;
      if (view.menuOnly) continue;
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
    actions.push(userMenu());
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
      // 現在只剩已刪除的帳號會在這裡被擋下（後端不發 session 給他）。
      // 停權的人拿得到憑證，會走下面 getBlockedStatus() 那條。
      if (err.payload?.code === 'deleted') {
        renderLogin();
        toast('已刪除的帳號', { error: true });
        return;
      }
      renderLogin(err.message);
      return;
    }
    // user 是 null 有兩種可能，要分開。
    if (!user) {
      if (getPendingRegistration()) renderRegister();
      else if (getBlockedStatus()) renderBlocked();
      else renderLogin();
      return;
    }
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

/**
 * 被停權的人看到的畫面：標題列與選單，其餘什麼都沒有。
 *
 * 不把他丟回登入頁，因為他的憑證是有效的——丟回去只會讓他一直重登，
 * 每次都成功、每次都進不來。讓他看見「進得來但什麼都沒有」，比讓他
 * 猜自己是不是密碼打錯了誠實。
 */
function renderBlocked() {
  clear(app);
  app.append(
    el('div', { class: 'topbar' }, [
      el('div', { class: 'topbar__brand' }, [brandIcon(), '步經徑']),
      el('div', { class: 'topbar__actions' }, [userMenu()]),
    ]),
    // toast 三秒就消失，而這是這位使用者畫面上唯一的解釋——晚幾秒看
    // 螢幕就只剩一片空白，不知道自己為什麼進不去。常駐一行說明。
    el('div', { class: 'empty' }, '此帳號未獲授權，請聯絡店家'),
  );
  toast('未授權的使用者', { error: true });
}

async function start() {
  clear(app);
  app.append(el('div', { class: 'loading' }, '載入中…'));
  const user = await refreshStatus();
  if (user) renderApp();
  else if (getPendingRegistration()) renderRegister();
  else if (getBlockedStatus()) renderBlocked();
  else renderLogin();
}

setUnauthorizedHandler(() => {
  toast('登入已過期，請重新登入', { error: true });
  renderLogin();
});

start();
