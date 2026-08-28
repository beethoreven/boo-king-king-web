/**
 * 使用者自己的資料。
 *
 * 預設整頁唯讀，按「編輯」才解鎖——這一頁大部分時候是拿來看的，一進來
 * 就全部可編輯，等於每次瀏覽都冒著誤改的風險。
 *
 * Email 永遠鎖著：那是 Google 登入身分，改它等於換一個人。
 */

import { api } from './api.js';
import { el, clear, field, toast, confirmDialog, alertDialog, spinner } from './ui.js';
import { refreshStatus } from './auth.js';

// 跟後端 auth_utils/profile.py 的規則一致。兩邊都要有：後端是把關（任何人
// 都能直接打 API），前端是為了在欄位下方即時顯示紅字，不必等送出。
// ★ 改任何一條時兩邊都要改，不然會出現「前端說可以、後端說不行」。
const LINE_ID_RE = /^[A-Za-z0-9._-]+$/;
const PHONE_RE = /^09\d{8}$/;

const FIELDS = [
  { key: 'name', label: '稱呼' },
  { key: 'line_id', label: 'LINE ID' },
  { key: 'phone', label: '電話' },
];

/** 回傳 {欄位: 錯誤訊息}。空字串不算格式錯誤——清空是允許的。 */
function validate(draft) {
  const errors = {};
  if (draft.line_id && !LINE_ID_RE.test(draft.line_id)) {
    errors.line_id = '只能使用英文、數字與 . - _';
  }
  if (draft.phone && !PHONE_RE.test(draft.phone)) {
    errors.phone = '請輸入 09 開頭的 10 碼手機號碼';
  }
  return errors;
}

const isComplete = (d) => FIELDS.every(({ key }) => (d[key] ?? '').trim());

export function createProfileView(onDeleted) {
  const root = el('div', { class: 'view' });

  const state = { data: null, editing: false, loading: true, saving: false };
  let draft = {};

  // 輸入框是持久節點，打字時不重繪——重繪會把正在編輯的欄位卸下來，
  // 焦點與注音組字都會跟著消失。錯誤紅字直接改 textContent。
  const inputs = {};
  const errorNodes = {};
  for (const { key } of FIELDS) {
    errorNodes[key] = el('div', { class: 'field__error' });
    inputs[key] = el('input', {
      type: 'text',
      disabled: true,
      onInput: (e) => {
        draft[key] = e.target.value;
        showErrors(validate(draft));
      },
    });
  }

  function showErrors(errors) {
    for (const { key } of FIELDS) {
      const msg = errors[key] ?? '';
      errorNodes[key].textContent = msg;
      errorNodes[key].hidden = !msg;
      inputs[key].closest('.field')?.classList.toggle('field--error', Boolean(msg));
    }
  }

  const emailInput = el('input', { type: 'email', disabled: true, 'aria-label': 'Email' });
  const deleteBtn = el('button', { class: 'btn btn--danger btn--small', onClick: onDelete }, '刪除帳號');
  const editBtn = el('button', { class: 'btn btn--primary btn--small', onClick: onEditOrSave }, '編輯');
  const hint = el('div', { class: 'field__hint' });

  async function load() {
    state.loading = true;
    render();
    try {
      state.data = await api.get('/api/profile');
    } catch (err) {
      toast(err.message, { error: true });
    }
    state.loading = false;
    render();
  }

  function onEditOrSave() {
    if (!state.editing) {
      state.editing = true;
      draft = Object.fromEntries(FIELDS.map(({ key }) => [key, state.data?.[key] ?? '']));
      render();
      return;
    }
    save();
  }

  async function save() {
    const errors = validate(draft);
    if (Object.keys(errors).length) {
      showErrors(errors);
      await alertDialog({ title: '格式不正確', body: '請修正紅字標示的欄位再儲存。' });
      return;
    }

    // 清空是允許的，但要讓他知道代價。問一次就好，不要每次儲存都問。
    if (!isComplete(draft)) {
      const ok = await confirmDialog({
        title: '確認移除聯絡資料',
        body: '若無提供聯絡資料，將會無法正常預定，確定要移除聯絡資料嗎？',
        confirmText: '是',
        cancelText: '否',
      });
      if (!ok) return;
    }

    state.saving = true;
    render();
    try {
      state.data = await api.put('/api/profile', draft);
      state.editing = false;
      // 預約畫面靠 currentUser.has_contact 判斷能不能訂場，清空聯絡資料
      // 之後那個值就過期了。重問一次狀態，不然他會在別的畫面看到跟這裡
      // 不一致的結果。
      await refreshStatus();
      toast('已儲存');
    } catch (err) {
      // 後端也會驗一次。走到這裡代表前端漏了什麼，把它顯示出來而不是
      // 只丟一句失敗——那會讓人不知道哪一格有問題。
      if (err.payload?.fields) showErrors(err.payload.fields);
      await alertDialog({ title: '儲存失敗', body: err.message });
    }
    state.saving = false;
    render();
  }

  async function onDelete() {
    const ok = await confirmDialog({
      title: '刪除帳號',
      body: '若刪除帳號，只能聯繫管理員恢復，真的要繼續嗎？',
      confirmText: '確認刪除',
      cancelText: '取消',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post('/api/profile/delete', {});
      onDeleted();
    } catch (err) {
      await alertDialog({ title: '無法刪除帳號', body: err.message });
    }
  }

  function render() {
    clear(root);
    if (state.loading) { root.append(spinner()); return; }
    if (!state.data) { root.append(el('div', { class: 'empty' }, '讀不到資料')); return; }

    const d = state.data;
    emailInput.value = d.email ?? '';
    for (const { key } of FIELDS) {
      const value = state.editing ? (draft[key] ?? '') : (d[key] ?? '');
      if (inputs[key].value !== value) inputs[key].value = value;
      inputs[key].disabled = !state.editing;
    }
    if (!state.editing) showErrors({});

    editBtn.textContent = state.saving ? '儲存中…' : (state.editing ? '儲存' : '編輯');
    editBtn.disabled = state.saving;
    deleteBtn.disabled = state.editing || state.saving;

    hint.textContent = isComplete(d)
      ? '' : '目前沒有完整的聯絡資料，將無法預定場次';

    root.append(
      el('div', { class: 'section' }, [
        el('div', { class: 'section__label' }, '使用者資料'),
        field({
          label: 'Email（Google 登入帳號）',
          control: emailInput,
          hint: '由 Google 登入帶入，無法修改',
        }),
        ...FIELDS.map(({ key, label }) =>
          el('div', { class: 'field' }, [
            el('div', { class: 'field__label' }, label),
            inputs[key],
            errorNodes[key],
          ]),
        ),
        hint,
      ]),
      el('div', { class: 'section', style: 'padding-bottom:24px' }, [
        el('div', { class: 'row' }, [deleteBtn, editBtn]),
      ]),
    );
  }

  load();
  return root;
}
