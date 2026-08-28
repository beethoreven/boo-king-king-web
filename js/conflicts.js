/**
 * 場次撞期的提醒。
 *
 * 主持人按確認、管理員切狀態，這兩個動作本身都不會製造衝突——衝突是
 * 先前就存在的（兩組都還在排隊時各自合法，其中一組先成立，另一組就變成
 * 卡到同一位主持人）。所以這裡只提醒，不阻擋：兩個畫面的用途都是人工
 * 判斷，系統該做的是把「撞到哪一場、幾點」攤開給人看。
 *
 * 抽成獨立模組是因為主持人與管理員兩邊都要用。訊息尾句與按鈕文字不同，
 * 用參數帶進來；查詢與格式化只有這一份，不會兩邊各改一次改到不一樣。
 */

import { api } from './api.js';
import { confirmDialog, toast } from './ui.js';

/** 2026-08-30 → 2026/08/30，照需求的顯示格式。 */
function formatWhen(conflict) {
  return `${conflict.session_date.replace(/-/g, '/')} ${conflict.session_time}`;
}

/**
 * 查這筆預約有沒有撞期，有的話跳對話框問要不要繼續。
 *
 * @param bookingId  要檢查的預約
 * @param tail       訊息最後一句（兩個畫面的處理方式不同）
 * @param confirmText 「還是要做」那顆按鈕的字
 * @param onlyMine   只看自己的撞期（主持人畫面用；管理員要看全部）
 * @returns true = 可以繼續（沒撞期，或使用者選了繼續）
 */
export async function confirmDespiteConflict(bookingId, { tail, confirmText, onlyMine = false }) {
  let conflicts;
  try {
    ({ conflicts } = await api.get(`/api/bookings/${bookingId}/conflicts`));
  } catch (err) {
    // 查不到就不擋。這是提醒，不是把關——因為一次查詢失敗就讓主持人
    // 沒辦法確認自己的場次，是拿次要功能去卡主要流程。
    toast(`撞期檢查失敗：${err.message}`, { error: true });
    return true;
  }

  const relevant = onlyMine ? conflicts.filter((c) => c.is_me) : conflicts;
  if (!relevant.length) return true;

  // 按「撞到的那一場」分組，不是按主持人。三位主持人撞到同一場，是一個
  // 衝突不是三個；逐位列出會變成六行講兩件事，重點反而看不出來。
  //
  // 主持人自己看時不列名字——那一定是他本人，寫出來只是佔行。
  const bySession = new Map();
  for (const c of relevant) {
    const key = `${c.mmg_name} ${formatWhen(c)}`;
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(c.host_name);
  }
  const lines = [...bySession].map(([when, hosts]) =>
    (onlyMine ? when : `${when}（${hosts.join('、')}）`));
  return confirmDialog({
    title: '該場次時間衝突',
    body: `已預定場次時間為\n${lines.join('\n')}\n\n${tail}`,
    confirmText,
    cancelText: '取消',
  });
}
