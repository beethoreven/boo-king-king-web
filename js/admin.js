/**
 * 管理員介面：劇本管理／場次管理／使用者管理。
 *
 * 共通模式：清單頁 + 點進去編輯。編輯是「改完一起按儲存」，不是改一格
 * 送一次——後端會逐欄比對，沒有實際變動時回 changed=false，據此決定
 * 要跳「已儲存」還是「無任何修改」。
 */

import { api } from './api.js';
import { el, clear, select, field, toast, confirmDialog, alertDialog, spinner } from './ui.js';
import { adminMaySave } from './conflicts.js';

const SECTIONS = [
  { key: 'mmg', label: '劇本管理' },
  { key: 'bookings', label: '場次管理' },
  { key: 'users', label: '使用者管理' },
];

const ROLE_OPTIONS = [
  { value: 1, label: '管理員' },
  { value: 2, label: '主持人' },
  { value: 3, label: '一般玩家' },
];

const USER_STATUS_OPTIONS = [
  { value: 'active', label: '啟用' },
  { value: 'deactive', label: '停用' },
];

const MMG_STATUS_OPTIONS = [
  { value: 'active', label: '上架' },
  { value: 'inactive', label: '下架' },
];

const BOOKING_STATUS_OPTIONS = [
  { value: 'gm_confirm', label: '待主持確認' },
  { value: 'gm_reviewed', label: '待收訂金' },
  { value: 'booked', label: '已成立' },
  { value: 'ended', label: '已結束' },
  { value: 'cancelled', label: '已取消' },
];

// 新增時的空白資料。用函式而不是常數，因為裡面有陣列——共用同一個物件
// 會讓上一次沒存檔的編輯殘留到下一次新增。
const emptyMmg = () => ({
  id: null, name: '', period: null, price: null, booking_cost: null,
  players: '', waitlist_limit: 3, status: 'active',
  gm_slots: [1, 2, 3, 4].map((slot) => ({ slot, name: '', user_ids: [] })),
});

const emptyUser = () => ({
  id: null, email: '', name: '', role: 3, status: 'active', line_id: '', phone: '',
});

const emptyBooking = () => ({
  id: null, mmg_id: null, player_id: null,
  session_date: '', session_time: '', status: 'gm_confirm',
  deposit: 0, note: '',
  gm_user_ids: [null, null, null, null],
  gm_confirmed: [false, false, false, false],
});

const EMPTY_BOOKING_FILTERS = {
  mmg_name: '', player_name: '', session_date: '', session_time: '',
};

export function createAdminView() {
  const root = el('div', { class: 'view' });

  const state = {
    section: 'mmg',
    mmg: { items: [], hostCandidates: [], loading: true, editing: null },
    users: { items: [], loading: true, editing: null },
    bookings: {
      tabs: {},           // 後端給的 {key: 中文標籤}
      tabOrder: [],
      tab: null,
      data: {},           // {key: {items, has_more, start, filters, loading}}
      editing: null,
      filterOpen: false,
      draft: { ...EMPTY_BOOKING_FILTERS },
    },
  };

  // ── 載入 ────────────────────────────────────────────────

  async function loadMmg() {
    state.mmg.loading = true;
    render();
    try {
      const d = await api.get('/api/admin/mmg');
      state.mmg.items = d.items;
      state.mmg.hostCandidates = d.host_candidates;
    } catch (err) { toast(err.message, { error: true }); }
    state.mmg.loading = false;
    render();
  }

  async function loadUsers() {
    state.users.loading = true;
    render();
    try {
      const d = await api.get('/api/admin/users');
      state.users.items = d.items;
    } catch (err) { toast(err.message, { error: true }); }
    state.users.loading = false;
    render();
  }

  async function loadBookings() {
    const b = state.bookings;
    try {
      const d = await api.get('/api/admin/bookings');
      b.tabs = d.tabs;
      b.tabOrder = Object.keys(d.tabs);
      b.tab = b.tab ?? b.tabOrder[0];
      for (const key of b.tabOrder) {
        b.data[key] = {
          ...d.data[key], start: 1,
          filters: b.data[key]?.filters ?? { ...EMPTY_BOOKING_FILTERS },
          loading: false,
        };
      }
    } catch (err) { toast(err.message, { error: true }); }
    render();
  }

  async function reloadBookingTab(key) {
    const t = state.bookings.data[key];
    t.loading = true;
    render();
    try {
      Object.assign(t, await api.get(`/api/admin/bookings/tab/${key}`, {
        start: t.start, ...t.filters,
      }));
    } catch (err) { toast(err.message, { error: true }); }
    t.loading = false;
    render();
  }

  function loadSection(key) {
    state.section = key;
    if (key === 'mmg') loadMmg();
    else if (key === 'users') loadUsers();
    else loadBookings();
  }

  // ── 儲存 ────────────────────────────────────────────────

  /** 新增走 POST、編輯走 PUT。只有編輯才有「無任何修改」這個結果。 */
  async function save(path, body, onDone, { create = false } = {}) {
    try {
      const r = create ? await api.post(path, body) : await api.put(path, body);
      toast(create ? '已新增' : (r.changed ? '已儲存' : '無任何修改'));
      onDone();
    } catch (err) {
      await alertDialog({ title: create ? '新增失敗' : '儲存失敗', body: err.message });
    }
  }

  /** 清單上方的「新增」列。三個頁籤共用。 */
  function addBar(label, onClick) {
    return el('div', { class: 'section toolbar' }, [
      el('button', { class: 'btn btn--ghost btn--small', onClick }, label),
    ]);
  }

  // ── 劇本管理 ────────────────────────────────────────────

  function renderMmgList() {
    const s = state.mmg;
    if (s.loading) return spinner();
    return el('div', {}, [
      addBar('＋ 新增劇本', () => { s.editing = emptyMmg(); render(); }),
      el('div', { class: 'section' }, [
      el('div', { class: 'list' }, s.items.map((m) =>
        el('div', { class: 'card list-item' }, [
          el('div', { class: 'list-item__main' }, [
            el('div', { class: 'list-item__title' }, m.name),
            el('div', { class: 'list-item__meta' },
              `${m.period ?? '—'} 小時 · ${m.players ?? '—'} 人 · NT$ ${m.price ?? '—'} · 訂金 ${m.booking_cost ?? '—'}`),
            el('div', { class: 'list-item__meta' },
              m.gm_slots.filter((g) => g.name).map((g) => `${g.name}（${g.user_ids.length} 人可帶）`).join('、') || '尚未設定角色'),
          ]),
          el('div', { class: 'list-item__side' }, [
            m.status !== 'active' && el('div', { class: 'status-chip' }, '下架'),
            el('button', { class: 'btn btn--ghost btn--small', onClick: () => { s.editing = deepCopy(m); render(); } }, '編輯'),
          ]),
        ]),
      )),
      ]),
    ]);
  }

  function renderMmgEditor() {
    const s = state.mmg;
    const m = s.editing;
    const setField = (k) => (e) => { m[k] = e.target.value; };
    const setNum = (k) => (e) => { m[k] = e.target.value === '' ? null : Number(e.target.value); };

    return el('div', { class: 'section' }, [
      el('div', { class: 'section__label' }, m.id ? `編輯劇本 #${m.id}` : '新增劇本'),
      field({ label: '名稱', control: el('input', { type: 'text', value: m.name ?? '', onInput: setField('name') }) }),
      el('div', { class: 'row' }, [
        field({ label: '時長（小時）', control: el('input', { type: 'number', step: '0.1', value: m.period ?? '', onInput: setNum('period') }) }),
        field({ label: '人數（顯示用）', control: el('input', { type: 'text', value: m.players ?? '', onInput: setField('players') }) }),
      ]),
      el('div', { class: 'row' }, [
        field({ label: '售價', control: el('input', { type: 'number', value: m.price ?? '', onInput: setNum('price') }) }),
        field({ label: '訂金', control: el('input', { type: 'number', value: m.booking_cost ?? '', onInput: setNum('booking_cost') }) }),
      ]),
      el('div', { class: 'row' }, [
        field({ label: '序位上限', control: el('input', { type: 'number', min: '0', value: m.waitlist_limit ?? 3, onInput: setNum('waitlist_limit') }),
          hint: '這個時段最多可以有幾組（含已成立的）' }),
        field({
          label: '狀態',
          control: select({ options: MMG_STATUS_OPTIONS, value: m.status, onChange: (v) => { m.status = v; }, ariaLabel: '劇本狀態' }),
        }),
      ]),

      el('div', { class: 'section__label', style: 'margin-top:8px' }, '主持人角色'),
      ...m.gm_slots.map((slot, i) => renderGmSlot(m, slot, i)),

      el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('button', { class: 'btn btn--ghost btn--small', onClick: () => { s.editing = null; render(); } }, '取消'),
        el('button', {
          class: 'btn btn--primary btn--small',
          onClick: () => save(
            m.id ? `/api/admin/mmg/${m.id}` : '/api/admin/mmg', m,
            () => { s.editing = null; loadMmg(); }, { create: !m.id },
          ),
        }, m.id ? '儲存' : '新增'),
      ]),
    ]);
  }

  /** 一個主持人角色：名稱 + 已加入的人（標籤，可移除）+ 新增下拉。 */
  function renderGmSlot(m, slot, index) {
    const hasName = Boolean((slot.name ?? '').trim());
    const candidates = state.mmg.hostCandidates.filter((c) => !slot.user_ids.includes(c.id));

    return el('div', { class: 'card card--flat', style: 'display:flex;flex-direction:column;gap:8px' }, [
      field({
        label: `角色 ${slot.slot} 名稱`,
        // 名稱清空時，資料庫的 CHECK 約束要求名單也必須是空的。
        // 這裡直接連動清掉，讓畫面跟規則一致——不然使用者會在儲存時
        // 才被擋下，而且不知道為什麼。
        control: el('input', {
          type: 'text',
          value: slot.name ?? '',
          placeholder: '留空＝這齣戲沒有這個角色',
          // 打字時只寫值，不重繪。render() 會把整個畫面重建，正在編輯的
          // 這個欄位也會被換成新節點——焦點跟著消失，打一個字就跳走。
          // 注音更嚴重：組字中的狀態在元素被銷毀後無法還原，等於完全
          // 打不了中文。
          onInput: (e) => { slot.name = e.target.value; },
          // 依附這個值的 UI（下面的主持人標籤、新增下拉、提示文字）改在
          // 離開欄位時才更新。change 不會在組字途中觸發，所以不會打斷輸入。
          onChange: (e) => {
            slot.name = e.target.value;
            if (!e.target.value.trim()) slot.user_ids = [];
            render();
          },
        }),
        hint: hasName ? '' : '留空時不能指派主持人',
      }),
      hasName && el('div', { class: 'tag-row' }, [
        ...slot.user_ids.map((uid) => {
          const person = state.mmg.hostCandidates.find((c) => c.id === uid);
          return el('div', { class: 'tag' }, [
            person ? person.name : `id=${uid}`,
            el('button', {
              class: 'tag__remove',
              'aria-label': '移除',
              onClick: () => { slot.user_ids = slot.user_ids.filter((x) => x !== uid); render(); },
            }, '×'),
          ]);
        }),
        !slot.user_ids.length && el('div', { class: 'field__hint' }, '尚未指派主持人'),
      ]),
      hasName && candidates.length > 0 && select({
        options: [{ value: '', label: '新增主持人…' }, ...candidates.map((c) => ({ value: c.id, label: c.name }))],
        value: '',
        onChange: (v) => { if (v) { slot.user_ids.push(Number(v)); render(); } },
        ariaLabel: `為角色 ${slot.slot} 新增主持人`,
      }),
    ]);
  }

  // ── 使用者管理 ──────────────────────────────────────────

  function renderUsersList() {
    const s = state.users;
    if (s.loading) return spinner();
    return el('div', {}, [
      addBar('＋ 新增使用者', () => { s.editing = emptyUser(); render(); }),
      el('div', { class: 'section' }, [
      el('div', { class: 'list' }, s.items.map((u) =>
        el('div', { class: 'card list-item' }, [
          el('div', { class: 'list-item__main' }, [
            el('div', { class: 'list-item__title' }, u.name || '（未命名）'),
            el('div', { class: 'list-item__meta' }, u.email),
            el('div', { class: 'list-item__meta' },
              [u.role_label, u.line_id && `LINE ${u.line_id}`, u.phone].filter(Boolean).join(' · ')),
          ]),
          el('div', { class: 'list-item__side' }, [
            u.status !== 'active' && el('div', { class: 'status-chip' }, '停用'),
            el('button', { class: 'btn btn--ghost btn--small', onClick: () => { s.editing = deepCopy(u); render(); } }, '編輯'),
          ]),
        ]),
      )),
      ]),
    ]);
  }

  function renderUserEditor() {
    const s = state.users;
    const u = s.editing;
    const original = s.items.find((x) => x.id === u.id);
    const setField = (k) => (e) => { u[k] = e.target.value; };

    return el('div', { class: 'section' }, [
      el('div', { class: 'section__label' }, u.id ? `編輯使用者 #${u.id}` : '新增使用者'),
      field({
        label: 'Email（Google 登入帳號）',
        // 不重繪：這裡不需要。警語是常駐的，而「email 有沒有被改過」
        // 改成在按下儲存的當下才算（見下方），不必為了更新它而重建畫面。
        control: el('input', { type: 'email', value: u.email ?? '', onInput: setField('email') }),
        // 常駐紅字，不是只有改了才出現——這是不可逆的破壞性操作，
        // 使用者應該在動手之前就看到警告。
        // 只有既有帳號才警告。新增時還沒有人在用這個 email，沒有東西會壞。
        warn: u.id ? '改動後該帳號將無法用原本的 Google 帳號登入，且對方無法自行修復' : null,
      }),
      field({ label: '姓名', control: el('input', { type: 'text', value: u.name ?? '', onInput: setField('name') }) }),
      el('div', { class: 'row' }, [
        field({
          label: '角色',
          control: select({ options: ROLE_OPTIONS, value: u.role, onChange: (v) => { u.role = Number(v); }, ariaLabel: '角色' }),
        }),
        field({
          label: '狀態',
          control: select({ options: USER_STATUS_OPTIONS, value: u.status, onChange: (v) => { u.status = v; }, ariaLabel: '狀態' }),
        }),
      ]),
      el('div', { class: 'row' }, [
        field({ label: 'LINE ID', control: el('input', { type: 'text', value: u.line_id ?? '', onInput: setField('line_id') }) }),
        field({ label: '電話', control: el('input', { type: 'text', value: u.phone ?? '', onInput: setField('phone') }) }),
      ]),
      el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('button', { class: 'btn btn--ghost btn--small', onClick: () => { s.editing = null; render(); } }, '取消'),
        el('button', {
          class: 'btn btn--primary btn--small',
          onClick: async () => {
            // 改 email 要二次確認：常駐警語容易被略過，而這個操作
            // 改錯了對方就登不進來、自己也救不了。
            //
            // 在這裡才比對，不在 render 時算：算在 render 就得靠每次
            // 輸入都重繪才會更新，而那正是會把使用者踢出輸入框的原因。
            const emailChanged = Boolean(original) && u.email !== original.email;
            if (emailChanged) {
              const ok = await confirmDialog({
                title: '確認變更登入 Email',
                body: `將 ${original.email}\n改為 ${u.email}\n\n這個帳號之後必須用新的 Google 帳號登入，舊帳號將無法進入系統。`,
                confirmText: '確認變更',
              });
              if (!ok) return;
            }
            save(
              u.id ? `/api/admin/users/${u.id}` : '/api/admin/users', u,
              () => { s.editing = null; loadUsers(); }, { create: !u.id },
            );
          },
        }, u.id ? '儲存' : '新增'),
      ]),
    ]);
  }

  // ── 場次管理 ────────────────────────────────────────────

  function renderBookingsList() {
    const b = state.bookings;
    if (!b.tab) return spinner();
    const t = b.data[b.tab];

    const nodes = [
      el('div', { class: 'tabs' }, b.tabOrder.map((key) =>
        el('button', {
          class: `tab${key === b.tab ? ' tab--active' : ''}`,
          onClick: () => { b.tab = key; b.draft = { ...t.filters }; render(); },
        }, b.tabs[key]),
      )),
      el('div', { class: 'section toolbar' }, [
        el('button', {
          class: 'btn btn--ghost btn--small',
          onClick: () => { b.filterOpen = !b.filterOpen; render(); },
        }, b.filterOpen ? '收起篩選器' : '篩選器'),
        el('button', {
          class: 'btn btn--ghost btn--small',
          // 新增場次要選預定者，而使用者清單是切到「使用者管理」才載的。
          // 這裡順手載一次，不然那個下拉會是空的。
          onClick: () => {
            b.editing = emptyBooking();
            if (!state.users.items.length) loadUsers(); else render();
          },
        }, '＋ 新增場次'),
      ]),
    ];

    if (b.filterOpen) {
      const set = (k) => (e) => { b.draft[k] = e.target.value; };
      nodes.push(el('div', { class: 'section' }, el('div', { class: 'list' }, [
        field({ label: '劇本名稱', control: el('input', { type: 'text', value: b.draft.mmg_name, onInput: set('mmg_name') }) }),
        field({ label: '預定者名稱', control: el('input', { type: 'text', value: b.draft.player_name, onInput: set('player_name') }) }),
        el('div', { class: 'row' }, [
          field({ label: '日期', control: el('input', { type: 'date', value: b.draft.session_date, onChange: set('session_date') }) }),
          field({ label: '時間', control: el('input', { type: 'time', step: '1800', value: b.draft.session_time, onChange: set('session_time') }) }),
        ]),
        el('div', { class: 'row' }, [
          el('button', {
            class: 'btn btn--ghost btn--small',
            onClick: () => { b.draft = { ...EMPTY_BOOKING_FILTERS }; t.filters = { ...EMPTY_BOOKING_FILTERS }; t.start = 1; reloadBookingTab(b.tab); },
          }, '清除'),
          el('button', {
            class: 'btn btn--primary btn--small',
            onClick: () => { t.filters = { ...b.draft }; t.start = 1; reloadBookingTab(b.tab); },
          }, '篩選'),
        ]),
      ])));
    }

    if (t.loading) { nodes.push(spinner()); return el('div', {}, nodes); }
    if (!t.items.length) { nodes.push(el('div', { class: 'empty' }, '這個狀態目前沒有場次')); return el('div', {}, nodes); }

    nodes.push(el('div', { class: 'section' }, el('div', { class: 'list' }, t.items.map((item) =>
      el('div', { class: 'card list-item' }, [
        el('div', { class: 'list-item__main' }, [
          el('div', { class: 'list-item__title' }, item.mmg_name),
          el('div', { class: 'list-item__meta' }, `${item.session_date} ${item.session_time} · ${item.player_name}`),
          el('div', { class: 'list-item__meta' }, depositLine(item)),
        ]),
        el('div', { class: 'list-item__side' },
          // 補上 status 再進編輯畫面。清單那一包刻意沒有這個欄位（子頁籤
          // 本身就是狀態），但編輯畫面要把它送回後端——不補的話，只要
          // 管理員沒動那個下拉，送出去的 status 就是 undefined，後端收到
          // None 直接退件「未知的狀態」。任何「不改狀態的儲存」都會失敗。
          el('button', {
            class: 'btn btn--ghost btn--small',
            onClick: () => { state.bookings.editing = { ...deepCopy(item), status: b.tab }; render(); },
          }, '編輯')),
      ]),
    ))));

    if (t.start > 1 || t.has_more) {
      nodes.push(el('div', { class: 'section' }, el('div', { class: 'pager' }, [
        el('button', { class: 'btn btn--ghost btn--small', disabled: t.start <= 1, onClick: () => { t.start = Math.max(1, t.start - 50); reloadBookingTab(b.tab); } }, '← 上一頁'),
        el('div', { class: 'pager__label' }, `${t.start} – ${t.start + t.items.length - 1}`),
        el('button', { class: 'btn btn--ghost btn--small', disabled: !t.has_more, onClick: () => { t.start += 50; reloadBookingTab(b.tab); } }, '下一頁 →'),
      ])));
    }
    return el('div', {}, nodes);
  }

  /**
   * 這場還沒「有人確認」的角色，回傳可以直接顯示的說明字串。
   *
   * 沒指派到人也算數：一個角色掛著空位，跟掛著一個還沒點頭的人，對
   * 「這場到底成不成立」來說是同一件事——都還沒有人答應要帶。
   *
   * 讀的是畫面上當下的值（item.gm_user_ids / item.gm_confirmed），不是
   * 資料庫載入時的值。管理員可能在同一個表單裡先勾了確認再改狀態，
   * 那就該以他眼前看到的為準。
   */
  function unconfirmedRoles(item, mmg) {
    const out = [];
    for (const [i, slot] of (mmg?.gm_slots ?? []).entries()) {
      if (!slot.name) continue;                       // 這齣戲沒有這個角色
      if (!item.gm_user_ids[i]) out.push(`${slot.name}：未指定主持人`);
      else if (!item.gm_confirmed[i]) out.push(`${slot.name}：尚未確認`);
    }
    return out;
  }

  function renderBookingEditor() {
    const b = state.bookings;
    const item = b.editing;
    const mmg = state.mmg.items.find((m) => m.id === item.mmg_id);

    const isNew = !item.id;

    return el('div', { class: 'section' }, [
      el('div', { class: 'section__label' }, isNew ? '新增場次' : `編輯場次 #${item.id}`),
      // 既有場次的劇本與預定者只顯示不編輯（改這兩者等於變成另一筆預約）；
      // 新增時當然要選。
      isNew
        ? el('div', { class: 'row' }, [
            field({
              label: '劇本',
              control: select({
                options: [{ value: '', label: '請選擇' },
                  ...state.mmg.items.map((m) => ({ value: m.id, label: m.name }))],
                value: item.mmg_id ?? '',
                onChange: (v) => {
                  item.mmg_id = v ? Number(v) : null;
                  // 換劇本等於換一組角色，先前選的主持人不再適用
                  item.gm_user_ids = [null, null, null, null];
                  item.gm_confirmed = [false, false, false, false];
                  render();
                },
                ariaLabel: '劇本',
              }),
            }),
            field({
              label: '預定者',
              control: select({
                options: [{ value: '', label: '請選擇' },
                  ...state.users.items.map((u) => ({ value: u.id, label: u.name || u.email }))],
                value: item.player_id ?? '',
                onChange: (v) => { item.player_id = v ? Number(v) : null; },
                ariaLabel: '預定者',
              }),
            }),
          ])
        : el('div', { class: 'card card--flat' }, `${item.mmg_name} · ${item.player_name}`),
      el('div', { class: 'row' }, [
        field({ label: '日期', control: el('input', { type: 'date', value: item.session_date, onChange: (e) => { item.session_date = e.target.value; } }) }),
        field({ label: '時間', control: el('input', { type: 'time', step: '1800', value: item.session_time, onChange: (e) => { item.session_time = e.target.value; } }) }),
      ]),
      el('div', { class: 'row' }, [
        field({
          label: '狀態',
          // 這裡只記下選擇，所有檢查都留到按儲存時一起做（見下方）。
          control: select({
            options: BOOKING_STATUS_OPTIONS,
            value: item.status ?? b.tab,
            onChange: (v) => { item.status = v; },
            ariaLabel: '場次狀態',
          }),
        }),
        field({
          label: '訂金',
          control: el('input', {
            type: 'number', value: item.deposit ?? 0,
            // 同樣不在打字途中重繪。下面的 warn（訂金與應收金額的關係）
            // 依附這個值，改成離開欄位時才更新。
            onInput: (e) => { item.deposit = Number(e.target.value || 0); },
            onChange: () => render(),
          }),
          warn: depositWarning(item.deposit, item.booking_cost),
        }),
      ]),
      field({ label: '備註', control: el('textarea', { rows: '3', value: item.note ?? '', onInput: (e) => { item.note = e.target.value; } }) }),

      el('div', { class: 'section__label', style: 'margin-top:8px' }, '主持人'),
      ...(mmg?.gm_slots ?? []).map((slot, i) => {
        if (!slot.name) return null;
        const candidates = state.mmg.hostCandidates.filter((c) => slot.user_ids.includes(c.id));
        return el('div', { class: 'card card--flat', style: 'display:flex;flex-direction:column;gap:8px' }, [
          field({
            label: slot.name,
            control: select({
              options: [{ value: '', label: '未指定' }, ...candidates.map((c) => ({ value: c.id, label: c.name }))],
              value: item.gm_user_ids[i] ?? '',
              onChange: (v) => {
                item.gm_user_ids[i] = v ? Number(v) : null;
                // 沒有人就不可能已確認，連動清掉——後端也會做同樣的
                // 清理，這裡先做是為了畫面立刻反映規則。
                if (!v) item.gm_confirmed[i] = false;
                render();
              },
              ariaLabel: `${slot.name} 的主持人`,
            }),
          }),
          el('label', { class: 'checkline' }, [
            el('input', {
              type: 'checkbox',
              checked: Boolean(item.gm_confirmed[i]),
              disabled: !item.gm_user_ids[i],
              // 只記錄，檢查在儲存時一起做——每勾一次查一次會把免費方案
              // 的額度花在使用者還沒決定送出的中途狀態上。
              onChange: (e) => { item.gm_confirmed[i] = e.target.checked; },
            }),
            '已確認',
          ]),
        ]);
      }).filter(Boolean),

      el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('button', { class: 'btn btn--ghost btn--small', onClick: () => { b.editing = null; render(); } }, '取消'),
        el('button', {
          class: 'btn btn--primary btn--small',
          onClick: async () => {
            if (isNew) {
              // 新增不做前端撞期檢查：create_booking() 在後端就會擋下
              // 劇本撞期與主持人撞期並回錯誤訊息。這裡再問一次只是多一支
              // 查詢，而且那筆預約還不存在，根本查不了。
              save('/api/admin/bookings', item,
                () => { b.editing = null; loadBookings(); }, { create: true });
              return;
            }

            const target = item.status ?? b.tab;
            // 清單那一包沒有 status 欄位（子頁籤本身就是狀態），所以原本
            // 的狀態就是當前頁籤。
            const statusChanged = target !== b.tab;
            const original = b.data[b.tab]?.items.find((x) => x.id === item.id);
            const newlyConfirmed = Boolean(original) && item.gm_confirmed
              .some((v, i) => v && !original.gm_confirmed[i]);

            // 只有真的在「推進」這場的時候才檢查。改個備註、改個訂金
            // 不必打那支查詢——免費方案的額度要花在有意義的地方。
            if (target !== 'cancelled' && (statusChanged || newlyConfirmed)) {
              if (!await adminMaySave(item.id)) return;

              const outstanding = unconfirmedRoles(item, mmg);
              if (outstanding.length) {
                const ok = await confirmDialog({
                  title: '目前尚有主持人未確認',
                  body: `${outstanding.join('\n')}\n\n還是要切換嗎？`,
                  confirmText: '還是要',
                  cancelText: '取消',
                });
                if (!ok) return;
              }
            }
            save(`/api/admin/bookings/${item.id}`, item, () => { b.editing = null; loadBookings(); });
          },
        }, isNew ? '新增' : '儲存'),
      ]),
    ]);
  }

  // ── 主渲染 ──────────────────────────────────────────────

  function render() {
    clear(root);
    root.append(
      el('div', { class: 'tabs' }, SECTIONS.map((s) =>
        el('button', {
          class: `tab${s.key === state.section ? ' tab--active' : ''}`,
          onClick: () => loadSection(s.key),
        }, s.label),
      )),
    );

    if (state.section === 'mmg') {
      root.append(state.mmg.editing ? renderMmgEditor() : renderMmgList());
    } else if (state.section === 'users') {
      root.append(state.users.editing ? renderUserEditor() : renderUsersList());
    } else {
      root.append(state.bookings.editing ? renderBookingEditor() : renderBookingsList());
    }
  }

  // 場次編輯要用到劇本的角色定義，所以一開始就把劇本也載進來
  loadMmg();
  return root;
}

function deepCopy(o) {
  return JSON.parse(JSON.stringify(o));
}

function depositWarning(deposit, cost) {
  if (cost == null || !deposit) return '';
  if (deposit > cost) return '超收訂金';
  if (deposit < cost) return '訂金不足額';
  return '';
}

function depositLine(item) {
  const warn = depositWarning(item.deposit, item.booking_cost);
  const base = `訂金 ${item.deposit} / ${item.booking_cost ?? '—'}`;
  return warn ? `${base}（${warn}）` : base;
}
