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

/**
 * 確認對話框。回傳 Promise<boolean>。
 *
 * 用在「按下去就回不來」的操作：確認主持指定、送出預約、改 email。
 * 一般的錯誤提示用 toast 就好，不要動不動就跳對話框擋住畫面。
 */
export function confirmDialog({ title, body, confirmText = '確認', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const close = (result) => {
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

    document.addEventListener('keydown', onKey);
    document.body.append(layer);
    confirmBtn.focus();
  });
}

/** 只有一個「確認」的告知對話框，用於送出前的錯誤彙總。 */
export function alertDialog({ title, body }) {
  return confirmDialog({ title, body, confirmText: '確認', cancelText: null });
}
