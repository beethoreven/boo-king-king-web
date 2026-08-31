/**
 * 「我預定的場次」：玩家看自己的預約。
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

const EMPTY_FILTERS = { mmg_name: '', session_date: '', session_time: '' };

const hasActiveFilter = (f) => Object.values(f).some((v) => v !== '');

const emptyTab = () => ({
  items: [], has_more: false, start: 1,
  filters: { ...EMPTY_FILTERS }, loading: true, loaded: false,
});

export function createMyBookingsView() {
  const root = el('div', { class: 'view' });

  const state = {
    tabs: {},        // {key: 中文標籤}，後端給的
    tabOrder: [],
    tab: null,
    data: {},        // {key: emptyTab()}
    filterOpen: false,
    draft: { ...EMPTY_FILTERS },
    loading: true,
  };

  async function loadTabs() {
    try {
      const d = await api.get('/api/bookings/mine/tabs');
      state.tabs = d.tabs;
      state.tabOrder = Object.keys(d.tabs);
      for (const key of state.tabOrder) state.data[key] = emptyTab();
      state.tab = state.tabOrder[0];
    } catch (err) {
      toast(err.message, { error: true });
    }
    state.loading = false;
    render();
    if (state.tab) reloadTab(state.tab);
  }

  async function reloadTab(key) {
    const t = state.data[key];
    t.loading = true;
    render();
    try {
      Object.assign(t, await api.get(`/api/bookings/mine/tab/${key}`, {
        start: t.start, ...t.filters,
      }));
      t.loaded = true;
    } catch (err) {
      toast(err.message, { error: true });
    }
    t.loading = false;
    render();
  }

  function switchTab(key) {
    state.tab = key;
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

  function renderItem(item) {
    const paid = item.deposit ?? 0;
    const due = item.booking_cost ?? 0;
    return el('div', { class: 'card list-item' }, [
      el('div', { class: 'list-item__main' }, [
        el('div', { class: 'list-item__title' }, scriptName(item.mmg_name, item.mmg_url)),
        el('div', { class: 'list-item__meta' },
          `${item.session_date}（${weekday(item.session_date)}）${item.session_time}`),
        el('div', { class: 'list-item__meta' },
          item.gm_names.length ? `主持：${item.gm_names.join('、')}` : '尚未指定主持人'),
        // 訂金只在還有意義的時候顯示。已結束或已取消的場次再提「還差多少」
        // 是在講一件已經不會發生的事。
        !['ended', 'cancelled'].includes(item.status)
          && el('div', { class: 'list-item__meta' }, `訂金 ${paid} / ${due}`),
      ]),
      el('div', { class: 'list-item__side' }, [
        // 序位只在還沒定案時有意義。已成立就是他的場，講「第 1 序位」
        // 反而讓人以為還在排隊。
        item.position != null && ['gm_confirm', 'gm_reviewed'].includes(item.status)
          ? el('div', { class: 'status-chip' }, `第 ${item.position} 序位`)
          : null,
      ]),
    ]);
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

    const panel = renderFilterPanel();
    if (panel) root.append(panel);

    if (t.loading) { root.append(spinner()); return; }
    if (!t.items.length) {
      root.append(el('div', { class: 'empty' },
        hasActiveFilter(t.filters) ? '沒有符合篩選條件的場次' : '這個狀態目前沒有場次'));
      return;
    }

    root.append(el('div', { class: 'section' }, el('div', { class: 'list' }, t.items.map(renderItem))));
    const pager = renderPager();
    if (pager) root.append(el('div', { class: 'section' }, pager));
  }

  loadTabs();
  return root;
}

/** 2026-08-30 → 日。純顯示用，日期字串本身就是台北時間的字面值。 */
function weekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return '日一二三四五六'[new Date(y, m - 1, d).getDay()];
}
