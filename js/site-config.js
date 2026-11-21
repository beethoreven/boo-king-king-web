/**
 * 讀 index.html 裡那一段 JSON 設定（id="site-config"），放到 window 上給其他模組用
 * （window.__BOO_KING_KING_API_HOST__ 之類，讀的地方見 api.js、auth.js、main.js、intro.js）。
 *
 * ★ 這一支是一般的 <script>，不是 module，而且在 index.html 裡排在 main.js 前面：
 *   module 一律延後到整頁解析完才執行，所以 main.js 與它載入的每一支執行時，這些值
 *   都已經在了。
 * ★ 為什麼不直接在 index.html 寫一段 <script> 設定這些值：見 index.html 那段 JSON 上面
 *   的說明（Content-Security-Policy 不准行內程式）。
 * ★ JSON 寫錯（多一個逗號、少一個引號）會在主控台報錯，頁面打不了 API——壞得看得見，
 *   不會安靜地用錯的值。
 */
(() => {
  const KEYS = [
    '__BOO_KING_KING_SITE_NAME__',
    '__BOO_KING_KING_API_HOST__',
    '__BOO_KING_KING_VARIANT__',
    '__GOOGLE_CLIENT_ID__',
  ];
  const config = JSON.parse(document.getElementById('site-config').textContent);
  for (const key of KEYS) {
    if (typeof config[key] === 'string') window[key] = config[key];
  }
})();
