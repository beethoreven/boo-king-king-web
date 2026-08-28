/**
 * 註冊表單。
 *
 * Google 驗過身分之後、還沒在這個系統留下聯絡資料的人會看到這一頁。
 * 它跟「登入」是分開的兩件事：登入證明「你是誰」，註冊留下「怎麼找到你」。
 *
 * Email 只顯示不編輯，而且不送出——後端一律用 session 裡那個 Google 驗過
 * 的 email，這個欄位純粹是讓填表的人確認自己用哪個帳號在填。就算有人用
 * devtools 把它改掉也不影響結果。
 */

import { register } from './auth.js';
import { el, field, toast, alertDialog } from './ui.js';

const NOTICE = '請填寫基本聯絡資料，方便店家後續聯繫。\n點選註冊即代表你同意店家的';

export function createRegisterView(email, onDone) {
  const root = el('div', { class: 'view' });

  // 三個欄位的值只存在這個物件裡，打字時不重繪任何東西。
  // （重繪會把正在輸入的欄位卸下來，焦點跟著消失，注音更是打不完一個字。）
  const draft = { name: '', line_id: '', phone: '' };
  const input = (key, placeholder) => el('input', {
    type: 'text',
    value: '',
    placeholder,
    autocomplete: 'off',
    onInput: (e) => { draft[key] = e.target.value; },
  });

  const nameInput = input('name', '例如：小明');
  const lineInput = input('line_id', '方便聯繫用');
  const phoneInput = input('phone', '');

  const submitBtn = el('button', { class: 'btn btn--primary', onClick: submit }, '註冊');

  async function submit() {
    // 三個都是必填。缺哪個就講哪個，不要只說「請填完整」——那等於要人
    // 自己一格一格找。
    const missing = [
      ['稱呼', draft.name],
      ['LINE ID', draft.line_id],
      ['電話', draft.phone],
    ].filter(([, v]) => !v.trim()).map(([label]) => label);

    if (missing.length) {
      await alertDialog({
        title: '尚未填寫完整',
        body: `以下欄位不能空白：\n${missing.join('\n')}`,
      });
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '註冊中…';
    try {
      const user = await register({
        name: draft.name.trim(),
        line_id: draft.line_id.trim(),
        phone: draft.phone.trim(),
      });
      toast(`歡迎，${user.name}`);
      onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = '註冊';
      await alertDialog({ title: '註冊失敗', body: err.message });
    }
  }

  root.append(
    el('div', { class: 'section', style: 'padding-top:28px' }, [
      el('div', { class: 'card card--flat notice' }, [
        el('div', {}, NOTICE),
        // 條款是獨立的一頁，跟這套介面無關，所以開新分頁而不是切換畫面——
        // 填到一半的表單不該因為想看條款就被丟掉。
        el('a', { href: 'terms.html', target: '_blank', rel: 'noopener' }, '使用者條款'),
        el('span', {}, '。'),
      ]),
    ]),

    el('div', { class: 'section' }, [
      field({
        label: 'Email（Google 登入帳號）',
        control: el('input', { type: 'email', value: email, disabled: true, 'aria-label': 'Email' }),
        hint: '由 Google 登入帶入，無法修改',
      }),
      field({ label: '稱呼', control: nameInput }),
      field({ label: 'LINE ID', control: lineInput }),
      field({ label: '電話', control: phoneInput }),
    ]),

    el('div', { class: 'section', style: 'padding-bottom:24px' }, [submitBtn]),
  );

  return root;
}
