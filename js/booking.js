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

export function createBookingView() {
  const root = el('div', { class: 'view' });

  const state = {
    scripts: [],
    mmgId: '',
    detail: null,       // 選中劇本的完整資料
    date: '',
    time: '',
    hosts: [...EMPTY_HOSTS],
    hostErrors: [null, null, null, null],
    // 已經驗證過的主持人選擇，避免重選同一個值又打一次 API。
    // key 是 `${slot}:${userId}`，值是錯誤訊息或 null（代表驗證過沒問題）
    hostChecked: new Map(),
    slot: null,         // 該時段的排隊狀況
    submitting: false,
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
    state.date = '';
    state.time = '';
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
    state.date = value;
    // 換日期時清掉時間：不同日期可能開放不同時段，留著上一個日期選過的
    // 時間會看起來像已經選好，其實那個時段在新日期可能根本不存在。
    state.time = '';
    state.slot = null;
    render();
  }

  async function pickTime(value) {
    state.time = value;
    state.slot = null;
    if (value && state.mmgId && state.date) {
      try {
        state.slot = await api.get(`/api/mmg/${state.mmgId}/slot`, {
          session_date: state.date,
          session_time: value,
        });
      } catch (err) {
        toast(err.message, { error: true });
      }
    }
    render();
  }

  async function pickHost(slotIndex, value) {
    const userId = value ? Number(value) : null;
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
    if (!state.date || !state.time) {
      state.hostErrors[slotIndex] = null;
      render();
      return;
    }

    try {
      await api.get('/api/bookings/check-host', {
        mmg_id: state.mmgId,
        session_date: state.date,
        session_time: state.time,
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
    if (!state.time) problems.push('尚未選擇時間');

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
      body: `${state.detail.name}\n${state.date} ${state.time}\n訂金 NT$ ${state.detail.booking_cost ?? 0}`,
      confirmText: '送出預約',
    });
    if (!ok) return;

    state.submitting = true;
    render();
    try {
      // ★ request_id 在這裡產生，而且只產生一次——這是冪等鍵，
      //   同一次意圖的所有重試都必須沿用同一組。如果每次重送都換
      //   新的 UUID，冪等保護就完全失效：玩家網路不穩重按一次，
      //   就可能佔到兩個名額，而名額是有限且被搶的。
      const requestId = crypto.randomUUID();
      const result = await api.post('/api/bookings', {
        mmg_id: Number(state.mmgId),
        session_date: state.date,
        session_time: state.time,
        gm_user_ids: state.hosts,
        request_id: requestId,
      });
      toast(result.already_existed ? '這筆預約先前已經成立' : `預約成功（${result.label}）`);
      resetBelowScript();
      state.mmgId = '';
      state.detail = null;
    } catch (err) {
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

    // 日期與時間並排，時間在日期選好之前鎖住
    root.append(
      el('div', { class: 'section' }, [
        el('div', { class: 'section__label' }, '場次'),
        el('div', { class: 'row' }, [
          field({
            label: '日期',
            control: el('input', {
              type: 'date',
              value: state.date,
              onChange: (e) => pickDate(e.target.value),
              'aria-label': '選擇日期',
            }),
          }),
          field({
            label: '時間',
            control: el('input', {
              type: 'time',
              step: '1800',   // 半小時一格
              value: state.time,
              disabled: !state.date,
              onChange: (e) => pickTime(e.target.value),
              'aria-label': '選擇時間',
            }),
            hint: state.time && d.period != null ? `預計 ${endTime(state.time, d.period)} 結束` : '',
          }),
        ]),
        state.slot && el('div', { class: 'field__hint' }, slotMessage(state.slot)),
      ]),
    );

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
  if (slot.taken > 0) return '本時段目前已有確認中的預約，您仍可登記候補';
  return '本時段目前可進行預約';
}
