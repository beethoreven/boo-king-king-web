/**
 * 劇本簡介頁：https://<店家前端>/mmg/<id>
 *
 * 公開頁面，不用登入。Cloudflare 的 _redirects 把 /mmg/* 導到 index.html，
 * main.js 看到這個網址就交給這裡畫，不走登入流程。
 *
 * 內容（後端 db/intro.py 決定回什麼，這裡只照著畫，沒有值就不畫）：
 *   店家編輯的   封面圖、類型標籤、劇本簡介、角色簡介、老闆的話
 *   自動帶入的   時長、人數、售價、訂金、額外註記
 *
 * ## 編輯模式：/mmg/<id>?edit=1
 *
 * 只有管理員看得到「編輯簡介頁」那顆按鈕，也只有管理員進得了編輯模式
 * （不是管理員的人帶著 ?edit=1 進來，看到的就是一般的簡介頁）。真正的權限
 * 在後端：編輯用的 API 全部是管理員限定，這裡藏按鈕只是介面。
 *
 * 編輯欄位跟預覽在同一頁：上面改、下面立刻看到長怎樣，存檔才寫進去。
 *
 * ★ 簡介與角色簡介一律用 textContent 放，不用 innerHTML。內容是店家打的字，
 *   當成 HTML 解讀的話，打一段 <script> 就能在每個看簡介的人的瀏覽器裡跑。
 */

import { api, apiUrl, ApiError, setUnauthorizedHandler } from './api.js';
import { refreshStatus, hasRole } from './auth.js';
import { el, clear, toast, dualPrice } from './ui.js';

const SITE_NAME = window.__BOO_KING_KING_SITE_NAME__;

// 跟後端 db/intro.py 的上限一致：這裡擋住打字，後端擋住手打 API。
const SYNOPSIS_MAX = 3000;
const CHARACTERS_MAX = 5000;
const OWNER_NOTE_MAX = 3000;
const TAGS_MAX = 8;
const TAG_MAX_CHARS = 12;

export async function startIntroPage(app, rawId) {
  // ★ 這一頁不需要登入。登入憑證過期（401）時，主站的做法是跳回登入畫面，
  //   在這裡會把一個公開頁面整個換成登入畫面——所以這一頁不做任何事。
  setUnauthorizedHandler(() => {});
  // 簡介頁自己的主色（style.css 的 .intro-page）。整頁重新載入才會離開這一頁，不用拿掉。
  app.classList.add('intro-page');

  clear(app);
  app.append(el('div', { class: 'loading' }, '載入中…'));

  // 網址上的編號不是正整數（/mmg/abc）：不用問後端就知道沒有這齣。
  const mmgId = /^\d+$/.test(rawId) ? Number(rawId) : null;
  if (mmgId === null) {
    renderMissing(app, new ApiError(404, '找不到這個劇本'), { isAdmin: false, mmgId: null });
    return;
  }

  // 有登入憑證的人才問一次身分（沒有的話這一步不會發任何請求）。
  const user = await refreshStatus();
  const isAdmin = Boolean(user) && hasRole(1);
  const editing = isAdmin && new URLSearchParams(window.location.search).get('edit') === '1';

  try {
    const data = editing
      ? await api.get(`/api/admin/mmg/${mmgId}/intro`)
      : await api.get(`/api/public/mmg/${mmgId}`);
    if (editing) renderEditor(app, data);
    else renderPage(app, data, { isAdmin });
  } catch (err) {
    renderMissing(app, err, { isAdmin, mmgId });
  }
}

function topbar(actions = []) {
  return el('div', { class: 'topbar' }, [
    // 品牌區塊連回店家首頁（預約畫面）。用一般連結：這一頁不在主站的畫面切換裡。
    el('a', { class: 'topbar__brand topbar__brand--home', href: '/' }, [
      el('img', { class: 'topbar__mark', src: '/brand-mark.png', alt: '', 'aria-hidden': 'true' }),
      SITE_NAME,
    ]),
    el('div', { class: 'topbar__actions' }, actions),
  ]);
}

function renderMissing(app, err, { isAdmin, mmgId }) {
  clear(app);
  const status = err instanceof ApiError ? err.status : 0;
  const message = status === 404 ? '找不到這個劇本'
    : status === 429 ? '請求過於頻繁，請稍候再試'
    // 每家店每天的讀取上限用完了（後端 intro_public 第 5 點），隔天就恢復。
    : status === 503 ? '今天的瀏覽人數太多，請明天再試'
    : '讀取失敗，請稍後再試';
  const actions = isAdmin
    ? [el('a', { class: 'btn btn--primary btn--small', href: `/mmg/${mmgId}?edit=1` }, '編輯簡介頁')]
    : [];
  app.append(topbar(actions), el('div', { class: 'empty' }, message));
  // 管理員看到 404 多半是「這齣還沒上架」：簡介頁只公開上架中的劇本。
  if (isAdmin && status === 404) {
    app.append(el('div', { class: 'field__hint', style: 'text-align:center' },
      '只有上架中的劇本會公開。還沒上架的劇本可以先進編輯頁準備內容。'));
  }
}

/** 時長、人數、售價、訂金、額外註記——跟預約畫面那一排同一種寫法。 */
function facts(d) {
  const deposit = dualPrice(d.booking_cost, d.booking_cost_holiday);
  return [
    d.period != null && `${d.period} 小時`,
    // players 是自由文字（例如「4男4女可反串」），單位已經寫在裡面了。
    d.players,
    dualPrice(d.price, d.price_holiday),
    deposit && `訂金 ${deposit}`,
    d.extra_note,
  ].filter(Boolean);
}

function textBlock(label, text) {
  if (!text) return null;
  return el('div', { class: 'intro__block' }, [
    el('div', { class: 'section__label' }, label),
    // ★ textContent（el 的字串子節點就是 text node），不是 innerHTML。見檔案開頭。
    el('div', { class: 'intro__text' }, text),
  ]);
}

/** 簡介本體。公開頁面與編輯模式的預覽都用這一份，看到的才會一樣。 */
function introBody(d, coverSrc) {
  const genre = (d.tags || []).filter(Boolean);
  const info = facts(d);
  return el('article', { class: 'intro' }, [
    el('h1', { class: 'intro__title' }, d.name || ''),
    coverSrc ? el('img', { class: 'intro__cover', src: coverSrc, alt: d.name || '' }) : null,
    genre.length ? el('div', { class: 'tag-row' }, genre.map((t) => el('span', { class: 'tag tag--genre' }, t))) : null,
    info.length ? el('div', { class: 'tag-row' }, info.map((t) => el('span', { class: 'tag' }, t))) : null,
    textBlock('劇本簡介', d.synopsis),
    textBlock('角色簡介', d.characters),
    textBlock('老闆的話', d.owner_note),
  ]);
}

function renderPage(app, d, { isAdmin }) {
  clear(app);
  const actions = isAdmin
    ? [el('a', { class: 'btn btn--primary btn--small', href: `/mmg/${d.id}?edit=1` }, '編輯簡介頁')]
    : [];
  app.append(topbar(actions), introBody(d, d.cover_path ? apiUrl(d.cover_path) : null));
  document.title = d.name ? `${d.name} — ${SITE_NAME}` : SITE_NAME;
}

// ── 編輯模式 ─────────────────────────────────────────────────────

function renderEditor(app, initial) {
  // 表單的狀態。存檔前的修改只在這裡，預覽照它畫。
  const draft = {
    synopsis: initial.synopsis ?? '',
    characters: initial.characters ?? '',
    owner_note: initial.owner_note ?? '',
    tags: [...(initial.tags || [])],
  };
  let data = initial;          // 後端最後一次給的完整資料（封面、價錢那些）
  let coverSrc = null;         // 封面的預覽網址（blob:）
  let coverGen = 0;            // 封面載入的世代（見 loadCover）
  let saving = false;
  // 最後一次存進去的內容。草稿跟它一樣就是「沒改過」，儲存鈕停用（跟劇本管理一致：
  // 灰的才是不能按，能按的一律是主色）。
  let saved = JSON.stringify(draft);

  const preview = el('div', { class: 'intro-edit__preview' });
  const tagList = el('div', { class: 'tag-row' });
  const tagInput = el('input', {
    type: 'text', maxlength: String(TAG_MAX_CHARS), placeholder: '例如：懸疑',
    onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } },
  });
  const coverHolder = el('div', { class: 'intro-edit__cover' });
  const saveBtn = el('button', { class: 'btn btn--primary', type: 'button', onClick: save }, '儲存');
  const removeBtn = el('button', { class: 'btn btn--primary btn--small', type: 'button', onClick: removeCover }, '移除圖片');

  function refreshSave() {
    saveBtn.disabled = saving || JSON.stringify(draft) === saved;
  }

  function refreshPreview() {
    refreshSave();
    clear(preview);
    preview.append(introBody({ ...data, ...draft }, coverSrc));
  }

  function refreshTags() {
    clear(tagList);
    for (const t of draft.tags) {
      tagList.append(el('span', { class: 'tag tag--genre' }, [
        t,
        el('button', {
          class: 'tag__remove', type: 'button', 'aria-label': `移除標籤 ${t}`,
          onClick: () => { draft.tags = draft.tags.filter((x) => x !== t); refreshTags(); refreshPreview(); },
        }, '×'),
      ]));
    }
    tagInput.disabled = draft.tags.length >= TAGS_MAX;
    tagInput.placeholder = tagInput.disabled ? `最多 ${TAGS_MAX} 個` : '例如：懸疑';
  }

  function addTag() {
    const t = tagInput.value.split(/\s+/).filter(Boolean).join(' ');
    if (!t) return;
    if (draft.tags.includes(t)) { tagInput.value = ''; return; }
    if (draft.tags.length >= TAGS_MAX) { toast(`類型標籤最多 ${TAGS_MAX} 個`, { error: true }); return; }
    draft.tags.push(t);
    tagInput.value = '';
    refreshTags();
    refreshPreview();
  }

  async function loadCover() {
    // ★ 世代檢查（known-issue 第 2、26 條）：連續換兩次圖，第一次的圖可能比
    //   第二次晚載完，沒擋的話預覽會停在舊的那張。
    const mine = ++coverGen;
    let src = null;
    if (data.cover_path) {
      // 管理員那一支不管上不上架都給，但要帶登入憑證，所以用 fetch 拿成 Blob。
      try {
        const blob = await api.blob(data.cover_path.replace('/api/public/', '/api/admin/'));
        src = URL.createObjectURL(blob);
      } catch {
        if (mine === coverGen) toast('封面圖讀取失敗', { error: true });
      }
    }
    if (mine !== coverGen) {
      if (src) URL.revokeObjectURL(src);
      return;
    }
    if (coverSrc) URL.revokeObjectURL(coverSrc);
    coverSrc = src;
    removeBtn.disabled = !data.cover_path;
    clear(coverHolder);
    coverHolder.append(
      coverSrc ? el('img', { class: 'intro__cover intro__cover--thumb', src: coverSrc, alt: '' })
        : el('div', { class: 'field__hint' }, '還沒有封面圖'),
    );
    refreshPreview();
  }

  const fileInput = el('input', {
    type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true,
    onChange: async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { toast('圖片太大（上限 5 MB）', { error: true }); return; }
      try {
        data = await api.upload(`/api/admin/mmg/${data.id}/cover`, file);
        toast('封面已更新');
        await loadCover();
      } catch (err) {
        toast(err.message || '上傳失敗', { error: true });
      }
    },
  });

  async function removeCover() {
    try {
      data = await api.del(`/api/admin/mmg/${data.id}/cover`);
      toast('封面已移除');
      await loadCover();
    } catch (err) {
      toast(err.message || '移除失敗', { error: true });
    }
  }

  async function save() {
    if (saving) return;
    saving = true;
    refreshSave();
    const sent = JSON.stringify(draft);
    try {
      data = await api.put(`/api/admin/mmg/${data.id}/intro`, draft);
      saved = sent;
      toast('已儲存');
    } catch (err) {
      toast(err.message || '儲存失敗', { error: true });
    } finally {
      saving = false;
      refreshPreview();
    }
  }

  const textarea = (key, max, placeholder) => el('textarea', {
    rows: '8', maxlength: String(max), placeholder,
    onInput: (e) => { draft[key] = e.target.value; refreshPreview(); },
  }, draft[key]);

  clear(app);
  app.append(
    topbar([
      el('a', { class: 'btn btn--primary btn--small', href: `/mmg/${data.id}` }, '看公開頁面'),
      el('a', { class: 'btn btn--primary btn--small', href: '/?view=admin&tab=mmg' }, '回劇本管理'),
    ]),
    el('div', { class: 'section' }, [
      el('div', { class: 'section__label' }, `編輯簡介頁：${data.name}`),
      data.public
        ? el('div', { class: 'field__hint' }, `公開網址：${window.location.origin}/mmg/${data.id}`)
        : el('div', { class: 'field__warn' }, '這齣目前沒有上架，公開網址會顯示「找不到這個劇本」。上架之後才會公開。'),

      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, '封面圖'),
        coverHolder,
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn--primary btn--small', type: 'button', onClick: () => fileInput.click() }, '上傳圖片'),
          removeBtn,
        ]),
        el('div', { class: 'field__hint' }, 'JPG、PNG、WebP、GIF，5 MB 以內。會照原比例縮到最寬 1200、最高 1600，並清掉照片的拍攝位置等資訊'),
        fileInput,
      ]),

      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, `類型標籤（最多 ${TAGS_MAX} 個，每個 ${TAG_MAX_CHARS} 字以內）`),
        tagList,
        el('div', { class: 'row' }, [
          tagInput,
          el('button', { class: 'btn btn--primary btn--small', type: 'button', onClick: addTag }, '加入'),
        ]),
      ]),

      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, `劇本簡介（${SYNOPSIS_MAX} 字以內）`),
        textarea('synopsis', SYNOPSIS_MAX, '這個劇本是什麼樣的故事'),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, `角色簡介（${CHARACTERS_MAX} 字以內）`),
        textarea('characters', CHARACTERS_MAX, '每個角色一段'),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, `老闆的話（${OWNER_NOTE_MAX} 字以內）`),
        textarea('owner_note', OWNER_NOTE_MAX, '想對玩家說的話'),
      ]),

      saveBtn,
      el('div', { class: 'field__hint' },
        '時長、人數、售價、訂金、額外註記會自動從劇本管理帶進來，在那邊改。沒有填的就不會顯示。'),

      el('div', { class: 'section__label', style: 'margin-top:16px' }, '預覽'),
    ]),
    preview,
  );
  refreshTags();
  loadCover();
}
