/**
 * 管理員改狀態之前的確認對話框：這次改動會牽動到哪些場次、哪些人。
 *
 * 後台改狀態本來就是人工介入，系統不擋；這裡做的是在送出之前把後果列出來，
 * 讓管理員知道自己在做什麼、還有哪些事要另外處理（案主 2026-11-10）。
 *
 * 查詢失敗一律放行並跳一則錯誤提示，跟 conflicts.js 同一個原則：提醒功能
 * 壞掉，不該連帶讓主要動作做不了。
 */

import { api } from './api.js';
import { confirmDialog, toast } from './ui.js';

// 一個對話框最多列幾筆。再多就講「還有 N 筆」——列幾十行的對話框會超出
// 手機畫面，而那時候管理員要的是「去場次管理處理」，不是在對話框裡讀完。
const MAX_LINES = 10;

const when = (b) => `${b.session_date.replace(/-/g, '/')} ${b.session_time}`;

function lines(items, fmt) {
  const shown = items.slice(0, MAX_LINES).map(fmt);
  if (items.length > MAX_LINES) shown.push(`…還有 ${items.length - MAX_LINES} 場`);
  return shown.join('\n');
}

async function fetchOrNull(path, what) {
  try {
    return await api.get(path);
  } catch (err) {
    toast(`${what}查詢失敗：${err.message}`, { error: true });
    return null;
  }
}

/**
 * 停用或停權一個人之前：他未來還有哪些場次。沒有就不問，直接回 true。
 * nextStatus 是 'deactive' 或 'banned'。
 */
export async function confirmUserBlock(userId, name, nextStatus) {
  const data = await fetchOrNull(`/api/admin/users/${userId}/future-bookings`, '未來場次');
  if (!data || (!data.as_gm.length && !data.as_player.length)) return true;

  const verb = nextStatus === 'banned' ? '停權' : '停用';
  const parts = [`${name || '這個人'}未來還有以下場次，${verb}不會改動它們：`];
  if (data.as_gm.length) {
    parts.push(`主持（${data.as_gm.length} 場）\n${lines(data.as_gm,
      (b) => `${when(b)}《${b.mmg_name}》${b.status_label} · 預訂者 ${b.player_name || '—'}`)}`);
  }
  if (data.as_player.length) {
    parts.push(`預訂（${data.as_player.length} 場）\n${lines(data.as_player,
      (b) => `${when(b)}《${b.mmg_name}》${b.status_label}`)}`);
  }
  // ★ 主持的那些要講清楚怎麼救：停用之後他登不進來，按不了確認，那些場次
  //   會一直停在原地，直到日期過了被系統自動取消。
  if (data.as_gm.length) parts.push('主持的場次請到場次管理改派主持人——他之後登不進來，按不了確認。');
  if (data.as_player.length) parts.push('預訂的場次請自行聯絡預訂者，或到場次管理取消。');

  return confirmDialog({
    title: `${verb}前請確認`,
    body: parts.join('\n\n'),
    confirmText: `仍要${verb}`,
    cancelText: '取消',
    danger: true,
  });
}

/** 下架一齣戲之前：它未來還有哪些場次。沒有就不問，直接回 true。 */
export async function confirmMmgDelist(mmgId, name) {
  const data = await fetchOrNull(`/api/admin/mmg/${mmgId}/future-bookings`, '未來場次');
  if (!data || !data.bookings.length) return true;

  return confirmDialog({
    title: '下架前請確認',
    body: [
      `《${name}》未來還有 ${data.bookings.length} 場預約：`,
      lines(data.bookings, (b) => `${when(b)} ${b.status_label} · 預訂者 ${b.player_name || '—'}`),
      '下架之後玩家就訂不到這齣戲，但這些場次不會被取消，請自行聯絡或到場次管理處理。',
    ].join('\n\n'),
    confirmText: '仍要下架',
    cancelText: '取消',
    danger: true,
  });
}

/**
 * 把已取消的預約改回來之前：它會排第幾、誰會往後移。
 *
 * 只在「真的有人的序位被改到」或「這個時段會變成兩組成立」時才問；
 * 改回來剛好排在最後面、又沒撞到成立的場次，就不打擾（案主 2026-11-10）。
 */
export async function confirmRevive(bookingId, target) {
  const data = await fetchOrNull(`/api/admin/bookings/${bookingId}/revive`, '序位');
  if (!data) return true;

  const doubleBooked = target === 'booked' && data.booked.length > 0;
  if (!data.moved.length && !doubleBooked) return true;

  const parts = [`這筆會回到第 ${data.position} 序位。`];
  if (data.moved.length) {
    parts.push(`以下預約往後移一位：\n${data.moved
      .map((m) => `第 ${m.from} → 第 ${m.to} 序位：${m.player_name || '—'}（${m.status_label}）`)
      .join('\n')}`);
    if (data.moved.some((m) => m.status === 'booked')) {
      parts.push('已成立的那一組狀態不變，只是序位往後。');
    }
  }
  if (doubleBooked) {
    const who = data.booked.map((b) => `第 ${b.position} 序位 ${b.player_name || '—'}`).join('、');
    parts.push(`這個時段已經有成立的場次（${who}），改成已成立之後會有兩組同時成立。`);
  }

  return confirmDialog({
    title: '序位會變動',
    body: parts.join('\n\n'),
    confirmText: '仍要改回',
    cancelText: '取消',
    danger: doubleBooked,
  });
}

/**
 * 從別的狀態改回「待主持確認」之前：主持人的確認會全部取消，系統會寄信請他們
 * 重新確認（後端 bookings_admin.update 與 notify_events ⑩）。
 * gms 是 [{ name, role }]，已指定的那幾位。
 */
export function confirmReconfirm(gms) {
  const body = gms.length
    ? '改回「待主持確認」之後，主持人原本的確認會全部取消，'
      + `系統會寄信請以下主持人重新確認：\n\n${gms.map((g) => `${g.name}（${g.role}）`).join('\n')}`
      + '\n\n在他們重新確認之前，這筆預約不會成立。'
    : '改回「待主持確認」之後，這筆預約要等主持人確認才會成立，'
      + '但目前沒有指定任何主持人——請記得指定。';
  return confirmDialog({
    title: '改回待主持確認',
    body,
    confirmText: '確定改回',
    cancelText: '取消',
  });
}
