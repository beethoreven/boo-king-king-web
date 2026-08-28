/**
 * 玩家的預約畫面。
 *
 * 互動規則（依先前討論定案）：
 *   - 選了劇本，下面才顯示其他區塊
 *   - 選了主持人才打 API 驗證是否撞期
 *   - 同一個選項重選同一個值，直接沿用上次的錯誤，不重打 API
 *   - 選單類錯誤用 toast + 欄位紅色驚嘆號；送出前的彙總用對話框
 *
 * ★ 畫面骨架只建立一次，render() 從不重建 DOM，只同步值、文字與顯示與否。
 *
 *   先前的寫法是每次 render() 都 clear(root) 再全部重畫，那是「打到日就
 *   跳掉」的真正原因：<input type="date"> 內部是年/月/日三個區段，使用者
 *   還停在「日」那一段時 change 就已經觸發，接著 render() 一跑，
 *   root.replaceChildren() 把所有子節點卸下——**節點一離開 DOM 焦點就沒了**，
 *   再 append 回去也救不回來。
 *
 *   曾經試過「把輸入框做成持久節點」，那不夠：焦點跟著的是「有沒有被卸下」，
 *   不是「是不是同一個節點物件」。持久節點只保住值，保不住焦點。唯一的解法
 *   是根本不要卸它——所以這裡改成骨架長駐、render() 只做同步。
 */

import { api, ApiError } from './api.js';
import { el, clear, toast, confirmDialog, alertDialog, spinner } from './ui.js';

/** 每個角色一列。gm_user_ids 固定 4 格，沒有的角色是 null。 */
const EMPTY_HOSTS = [null, null, null, null];

// 時與分的下拉選項。分只給整點與半點——場次時間是以半小時為單位的約定，
// 給 60 個選項只會讓人多滑。想打其他分鐘數的，用下面那排手動欄位。
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTE_OPTIONS = ['00', '30'];

const pad = (n, width) => String(n).padStart(width, '0');

export function createBookingView() {
  const root = el('div', { class: 'view' });

  // ── 骨架：以下節點在這裡建立一次，之後永遠不重建、不卸下 ──────────

  // 劇本
  const scriptSelect = el('select', {
    'aria-label': '選擇劇本',
    onChange: (e) => pickScript(e.target.value),
  });
  // 搜尋只在前端做。劇本清單在載入時就整包拿回來了，為了「打一個字」
  // 再去打一支 API 是白花的——資料已經在手上。
  const searchInput = el('input', {
    type: 'text',
    placeholder: '或輸入劇本名稱搜尋',
    'aria-label': '搜尋劇本',
    autocomplete: 'off',
    onInput: () => renderSearchResults(),
    // 離開欄位時把清單收起來。用 mousedown 而不是 click 綁在選項上
    // （見 renderSearchResults），否則 blur 會先發生、選項在被點到之前
    // 就消失了。
    onBlur: () => setTimeout(() => { searchResults.hidden = true; }, 0),
    onFocus: () => renderSearchResults(),
  });
  const searchResults = el('div', { class: 'search-results', hidden: true });

  const scriptSection = el('div', { class: 'section' }, [
    el('div', { class: 'section__label' }, '選擇劇本'),
    el('div', { class: 'select-wrap' }, scriptSelect),
    el('div', { class: 'search-wrap' }, [searchInput, searchResults]),
  ]);

  // 劇本資訊標籤（純顯示，內容可以整批換掉，沒有焦點問題）
  const tagRow = el('div', { class: 'tag-row' });
  const tagSection = el('div', { class: 'section' }, [tagRow]);

  // 場次 —— 兩排，抄 fireless-war 的做法
  //
  // 上排是「輸入輔助」：日曆選擇器與時／分下拉，方便快速選。
  // 下排是「資料來源」：五個獨立的數字欄位，送出時只讀這裡。
  //
  // ★ 為什麼要有下排：<input type="date"> 是瀏覽器的多區段元件，它什麼時候
  //   觸發 change、焦點停在哪一段，我們控制不了。把它降級成純輔助之後，
  //   就算它行為古怪也只是往下排寫一次值，不影響任何事。而下排是普通的
  //   數字輸入，沒有「區段」的概念，結構上不可能打到一半跳掉。
  //   這也是 fireless-war 那個介面好用的原因：picker 只是捷徑，不是必經之路。
  const datePicker = el('input', {
    type: 'date',
    class: 'date-picker',
    'aria-label': '用日曆選擇日期',
    onChange: () => {
      if (!datePicker.value) return;
      const [y, mo, d] = datePicker.value.split('-');
      fieldYear.value = Number(y);
      fieldMonth.value = Number(mo);
      fieldDay.value = Number(d);
      readManualFields();
      refreshSlot();
    },
  });
  const hourPicker = buildPicker('用下拉選擇小時', HOUR_OPTIONS, (v) => {
    fieldHour.value = Number(v);
    readManualFields();
    refreshSlot();
  });
  const minutePicker = buildPicker('用下拉選擇分鐘', MINUTE_OPTIONS, (v) => {
    fieldMinute.value = Number(v);
    readManualFields();
    refreshSlot();
  });

  const fieldYear = buildNumberField('YYYY', 1970, 9999, 'dt-input--year');
  const fieldMonth = buildNumberField('MM', 1, 12);
  const fieldDay = buildNumberField('DD', 1, 31);
  const fieldHour = buildNumberField('hh', 0, 23);
  const fieldMinute = buildNumberField('mm', 0, 59);

  const timeHint = el('div', { class: 'field__hint' });
  const slotHint = el('div', { class: 'field__hint' });

  const slotSection = el('div', { class: 'section' }, [
    el('div', { class: 'section__label' }, '場次'),
    el('div', { class: 'field' }, [
      el('div', { class: 'field__label' }, '選擇日期時間'),
      el('div', { class: 'picker-row' }, [
        datePicker,
        el('div', { class: 'select-wrap' }, hourPicker),
        el('span', { class: 'dt-unit' }, '時'),
        el('div', { class: 'select-wrap' }, minutePicker),
        el('span', { class: 'dt-unit' }, '分'),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('div', { class: 'field__label' }, '日期時間'),
      el('div', { class: 'dt-row' }, [
        fieldYear, el('span', { class: 'dt-unit' }, '年'),
        fieldMonth, el('span', { class: 'dt-unit' }, '月'),
        fieldDay, el('span', { class: 'dt-unit' }, '日'),
        fieldHour, el('span', { class: 'dt-unit' }, '時'),
        fieldMinute, el('span', { class: 'dt-unit' }, '分'),
      ]),
    ]),
    timeHint,
    slotHint,
  ]);

  // 主持人。角色的數量與名稱只在換劇本時才變，所以只有換劇本才重建這一段；
  // 選了人之後只更新既有節點的值與錯誤文字，不重畫。
  const hostList = el('div', { class: 'list' });
  const hostSection = el('div', { class: 'section' }, [
    el('div', { class: 'section__label' }, '選擇主持人'),
    hostList,
  ]);
  let hostRows = [];          // [{ wrap, sel, errNode }]
  let hostRowsBuiltFor = null; // 已經照哪一個 mmg id 建過

  const submitBtn = el('button', { class: 'btn btn--primary', onClick: submit }, '立即預約');
  const submitSection = el('div', { class: 'section', style: 'padding-bottom: 20px' }, [submitBtn]);

  // 劇本清單還沒回來之前顯示這個。骨架是持久節點、建構當下就掛上去了，
  // 不擋著的話會先看到一個空的劇本選單加上「場次」「選擇主持人」等空區塊，
  // 那看起來像是載完了但沒有資料。
  const loadingNode = spinner();

  root.append(
    loadingNode, scriptSection, tagSection, slotSection, hostSection,
    el('div', { class: 'spacer' }), submitSection,
  );

  // ── 狀態 ────────────────────────────────────────────────────

  const state = {
    scripts: [],
    mmgId: '',
    detail: null,       // 選中劇本的完整資料
    // 日期時間的真正來源是下排那五個欄位，state 只是它們的鏡像。
    // 存字串不存數字：使用者可能只打了一半（"20"），那不是 20 年。
    y: '', mo: '', d: '', h: '', mi: '',
    hosts: [...EMPTY_HOSTS],
    hostErrors: [null, null, null, null],
    // 已經驗證過的主持人選擇，避免重選同一個值又打一次 API。
    // key 是 `${slot}:${userId}`，值是錯誤訊息或 null（代表驗證過沒問題）。
    //
    // ★ 鍵裡刻意不含時段——因為換時段時整份快取會被丟掉（見
    //   checkedSlot）。若哪天改成保留跨時段的結果，鍵就必須帶上時段，
    //   否則「A 主持人在 10:00 撞期」會被誤用到 14:00 上。
    hostChecked: new Map(),
    // 這份主持人檢查是針對哪一個時段做的。時段一換，先前的結果就不再
    // 適用：撞期是「這個人在這段時間有沒有別的場」，換了時間答案可能
    // 完全相反。
    checkedSlot: '',
    slot: null,         // 該時段的排隊狀況
    loading: true,      // 劇本清單還在路上
    submitting: false,
    // 這次「送出預約」意圖的冪等鍵，只在真正送出時才產生（見 submit()）。
    // 日期、時間、主持人任何一項改變，都代表變成另一次意圖，必須清成
    // null 逼下次送出重新產生一組——否則會被後端的 ON CONFLICT 誤判成
    // 同一筆預約，改了日期卻建立/回傳的是改之前那筆。
    requestId: null,
  };

  /**
   * 依輸入的字串篩出劇本，畫成可點的清單。
   *
   * 比對用「包含」而不是「開頭」：使用者記得的常常是中間那個字
   * （打「雲」要找得到《竊雲台》）。大小寫一律轉小寫再比，英文名的
   * 劇本才不會因為大小寫打錯就找不到。
   *
   * 沒有相符的就顯示「找不到」而不是空白——空白會讓人以為是還沒載完。
   */
  function renderSearchResults() {
    const term = searchInput.value.trim().toLowerCase();
    clear(searchResults);
    if (!term) { searchResults.hidden = true; return; }

    const hits = state.scripts.filter((s) => s.name.toLowerCase().includes(term));
    if (!hits.length) {
      searchResults.append(el('div', { class: 'search-empty' }, '找不到符合的劇本'));
    }
    for (const item of hits) {
      searchResults.append(el('button', {
        class: 'search-hit',
        type: 'button',
        // mousedown 而不是 click：輸入框的 blur 會先於 click 發生，
        // 用 click 的話清單在被點到之前就已經藏起來了。
        onMouseDown: (e) => {
          e.preventDefault();
          searchInput.value = item.name;
          searchResults.hidden = true;
          pickScript(String(item.id));
        },
      }, item.name));
    }
    searchResults.hidden = false;
  }

  // ── 建構小工具 ──────────────────────────────────────────────

  function buildPicker(ariaLabel, values, onPick) {
    const sel = el('select', {
      class: 'time-select',
      'aria-label': ariaLabel,
      onChange: (e) => {
        if (e.target.value === '') return;
        state.requestId = null;
        onPick(e.target.value);
      },
    });
    sel.append(el('option', { value: '' }, '--'));
    for (const v of values) sel.append(el('option', { value: v }, v));
    return sel;
  }

  /** 下排的一格。input 事件同步 state，change（離開欄位）才去查時段。 */
  function buildNumberField(placeholder, min, max, extraClass = 'dt-input--short') {
    return el('input', {
      type: 'number',
      class: `dt-input ${extraClass}`,
      placeholder,
      min: String(min),
      max: String(max),
      inputmode: 'numeric',
      'aria-label': placeholder,
      // 打字時只更新 state 與提示文字，不打 API、不碰任何輸入框的值。
      onInput: () => { readManualFields(); syncHints(); },
      // 離開欄位（或按 Enter）才算「這一格填完了」，這時才值得打 API。
      onChange: () => { readManualFields(); refreshSlot(); },
    });
  }

  // ── 日期時間 ────────────────────────────────────────────────

  /** 把下排五格的內容抄進 state。這是唯一的讀取來源。 */
  function readManualFields() {
    state.requestId = null;
    state.slot = null;
    state.y = fieldYear.value.trim();
    state.mo = fieldMonth.value.trim();
    state.d = fieldDay.value.trim();
    state.h = fieldHour.value.trim();
    state.mi = fieldMinute.value.trim();
  }

  /** 五格都填了且是真實存在的日期才回傳 YYYY-MM-DD，否則空字串。 */
  function currentDate() {
    if (!state.y || !state.mo || !state.d) return '';
    const y = Number(state.y), mo = Number(state.mo), d = Number(state.d);
    if (!Number.isInteger(y) || y < 1970 || y > 9999) return '';
    if (!Number.isInteger(mo) || mo < 1 || mo > 12) return '';
    if (!Number.isInteger(d) || d < 1 || d > 31) return '';
    // 擋掉 2 月 31 日這種「每一格都在範圍內、湊起來不存在」的日期。
    const probe = new Date(y, mo - 1, d);
    if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return '';
    return `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`;
  }

  function currentTime() {
    if (state.h === '' || state.mi === '') return '';
    const h = Number(state.h), mi = Number(state.mi);
    if (!Number.isInteger(h) || h < 0 || h > 23) return '';
    if (!Number.isInteger(mi) || mi < 0 || mi > 59) return '';
    return `${pad(h, 2)}:${pad(mi, 2)}`;
  }

  // 送出過的時段查詢流水號。只有最後一次發出的請求可以寫入 state.slot。
  //
  // ★ 沒有這道閘門會顯示錯的空位狀況：使用者連續改日期時會發出多個請求，
  //   回應的順序不保證跟送出的順序一樣。先送的晚回來，就會把後送的結果
  //   蓋掉——畫面上寫著「可預約」，講的卻是使用者已經改掉的那個時段。
  //   實測時就是這樣現形的：把月改成 2（合法，發出請求），再把日改成 31
  //   （不存在的日期），舊回應仍然把提示寫成「可進行預約」。
  let slotSeq = 0;

  /**
   * 時段變了就把主持人的選擇、錯誤與快取一起清掉，回傳有沒有真的清到東西。
   *
   * 不這樣做的話會留下騙人的畫面：在 10:00 選了撞期的主持人、看到紅字，
   * 改成 14:00 之後那行紅字還在，而重選同一個人會命中快取、連 API 都不打，
   * 於是紅字永遠不會消失——玩家會以為這位主持人怎麼樣都不能選。
   *
   * 選擇清空而不是自動重驗：重驗要為每一位已選的主持人各打一支 API，
   * 而使用者換時間之後本來就常常會換人。讓他重選一次，每一次選擇都是
   * 對「現在這個時段」問的，不會有過期的答案。
   */
  function resetHostsForNewSlot() {
    const key = currentDate() && currentTime() ? `${currentDate()} ${currentTime()}` : '';
    if (!key || key === state.checkedSlot) return false;
    state.checkedSlot = key;

    const had = state.hosts.some((h) => h !== null);
    state.hosts = [...EMPTY_HOSTS];
    state.hostErrors = [null, null, null, null];
    state.hostChecked.clear();
    return had;
  }

  /** 日期時間齊全就去查該時段的排隊狀況。 */
  async function refreshSlot() {
    if (resetHostsForNewSlot()) {
      toast('時段已變更，請重新選擇主持人');
    }
    syncHints();
    const seq = ++slotSeq;
    const date = currentDate();
    const time = currentTime();
    if (!date || !time || !state.mmgId) { render(); return; }
    try {
      const slot = await api.get(`/api/mmg/${state.mmgId}/slot`, {
        session_date: date, session_time: time,
      });
      if (seq !== slotSeq) return;   // 期間又改過，這份回應已經過期
      state.slot = slot;
    } catch (err) {
      if (seq !== slotSeq) return;
      toast(err.message, { error: true });
    }
    render();
  }

  // ── 載入與重設 ──────────────────────────────────────────────

  async function load() {
    state.loading = true;
    render();
    try {
      state.scripts = await api.get('/api/mmg');
    } catch (err) {
      toast(err.message, { error: true });
    }
    state.loading = false;
    clear(scriptSelect);
    scriptSelect.append(el('option', { value: '' }, '請選擇劇本'));
    for (const s of state.scripts) {
      scriptSelect.append(el('option', { value: s.id }, s.name));
    }
    render();
  }

  function resetBelowScript() {
    state.requestId = null;
    state.y = ''; state.mo = ''; state.d = ''; state.h = ''; state.mi = '';
    for (const f of [fieldYear, fieldMonth, fieldDay, fieldHour, fieldMinute]) f.value = '';
    datePicker.value = '';
    hourPicker.value = '';
    minutePicker.value = '';
    state.hosts = [...EMPTY_HOSTS];
    state.hostErrors = [null, null, null, null];
    state.hostChecked.clear();
    state.checkedSlot = '';
    state.slot = null;
  }

  async function pickScript(value) {
    state.mmgId = value;
    // 兩個入口選出來的結果要一致：從下拉選的，搜尋欄也顯示同一個名字。
    const picked = state.scripts.find((s) => String(s.id) === String(value));
    searchInput.value = picked ? picked.name : '';
    resetBelowScript();
    state.detail = null;
    if (value) {
      try {
        state.detail = await api.get(`/api/mmg/${value}`);
      } catch (err) {
        toast(err.message, { error: true });
      }
    }
    render();
  }

  // ── 主持人 ──────────────────────────────────────────────────

  function buildHostRows(d) {
    clear(hostList);
    hostRows = [];
    for (const gm of d.gm_slots) {
      const sel = el('select', {
        'aria-label': `選擇「${gm.name}」的主持人`,
        onChange: (e) => pickHost(gm.slot - 1, e.target.value),
      });
      sel.append(el('option', { value: '' }, '未選擇'));
      for (const h of gm.hosts) sel.append(el('option', { value: h.id }, h.name));

      const errNode = el('div', { class: 'field__error' });
      const wrap = el('div', { class: 'field' }, [
        el('div', { class: 'field__label' }, gm.name),
        el('div', { class: 'select-wrap' }, sel),
        errNode,
      ]);
      hostList.append(wrap);
      hostRows.push({ wrap, sel, errNode, slotIndex: gm.slot - 1 });
    }
    hostRowsBuiltFor = d.id;
  }

  async function pickHost(slotIndex, value) {
    const userId = value ? Number(value) : null;
    state.requestId = null;
    state.hosts[slotIndex] = userId;

    if (userId === null) {
      state.hostErrors[slotIndex] = null;
      render();
      return;
    }

    // 重複指派同一個人：純字串比對，不用打 API
    const duplicateAt = state.hosts.findIndex((h, i) => i !== slotIndex && h === userId);
    if (duplicateAt !== -1) {
      state.hostErrors[slotIndex] = '請選擇不同的主持人';
      toast('請選擇不同的主持人', { error: true });
      render();
      return;
    }

    // 這個選擇先前驗證過就直接沿用結果，不重打 API
    const key = `${slotIndex}:${userId}`;
    if (state.hostChecked.has(key)) {
      const cached = state.hostChecked.get(key);
      state.hostErrors[slotIndex] = cached;
      if (cached) toast(cached, { error: true });
      render();
      return;
    }

    // 還沒填完日期時間就沒得驗證，等送出時後端會擋
    const date = currentDate();
    const time = currentTime();
    if (!date || !time) {
      state.hostErrors[slotIndex] = null;
      render();
      return;
    }

    try {
      await api.get('/api/bookings/check-host', {
        mmg_id: state.mmgId,
        session_date: date,
        session_time: time,
        user_id: userId,
      });
      state.hostChecked.set(key, null);
      state.hostErrors[slotIndex] = null;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '主持人檢查失敗';
      state.hostChecked.set(key, message);
      state.hostErrors[slotIndex] = message;
      toast(message, { error: true });
    }
    render();
  }

  // ── 送出 ────────────────────────────────────────────────────

  /** 送出前的完整檢查，回傳錯誤訊息陣列。 */
  function collectProblems() {
    const problems = [];
    if (!state.mmgId) problems.push('尚未選擇劇本');

    // 分辨「還沒填」與「填了但不對」，後者要講清楚哪裡不對。
    if (!state.y || !state.mo || !state.d) problems.push('日期尚未填寫完整');
    else if (!currentDate()) problems.push(`日期不正確：${state.y}/${state.mo}/${state.d}`);

    if (state.h === '' || state.mi === '') problems.push('時間尚未填寫完整');
    else if (!currentTime()) problems.push(`時間不正確：${state.h}:${state.mi}`);

    // 已經知道撞期就不必送出去問。原本是照送、由後端擋下來，使用者要多按
    // 一次「確認預約」、多等一趟往返，才看到一件螢幕上早就寫著的事。
    if (state.slot?.has_conflict) problems.push('本時段有衝突場次，請改選其他時間');
    if (state.slot?.is_full) problems.push('本時段已額滿');

    for (const gm of state.detail?.gm_slots ?? []) {
      if (state.hosts[gm.slot - 1] === null) {
        problems.push(`「${gm.name}」尚未選擇主持人`);
      }
    }
    for (const err of state.hostErrors) {
      if (err) problems.push(err);
    }
    return problems;
  }

  async function submit() {
    const problems = collectProblems();
    if (problems.length) {
      await alertDialog({ title: '無法送出預約', body: problems.join('\n') });
      return;
    }

    const date = currentDate();
    const time = currentTime();
    const ok = await confirmDialog({
      title: '確認預約',
      body: `${state.detail.name}\n${date} ${time}\n訂金 NT$ ${state.detail.booking_cost ?? 0}`,
      confirmText: '送出預約',
    });
    if (!ok) return;

    state.submitting = true;
    render();
    try {
      // ★ request_id 是冪等鍵，同一次意圖的所有重試都要沿用同一組，
      //   否則玩家網路不穩重按一次就可能佔到兩個名額（名額有限且被搶）。
      //
      //   但「同一次意圖」不是「同一個 state 物件」——只要使用者在這之間
      //   改了日期、時間或主持人，那就是另一筆預約，絕不能沿用舊的 id，
      //   不然會被後端的 ON CONFLICT 誤判成同一筆，回傳/鎖住的是改之前
      //   那個時段。所以 requestId 只存在這裡：readManualFields／pickHost／
      //   resetBelowScript 任何一個都會先把它清成 null，逼這裡重新產生一組；
      //   只有「什麼都沒改、單純重按送出」才會沿用。
      if (!state.requestId) state.requestId = crypto.randomUUID();
      const result = await api.post('/api/bookings', {
        mmg_id: Number(state.mmgId),
        session_date: date,
        session_time: time,
        gm_user_ids: state.hosts,
        request_id: state.requestId,
      });
      toast(result.already_existed ? '這筆預約先前已經成立' : `預約成功（${result.label}）`);
      resetBelowScript();
      state.mmgId = '';
      state.detail = null;
      scriptSelect.value = '';
    } catch (err) {
      // 刻意不清 requestId：失敗可能是請求根本沒送到（例如 failed to
      // fetch），也可能是送到了、寫入成功但回應在路上遺失——兩種都要讓
      // 使用者「什麼都沒改就重按」時沿用同一組 id，交給後端的 ON CONFLICT
      // 判斷這是不是同一次意圖，而不是無條件建出第二筆。
      await alertDialog({ title: '預約失敗', body: err.message });
    } finally {
      state.submitting = false;
      render();
    }
  }

  // ── 同步（不重建）──────────────────────────────────────────

  /** 只更新兩行提示文字。打字時走這條，不碰任何輸入框。 */
  function syncHints() {
    const time = currentTime();
    const period = state.detail?.period;
    timeHint.textContent = time && period != null
      ? `預計 ${endTime(time, period)} 結束` : '';
    slotHint.textContent = state.slot ? slotMessage(state.slot) : '';
  }

  /**
   * 把 state 反映到既有節點上。
   *
   * ★ 這裡不建立、不移除、不重新插入任何節點——只改 value、textContent、
   *   hidden 與 disabled。輸入中的欄位因此不會失去焦點。
   *   寫 value 前一律先比對，相同就不寫：對聚焦中的輸入框指派 value
   *   （即使是同一個字串）在部分瀏覽器會重置游標位置。
   */
  function render() {
    loadingNode.hidden = !state.loading;
    scriptSection.hidden = state.loading;
    if (state.loading) {
      tagSection.hidden = true;
      slotSection.hidden = true;
      hostSection.hidden = true;
      submitSection.hidden = true;
      return;
    }

    if (scriptSelect.value !== String(state.mmgId)) scriptSelect.value = state.mmgId;

    const d = state.detail;
    const show = Boolean(d);
    tagSection.hidden = !show;
    slotSection.hidden = !show;
    submitSection.hidden = !show;
    hostSection.hidden = !show || !d.gm_slots.length;
    if (!show) return;

    clear(tagRow);
    for (const tag of [
      d.period != null && `${d.period} 小時`,
      d.players && `${d.players} 人`,
      d.price != null && `NT$ ${d.price}`,
      d.booking_cost != null && `訂金 NT$ ${d.booking_cost}`,
    ]) {
      if (tag) tagRow.append(el('div', { class: 'tag' }, tag));
    }

    // 上排 picker 只是輔助，這裡把它對齊到下排目前的值，讓它看起來一致。
    // 下排（真正的來源）不在這裡寫回去——那是使用者正在打字的地方。
    const date = currentDate();
    if (datePicker.value !== date) datePicker.value = date;
    const hh = state.h === '' ? '' : pad(Number(state.h), 2);
    const mm = state.mi === '' ? '' : pad(Number(state.mi), 2);
    if (hourPicker.value !== hh) hourPicker.value = HOUR_OPTIONS.includes(hh) ? hh : '';
    if (minutePicker.value !== mm) minutePicker.value = MINUTE_OPTIONS.includes(mm) ? mm : '';

    syncHints();

    if (d.gm_slots.length && hostRowsBuiltFor !== d.id) buildHostRows(d);
    for (const row of hostRows) {
      const value = state.hosts[row.slotIndex] ?? '';
      if (row.sel.value !== String(value)) row.sel.value = value;
      const err = state.hostErrors[row.slotIndex];
      row.errNode.textContent = err ?? '';
      row.errNode.hidden = !err;
      row.wrap.className = `field${err ? ' field--error' : ''}`;
    }

    submitBtn.disabled = state.submitting;
    submitBtn.textContent = state.submitting ? '送出中…' : '立即預約';
  }

  // 先畫一次（此時 loading 為 true，只會顯示轉圈圈）再去要資料。
  render();
  load();
  return root;
}

function endTime(start, hours) {
  const [h, m] = start.split(':').map(Number);
  const total = h * 60 + m + Math.round(hours * 60);
  return `${pad(Math.floor(total / 60) % 24, 2)}:${pad(total % 60, 2)}`;
}

/**
 * 玩家看到的時段說明。
 *
 * 序位只對玩家有意義——主持人與管理員看到的是一份照時間排的清單，
 * 誰排第幾對他們不改變任何事。所以這段文字只在這個畫面出現。
 *
 * 已經有一組成立（booked）跟「大家都還在排隊」是兩件事，說法必須分開：
 * 前者代表這個時段實際上已經有人要開了，後面排的就是候補；後者只是
 * 先後順序，誰都還沒定案。
 */
function slotMessage(slot) {
  // 撞期排在最前面：額滿還可以等別人取消，包廂被佔著是這個時間根本開不成。
  // 兩者都成立時，先講那個改時間才能解決的。
  //
  // 刻意不寫是被什麼撞到。撞到的是別的客人的預約——演什麼、誰訂的、
  // 演到幾點，都不是這位玩家該知道的事。後端也只回一個布林值，不是
  // 前端拿到細節卻選擇不顯示（那樣打開開發者工具照樣看得到）。
  // 管理員與主持人要處理衝突，他們的畫面有完整資訊。
  if (slot.has_conflict) return '本時段有衝突場次，請改選其他時間';
  if (slot.is_full) return '本時段已額滿';
  const position = slot.taken + 1;
  if (slot.has_booked) {
    return `本時段已經有排定預約，您將排在第 ${position} 序位，`
         + '若排定預約未取消，候補將於三天後自動失效。';
  }
  if (slot.taken > 0) return `本時段目前已有 ${slot.taken} 組預約，您將排在第 ${position} 序位`;
  return '本時段目前可進行預約';
}
