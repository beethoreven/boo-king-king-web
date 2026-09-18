/**
 * 場次行事曆：店家看全站的場次落在哪幾天。
 *
 * 版面與互動全在 calendarpage.js，這裡只回答三件事：資料從哪來、一項怎麼畫、
 * 圖例寫什麼——跟另外兩份行事曆是同一支元件的不同組答案。
 *
 * 跟場次管理的分工：那一頁按狀態分子頁籤（要處理某一類時用），這一頁回答
 * 「哪幾天有場次、那天排了什麼」。所以這裡不分頁籤，一天之內混著列，
 * 每一項自己講自己的狀態。
 *
 * 點只畫非取消的場次，清單全部列出（案主 2026-09-17 定案）。
 */

import { api } from './api.js';
import { el, clear, toast, confirmDialog } from './ui.js';
import { createCalendarPage } from './calendarpage.js';
import { storeCard, bookingEditorNode } from './admin.js';

export function createStoreCalendarView() {
  // 劇本清單（含每個角色可選的主持人）：編輯畫面要用。第一次按「編輯」才抓，
  // 之後沿用——只是看日曆的人不該為了一個他沒打開的表單多打一支 API。
  let scriptsPromise = null;
  const loadScripts = () => (scriptsPromise ??= api.get('/api/admin/mmg'));

  // 目前打開的那一張編輯表單（同一時間只有一張）。
  let editing = null;
  const dirty = () => Boolean(editing)
    && JSON.stringify(editing.b.editing) !== editing.b.snapshot;

  /** 有沒存的修改就先問一次。回傳 false 代表他選擇留下。 */
  async function canLeave() {
    // 他選擇離開（或根本沒改）就把表單一起忘掉：清單接著會重畫，那張表單
    // 已經不在畫面上了，留著它的話下一次會被誤判成「還有沒存的修改」。
    if (!dirty()) { editing = null; return true; }
    const ok = await confirmDialog({
      title: '尚未儲存',
      body: '目前修改尚未儲存，是否確認退出？',
      confirmText: '退出不儲存',
      cancelText: '留在這裡',
      danger: true,
    });
    if (ok) editing = null;
    return ok;
  }

  /**
   * 在那張卡片的位置展開編輯表單。用的是場次管理同一張（bookingEditorNode），
   * 所以忙碌日、撞期、訂金那幾道檢查一道都不少。
   */
  async function openEditor(item, card) {
    if (!await canLeave()) return;
    let data;
    try {
      data = await loadScripts();
    } catch (err) {
      scriptsPromise = null;   // 下次再按要能重試，不要把失敗記住
      toast(err.message, { error: true });
      return;
    }
    const b = {
      editing: JSON.parse(JSON.stringify(item)),
      snapshot: JSON.stringify(item),
      busyInfo: null,
      tab: item.status,
    };
    const holder = el('div', {});
    const draw = () => {
      clear(holder);
      holder.append(bookingEditorNode({
        b,
        scripts: data.items,
        gmCandidates: data.gm_candidates,
        users: [],   // 這裡只編輯既有的場次，用不到預訂者清單
        rerender: draw,
        onCancel: async () => {
          if (!await canLeave()) return;
          editing = null;
          page.reload();
        },
        // 存完重抓整個月與這一天：日期或狀態改了，點的顏色、那一格有沒有點
        // 都會跟著變，只換掉這一張卡片是不夠的。
        onSaved: () => { editing = null; page.reload(); },
      }));
    };
    editing = { b };
    draw();
    card.replaceWith(holder);
  }

  const page = createCalendarPage({
    loadMonth: async (ym) => (await api.get(`/api/admin/bookings/month/${ym}`)).days,
    loadDay: (iso) => api.get(`/api/admin/bookings/date/${iso}`),
    // ★ 借用玩家那支端點不是偷懶：它回的是「這家店到得了的狀態」
    //   （後端的 reachable_tabs，不看是誰在問），場次管理的子頁籤也是同一份。
    //   另開一支一模一樣的管理員版本，只會多一個之後會走鐘的定義。
    loadLegend: async () => {
      const d = await api.get('/api/bookings/mine/tabs');
      // 已取消不進圖例：它不畫點。留著會讓人在日曆上找一個永遠不會出現的顏色。
      return Object.entries(d.tabs || {})
        .filter(([key]) => key !== 'cancelled')
        .map(([key, label]) => ({ key, label }));
    },
    renderItem: (item) => {
      const card = storeCard(item, { showStatus: true, onEdit: () => openEditor(item, card) });
      return card;
    },
    canLeave,
    emptyText: '這天沒有場次',
    moreText: '這天的場次太多，其餘請到場次管理查看',
    // 店家忙碌日：那天整家店不開，玩家一律訂不到（比排期的每一層都高）。
    busy: {
      load: async (ym) => (await api.get(`/api/admin/busy/${ym}`)).dates,
      set: (iso) => api.post('/api/admin/busy', { date: iso }),
      clear: (iso) => api.del(`/api/admin/busy/${iso}`),
      // 那天已經有場次還是可以設（案主定案），但要先講清楚後果——那些場次
      // 不會自動消失，得有人去處置。這裡不另外打 API 問：日曆上那一格的點
      // 就是那天的場次，畫面手上已經有了。
      beforeSet: (iso, statuses) => statuses.length
        ? confirmDialog({
            title: '這天已經有場次',
            body: `${iso} 已經有 ${statuses.length} 場非取消的場次。\n\n`
                + '設成忙碌日不會取消它們，玩家之後也訂不了這一天。\n'
                + '建議先確認那些場次要改期還是取消，並讓玩家知道處理方式。',
            confirmText: '仍要設為忙碌日',
            danger: true,
          })
        : Promise.resolve(true),
    },
  });
  return page.node;
}
