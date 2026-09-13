/**
 * 共用的畫面工具：建 DOM、toast、對話框。
 *
 * 刻意不用樣板字串 + innerHTML 組畫面：那條路只要有任何一個值來自
 * 使用者輸入（劇本名稱、玩家姓名、備註），就是一個 XSS 洞。這裡一律
 * 用 createElement + textContent，內容永遠是文字、不會被當成標記解析。
 */

/**
 * el('div', {class: 'card'}, [子元素或字串...])
 * 屬性名用 DOM 的寫法（class 例外，會轉成 className）；
 * on 開頭的屬性當成事件監聽器。
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'disabled' || key === 'checked' || key === 'selected') {
      node[key] = Boolean(value);
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * 載入中的提示。
 *
 * 每個畫面在資料回來之前都該顯示這個，而不是讓上一個畫面的內容留在原地、
 * 或是先把空骨架掛上去——那兩種都會讓人以為「載完了，只是沒東西」。
 */
export function spinner(label = '載入中…') {
  return el('div', { class: 'loading' }, [
    el('div', { class: 'spinner', 'aria-hidden': 'true' }),
    el('div', {}, label),
  ]);
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

/** 下拉選單。options 是 [{value, label}]，value 為 '' 的通常是「未選擇」。 */
export function select({ options, value = '', disabled = false, onChange, ariaLabel }) {
  const sel = el('select', {
    disabled,
    'aria-label': ariaLabel,
    onChange: onChange ? (e) => onChange(e.target.value) : undefined,
  });
  for (const opt of options) {
    sel.append(el('option', { value: opt.value, selected: String(opt.value) === String(value) }, opt.label));
  }
  // selected 屬性在動態建立時不一定生效，明確設一次 value 比較保險
  sel.value = value ?? '';
  return el('div', { class: `select-wrap${disabled ? ' select-wrap--disabled' : ''}` }, sel);
}

/** 帶標題與錯誤訊息的欄位容器。 */
export function field({ label, control, hint, error, warn }) {
  return el('div', { class: `field${error ? ' field--error' : ''}` }, [
    label && el('div', { class: 'field__label' }, label),
    control,
    warn && el('div', { class: 'field__warn' }, warn),
    error && el('div', { class: 'field__error' }, [warnIcon(), error]),
    !error && hint && el('div', { class: 'field__hint' }, hint),
  ]);
}

function warnIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 8v5M12 17v.5');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  svg.append(circle, path);
  return svg;
}

// ── Toast ─────────────────────────────────────────────────

let toastLayer = null;

function ensureToastLayer() {
  if (!toastLayer) {
    toastLayer = el('div', { class: 'toast-layer', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastLayer);
  }
  return toastLayer;
}

export function toast(message, { error = false, duration = 3200 } = {}) {
  const node = el('div', { class: `toast${error ? ' toast--error' : ''}` }, message);
  ensureToastLayer().append(node);
  setTimeout(() => node.remove(), duration);
}

// ── 對話框 ────────────────────────────────────────────────

/** 目前掛在畫面上的那一個對話框的 close()。沒有就是 null。 */
let openDialog = null;

/**
 * 確認對話框。回傳 Promise<boolean>。
 *
 * 用在「按下去就回不來」的操作：確認主持指定、送出預約、改 email。
 * 一般的錯誤提示用 toast 就好，不要動不動就跳對話框擋住畫面。
 *
 * 同時只會有一個對話框存在，新的把舊的頂掉——理由寫在下面 openDialog 那段。
 */
export function confirmDialog({ title, body, confirmText = '確認', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const close = (result) => {
      // 只有還掛在台上的那一個才有資格把 openDialog 清掉。少了這個比對，
      // 一個被取代的舊對話框關閉時會把「現在這一個」的登記抹掉。
      if (openDialog === close) openDialog = null;
      layer.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };

    const confirmBtn = el(
      'button',
      { class: 'btn btn--primary btn--small', onClick: () => close(true) },
      confirmText,
    );

    const layer = el(
      'div',
      {
        class: 'modal-layer',
        role: 'dialog',
        'aria-modal': 'true',
        // 只有點在遮罩本身（不是對話框內部）才關閉
        onClick: (e) => { if (e.target === layer) close(false); },
      },
      el('div', { class: 'modal' }, [
        title && el('div', { class: 'modal__title' }, title),
        body && el('div', { class: 'modal__body' }, body),
        el('div', { class: 'modal__actions' }, [
          cancelText && el('button', { class: 'btn btn--ghost btn--small', onClick: () => close(false) }, cancelText),
          confirmBtn,
        ]),
      ]),
    );

    // ★ 同時只留一個對話框，新的把舊的頂掉。
    //
    // 後端冷啟動時一支 API 要等快一分鐘。使用者點了沒反應會再點，等後端
    // 醒來時每一次點擊各自開一個對話框，一口氣疊五層。實際遇過。
    //
    // 取代而不是忽略，是因為連點的內容一模一樣，最後那個就是答案。
    // 被頂掉的那個 resolve(false)——往「當作沒按」的方向失敗，所以
    // `if (await confirmDialog(...))` 這種寫法不會因此誤觸發破壞性操作。
    //
    // 全站的對話框都經過這裡，所以這條規則不需要各個呼叫點配合。現有的
    // 用法全部是循序的（await 完前一個才開下一個），不會被這條影響。
    if (openDialog) openDialog(false);
    openDialog = close;

    document.addEventListener('keydown', onKey);
    document.body.append(layer);
    confirmBtn.focus();
  });
}

/** 只有一個「確認」的告知對話框，用於送出前的錯誤彙總。 */
export function alertDialog({ title, body }) {
  return confirmDialog({ title, body, confirmText: '確認', cancelText: null });
}

/**
 * 會打 API 的文字按鈕（`.linklike`）。
 *
 * 上面 confirmDialog 那條「只留一個對話框」是保險，這個是治本的一半:
 * 按下去之後按鈕會 disabled 並顯示 `…`，所以使用者看得出來它在跑，
 * 不會以為沒反應而連點。
 *
 * ★ 防連點靠的就是 `disabled` 本身——disabled 的 button 根本不會派送
 *   click 事件，所以不需要另外再寫一個 inflight 旗標。
 *
 * ★ finally 不能省。API 失敗（逾時、403、後端沒醒）時按鈕一樣要復原，
 *   否則使用者只會得到一個永遠停在「…」而且再也點不動的東西。
 */
export function asyncLink(label, fn) {
  const btn = el('button', {
    class: 'linklike',
    onClick: async () => {
      btn.disabled = true;
      btn.classList.add('is-busy');
      try {
        await fn();
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-busy');
      }
    },
  }, label);
  return btn;
}

/**
 * 劇本名稱。有簡介連結就變成可以點的連結（開新分頁），沒有就是純文字。
 *
 * 四個畫面都要用（劇本管理、場次管理、主持人介面、我預約的場次），所以
 * 放這裡。散在各處各寫一份的話，遲早有一個地方忘記加 rel、或忘記處理
 * 沒有連結的情況。
 *
 * ★ rel="noopener noreferrer" 不能省。target="_blank" 會讓被開啟的頁面
 *   拿到 window.opener，那是一個可以反過來把我們這一頁導向別處的把手
 *   （分頁挾持）。簡介連結是店家自己填的，但那不代表填進來的一定是
 *   他們控制的網域。
 *
 * ★ 只接受 http/https。填進來的字串可能是 javascript: 開頭——那會讓
 *   一個「看起來只是簡介連結」的欄位變成在別人瀏覽器上執行程式的入口。
 *   不合格就退回純文字，不要嘗試修正它。
 */
export function scriptName(name, url, extraClass = '') {
  const safe = isHttpUrl(url);
  if (!safe) return el('span', { class: extraClass }, name ?? '');
  return el('a', {
    class: `link ${extraClass}`.trim(),
    href: safe,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: '開啟劇本簡介',
  }, name ?? '');
}

/**
 * 平日／假日兩個金額合成一段顯示字串。售價與訂金共用，所以放這裡。
 *
 *   兩個一樣 → 「NT$ 1000」（跟只有一種價錢時長得一模一樣）
 *   只填一個 → 就顯示那一個，不標平假日
 *   兩個不同 → 「平日 NT$ 1000／假日 NT$ 1200」
 *   都沒填   → null，呼叫端決定要不要畫
 *
 * ★ 「一樣就只顯示一個」是步經徑遷移後畫面完全不變的原因：既有劇本的
 *   假日金額是從平日複製過去的。
 *
 * 兩個之間用「／」不用「·」：劇本管理的清單已經用「·」隔開售價與訂金，
 * 同一行裡兩種意思共用一個符號，就分不出哪個數字屬於哪一組。
 *
 * prefix 預設「NT$ 」。劇本管理清單的訂金原本就不帶 NT$（「訂金 1000」），
 * 傳空字串讓它維持原樣。
 *
 * 還沒更新的舊後端沒有 holiday 這個欄位（undefined），走的是「只填一個」
 * 那條，顯示平日那個數字——正好就是舊版的畫面。
 */
export function dualPrice(weekday, holiday, { prefix = 'NT$ ' } = {}) {
  const w = weekday ?? null;
  const h = holiday ?? null;
  if (w == null && h == null) return null;
  if (w == null) return `${prefix}${h}`;
  if (h == null || w === h) return `${prefix}${w}`;
  return `平日 ${prefix}${w}／假日 ${prefix}${h}`;
}

/** 場次類型的中文。後端 DAY_TYPE_LABEL 加一個「場」字。 */
export const DAY_TYPE_LABEL = { weekday: '平日場', holiday: '假日場' };

/**
 * 依日期推場次類型：週六日是假日場，其餘是平日場。跟後端
 * default_day_type() 同一條規則——國定假日、補班日系統不知道，那是管理員
 * 在場次管理手動改的。日期不完整就回 null。
 */
export function dayTypeOf(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '')) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return wd === 0 || wd === 6 ? 'holiday' : 'weekday';
}


/** 是 http/https 就回傳整理過的網址，否則回傳空字串。 */
export function isHttpUrl(raw) {
  const text = (raw ?? '').trim();
  if (!text) return '';
  try {
    const u = new URL(text);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch {
    return '';
  }
}
