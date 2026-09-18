/**
 * 指定行事曆：主持人看哪幾天有場次指定到自己。
 *
 * 版面與互動全在 calendarpage.js，這裡只回答三件事：資料從哪來、一項怎麼畫、
 * 圖例寫什麼——跟玩家的預訂行事曆是同一支元件的兩組答案。
 *
 * ## 分類不是狀態
 *
 * 點的顏色與每一項的說明用的是「這一場對我而言算哪一類」（待確認／已確認／
 * 已結束），不是整筆預約的狀態。一場還在等**我**確認的戲，整筆的狀態文字會
 * 寫成「等待其他主持確認」，那句話在這裡是錯的。判斷在後端（_GM_CATEGORY_SQL），
 * 跟主持人介面三個頁籤是同一套。
 *
 * ## 確認按鈕留著
 *
 * 待確認的場次在這裡也能直接按確認（案主 2026-09-17 決定）：黃點就是在說
 * 「這天有事要你處理」，點進去卻只能看，等於要他再繞回場次確認頁去找同一筆。
 * 按下去走的是跟主持人介面同一支 confirmGmBooking()，規矩完全一樣。
 */

import { api } from './api.js';
import { confirmDialog } from './ui.js';
import { createCalendarPage } from './calendarpage.js';
import { TABS, gmCard, confirmGmBooking } from './gm.js';

export function createGmCalendarView() {
  const page = createCalendarPage({
    loadMonth: async (ym) => (await api.get(`/api/gm/month/${ym}`)).days,
    loadDay: (iso) => api.get(`/api/gm/date/${iso}`),
    // 圖例就是主持人介面的三個頁籤，同一份清單、同樣的字。
    // 已取消不列：它不畫點（點進某一天時才會出現在清單裡）。
    loadLegend: async () => TABS.map(({ key, label }) => ({ key, label })),
    renderItem: (item) => gmCard(item, {
      category: item.category,
      showCategory: true,
      onConfirm: async () => {
        // 確認完要重抓：那一場會從待確認變成已確認，日曆上那個點的顏色
        // 也得跟著變，否則他剛動過的那一天會留在舊顏色上。
        if (await confirmGmBooking(item)) page.reload();
      },
    }),
    emptyText: '這天沒有指定給你的場次',
    moreText: '這天的場次太多，其餘請到場次確認頁查看',
    // 自己的忙碌日：標起來之後，那天**誰都不能把場次指定給你**，管理員也不行。
    // 要讓他排，得自己先來這裡取消。
    busy: {
      load: async (ym) => (await api.get(`/api/gm/busy/${ym}`)).dates,
      set: (iso) => api.post('/api/gm/busy', { date: iso }),
      clear: (iso) => api.del(`/api/gm/busy/${iso}`),
      beforeSet: (iso, statuses) => statuses.length
        ? confirmDialog({
            title: '這天已經有指定給你的場次',
            body: `${iso} 已經有 ${statuses.length} 場指定給你。\n\n`
                + '設成忙碌日不會取消它們，只是之後不能再把新的場次指定給你。\n'
                + '既有的那幾場請直接跟管理員確認。',
            confirmText: '仍要設為忙碌日',
            danger: true,
          })
        : Promise.resolve(true),
    },
  });
  return page.node;
}
