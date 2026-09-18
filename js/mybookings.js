/**
 * 「我預訂的場次」：玩家看自己的預約。
 *
 * 只能看，不能改。取消或改時間都要經過店家，這一頁是查詢用的——放上
 * 編輯功能會讓人以為自己改得動，然後在真的需要改的時候才發現不行。
 *
 * 結構跟主持人介面一樣：按狀態分頁籤、每個頁籤自己的分頁與篩選、切過去
 * 才抓那一包。玩家同一時間只看得到一個頁籤，先把另外四包撈出來是替他
 * 決定他要看什麼，而每一包都是一次查詢。
 */

import { api } from './api.js';
import { el, clear, field, toast, spinner, scriptName } from './ui.js';
import { setRouteTab, slugs, slugGap, slugGapNode, STATUS_SLUG,
         newInstance } from './route.js';

// 頁籤就是後端那五個 status，網址名稱與管理員的場次管理共用同一份。
const tabRoute = slugs(STATUS_SLUG);

const EMPTY_FILTERS = { mmg_name: '', session_date: '', session_time: '' };

const hasActiveFilter = (f) => Object.values(f).some((v) => v !== '');

const emptyTab = () => ({
  items: [], has_more: false, start: 1,
  filters: { ...EMPTY_FILTERS }, loading: true, loaded: false,
  // 這一次載入是不是失敗了（≠ 這個狀態真的沒有場次）
  failed: false,
});

/**
 * initialTab 來自網址（?view=mybookings&tab=）。「預約成功」那封信帶
 * booked 進來。
 *
 * ★ 頁籤清單是後端給的，所以有效性**只能在 loadTabs() 拿到清單之後**
 *   才判定得了——不能在這裡先驗。
 */
export function createMyBookingsView({ tab } = {}) {
  const root = el('div', { class: 'view' });
  // 這個實例的號碼，寫網址時帶著（見 route.js 的 newInstance）。
  const instance = newInstance();

  const state = {
    tabs: {},        // {key: 中文標籤}，後端給的
    tabOrder: [],
    tab: null,
    data: {},        // {key: emptyTab()}
    filterOpen: false,
    draft: { ...EMPTY_FILTERS },
    loading: true,
    // 網址名稱表沒蓋到後端給的某個頁籤時，這裡放一句要顯示出來的話。
    gap: null,
  };


  // 過期的回應不要蓋掉比較新的結果——理由與寫法見 admin.js 的同一段。
  const claim = (slot) => (slot.seq = (slot.seq ?? 0) + 1);
  const stale = (slot, mine) => mine !== slot.seq;

  async function loadTabs() {
    try {
      const d = await api.get('/api/bookings/mine/tabs');
      state.tabs = d.tabs;
      state.tabOrder = Object.keys(d.tabs);
      for (const key of state.tabOrder) state.data[key] = emptyTab();
      // 頁籤清單是後端給的，所以完整性只能在這裡檢查——不像靜態的表可以
      // 在載入時就擋下來。
      // subset 的理由同 admin.js。
      state.gap = slugGap('我預訂的場次', STATUS_SLUG, state.tabOrder, { subset: true });
      // 網址指定的優先，指不到（舊連結、拼錯）就退回第一個頁籤。
      const wanted = tabRoute.toKey(tab);
      state.tab = state.tabOrder.includes(wanted) ? wanted : state.tabOrder[0];
      setRouteTab('mybookings', tabRoute.toSlug(state.tab), instance);
    } catch (err) {
      toast(err.message, { error: true });
    }
    state.loading = false;
    render();
    if (state.tab) reloadTab(state.tab);
  }

  async function reloadTab(key) {
    const t = state.data[key];
    const mine = claim(t);
    t.loading = true;
    render();
    try {
      const got = await api.get(`/api/bookings/mine/tab/${key}`, {
        start: t.start, ...t.filters,
      });
      if (stale(t, mine)) return;
      Object.assign(t, got);
      t.loaded = true;
      t.failed = false;
    } catch (err) {
      if (stale(t, mine)) return;
      t.failed = true;
      toast(err.message, { error: true });
    }
    t.loading = false;
    render();
  }

  function switchTab(key) {
    state.tab = key;
    setRouteTab('mybookings', tabRoute.toSlug(key), instance);
    state.draft = { ...state.data[key].filters };
    // 還沒抓過的才抓。已經看過的那一包留著，來回切不必重打。
    if (!state.data[key].loaded) reloadTab(key);
    else render();
  }

  /** 開合篩選面板。收起時若還有條件生效就一併清掉——條件留著卻把清除
   *  按鈕藏進收合的面板裡，就沒有路回到完整清單了。 */
  function toggleFilter() {
    const closing = state.filterOpen;
    state.filterOpen = !state.filterOpen;
    const t = state.data[state.tab];
    if (closing && hasActiveFilter(t.filters)) {
      state.draft = { ...EMPTY_FILTERS };
      t.filters = { ...EMPTY_FILTERS };
      t.start = 1;
      reloadTab(state.tab);
      return;
    }
    render();
  }

  function renderFilterPanel() {
    if (!state.filterOpen) return null;
    const t = state.data[state.tab];
    const set = (key) => (e) => { state.draft[key] = e.target.value; };
    return el('div', { class: 'section' }, el('div', { class: 'list' }, [
      field({
        label: '劇本名稱',
        control: el('input', { type: 'text', value: state.draft.mmg_name, onInput: set('mmg_name'), placeholder: '不填＝不篩選' }),
      }),
      el('div', { class: 'row' }, [
        field({ label: '日期', control: el('input', { type: 'date', value: state.draft.session_date, onChange: set('session_date') }) }),
        field({ label: '時間', control: el('input', { type: 'time', step: '1800', value: state.draft.session_time, onChange: set('session_time') }) }),
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn--ghost btn--small',
          onClick: () => {
            state.draft = { ...EMPTY_FILTERS };
            t.filters = { ...EMPTY_FILTERS };
            t.start = 1;
            reloadTab(state.tab);
          },
        }, '清除'),
        el('button', {
          class: 'btn btn--primary btn--small',
          onClick: () => { t.filters = { ...state.draft }; t.start = 1; reloadTab(state.tab); },
        }, '篩選'),
      ]),
    ]));
  }

  function renderPager() {
    const t = state.data[state.tab];
    const atFirst = t.start <= 1;
    if (atFirst && !t.has_more) return null;
    return el('div', { class: 'pager' }, [
      el('button', {
        class: 'btn btn--ghost btn--small',
        disabled: atFirst,
        onClick: () => { t.start = Math.max(1, t.start - 50); reloadTab(state.tab); },
      }, '← 上一頁'),
      el('div', { class: 'pager__label' }, `${t.start} – ${t.start + t.items.length - 1}`),
      el('button', {
        class: 'btn btn--ghost btn--small',
        disabled: !t.has_more,
        onClick: () => { t.start += 50; reloadTab(state.tab); },
      }, '下一頁 →'),
    ]);
  }

  function render() {
    clear(root);
    if (state.loading) { root.append(spinner()); return; }
    if (!state.tab) { root.append(el('div', { class: 'empty' }, '讀不到資料')); return; }

    const t = state.data[state.tab];

    root.append(
      el('div', { class: 'tabs' }, state.tabOrder.map((key) =>
        el('button', {
          class: `tab${key === state.tab ? ' tab--active' : ''}`,
          onClick: () => switchTab(key),
        }, state.tabs[key]),
      )),
      el('div', { class: 'section toolbar' }, [
        el('button', {
          class: 'btn btn--ghost btn--small',
          onClick: toggleFilter,
        }, state.filterOpen ? '收起篩選器' : '篩選器'),
        hasActiveFilter(t.filters) && el('div', { class: 'field__hint' }, '篩選中'),
      ]),
    );

    if (state.gap) root.append(slugGapNode(state.gap));

    const panel = renderFilterPanel();
    if (panel) root.append(panel);

    if (t.loading) { root.append(spinner()); return; }
    if (!t.items.length) {
      root.append(el('div', { class: 'empty' }, t.failed
        ? '讀取失敗，請稍後再試'
        : (hasActiveFilter(t.filters) ? '沒有符合篩選條件的場次' : '這個狀態目前沒有場次')));
      return;
    }

    root.append(el('div', { class: 'section' },
      el('div', { class: 'list' }, t.items.map((item) => bookingCard(item)))));
    const pager = renderPager();
    if (pager) root.append(el('div', { class: 'section' }, pager));
  }

  loadTabs();
  return root;
}

/**
 * 一筆預約的卡片。**「我預訂的場次」與「預訂行事曆」共用這一張。**
 *
 * 各畫一份的話，只要有人改了其中一邊，同一場戲在兩個畫面上就會長得不一樣，
 * 而那種不一致不會有任何錯誤訊息——跟 TAB_LABEL 一份共用是同一個理由。
 *
 * showStatus：行事曆的某一天是各種狀態混在一起，所以每一項最下面補一行
 * 狀態；頁籤那邊狀態就是頁籤本身，再寫一次是多的。
 *
 * ★ 這家店沒有訂金，主持人也只有一位（single 模式，主持人介面整塊拔掉了），
 *   所以卡片上沒有那兩行——差異在這裡，不在呼叫端。
 */
export function bookingCard(item, { showStatus = false } = {}) {
  return el('div', { class: 'card list-item' }, [
    el('div', { class: 'list-item__main' }, [
      el('div', { class: 'list-item__title' }, scriptName(item.mmg_name, item.mmg_url)),
      el('div', { class: 'list-item__meta' },
        `${item.session_date}（${weekday(item.session_date)}）${item.session_time}`),
      // 狀態用後端給的字，跟頁籤名稱是同一份——兩個畫面不會各自翻譯一次。
      showStatus && el('div', { class: 'list-item__meta list-item__status' },
        item.status_label ?? item.status),
    ]),
    el('div', { class: 'list-item__side' }, [
      // 序位只在還沒定案時有意義。已成立就是他的場，講「第 1 序位」
      // 反而讓人以為還在排隊。
      //
      // 容量 1 的時段也不顯示：那種時段沒有排隊這回事，「第 1 序位」會讓人
      // 以為後面還有第 2、第 3。這是從劇本自己的 waitlist_limit 推出來的，
      // 不是另一個設定——哪天那齣戲放寬到 3，標籤自己就回來了。
      item.position != null
        && ['gm_confirm', 'gm_reviewed'].includes(item.status)
        && item.waitlist_limit !== 1
        ? el('div', { class: 'status-chip' }, `第 ${item.position} 序位`)
        : null,
    ]),
  ]);
}

/** 2026-08-30 → 日。純顯示用，日期字串本身就是台北時間的字面值。 */
function weekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return '日一二三四五六'[new Date(y, m - 1, d).getDay()];
}
