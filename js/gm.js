/**
 * 主持人介面：三個頁籤（待確認／已確認／已結束）。
 *
 * 分頁與篩選都只作用於當前頁籤——初次載入打一支 /api/gm/dashboard
 * 拿三包的第一頁，之後翻頁或篩選只針對當前頁籤打 /api/gm/tab/<tab>，
 * 另外兩包維持畫面上既有的內容不動。
 */

import { api } from './api.js';
import { el, clear, select, field, toast, confirmDialog, alertDialog, spinner, scriptName, asyncLink} from './ui.js';
import { gmMayConfirm } from './conflicts.js';
import { setRouteTab, slugs, assertSlugs, newInstance } from './route.js';
import { showGms } from './gms-dialog.js';

const TABS = [
  { key: 'pending', label: '待確認場次' },
  { key: 'confirmed', label: '已確認場次' },
  { key: 'ended', label: '已結束場次' },
];

// 頁籤的網址名稱。這三個本來就是好讀的英文，網址值與 key 相同——但表還是
// 要寫出來：之後多一個頁籤而忘了給它網址名稱時，下面那行會讓模組載不起來，
// 而不是安靜地讓那個頁籤變成「連結分享不出去」。
const TAB_SLUG = { pending: 'pending', confirmed: 'confirmed', ended: 'ended' };
assertSlugs('主持人介面', TAB_SLUG, TABS.map((t) => t.key));
const tabRoute = slugs(TAB_SLUG);

// 狀態篩選的選項**由後端跟著 dashboard 一起回**（db/bookings.py 的
// GM_FILTER_STATUSES）。這裡原本硬寫一份，結果同一個狀態在下拉裡叫
// 「等待訂金支付」、在清單列裡叫「等待支付訂金」——兩份各改各的，沒人發現。
//
// 「全部」留在前端：它不是一個狀態，是「不要篩」。

const EMPTY_FILTERS = {
  mmg_name: '', player_name: '', role_name: '',
  session_date: '', session_time: '', status: '',
};

/**
 * tab 來自網址（?view=gm&tab=）。指定通知那封信會帶 pending
 * 進來——那剛好也是預設值，但**不能因此就不接這個參數**：那是巧合，
 * 之後改了預設頁籤，信就會安靜地落錯地方。
 */
export function createGmView({ tab } = {}) {
  const root = el('div', { class: 'view' });
  // 這個實例的號碼。寫網址時帶著，讓被丟掉的舊實例寫不進去。
  const instance = newInstance();

  const state = {
    tab: tabRoute.toKey(tab) ?? 'pending',
    // 每個頁籤各自記住自己的資料、頁碼與篩選條件
    tabs: Object.fromEntries(TABS.map((t) => [
      t.key,
      // stale：這一包的內容已經被別的動作改掉了，但使用者還沒切過來看。
      // 標記起來、等他真的切過去再重抓，不要在他還沒要看的時候先打 API。
      { items: [], has_more: false, start: 1, filters: { ...EMPTY_FILTERS },
        loading: true, stale: false,
        // 這一次載入是不是失敗了（≠ 真的沒有場次）
        failed: false },
    ])),
    filterOpen: false,
    // 後端回的狀態選項。還沒載到之前是空的，篩選器就只有「全部」——
    // 那時候三個頁籤也都還在載入中，沒有東西可以篩。
    statusOptions: [],
    // 篩選器輸入中的暫存值。按下「篩選」才寫進 tabs[x].filters 並打 API——
    // 每改一格就送出會產生大量沒必要的請求。
    draft: { ...EMPTY_FILTERS },
  };


  // 過期的回應不要蓋掉比較新的結果。
  //
  // 同一包資料可能同時有兩個請求在飛（連按兩下「下一頁」、改完篩選又馬上再改），
  // 而**回來的順序不保證跟送出的順序一樣**。沒有這個保護的話，先送的那個後回來，
  // 就會把舊資料蓋在新資料上——畫面列出第 2 頁的內容，頁碼卻寫著第 3 頁。
  //
  // 號碼記在「要被寫入的那個物件」上，不是整個畫面共用一個：切頁籤不該讓另一個
  // 頁籤還在飛的請求作廢，那會讓已經抓過的那包白抓一次。
  // （寫法沿用 calendar.js 的 seq。）
  const claim = (slot) => (slot.seq = (slot.seq ?? 0) + 1);
  const stale = (slot, mine) => mine !== slot.seq;

  async function loadAll() {
    const mine = Object.fromEntries(TABS.map((t) => [t.key, claim(state.tabs[t.key])]));
    try {
      const data = await api.get('/api/gm/dashboard');
      for (const t of TABS) {
        if (stale(state.tabs[t.key], mine[t.key])) continue;
        Object.assign(state.tabs[t.key], data[t.key], { loading: false, failed: false });
      }
      state.statusOptions = data.status_options ?? [];
    } catch (err) {
      // ★ 載入失敗要留下痕跡。只跳一個三秒就消失的 toast、把清單留成空的，
      //   畫面顯示的就是「目前沒有…」——跟真的沒資料長得一模一樣。
      //   /api/admin/abuse 壞了好幾個 commit 沒人發現就是這樣蓋掉的。
      toast(err.message, { error: true });
      for (const t of TABS) {
        if (stale(state.tabs[t.key], mine[t.key])) continue;
        Object.assign(state.tabs[t.key], { loading: false, failed: true });
      }
    }
    render();
  }

  /** 只重載當前頁籤。翻頁與篩選都走這裡。 */
  async function reloadTab(key) {
    const tab = state.tabs[key];
    const mine = claim(tab);
    tab.loading = true;
    render();
    try {
      const data = await api.get(`/api/gm/tab/${key}`, {
        start: tab.start,
        ...tab.filters,
      });
      if (stale(tab, mine)) return;
      Object.assign(tab, data);
      tab.failed = false;
    } catch (err) {
      if (stale(tab, mine)) return;
      tab.failed = true;
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
    setRouteTab('gm', tabRoute.toSlug(key), instance);
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

  async function confirmBooking(item) {
    const ok = await confirmDialog({
      title: '確認主持指定',
      body: '請確認已和玩家取得遊戲時間與主持共識。',
      confirmText: '確認',
    });
    if (!ok) return;

    // 撞期檢查排在同意之後、送出之前，讓「依然確認」按下去就是真的送出，
    // 中間不再多問一次。自己撞期會直接擋下來（見 conflicts.js）。
    if (!await gmMayConfirm(item.id)) return;

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
            options: [{ value: '', label: '全部' }, ...state.statusOptions],
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
        el('div', { class: 'list-item__title' }, [
          scriptName(item.mmg_name, item.mmg_url),
          // 自己在這一場擔任的角色。移到標題旁邊是因為那是主持人掃清單
          // 時最需要一眼看到的——「這場我是誰」比「預定者是誰」先要緊。
          item.role_name && el('span', { class: 'sep' }, '·'),
          item.role_name && asyncLink(item.role_name, () => showGms(item.id)),
        ].filter(Boolean)),
        el('div', { class: 'list-item__meta' }, [
          `${item.session_date}（${weekday(item.session_date)}）${item.session_time}`,
        ]),
        el('div', { class: 'list-item__links' }, [
          asyncLink(item.player_name, () => showPlayer(item.id)),
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
      root.append(el('div', { class: 'empty' }, tab.failed
        ? '讀取失敗，請稍後再試'
        : (hasActiveFilter(tab.filters) ? '沒有符合篩選條件的場次' : '目前沒有場次')));
      return;
    }

    root.append(el('div', { class: 'section' }, el('div', { class: 'list' }, tab.items.map(renderItem))));
    const pager = renderPager();
    if (pager) root.append(el('div', { class: 'section' }, pager));
  }

  // 網址帶了無效的頁籤（舊連結、拼錯）時，pickTab 已經退回 pending 了，
  // 這裡把網址一起改正——否則網址會停在一個跟畫面對不起來的值上。
  setRouteTab('gm', tabRoute.toSlug(state.tab), instance);
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
