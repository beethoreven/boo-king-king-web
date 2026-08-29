/**
 * 只給得選開放日期的日曆。
 *
 * ## 為什麼要自己刻
 *
 * 原生 <input type="date"> 只吃 min/max，**沒有辦法把區間內的個別日子
 * 變成不可選**。而這個系統最需要表達的正是「9/5 開、9/6 不開、9/12 開」
 * 這種散落的形狀——用原生控制項只能讓人選下去、再告訴他不行。
 *
 * 代價是失去手機上的系統日期選單（iOS 的滾輪）。那是真的損失，所以格子
 * 的觸控目標做到 44px，不要讓「不能用原生」順便變成「手機上難按」。
 *
 * ## 跟外面的分工
 *
 * 這支只管「顯示哪些日子可以點、點了通知你」。它不知道什麼是劇本、
 * 不打任何 API——要顯示哪個月的資料由 loadMonth 提供，那是呼叫端的事。
 * 這樣它才能被別的畫面重用，也才測得動。
 *
 * ★ 它是「輸入輔助」，不是資料來源。booking.js 下排那五個數字欄位才是
 *   送出時真正讀的東西（見那支開頭的說明）。這裡點一下只是幫使用者把
 *   那五格填好，所以就算這支壞了，手動輸入的路仍然是通的。
 */

import { el, clear } from './ui.js';

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * @param {object} opts
 * @param {(iso: string) => void} opts.onPick  選了某一天
 * @param {(year:number, month:number) => Promise<object>} opts.loadMonth
 *        回傳 { 'YYYY-MM-DD': ['10:00', ...] }，只需要有開放的日子
 */
export function createCalendar({ onPick, loadMonth }) {
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth() + 1;   // 1-12
  let days = {};                      // 這個月的開放資料
  let selected = '';
  let loading = false;
  let failed = false;                 // 這一次載入是不是失敗了（≠ 沒開放）
  // 翻月份的世代序。連續按「下個月」時會有兩個請求同時在飛，先發的可能
  // 後到；沒有這個守衛，舊月份的資料會蓋掉新月份的。
  //
  // ★ 症狀不是「顯示錯的月份」那麼明顯：標題仍然是新月份，但格子是用
  //   舊月份的日期當 key 去查的，一個都對不上，於是整個月變成全部不可
  //   選——看起來就像店家那個月完全沒開。實測確認過。
  let seq = 0;

  // 觸發用的欄位。外觀跟原本那個原生輸入框一致——案主要的是「沒開放
  // 不能點」，不是換一套視覺。
  const trigger = el('button', {
    type: 'button',
    class: 'cal-trigger',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    onClick: () => (panel.hidden ? open() : close()),
  }, '選擇日期');

  const title = el('div', { class: 'cal__title', 'aria-live': 'polite' });
  const grid = el('div', { class: 'cal__grid', role: 'grid' });
  const panel = el('div', { class: 'cal', hidden: true, role: 'dialog', 'aria-label': '選擇日期' }, [
    el('div', { class: 'cal__head' }, [
      el('button', { type: 'button', class: 'cal__nav', 'aria-label': '上個月',
        onClick: () => shift(-1) }, '‹'),
      title,
      el('button', { type: 'button', class: 'cal__nav', 'aria-label': '下個月',
        onClick: () => shift(1) }, '›'),
    ]),
    grid,
  ]);

  const node = el('div', { class: 'cal-wrap' }, [trigger, panel]);

  function shift(delta) {
    month += delta;
    if (month < 1) { month = 12; year -= 1; }
    if (month > 12) { month = 1; year += 1; }
    load();
  }

  async function load() {
    const mine = ++seq;
    loading = true;
    failed = false;
    render();
    try {
      const got = await loadMonth(year, month) ?? {};
      if (mine !== seq) return;   // 期間又翻過月份，這份已經過期
      days = got;
    } catch {
      if (mine !== seq) return;
      // ★ 「拿不到」跟「這個月沒開」要分開。兩者都是空的格子，但一個是
      //   系統壞了、一個是店家的安排——混在一起的話，一次網路失敗會被
      //   讀成「這家店整個月都不開」，而畫面上沒有任何地方說得出真相。
      days = {};
      failed = true;
    }
    loading = false;
    render();
  }

  function render() {
    title.textContent = `${year} 年 ${month} 月`;
    clear(grid);

    for (const w of WEEKDAY) {
      grid.append(el('div', { class: 'cal__dow', role: 'columnheader' }, w));
    }
    if (loading) {
      grid.append(el('div', { class: 'cal__empty' }, '載入中…'));
      return;
    }

    // 這個月 1 號是星期幾，前面補幾個空格。用 Date 只為了算星期，
    // 不涉及時區——年月日都是本地的字面值。
    const lead = new Date(year, month - 1, 1).getDay();
    for (let i = 0; i < lead; i += 1) {
      grid.append(el('div', { class: 'cal__pad' }));
    }

    const total = new Date(year, month, 0).getDate();
    for (let d = 1; d <= total; d += 1) {
      const iso = isoOf(year, month, d);
      const times = days[iso];
      const openDay = Array.isArray(times) && times.length > 0;
      grid.append(el('button', {
        type: 'button',
        // ★ 沒開放的就是 disabled，不是「點了再說不行」。這整支存在的
        //   理由就是這一行。
        disabled: !openDay,
        class: `cal__day${iso === selected ? ' is-selected' : ''}`,
        // 讀螢幕的人也要知道為什麼點不了，光靠顏色不夠。
        'aria-label': openDay
          ? `${month} 月 ${d} 日，開放 ${times.join('、')}`
          : `${month} 月 ${d} 日，未開放`,
        onClick: () => { selected = iso; render(); close(); onPick(iso); },
      }, String(d)));
    }

    if (!Object.keys(days).length) {
      grid.append(el('div', { class: 'cal__empty' },
        failed ? '讀取失敗，請稍後再試' : '這個月沒有開放的日期'));
    }
  }

  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    // 每次打開都重抓：使用者可能在別的分頁把場次訂走了，或店家剛改過
    // 設定。這是一個低頻動作，重抓一次的成本遠低於顯示過期的可選日。
    load();
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
  }

  function close() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onKey);
  }

  // 用 mousedown 而不是 click：click 要等到放開才觸發，而使用者按下去的
  // 那一刻面板就該收起來。搜尋結果那邊也是同一個理由。
  function onOutside(e) {
    if (!node.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === 'Escape') { close(); trigger.focus(); }
  }

  return {
    node,
    /** 外面改了日期（例如手動輸入五格）時同步顯示。 */
    setValue(iso) {
      selected = iso || '';
      trigger.textContent = selected ? selected.replace(/-/g, '/') : '選擇日期';
      trigger.classList.toggle('is-empty', !selected);
      if (selected) {
        const [y, m] = selected.split('-').map(Number);
        year = y; month = m;
      }
      if (!panel.hidden) render();
    },
    /** 換劇本之後，之前抓的開放日期就不算數了。 */
    reset() {
      days = {};
      close();
    },
  };
}
