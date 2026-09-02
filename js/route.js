/**
 * 網址路由：`?view=<畫面>&tab=<頁籤>&sub=<子頁籤>`。
 *
 * 做這件事的理由不是「網址好看」，是**通知信的按鈕要落得了地**。五封信
 * 原本都指向站台根目錄，而根目錄一律開在預約畫面——主持人收到「你被指定
 * 了」，點進來看到的是預約畫面，還要自己再點一次「主持人介面」。
 *
 * ## 為什麼是查詢參數，不是真路徑
 *
 * 真路徑（/gm、/admin）需要把 Cloudflare 的 not_found_handling 改成
 * SPA 模式，代價是**把一個已經避開的問題找回來**：打錯檔名會回 200 顯示
 * 首頁，而不是 404（理由見 wrangler.jsonc 的註解）。查詢參數換到的是
 * 同一件事——信裡的連結落得了地——而那個代價一毛都不用付。
 *
 * 而且 ?apiBase= / ?debug= / ?googleClientId= 已經在用了，查詢參數是這個
 * 專案**現成的慣例**，不是為了路由新發明的東西。
 *
 * ## 三層
 *
 *   view —— 畫面（預約／主持人介面／管理員介面／使用者資料／我預定的場次）
 *   tab  —— 畫面裡的頁籤
 *   sub  —— 頁籤裡的子頁籤（目前只有管理員的場次管理有）
 *
 * sub 依附在 tab 上，所以**換 tab 一定要清掉 sub**——留著的話網址會描述
 * 一個不存在的位置（?tab=users&sub=booked）。這件事由 setRouteTab() 一手
 * 包辦，呼叫端不必記得。
 *
 * ## 幾個刻意的決定
 *
 * ★ **切畫面用 pushState，切頁籤用 replaceState。** 「上一頁」對應的是
 *   「上一個畫面」，不是「上一個頁籤」。管理員在四個頁籤之間點一輪之後，
 *   按上一頁應該回到預約畫面，而不是倒著把那四個頁籤走一遍。頁籤仍然
 *   寫進網址（複製給別人、重新整理都留在原地），只是不佔歷史紀錄。
 *
 * ★ **booking 不寫進網址。** 它是預設值，`?view=booking` 與什麼都不帶
 *   是同一件事，那就只留一種寫法——否則「乾淨的網址」會有兩個長相，
 *   之後每個讀網址的地方都要記得兩種都算。
 *
 * ★ 每次都從目前的 location.search 重建，只動 view/tab/sub 三個鍵。
 *   ?apiBase= 那幾個是**別人的**參數，路由沒有資格把它們洗掉——本機開發
 *   常態是 ?apiBase=... 一整天不關，切個畫面就掉了會很難查。
 */

import { el } from './ui.js';

const VIEW = 'view';
const TAB = 'tab';
const SUB = 'sub';

/** 網址現在說的是哪個位置。沒帶的是 null，由呼叫端決定預設值。 */
export function readRoute() {
  const q = new URLSearchParams(window.location.search);
  return { view: q.get(VIEW) || null, tab: q.get(TAB) || null, sub: q.get(SUB) || null };
}

/** 就地改寫查詢字串。fn 拿到 URLSearchParams，改完由這裡收尾。 */
function apply(fn, push) {
  const q = new URLSearchParams(window.location.search);
  fn(q);
  const qs = q.toString();
  const url = (qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
            + window.location.hash;
  window.history[push ? 'pushState' : 'replaceState'](null, '', url);
}

function setAll(q, { view, tab, sub }) {
  // booking 是預設值，不寫進網址（見開頭）。
  if (view && view !== 'booking') q.set(VIEW, view); else q.delete(VIEW);
  if (tab) q.set(TAB, tab); else q.delete(TAB);
  if (sub) q.set(SUB, sub); else q.delete(SUB);
}

/** 切換畫面：留一筆歷史紀錄，讓上一頁回得來。 */
export function pushRoute(route) {
  apply((q) => setAll(q, route), true);
}

/** 修正網址而不留歷史紀錄（權限退回、把預設值補進去）。 */
export function replaceRoute(route) {
  apply((q) => setAll(q, route), false);
}

/**
 * 網址現在是不是還停在這個畫面。
 *
 * ★ 頁籤的寫入**一定要先問過這件事**，否則會踩到「過期的非同步回應覆蓋
 *   較新狀態」那一類的錯（known-issue 第 2 條）。實際會發生的事：
 *
 *     1. 使用者在「我預定的場次」，loadTabs() 還在飛
 *     2. 他按了「回到預約」，接著點進管理員介面（網址 ?view=admin&tab=mmg）
 *     3. 那個**已經被丟掉的**畫面的 loadTabs() 這時才回來，
 *        呼叫 setRouteTab('gm-confirm')
 *     4. 網址變成 ?view=admin&tab=gm-confirm——一個管理員介面沒有的節
 *
 *   畫面當下不會有任何異狀（那個 view 實例已經被丟掉了，沒有人在看它），
 *   所以不會有人發現；但使用者**下一次重新整理**就會被丟回劇本管理，
 *   而他完全不知道為什麼。這正是這一類錯難抓的地方——症狀延遲、而且
 *   看起來跟操作無關。
 *
 *   不用世代計數器而用「網址的 view 還是不是我」，是因為這個條件本身就是
 *   要表達的不變量：**不要為一個你已經不在的畫面寫頁籤**。呼叫端也不必
 *   多接一個參數回來。
 */
function stillOn(viewSlug) {
  return readRoute().view === viewSlug;
}

/**
 * 只換頁籤，畫面不動。**會一併清掉 sub**——子頁籤是依附在頁籤底下的，
 * 換了頁籤之後舊的 sub 就沒有意義了。
 *
 * viewSlug 是呼叫端自己屬於哪個畫面（gm.js 永遠是 'gm'，以此類推）。
 */
export function setRouteTab(viewSlug, tab) {
  if (!stillOn(viewSlug)) return;
  apply((q) => {
    if (tab) q.set(TAB, tab); else q.delete(TAB);
    q.delete(SUB);
  }, false);
}

/** 只換子頁籤。同樣先確認網址還停在這個畫面。 */
export function setRouteSub(viewSlug, sub) {
  if (!stillOn(viewSlug)) return;
  apply((q) => { if (sub) q.set(SUB, sub); else q.delete(SUB); }, false);
}

/** 上一頁／下一頁。fn 收到 { view, tab, sub }。 */
export function onRouteChange(fn) {
  window.addEventListener('popstate', () => fn(readRoute()));
}

// ── 網址值 ↔ 內部 key ──────────────────────────────────────────
//
// 內部 key 有些是資料庫的 status（gm_confirm、gm_reviewed），直接放進網址
// 既難讀又容易搞混——gm_reviewed 的意思其實是「主持人都確認完了，等付訂金」，
// 光看名字會以為還在等人確認。所以網址上另外取名。
//
// ★ **對照表必須完整覆蓋，缺一個是錯誤，不是退化。**（案主定的原則）
//   一開始的寫法是「對不到就用原本的 key」，那樣漏掉一個頁籤時網址只是變醜
//   但照樣會動，沒有人會發現。現在改成：靜態的表在載入時就檢查，不符直接讓
//   模組載不起來；頁籤清單由後端給的（沒辦法在載入時檢查）則在拿到清單當下
//   檢查，不符就在畫面上顯示一段紅字。
//
// 這五個 status 兩個畫面共用（管理員的場次管理、玩家的我預定的場次），
// 後端也是共用的一份（db/bookings.py 的 TAB_LABEL）。
export const STATUS_SLUG = {
  gm_confirm: 'gm-confirm',
  gm_reviewed: 'waiting-deposit',
  booked: 'booked',
  ended: 'ended',
  cancelled: 'cancelled',
};

/** 把一張 {內部key: 網址值} 包成雙向查詢。 */
export function slugs(table) {
  const back = Object.fromEntries(Object.entries(table).map(([k, v]) => [v, k]));
  return {
    /** 內部 key → 網址值。 */
    toSlug: (key) => table[key] ?? null,
    /**
     * 網址值 → 內部 key。對不到回 null。
     *
     * ★ 這裡對不到**不是**錯誤：網址是使用者給的，可能是舊連結或手打錯的。
     *   要檢查完整性的是「表」，不是「使用者輸入的值」。
     */
    toKey: (slug) => (slug && back[slug]) || null,
  };
}

/**
 * 表跟實際頁籤對不對得起來。對得上回 null，否則回一句可以直接給人看的話。
 */
export function slugGap(name, table, keys) {
  const missing = keys.filter((k) => !(k in table));
  const extra = Object.keys(table).filter((k) => !keys.includes(k));
  if (!missing.length && !extra.length) return null;
  const parts = [];
  if (missing.length) parts.push(`少了 ${missing.join('、')}`);
  if (extra.length) parts.push(`多了 ${extra.join('、')}`);
  const message = `${name}：網址名稱表跟實際頁籤對不上（${parts.join('；')}）`;
  // 在偵測的當下記一次，不要放到 slugGapNode() 裡——那支每次重畫都會跑。
  console.error(message);
  return message;
}

/**
 * 靜態的表：載入時就檢查。不符直接丟例外——那會讓整個模組載不起來，
 * 一開網頁就看得到，不可能漏掉。
 */
export function assertSlugs(name, table, keys) {
  const gap = slugGap(name, table, keys);
  if (gap) throw new Error(gap);
}

/**
 * 頁籤清單由後端給的情況：拿到清單當下才檢查得了，所以錯誤要用看得見的
 * 方式呈現。console 不算——沒有人會為了看一個正常的畫面去開 DevTools。
 */
export function slugGapNode(message) {
  return el('div', { class: 'field__error', style: 'margin:12px 16px' },
    `網址設定有缺漏，請回報：${message}`);
}
