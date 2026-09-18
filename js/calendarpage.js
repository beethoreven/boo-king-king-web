/**
 * 行事曆頁面的共用骨架：一個月的日曆 + 點 + 圖例 + 直接輸入年月日 + 某一天的清單。
 *
 * 三份行事曆（玩家的預訂、主持人的指定、店家的場次）長得一樣，差別只有
 * 「資料從哪來、一項怎麼畫、圖例寫什麼」——那三件事由呼叫端給，其餘都在
 * 這裡。各寫一份的話，之後補一個「今天」的標記或改點的行為，就要記得改
 * 三個地方，而漏掉的那一份不會有任何錯誤訊息。
 *
 * ## 點與清單刻意不一致
 *
 * 點不畫已取消的場次，清單全部列出（案主 2026-09-17 定案）。兩者回答的問題
 * 不同：點回答「那天有沒有事」，清單回答「那天這筆後來怎麼了」。
 * 這條規則由後端的兩支 API 決定，這裡只是照著顯示。
 *
 * ## 骨架長駐，只換內容
 *
 * 三格數字輸入框是持久節點，永遠不被卸下。整頁重畫的話，非同步回應一回來
 * 就會把使用者打到一半的年月日洗掉、焦點也跟著消失——預約畫面踩過這個坑，
 * 理由見 booking.js 開頭。
 */

import { el, clear, toast, spinner } from './ui.js';
import { weekdayRow, monthCells } from './calendar.js';

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// 一格裡最多畫幾個點，超過就改成一條線。
//
// ★ 這個數字是量出來的，不是美感：日曆一格在 320px 的手機上約 39px 寬，
//   6px 的點加 3px 間距，4 個點要 33px，第 5 個就擠出去了。
//   案主 2026-09-17 定案「4 場以上一律一條線」——店家看四場跟十場的意義
//   一樣，只是要確認有沒有人亂訂，所以不做「三個點加 +N」那種變體。
const MAX_DOTS = 3;

/**
 * @param {object} opts
 * @param {(ym: string) => Promise<object>} opts.loadMonth  'YYYY-MM' → {iso: ['狀態', ...]}
 * @param {(iso: string) => Promise<object>} opts.loadDay    'YYYY-MM-DD' → {items, has_more}
 * @param {() => Promise<Array>} opts.loadLegend             → [{key, label}]，key 要對得上點的 class
 * @param {(item: object) => Node} opts.renderItem           清單裡的一項
 * @param {string} opts.emptyText                            這天沒有東西時說什麼
 * @param {string} opts.moreText                             一天超過一頁時說什麼
 */
export function createCalendarPage({
  loadMonth, loadDay, loadLegend, renderItem, emptyText, moreText,
}) {
  const root = el('div', { class: 'view' });
  const today = new Date();

  const state = {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    selected: isoOf(today.getFullYear(), today.getMonth() + 1, today.getDate()),
    days: {},            // {iso: ['gm_confirm', 'booked']}，依開始時間排序
    daysLoading: true,
    daysFailed: false,
    items: [],
    itemsLoading: true,
    itemsFailed: false,
    hasMore: false,
    // 圖例。跟頁籤同一份清單（後端依這家店的功能表給），所以不收訂金的店
    // 不會出現「等待支付訂金」那個顏色。
    legend: [],
  };

  // 過期的回應不要蓋掉比較新的結果——寫法與理由見 admin.js 的同一段。
  // 連按兩下「下個月」時，先送出的那個可能後到。
  let monthSeq = 0;
  let daySeq = 0;

  // ── 骨架（以下節點建立一次，之後只換它們的內容）─────────────

  const title = el('div', { class: 'cal__title', 'aria-live': 'polite' });
  const gridBox = el('div', {});
  const legendBox = el('div', {});
  const listBox = el('div', {});

  const numberField = (placeholder, min, max, cls = 'dt-input--short') => el('input', {
    type: 'number',
    class: `dt-input ${cls}`,
    placeholder,
    min: String(min),
    max: String(max),
    inputmode: 'numeric',
    'aria-label': placeholder,
    // 離開欄位或按 Enter 才算填完——邊打邊跳，會在打「20」的時候就跳到 20 年。
    onChange: () => applyFields(),
  });

  const fieldYear = numberField('YYYY', 1970, 9999, 'dt-input--year');
  const fieldMonth = numberField('MM', 1, 12);
  const fieldDay = numberField('DD', 1, 31);

  root.append(
    el('div', { class: 'section' }, [
      el('div', { class: 'cal__head' }, [
        el('button', {
          type: 'button', class: 'cal__nav', 'aria-label': '上個月',
          onClick: () => shiftMonth(-1),
        }, '‹'),
        title,
        el('button', {
          type: 'button', class: 'cal__nav', 'aria-label': '下個月',
          onClick: () => shiftMonth(1),
        }, '›'),
      ]),
      gridBox,
      legendBox,
      el('div', { class: 'dt-row dt-row--jump' }, [
        fieldYear, el('span', { class: 'dt-unit' }, '年'),
        fieldMonth, el('span', { class: 'dt-unit' }, '月'),
        fieldDay, el('span', { class: 'dt-unit' }, '日'),
      ]),
      el('div', { class: 'field__hint' }, '輸入年月日可以直接跳到那一天'),
    ]),
    listBox,
  );

  // ── 載入 ────────────────────────────────────────────────────

  async function fetchLegend() {
    try {
      state.legend = await loadLegend();
    } catch (err) {
      // 圖例載不到不影響看場次，所以不擋畫面，只留一句。
      toast(err.message, { error: true });
    }
    renderLegend();
  }

  async function fetchMonth() {
    const mine = ++monthSeq;
    state.daysLoading = true;
    state.daysFailed = false;
    renderGrid();
    try {
      const days = await loadMonth(`${state.year}-${pad(state.month)}`);
      if (mine !== monthSeq) return;
      state.days = days ?? {};
    } catch (err) {
      if (mine !== monthSeq) return;
      // ★ 「讀不到」與「這個月沒有場次」要分開。兩者的格子都是空的，但一個
      //   是系統壞了、一個是真的沒事——混在一起的話，一次網路失敗會被讀成
      //   「我這個月沒有預約」。
      state.days = {};
      state.daysFailed = true;
      toast(err.message, { error: true });
    }
    state.daysLoading = false;
    renderGrid();
  }

  async function fetchDay(iso) {
    const mine = ++daySeq;
    state.itemsLoading = true;
    state.itemsFailed = false;
    renderList();
    try {
      const d = await loadDay(iso);
      if (mine !== daySeq) return;
      state.items = d.items ?? [];
      state.hasMore = Boolean(d.has_more);
    } catch (err) {
      if (mine !== daySeq) return;
      state.items = [];
      state.hasMore = false;
      state.itemsFailed = true;
      toast(err.message, { error: true });
    }
    state.itemsLoading = false;
    renderList();
  }

  // ── 動作 ────────────────────────────────────────────────────

  /** 選某一天：日曆上標起來、下面列出那天的場次、三格跟著同步。 */
  function pickDay(iso) {
    state.selected = iso;
    syncFields();
    renderGrid();
    fetchDay(iso);
  }

  function shiftMonth(delta) {
    let m = state.month + delta;
    let y = state.year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    state.year = y;
    state.month = m;
    // ★ 換月份就取消選取。不清的話，下面列的是別的月份那一天的場次，而
    //   日曆上看不到任何被選起來的格子——畫面同時在講兩件事。
    state.selected = null;
    state.items = [];
    state.itemsLoading = false;
    state.itemsFailed = false;
    syncFields();
    renderList();
    fetchMonth();
  }

  /** 跳到某一天（手動輸入年月日用）。 */
  function jumpTo(y, m, d) {
    const sameMonth = y === state.year && m === state.month;
    state.year = y;
    state.month = m;
    state.selected = isoOf(y, m, d);
    if (!sameMonth) fetchMonth(); else renderGrid();
    fetchDay(state.selected);
  }

  /**
   * 三格湊得出一個真實存在的日期就跳過去，湊不出來就什麼都不做。
   *
   * 這三格只是換位置，不送出任何東西，所以打錯沒有後果——不必像預約畫面
   * 那樣把錯誤講出來，安靜地停在原地就好。
   */
  function applyFields() {
    const y = Number(fieldYear.value.trim());
    const m = Number(fieldMonth.value.trim());
    const d = Number(fieldDay.value.trim());
    if (!Number.isInteger(y) || y < 1970 || y > 9999) return;
    if (!Number.isInteger(m) || m < 1 || m > 12) return;
    if (!Number.isInteger(d) || d < 1 || d > 31) return;
    // 擋掉 2 月 31 日這種「每一格都在範圍內、湊起來不存在」的日期。
    const probe = new Date(y, m - 1, d);
    if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return;
    if (isoOf(y, m, d) === state.selected) return;   // 已經在這一天了
    jumpTo(y, m, d);
  }

  /** 把目前的位置抄回三格。**只在程式改動位置時呼叫**，不在每次重畫時做——
   *  否則一個非同步回應回來，就會把使用者打到一半的年月日洗掉。 */
  function syncFields() {
    fieldYear.value = state.year;
    fieldMonth.value = state.month;
    fieldDay.value = state.selected ? Number(state.selected.slice(8, 10)) : '';
  }

  // ── 畫面 ────────────────────────────────────────────────────

  function renderLegend() {
    clear(legendBox);
    if (!state.legend.length) return;
    legendBox.append(el('div', { class: 'cal-legend' }, state.legend.map(({ key, label }) =>
      el('span', { class: 'cal-legend__item' }, [
        el('span', { class: `cal-dot cal-dot--${key}`, 'aria-hidden': 'true' }),
        label,
      ]))));
  }

  /**
   * 一格底下的點。四場以上改成一條線（案主定案，見 MAX_DOTS）。
   *
   * ★ 沒有場次的日子也回傳這一列，只是裡面是空的。省掉的話，有點的格子
   *   會把數字往上擠，整個月的數字就高高低低——案主 2026-09-18 在線上
   *   看到的就是這個。寧可每一格都先空出這 6px，也不要歪。
   */
  function marks(statuses) {
    const inner = statuses.length > MAX_DOTS
      ? [el('span', { class: 'cal-line' })]
      : statuses.map((s) => el('span', { class: `cal-dot cal-dot--${s}` }));
    return el('span', { class: 'cal-marks', 'aria-hidden': 'true' }, inner);
  }

  function renderGrid() {
    title.textContent = `${state.year} 年 ${state.month} 月`;
    clear(gridBox);
    const grid = el('div', { class: 'cal__grid', role: 'grid' }, weekdayRow());
    gridBox.append(grid);
    if (state.daysLoading) {
      grid.append(el('div', { class: 'cal__empty' }, '載入中…'));
      return;
    }
    grid.append(...monthCells(state.year, state.month, (iso, d) => {
      const statuses = state.days[iso] ?? [];
      return el('button', {
        type: 'button',
        class: `cal__day cal__day--mark${iso === state.selected ? ' is-selected' : ''}`,
        // 顏色對讀螢幕的人沒有意義，所以把「幾場」講出來。
        'aria-label': statuses.length
          ? `${state.month} 月 ${d} 日，${statuses.length} 場`
          : `${state.month} 月 ${d} 日`,
        onClick: () => pickDay(iso),
      }, [el('span', { class: 'cal__day-num' }, String(d)), marks(statuses)]);
    }));
    if (state.daysFailed) {
      grid.append(el('div', { class: 'cal__empty' }, '讀取失敗，請稍後再試'));
    }
  }

  function renderList() {
    clear(listBox);
    if (!state.selected) {
      listBox.append(el('div', { class: 'empty' }, '點一個日期，看那天的場次'));
      return;
    }
    if (state.itemsLoading) { listBox.append(spinner()); return; }
    if (state.itemsFailed) {
      listBox.append(el('div', { class: 'empty' }, '讀取失敗，請稍後再試'));
      return;
    }
    if (!state.items.length) {
      listBox.append(el('div', { class: 'empty' }, emptyText));
      return;
    }
    listBox.append(el('div', { class: 'section' }, [
      el('div', { class: 'list' },
        state.items.map((item) => renderItem(item))),
      // 一天超過一頁在這個畫面上幾乎不會發生，但真的發生時要說出來——
      // 安靜地少列幾筆的話，使用者只會覺得是自己記錯了。
      state.hasMore
        ? el('div', { class: 'field__hint' }, moreText)
        : null,
    ]));
  }

  syncFields();
  renderGrid();
  renderList();
  fetchLegend();
  fetchMonth();
  fetchDay(state.selected);

  return {
    node: root,
    /**
     * 資料被改動之後重抓：這個月的點，以及目前選的那一天。
     *
     * 主持人在清單上按「確認」之後就是走這裡——那一場的分類會從待確認
     * 變成已確認，日曆上那個點的顏色也必須跟著變。只重畫清單的話，
     * 點會留在舊顏色上，而那正是他剛剛動過的那一天。
     */
    reload() {
      fetchMonth();
      if (state.selected) fetchDay(state.selected);
    },
  };
}
