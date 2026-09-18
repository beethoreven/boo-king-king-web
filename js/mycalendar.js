/**
 * 預訂行事曆：玩家看自己的場次落在哪幾天。
 *
 * 版面與互動全在 calendarpage.js，這裡只回答三件事：資料從哪來、一項怎麼畫、
 * 圖例寫什麼。主持人與店家的行事曆是同一支元件的另外兩組答案。
 *
 * 跟「我預訂的場次」的分工：那一頁按狀態分頁籤（要找某一筆時用），這一頁
 * 回答「我哪幾天有事」。所以這裡不分頁籤，一天之內各種狀態混著列，
 * 每一項自己講自己的狀態。
 */

import { api } from './api.js';
import { createCalendarPage } from './calendarpage.js';
import { bookingCard } from './mybookings.js';

export function createMyCalendarView() {
  return createCalendarPage({
    loadMonth: async (ym) => (await api.get(`/api/bookings/mine/month/${ym}`)).days,
    loadDay: (iso) => api.get(`/api/bookings/mine/date/${iso}`),
    loadLegend: async () => {
      // 圖例跟頁籤同一份清單（後端依這家店的功能表給），所以不收訂金的店
      // 不會出現「等待支付訂金」那個顏色。
      const d = await api.get('/api/bookings/mine/tabs');
      // 已取消不進圖例：它不畫點。留著會讓人在日曆上找一個永遠不會出現的顏色。
      return Object.entries(d.tabs || {})
        .filter(([key]) => key !== 'cancelled')
        .map(([key, label]) => ({ key, label }));
    },
    renderItem: (item) => bookingCard(item, { showStatus: true }),
    emptyText: '這天沒有預訂的場次',
    moreText: '這天的場次太多，其餘請到「我預訂的場次」查看',
  }).node;
}
