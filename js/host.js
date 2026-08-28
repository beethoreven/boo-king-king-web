/**
 * 主持人介面：三個頁籤（待確認／已確認／已結束）。
 *
 * 分頁與篩選都只作用於當前頁籤——初次載入打一支 /api/host/dashboard
 * 拿三包的第一頁，之後翻頁或篩選只針對當前頁籤打 /api/host/tab/<tab>，
 * 另外兩包維持畫面上既有的內容不動。
 */

import { api } from './api.js';
import { el, clear, select, field, toast, confirmDialog, alertDialog, spinner } from './ui.js';
import { hostMayConfirm } from './conflicts.js';

const TABS = [
  { key: 'pending', label: '待確認場次' },
  { key: 'confirmed', label: '已確認場次' },
  { key: 'ended', label: '已結束場次' },
];

// 「狀態」篩選只對已確認頁籤有意義：待確認永遠是 gm_confirm、
// 已結束永遠是 ended，對它們篩狀態等於沒篩。
const STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'gm_confirm', label: '等待其他主持確認' },
  { value: 'gm_reviewed', label: '等待訂金支付' },
  { value: 'booked', label: '場次已預約完成' },
];

const EMPTY_FILTERS = {
  mmg_name: '', player_name: '', role_name: '',
  session_date: '', session_time: '', status: '',
};

export function createHostView() {
  const root = el('div', { class: 'view' });

  const state = {
    tab: 'pending',
    // 每個頁籤各自記住自己的資料、頁碼與篩選條件
    tabs: Object.fromEntries(TABS.map((t) => [
      t.key,
      // stale：這一包的內容已經被別的動作改掉了，但使用者還沒切過來看。
      // 標記起來、等他真的切過去再重抓，不要在他還沒要看的時候先打 API。
      { items: [], has_more: false, start: 1, filters: { ...EMPTY_FILTERS },
        loading: true, stale: false },
    ])),
    filterOpen: false,
    // 篩選器輸入中的暫存值。按下「篩選」才寫進 tabs[x].filters 並打 API——
    // 每改一格就送出會產生大量沒必要的請求。
    draft: { ...EMPTY_FILTERS },
  };

  async function loadAll() {
    try {
      const data = await api.get('/api/host/dashboard');
      for (const t of TABS) {
        Object.assign(state.tabs[t.key], data[t.key], { loading: false });
      }
    } catch (err) {
      toast(err.message, { error: true });
      for (const t of TABS) state.tabs[t.key].loading = false;
    }
    render();
  }

  /** 只重載當前頁籤。翻頁與篩選都走這裡。 */
  async function reloadTab(key) {
    const tab = state.tabs[key];
    tab.loading = true;
    render();
    try {
      const data = await api.get(`/api/host/tab/${key}`, {
        start: tab.start,
        ...tab.filters,
      });
      Object.assign(tab, data);
    } catch (err) {
      toast(err.message, { error: true });
    }
    tab.loading = false;
    render();
  }

  /**
   * 開合篩選面板。收起時如果還有條件生效，一併清掉並重載。
   *
   * 「收起篩選器」在使用者眼中就是「不篩了」。原本只是把面板藏起來、條件
   * 照舊，而清除按鈕在面板裡——藏起來之後就沒有任何路可以回到完整清單，
   * 只能重新整理。那是死路，不是設計。
   *
   * 沒有生效中的條件就只是單純收合，不必為此打一支 API。
   */
  function closeOrOpenFilter() {
    const closing = state.filterOpen;
    state.filterOpen = !state.filterOpen;
    const tab = state.tabs[state.tab];
    if (closing && hasActiveFilter(tab.filters)) {
      state.draft = { ...EMPTY_FILTERS };
      tab.filters = { ...EMPTY_FILTERS };
      tab.start = 1;
      reloadTab(state.tab);
      return;
    }
    render();
  }

  function applyFilters() {
    const tab = state.tabs[state.tab];
    tab.filters = { ...state.draft };
    // 換了條件就回第一頁——舊頁碼在新條件下可能根本不存在
    tab.start = 1;
    reloadTab(state.tab);
  }

  function clearFilters() {
    state.draft = { ...EMPTY_FILTERS };
    applyFilters();
  }

  function switchTab(key) {
    state.tab = key;
    // 篩選條件是各頁籤自己的，切過去時把草稿同步成該頁籤目前生效的條件
    state.draft = { ...state.tabs[key].filters };
    // 被標記過期的才重抓。這是「確認場次」之後那一包會走的路：
    // 資料確實變了，但要等使用者真的想看才值得花那支 API。
    if (state.tabs[key].stale) {
      state.tabs[key].stale = false;
      reloadTab(key);
      return;
    }
    render();
  }

  async function showPlayer(bookingId) {
    try {
      const d = await api.get(`/api/bookings/${bookingId}/detail`);
      const p = d.player;
      await alertDialog({
        title: '預定者資料',
        body: [
          `稱呼：${p.name || '（未填）'}`,
          `Email：${p.email}`,
          `LINE：${p.line_id || '（未填）'}`,
          `電話：${p.phone || '（未填）'}`,
        ].join('\n'),
      });
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  async function showHosts(bookingId) {
    try {
      const d = await api.get(`/api/bookings/${bookingId}/detail`);
      const lines = d.gm_slots.map((s) => {
        const who = s.user_name || '（未指定）';
        const mark = s.confirmed ? '已確認' : '未確認';
        return `${s.role_name}：${who}（${mark}）`;
      });
      await alertDialog({ title: '本場主持人', body: lines.join('\n') });
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  async function confirmBooking(item) {
    const ok = await confirmDialog({
      title: '確認主持指定',
      body: '請確認已和玩家取得遊戲時間與主持共識。',
      confirmText: '確認',
    });
    if (!ok) return;

    // 撞期檢查排在同意之後、送出之前，讓「依然確認」按下去就是真的送出，
    // 中間不再多問一次。自己撞期會直接擋下來（見 conflicts.js）。
    if (!await hostMayConfirm(item.id)) return;

    try {
      await api.post(`/api/bookings/${item.id}/confirm`);
      toast('已確認主持指定');

      // 確認之後這筆會從待確認移到已確認。兩包都變了，但兩包都重抓是
      // 多花了兩支 API：
      //
      //   待確認——就是把這一列拿掉而已，畫面上的資料已經夠了，不需要
      //           跟後端再要一次一模一樣的清單。
      //   已確認——使用者現在人在待確認頁，那一包他還沒要看。先標記
      //           過期，等他切過去再抓（見 switchTab）。
      const pending = state.tabs.pending;
      pending.items = pending.items.filter((x) => x.id !== item.id);
      state.tabs.confirmed.stale = true;
      render();
    } catch (err) {
      toast(err.message, { error: true });
    }
  }

  function renderFilterPanel() {
    if (!state.filterOpen) return null;
    const showStatus = state.tab === 'confirmed';
    const set = (key) => (e) => { state.draft[key] = e.target.value ?? e; };

    return el('div', { class: 'section' }, [
      el('div', { class: 'list' }, [
        field({
          label: '劇本名稱',
          control: el('input', { type: 'text', value: state.draft.mmg_name, onInput: set('mmg_name'), placeholder: '不填＝不篩選' }),
        }),
        field({
          label: '預定者名稱',
          control: el('input', { type: 'text', value: state.draft.player_name, onInput: set('player_name'), placeholder: '不填＝不篩選' }),
        }),
        field({
          label: '指定的角色名稱',
          control: el('input', { type: 'text', value: state.draft.role_name, onInput: set('role_name'), placeholder: '不填＝不篩選' }),
        }),
        el('div', { class: 'row' }, [
          field({
            label: '日期',
            control: el('input', { type: 'date', value: state.draft.session_date, onChange: set('session_date') }),
          }),
          field({
            label: '時間',
            control: el('input', { type: 'time', step: '1800', value: state.draft.session_time, onChange: set('session_time') }),
          }),
        ]),
        showStatus && field({
          label: '狀態',
          control: select({
            options: STATUS_OPTIONS,
            value: state.draft.status,
            onChange: (v) => { state.draft.status = v; },
            ariaLabel: '篩選狀態',
          }),
        }),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn--ghost btn--small', onClick: clearFilters }, '清除'),
          el('button', { class: 'btn btn--primary btn--small', onClick: applyFilters }, '篩選'),
        ]),
      ]),
    ]);
  }

  function renderItem(item) {
    const isPending = state.tab === 'pending';
    return el('div', { class: 'card list-item' }, [
      el('div', { class: 'list-item__main' }, [
        el('div', { class: 'list-item__title' }, item.mmg_name),
        el('div', { class: 'list-item__meta' }, [
          `${item.session_date}（${weekday(item.session_date)}）${item.session_time}`,
        ]),
        el('div', { class: 'list-item__links' }, [
          el('button', { class: 'linklike', onClick: () => showPlayer(item.id) }, item.player_name),
          el('span', { class: 'sep' }, '·'),
          el('button', { class: 'linklike', onClick: () => showHosts(item.id) }, item.role_name || '（角色）'),
        ]),
      ]),
      el('div', { class: 'list-item__side' }, [
        isPending
          ? el('button', { class: 'btn btn--primary btn--small', onClick: () => confirmBooking(item) }, '確認')
          : state.tab === 'confirmed'
            ? el('div', { class: 'status-chip' }, item.status_label)
            : null,
      ]),
    ]);
  }

  function renderPager() {
    const tab = state.tabs[state.tab];
    const atFirst = tab.start <= 1;
    if (atFirst && !tab.has_more) return null;
    return el('div', { class: 'pager' }, [
      el('button', {
        class: 'btn btn--ghost btn--small',
        disabled: atFirst,
        onClick: () => { tab.start = Math.max(1, tab.start - 50); reloadTab(state.tab); },
      }, '← 上一頁'),
      el('div', { class: 'pager__label' }, `${tab.start} – ${tab.start + tab.items.length - 1}`),
      el('button', {
        class: 'btn btn--ghost btn--small',
        disabled: !tab.has_more,
        onClick: () => { tab.start += 50; reloadTab(state.tab); },
      }, '下一頁 →'),
    ]);
  }

  function render() {
    clear(root);
    const tab = state.tabs[state.tab];

    root.append(
      el('div', { class: 'tabs' }, TABS.map((t) =>
        el('button', {
          class: `tab${t.key === state.tab ? ' tab--active' : ''}`,
          onClick: () => switchTab(t.key),
        }, t.label),
      )),
    );

    root.append(
      el('div', { class: 'section toolbar' }, [
        el('button', {
          class: 'btn btn--ghost btn--small',
          onClick: () => closeOrOpenFilter(),
        }, state.filterOpen ? '收起篩選器' : '篩選器'),
        hasActiveFilter(tab.filters) && el('div', { class: 'field__hint' }, '篩選中'),
      ]),
    );

    const panel = renderFilterPanel();
    if (panel) root.append(panel);

    if (tab.loading) {
      root.append(spinner());
      return;
    }
    if (!tab.items.length) {
      root.append(el('div', { class: 'empty' }, hasActiveFilter(tab.filters) ? '沒有符合篩選條件的場次' : '目前沒有場次'));
      return;
    }

    root.append(el('div', { class: 'section' }, el('div', { class: 'list' }, tab.items.map(renderItem))));
    const pager = renderPager();
    if (pager) root.append(el('div', { class: 'section' }, pager));
  }

  // 先畫一次再去要資料。少了這一行，root 會在整個載入期間是空的——
  // 使用者看到的是一片空白，分不出「還在載」與「真的沒東西」。
  render();
  loadAll();
  return root;
}

function hasActiveFilter(filters) {
  return Object.values(filters).some((v) => v !== '');
}

function weekday(iso) {
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  // 用 UTC 解析，避免時區造成日期偏移一天
  const [y, m, d] = iso.split('-').map(Number);
  return names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
