/**
 * 應用程式進入點：啟動、頂端列、畫面切換。
 *
 * 「畫面」目前有三個：預約（所有人）、主持人介面（role<=2）、
 * 管理員介面（role=1）。切換是替換 #app 裡的內容，同時把位置寫進網址
 * （?view=&tab=，見 route.js）。
 *
 * ★ 這裡原本刻意沒有路由，理由是「這個規模不需要，而且沒有路由就不會有
 *   重新整理後停在一個沒權限的頁面」。第一個理由被通知信推翻了——五封信
 *   的按鈕都要落到特定畫面的特定頁籤，沒有路由就一律落在預約畫面。第二個
 *   理由則是**在寫下那段話之後就自己消失了**：renderApp() 底下那段權限
 *   退回是後來獨立加上去的，而它正好就是路由需要的那道保護。
 */

import { setUnauthorizedHandler } from './api.js';
import { refreshStatus, logout, getUser, hasRole, renderGoogleButton,
         getPendingRegistration, getBlockedStatus } from './auth.js';
import { el, clear, toast } from './ui.js';
import { createBookingView } from './booking.js';
import { createGmView } from './gm.js';
import { createAdminView } from './admin.js';
import { createRegisterView } from './register.js';
import { createProfileView } from './profile.js';
import { createMyBookingsView } from './mybookings.js';
import { readRoute, pushRoute, replaceRoute, onRouteChange, slugs, assertSlugs } from './route.js';

const app = document.getElementById('app');

const VIEWS = {
  booking: { label: '預約', minRole: 3, build: () => createBookingView() },
  gm: { label: '主持人介面', minRole: 2, build: (route) => createGmView(route) },
  admin: { label: '管理員介面', minRole: 1, build: (route) => createAdminView(route) },
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
  mybookings: { label: '我預定的場次', minRole: 3, menuOnly: true,
    build: (route) => createMyBookingsView(route) },
};

/**
 * 畫面的網址名稱。內部 key 與網址值分開，讓網址可以取一個對外好讀的名字
 * 而不必動到程式裡的變數名——profile 在網址上叫 account 就是這樣來的。
 *
 * ★ 這張表**必須剛好覆蓋 VIEWS**，下面那行會在載入時檢查。少一個畫面的
 *   話它的網址值會是 null，切過去就變成「什麼都不帶」＝回到預約畫面，
 *   而且不會有任何錯誤。所以寧可讓整個模組載不起來。
 */
const VIEW_SLUG = {
  booking: 'booking',   // 是預設值，實際上不會寫進網址（見 route.js）
  gm: 'gm',
  admin: 'admin',
  profile: 'account',
  mybookings: 'mybookings',
};
assertSlugs('畫面', VIEW_SLUG, Object.keys(VIEWS));
const viewRoute = slugs(VIEW_SLUG);

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

// 目前打開的那個選單面板，以及「點別的地方就收起來」的監聽器。
//
// 綁在 document 上而不是遮罩層：遮罩會擋住底下的內容，而這個選單小到不需要
// 把整頁鎖起來。（這個理由是原本就有的，沒變。）
//
// ★ 監聽器掛在**模組層，只掛一次**。原本寫在 userMenu() 裡面，而 userMenu()
//   在 renderTopbar() 裡、renderTopbar() 又在每次 renderApp() 都會跑——所以
//   每切一次畫面就多掛一個，而且從來不拆。功能沒壞（舊的那些都在對已經被丟掉
//   的面板設 hidden，看不出影響），但監聽器與它們抓住的 DOM 節點會一直累積。
//   路由做完之後上一頁／下一頁也會重畫，累積得比以前快。
let openPanel = null;

function closeMenu() {
  if (openPanel) {
    openPanel.hidden = true;
    openPanel = null;
  }
}

document.addEventListener('click', closeMenu);

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
    items.push(['我預定的場次', () => switchView('mybookings')]);
  }
  items.push(['登出', async () => { await logout(); start(); }]);

  const panel = el('div', { class: 'menu__panel', hidden: true },
    items.map(([label, onClick]) =>
      el('button', {
        class: 'menu__item',
        onClick: () => { closeMenu(); onClick(); },
      }, label),
    ),
  );

  const toggle = el('button', {
    class: 'btn btn--ghost btn--small menu__toggle',
    'aria-label': '選單',
    'aria-haspopup': 'true',
    onClick: (e) => {
      e.stopPropagation();
      const opening = panel.hidden;
      closeMenu();
      panel.hidden = !opening;
      openPanel = opening ? panel : null;
    },
  }, menuIcon());

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
  // 同一個畫面點第二次不留歷史紀錄——選單裡的「使用者資料」在使用者資料
  // 頁上仍然點得到，每點一次就多一筆的話，之後按上一頁會看起來沒反應。
  if (key !== currentView) pushRoute({ view: viewRoute.toSlug(key) });
  currentView = key;
  renderApp();
}

/**
 * 畫出目前的畫面。**這裡是唯一會修正 currentView 的地方。**
 *
 * 兩種要修正的情況合成同一條：
 *   1. 權限在切換之後才改變（例如管理員把自己降級）
 *   2. 網址帶了一個不存在或權限不足的 view（?view=打錯了、玩家點到主持人的信）
 *
 * 第 2 種是路由帶來的新情況，但它需要的保護跟第 1 種一模一樣，所以不另外
 * 寫一段——退回預約畫面。
 *
 * ★ 退回時**網址要跟著改**，否則它會留在 ?view=admin 上說謊：使用者重新
 *   整理會再退一次，而他每次都看到同一個網址配上不同的畫面。用 replace
 *   不用 push，因為這不是一次導覽，是修正一個到不了的位置。
 *
 * ★ 修正要在 renderTopbar() **之前**做完。頂欄是照 currentView 決定要放
 *   哪幾顆切換鈕的，先畫就會畫出一組跟底下內容對不起來的按鈕。
 */
function renderApp() {
  if (!VIEWS[currentView] || !hasRole(VIEWS[currentView].minRole)) {
    currentView = 'booking';
  }
  // 網址上的畫面跟實際畫出來的不一樣就修正。
  //
  // ★ 條件不能寫成「有沒有走上面那個 if」。不存在的 view（?view=打錯了）
  //   在 start() 讀進來的當下就已經被正規化成 booking 了，所以上面那個 if
  //   根本不會成立，而網址還留著那個打錯的值——實測抓到的（2026-09-02）。
  //   改成比對「網址說的」與「實際畫的」，兩種情況就都蓋得到。
  //
  // ★ 相等時**不寫**。每次重畫都寫一次的話，replaceRoute 會把 tab 與 sub
  //   一起清掉，等於每次重畫都把使用者踢回預設頁籤。
  const wantView = currentView === 'booking' ? null : viewRoute.toSlug(currentView);
  if (readRoute().view !== wantView) replaceRoute({ view: wantView });

  clear(app);
  app.append(renderTopbar());
  // 頁籤與子頁籤直接讀網址，不另外存一份。存了就會有「state 說 abuse、
  // 網址說 users」這種兩邊不同步的狀態，而網址才是使用者看得到的那一份。
  app.append(VIEWS[currentView].build(readRoute()));
}

/** 在既有的登入畫面上顯示錯誤，不重畫、不動 Google 按鈕。 */
function showLoginError(message) {
  toast(message, { error: true });
  const holder = app.querySelector('.section');
  if (!holder) { renderLogin(message); return; }
  let node = holder.querySelector('.field__error');
  if (!node) {
    node = el('div', { class: 'field__error', style: 'margin-top:8px' });
    // 插在提示文字後面、按鈕前面，跟 renderLogin 的排法一致。
    holder.insertBefore(node, holder.children[2] ?? null);
  }
  node.textContent = message;
}

function renderLogin(message) {
  clear(app);
  app.append(renderTopbar());
  const buttonHolder = el('div', { style: 'display:flex;justify-content:center;padding:24px 0' });
  // 錯誤訊息用紅字自成一行，不要塞進原本那句灰色提示裡。
  // 上線第一天就踩到：登入失敗時訊息被擺在 .field__hint 的位置，跟平常
  // 那句「請使用 Google 帳號登入」長得一樣，使用者完全沒看到，回報是
  // 「按了沒反應」。
  const errNode = message
    ? el('div', { class: 'field__error', style: 'margin-top:8px' }, message)
    : null;
  app.append(
    el('div', { class: 'section', style: 'padding-top:48px;text-align:center' }, [
      el('div', { style: 'font-size:20px;font-weight:700' }, '劇本殺預約'),
      el('div', { class: 'field__hint' }, '請使用 Google 帳號登入'),
      errNode,
      buttonHolder,
    ].filter(Boolean)),
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
      // ★ 不要重畫整個登入畫面。重畫會把 Google 的按鈕卸下再重新掛載，
      //   使用者看到的是「載入圈消失又出現」，看起來像自己什麼都沒按到，
      //   而真正的錯誤反而被蓋掉。改成原地顯示錯誤，按鈕保持不動。
      showLoginError(err.message);
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
    // ★ 這裡原本寫 currentView = 'booking'。不能留：從信裡點進來的人多半
    //   還沒登入，被要求登入、登入完卻被丟回預約畫面，等於整條路由白做——
    //   而這正是做這件事的主要動機。Google 登入不會重新載入頁面（走的是
    //   JS callback，不是轉址），所以 start() 從網址讀進來的 currentView
    //   到這裡還在。權限不夠的話 renderApp() 會自己退回預約畫面。
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
    // 剛註冊完的人一定是 role 3，網址就算指著主持人介面也會被 renderApp()
    // 退回預約畫面。所以這裡同樣不需要寫死 booking。
    createRegisterView(pending.email, () => {
      renderApp();
    }),
  );
}

/**
 * 把停權到期時間寫成人看得懂的樣子。
 *
 * 只到「分」，不寫秒——秒的精度對「我還要等多久」沒有幫助，只會讓那一行
 * 更長。跨年時才補上年份，平常寫「9 月 1 日 20:45」就夠。
 */
function formatBanUntil(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = sameYear
    ? `${d.getMonth() + 1} 月 ${d.getDate()} 日`
    : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return `${ymd} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 被停權的人看到的畫面：標題列與選單，其餘什麼都沒有。
 *
 * 不把他丟回登入頁，因為他的憑證是有效的——丟回去只會讓他一直重登，
 * 每次都成功、每次都進不來。讓他看見「進得來但什麼都沒有」，比讓他
 * 猜自己是不是密碼打錯了誠實。
 *
 * 兩種停權說的話不一樣：
 *   deactive —— 店家關掉的。沒有到期這回事，只能聯絡店家。
 *   banned   —— 系統判定的異常行為。**一定要說到什麼時候**：5 分鐘跟
 *               30 天的處置完全不同，只說「你被停權了」會讓人不知道
 *               該等一下還是該打電話。
 */
function renderBlocked() {
  const blocked = getBlockedStatus() || {};
  const lines = [];

  if (blocked.status === 'banned') {
    const until = blocked.bannedUntil ? formatBanUntil(blocked.bannedUntil) : null;
    lines.push(until
      ? `因異常行為暫時停權至 ${until}`
      // 到期時間是 null 代表無限期（abuse_rule 的 ban_seconds 設 0）。
      // 不要編一個時間出來，直接說沒有期限。
      : '因異常行為停權，未設定解除期限');
    lines.push('若有誤判請聯繫管理員');
    if (blocked.adminName) lines.push(`步經徑管理員為${blocked.adminName}`);
  } else {
    lines.push('此帳號未獲授權，請聯絡店家');
  }

  clear(app);
  app.append(
    el('div', { class: 'topbar' }, [
      el('div', { class: 'topbar__brand' }, [brandIcon(), '步經徑']),
      el('div', { class: 'topbar__actions' }, [userMenu()]),
    ]),
    // toast 三秒就消失，而這是這位使用者畫面上唯一的解釋——晚幾秒看
    // 螢幕就只剩一片空白，不知道自己為什麼進不去。常駐說明。
    el('div', { class: 'empty blocked-note' },
      lines.map((t) => el('div', {}, t))),
  );
  toast(blocked.status === 'banned' ? '此帳號因異常行為停權' : '未授權的使用者',
        { error: true });
}

async function start() {
  // 網址說了算。值可能是舊的、拼錯的、或這個人沒權限的，一律交給
  // renderApp() 去退——這裡不先驗證，驗證只留一個地方。
  currentView = viewRoute.toKey(readRoute().view) || 'booking';
  clear(app);
  app.append(el('div', { class: 'loading' }, '載入中…'));
  const user = await refreshStatus();
  if (user) renderApp();
  else if (getPendingRegistration()) renderRegister();
  else if (getBlockedStatus()) renderBlocked();
  else renderLogin();
}

// 上一頁／下一頁。
//
// ★ 沒登入的時候只更新 currentView，不重畫。沒登入時畫面是由登入狀態決定
//   的（登入／註冊／停權），不是由 view 決定——這裡照樣呼叫 renderApp()
//   的話，會把預約畫面畫給一個還沒登入的人看。等他登入完再照 currentView
//   落地就好。
onRouteChange(({ view }) => {
  currentView = viewRoute.toKey(view) || 'booking';
  if (getUser()) renderApp();
});

setUnauthorizedHandler(() => {
  toast('登入已過期，請重新登入', { error: true });
  renderLogin();
});

start();
