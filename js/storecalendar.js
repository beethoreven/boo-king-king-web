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
import { createCalendarPage } from './calendarpage.js';
import { storeCard } from './admin.js';

export function createStoreCalendarView() {
  return createCalendarPage({
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
    renderItem: (item) => storeCard(item, { showStatus: true }),
    emptyText: '這天沒有場次',
    moreText: '這天的場次太多，其餘請到場次管理查看',
  }).node;
}
