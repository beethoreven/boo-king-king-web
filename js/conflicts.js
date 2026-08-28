/**
 * 場次撞期的檢查。
 *
 * 有兩種撞期，嚴重程度不同：
 *
 *   劇本撞期 —— 同一個劇本在這段時間已經有另一場成立了。劇本是實體資源
 *     （同一套本、同一間房），一次只能開一場。這是排班問題，人看過之後
 *     可以決定放行。
 *
 *   主持人撞期 —— 這位主持人自己在這段時間已經被別的成立場次佔住，不論
 *     是不是同一齣戲。這個不能放行：一個人沒辦法同時待在兩場。要嘛另一
 *     場先取消，要嘛這場換人。
 *
 * 兩種都只在「另一場已經 booked」時才算數。同一時段好幾組排隊是正常的
 * （那正是序位的意義），衝突指的是已經成立的那一場把資源佔住了。
 *
 * 這些都不是把關——真正擋下寫入的是 create_booking()。這裡處理的是
 * 「當初建立時還不衝，後來別的場次成立了」才浮現的狀況。
 */

import { api } from './api.js';
import { confirmDialog, toast } from './ui.js';

/** 2026-08-30 → 2026/08/30，照需求的顯示格式。 */
const when = (c) => `${c.session_date.replace(/-/g, '/')} ${c.session_time}`;

/** 查不到就回 null，呼叫端一律當作「沒有衝突」放行。 */
async function fetchConflicts(bookingId) {
  try {
    return await api.get(`/api/bookings/${bookingId}/conflicts`);
  } catch (err) {
    // 提醒功能查詢失敗，不該連帶讓主要動作做不了——一次 GET 失敗就讓
    // 主持人沒辦法確認自己的場次，是拿次要功能去卡主要流程。
    toast(`撞期檢查失敗：${err.message}`, { error: true });
    return null;
  }
}

/**
 * 主持人撞期的硬擋。只有一顆「取消」，沒有放行的選項。
 *
 * 用 confirmDialog 而不是 alertDialog，是為了讓那顆按鈕寫「取消」而不是
 * 「確認」——這個對話框沒有任何東西可以確認，寫「確認」會讓人以為按下去
 * 就成立了。
 */
function blockDialog(title, conflicts, tail) {
  return confirmDialog({
    title,
    body: `${conflicts.map((c) => `${c.mmg_name} 已預定在 ${when(c)}`).join('\n')}\n\n${tail}`,
    confirmText: '取消',
    cancelText: null,
  });
}

/** 劇本撞期的提醒。可以放行，回傳 true 代表繼續。 */
function scriptConflictDialog(script, { tail, confirmText }) {
  return confirmDialog({
    title: '該場次時間衝突',
    body: `已預定場次時間為\n${script.map(when).join('\n')}\n\n${tail}`,
    confirmText,
    cancelText: '取消',
  });
}

/**
 * 主持人按確認之前的檢查。回傳 true 代表可以送出。
 *
 * 先擋自己撞期（不能放行），再問劇本撞期（可以放行）——被擋下來的時候
 * 就不必再問後面那個了，反正這一場他接不了。
 */
export async function hostMayConfirm(bookingId) {
  const data = await fetchConflicts(bookingId);
  if (!data) return true;

  const mine = data.hosts.filter((c) => c.is_me);
  if (mine.length) {
    await blockDialog('你有衝突場次', mine,
      '該場次未取消前你不能確認衝突場次，請通知管理員處理');
    return false;
  }

  if (data.script.length) {
    return scriptConflictDialog(data.script, {
      tail: '請通知管理員處理',
      confirmText: '依然確認',
    });
  }
  return true;
}

/**
 * 管理員按下儲存之前的檢查。回傳 true 代表可以送出。
 *
 * 兩層依序跑，共用同一次查詢：
 *   1. 劇本撞期——提醒，可以放行
 *   2. 主持人撞期——硬擋，不能放行
 * 順序是刻意的：擋得住的先問，擋不住的後擋，被擋下來時前面那題也已經
 * 問過了，使用者知道這一場總共有幾個問題。
 *
 * ★ 為什麼在「儲存」而不是在「切換狀態」或「打勾」的當下檢查：
 *   後兩者每互動一次就要打一次 API。目前後端跑在免費方案上，執行時間
 *   有限，把額度花在「使用者還在改、根本還沒決定送出」的中途狀態上不
 *   划算。一次儲存最多一次查詢，是這個限制下的取捨。
 *
 *   如果哪天換成付費方案，改成即時檢查是更好的體驗——勾下去就知道不
 *   行，不用等到按了儲存才被退回來。要改的話就是把這支拆回
 *   「切換狀態時查一次、打勾時查一次」，呼叫點在 admin.js 的狀態下拉
 *   與確認勾選框。
 */
export async function adminMaySave(bookingId) {
  const data = await fetchConflicts(bookingId);
  if (!data) return true;

  if (data.script.length) {
    const ok = await scriptConflictDialog(data.script, {
      tail: '請確保沒有衝突場次狀況發生',
      confirmText: '依然切換',
    });
    if (!ok) return false;
  }

  // 全部被指派的主持人都要查，不是只查這次動到的那一個——管理員可能
  // 一次改好幾格，只講其中一個會讓他改完再撞一次。
  if (data.hosts.length) {
    const names = [...new Set(data.hosts.map((c) => c.host_name))];
    await blockDialog(
      `${names.join('、')}有衝突場次`,
      data.hosts.map((c) => ({ ...c, mmg_name: `${c.host_name}：${c.mmg_name}` })),
      '該場次未取消前你不能確認衝突指定，請確認何者為正式場次',
    );
    return false;
  }
  return true;
}
