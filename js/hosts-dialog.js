/**
 * 「本場主持人」對話框。
 *
 * 三個畫面都要用（主持人介面、管理員的場次管理、玩家的我預定的場次），
 * 所以抽出來共用。各自寫一份的話，「未指定」跟「已/未確認」的措辭遲早
 * 會在某一個畫面走樣，而那正是使用者用來判斷「我的場次到底成立了沒」
 * 的資訊。
 */

import { api } from './api.js';
import { alertDialog, toast } from './ui.js';

/** 開啟某一筆預約的主持人明細。失敗時只跳 toast，不留下半開的對話框。 */
export async function showHosts(bookingId) {
  try {
    const d = await api.get(`/api/bookings/${bookingId}/detail`);
    const lines = d.gm_slots.map((s) => {
      const who = s.user_name || '（未指定）';
      const mark = s.confirmed ? '已確認' : '未確認';
      return `${s.role_name}：${who}（${mark}）`;
    });
    await alertDialog({
      title: '本場主持人',
      body: lines.length ? lines.join('\n') : '這齣戲沒有設定主持人角色',
    });
  } catch (err) {
    toast(err.message, { error: true });
  }
}
