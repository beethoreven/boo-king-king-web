/**
 * 玩家的預約畫面。
 *
 * 互動規則（依先前討論定案）：
 *   - 選了劇本，下面才顯示其他區塊
 *   - 選了日期，時間才解鎖（為「不同日期開放不同時段」預留）
 *   - 選了主持人才打 API 驗證是否撞期
 *   - 同一個選項重選同一個值，直接沿用上次的錯誤，不重打 API
 *   - 選單類錯誤用 toast + 欄位紅色驚嘆號；送出前的彙總用對話框
 */

import { api, ApiError } from './api.js';
import { el, clear, select, field, toast, confirmDialog, alertDialog } from './ui.js';

/** 每個角色一列。gm_user_ids 固定 4 格，沒有的角色是 null。 */
const EMPTY_HOSTS = [null, null, null, null];

// 時與分的選項。分只給整點與半點——場次時間是以半小時為單位的約定，
// 給 60 個選項只會讓人多滑。
const HOURS = Array.from({ length: 24 }, (_, i) => {
  const v = String(i).padStart(2, '0');
  return { value: v, label: v };
});
const MINUTES = ['00', '30'].map((v) => ({ value: v, label: v }));

export function createBookingView() {
  const root = el('div', { class: 'view' });

  // 日期輸入框只建立一次，之後每次 render 都沿用同一個節點。
  //
  // ★ 這是刻意的，不是效能優化。<input type="date"> 內部是「年/月/日」
  //   三個區段，使用者打完年、月，焦點停在「日」那一段時，change 事件
  //   已經觸發過了。如果那時整個畫面重建、這個 input 被換成新節點，
  //   焦點與正在編輯的區段會一起消失，使用者永遠打不完最後一段。
  //   （實際回報過的 bug：年正常、月正常，一打到日就跳掉。）
  //
  //   fireless-war 沒有這個問題，因為它的日期欄位是寫死在 HTML 裡的
  //   靜態節點、從不重建。這裡用同樣的原則：輸入類元件持久化，
  //   只有純顯示的部分才隨 render 重畫。
  const dateInput = el('input', {
    type: 'date',
    'aria-label': '選擇日期',
    onChange: (e) => pickDate(e.target.value),
  });
  const hourSelect = el('select', {
    'aria-label': '選擇小時',
    onChange: (e) => pickTimePart('hour', e.target.value),
  });
  const minuteSelect = el('select', {
    'aria-label': '選擇分鐘',
    onChange: (e) => pickTimePart('minute', e.target.value),
  });
  for (const opt of [{ value: '', label: '--' }, ...HOURS]) {
    hourSelect.append(el('option', { value: opt.value }, opt.label));
  }
  for (const opt of [{ value: '', label: '--' }, ...MINUTES]) {
    minuteSelect.append(el('option', { value: opt.value }, opt.label));
  }

  // 「場次」整個區塊也是持久的，不只裡面的輸入框。
  //
  // ★ 光是「重用同一個 input 節點」還不夠：clear(root) 會把它從 DOM
  //   移除再插回去，而瀏覽器在節點離開文件時就會撤銷焦點。實測過
  //   節點相同（sameNode: true）但焦點仍然掉了。所以整塊都不參與
  //   重繪，只更新裡面會變的文字。
  const timeHint = el('div', { class: 'field__hint' });
  const slotHint = el('div', { class: 'field__hint' });
  const slotSection = el('div', { class: 'section' }, [
    el('div', { class: 'section__label' }, '場次'),
    el('div', { class: 'row' }, [
      field({ label: '日期', control: dateInput }),
      field({ label: '時', control: el('div', { class: 'select-wrap' }, hourSelect) }),
      field({ label: '分', control: el('div', { class: 'select-wrap' }, minuteSelect) }),
    ]),
    timeHint,
    slotHint,
  ]);

  const state = {
    scripts: [],
    mmgId: '',
    detail: null,       // 選中劇本的完整資料
    date: '',
    // 時與分分開存。用兩個下拉而不是 <input type="time">，理由同上：
    // 下拉選單選完就結束，沒有「還在輸入中」的中間狀態會被重繪打斷。
    hour: '',
    minute: '',
    hosts: [...EMPTY_HOSTS],
    hostErrors: [null, null, null, null],
    // 已經驗證過的主持人選擇，避免重選同一個值又打一次 API。
    // key 是 `${slot}:${userId}`，值是錯誤訊息或 null（代表驗證過沒問題）
    hostChecked: new Map(),
    slot: null,         // 該時段的排隊狀況
    submitting: false,
    // 這次「送出預約」意圖的冪等鍵，只在真正送出時才產生（見 submit()）。
    // 日期、時間、主持人任何一項改變，都代表變成另一次意圖，必須清成
    // null 逼下次送出重新產生一組——否則會被後端的 ON CONFLICT 誤判成
    // 同一筆預約，改了日期卻建立/回傳的是改之前那筆。
    requestId: null,
  };

  async function load() {
    try {
      state.scripts = await api.get('/api/mmg');
    } catch (err) {
      toast(err.message, { error: true });
    }
    render();
  }

  function resetBelowScript() {
    state.requestId = null;
    state.date = '';
    state.hour = '';
    state.minute = '';
    state.hosts = [...EMPTY_HOSTS];
    state.hostErrors = [null, null, null, null];
    state.hostChecked.clear();
    state.slot = null;
  }

  async function pickScript(value) {
    state.mmgId = value;
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

  function pickDate(value) {
    state.requestId = null;
    state.date = value;
    // 換日期時清掉時間：不同日期可能開放不同時段，留著上一個日期選過的
    // 時間會看起來像已經選好，其實那個時段在新日期可能根本不存在。
    state.hour = '';
    state.minute = '';
    state.slot = null;
    render();
  }

  /** 「時」與「分」任一個改變時呼叫。兩個都選了才去查該時段的狀況。 */
  async function pickTimePart(part, value) {
    state.requestId = null;
    state[part] = value;
    state.slot = null;
    const time = currentTime();
    if (time && state.mmgId && state.date) {
      try {
        state.slot = await api.get(`/api/mmg/${state.mmgId}/slot`, {
          session_date: state.date,
          session_time: time,
        });
      } catch (err) {
        toast(err.message, { error: true });
      }
    }
    render();
  }

  /** 時與分都選了才算一個完整時間，否則回傳空字串。 */
  function currentTime() {
    if (state.hour === '' || state.minute === '') return '';
    return `${state.hour}:${state.minute}`;
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

    // 還沒選日期時間就沒得驗證，等送出時後端會擋
    if (!state.date || !currentTime()) {
      state.hostErrors[slotIndex] = null;
      render();
      return;
    }

    try {
      await api.get('/api/bookings/check-host', {
        mmg_id: state.mmgId,
        session_date: state.date,
        session_time: currentTime(),
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

  /** 送出前的完整檢查，回傳錯誤訊息陣列。 */
  function collectProblems() {
    const problems = [];
    if (!state.mmgId) problems.push('尚未選擇劇本');
    if (!state.date) problems.push('尚未選擇日期');
    if (!currentTime()) problems.push('尚未選擇時間');

    for (const [i, gm] of (state.detail?.gm_slots ?? []).entries()) {
      if (state.hosts[gm.slot - 1] === null) {
        problems.push(`「${gm.name}」尚未選擇主持人`);
      }
    }
    for (const [i, err] of state.hostErrors.entries()) {
      if (err) problems.push(err);
    }
    return problems;
  }

  async function submit() {
    const problems = collectProblems();
    if (problems.length) {
      await alertDialog({
        title: '無法送出預約',
        body: problems.join('\n'),
      });
      return;
    }

    const ok = await confirmDialog({
      title: '確認預約',
      body: `${state.detail.name}\n${state.date} ${currentTime()}\n訂金 NT$ ${state.detail.booking_cost ?? 0}`,
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
      //   那個時段。所以 requestId 只存在這裡：pickDate／pickTimePart／
      //   pickHost／resetBelowScript 任何一個都會先把它清成 null，逼這裡
      //   重新產生一組；只有「什麼都沒改、單純重按送出」才會沿用。
      if (!state.requestId) state.requestId = crypto.randomUUID();
      const result = await api.post('/api/bookings', {
        mmg_id: Number(state.mmgId),
        session_date: state.date,
        session_time: currentTime(),
        gm_user_ids: state.hosts,
        request_id: state.requestId,
      });
      toast(result.already_existed ? '這筆預約先前已經成立' : `預約成功（${result.label}）`);
      resetBelowScript();
      state.mmgId = '';
      state.detail = null;
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

  function render() {
    clear(root);

    // 劇本選單本身就是頁面標題
    root.append(
      el('div', { class: 'section' }, [
        el('div', { class: 'section__label' }, '選擇劇本'),
        select({
          options: [
            { value: '', label: '請選擇劇本' },
            ...state.scripts.map((s) => ({ value: s.id, label: s.name })),
          ],
          value: state.mmgId,
          onChange: pickScript,
          ariaLabel: '選擇劇本',
        }),
      ]),
    );

    if (!state.detail) return;

    const d = state.detail;
    root.append(
      el('div', { class: 'section' }, [
        el('div', { class: 'tag-row' }, [
          d.period != null && el('div', { class: 'tag' }, `${d.period} 小時`),
          d.players && el('div', { class: 'tag' }, `${d.players} 人`),
          d.price != null && el('div', { class: 'tag' }, `NT$ ${d.price}`),
          d.booking_cost != null && el('div', { class: 'tag' }, `訂金 NT$ ${d.booking_cost}`),
        ]),
      ]),
    );

    // 場次區塊是持久節點（見上方宣告），這裡只同步值與提示文字。
    // 刻意不重建：重建會讓正在輸入的日期欄位失去焦點。
    //
    // 只在值真的不同時才寫回 input——對聚焦中的 <input type="date">
    // 指派 value（即使是同一個值）會重置它內部正在編輯的區段。
    if (dateInput.value !== state.date) dateInput.value = state.date;
    if (hourSelect.value !== state.hour) hourSelect.value = state.hour;
    if (minuteSelect.value !== state.minute) minuteSelect.value = state.minute;
    hourSelect.disabled = !state.date;
    minuteSelect.disabled = !state.date;

    const time = currentTime();
    timeHint.textContent = time && d.period != null
      ? `預計 ${endTime(time, d.period)} 結束` : '';
    slotHint.textContent = state.slot ? slotMessage(state.slot) : '';
    root.append(slotSection);

    // 主持人：每個存在的角色一列
    if (d.gm_slots.length) {
      root.append(
        el('div', { class: 'section' }, [
          el('div', { class: 'section__label' }, '選擇主持人'),
          el(
            'div',
            { class: 'list' },
            d.gm_slots.map((gm) =>
              field({
                label: gm.name,
                error: state.hostErrors[gm.slot - 1],
                control: select({
                  options: [
                    { value: '', label: '未選擇' },
                    ...gm.hosts.map((h) => ({ value: h.id, label: h.name })),
                  ],
                  value: state.hosts[gm.slot - 1] ?? '',
                  onChange: (v) => pickHost(gm.slot - 1, v),
                  ariaLabel: `選擇「${gm.name}」的主持人`,
                }),
              }),
            ),
          ),
        ]),
      );
    }

    root.append(el('div', { class: 'spacer' }));
    root.append(
      el('div', { class: 'section', style: 'padding-bottom: 20px' }, [
        el('button', {
          class: 'btn btn--primary',
          disabled: state.submitting,
          onClick: submit,
        }, state.submitting ? '送出中…' : '立即預約'),
      ]),
    );
  }

  load();
  return root;
}

function endTime(start, hours) {
  const [h, m] = start.split(':').map(Number);
  const total = h * 60 + m + Math.round(hours * 60);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function slotMessage(slot) {
  if (slot.is_full) return '本時段已額滿';
  if (slot.taken > 0) return `本時段目前已有 ${slot.taken} 組預約，您將排在第 ${slot.taken + 1} 序位`;
  return '本時段目前可進行預約';
}
