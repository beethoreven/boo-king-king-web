# boo-king-king-web

劇本殺預約系統前端。純靜態站：原生 ES modules，沒有框架、沒有 build step，
改完存檔重新整理就生效。

## 本機開發

```bash
python3 -m http.server 5173
```

然後開 **http://localhost:5173/**

在 localhost 開的頁面，API 預設打 `http://localhost:5001/v/<店家識別>`（店家識別是
`index.html` 的 `__BOO_KING_KING_VARIANT__`），後端照預設的 5001 起就不用帶任何參數。
後端在別的位址時用 `?apiBase=` 覆寫，值要自己帶上 `/v/<店家識別>`：

```
http://localhost:5173/?apiBase=http://localhost:5002/v/tutor-arthur-demo
```

★ `?apiBase=` 與 `?googleClientId=` **只在本機有效**（主機名稱是 `localhost`、
  `127.0.0.1` 或 `[::1]`）。正式站不讀這兩個參數：網址參數是任何人都能寫進連結裡的，
  而這一頁會把登入憑證附在每個請求上。細節見 `js/api.js` 的 `devParam`。

後端要另外起，見 boo-king-king-backend 的 README。

## 測試

```bash
node --test
```

用 Node 內建的測試執行器，不必安裝任何套件（在 Node 24 上跑過）。`tests/` 底下：

- `dev-params.test.mjs`：上面那條「只在本機有效」。
- `site-config.test.mjs`：`index.html`、`_headers`、`.assetsignore` 三份對得上。每條店家分支的
  `index.html` 不一樣，所以每條分支都要跑。
- `doc-pages.test.mjs`：`privacy.html`、`terms.html` 自己的 meta CSP 有該有的限制，也沒有擋到
  頁面自己要載入的東西。

★ 這個 repo 沒有 `package.json`，Node 是從語法判斷 `js/` 底下的檔案是 ES module。
  把這個判斷關掉（`--no-experimental-detect-module`）實測會在載入那一步就失敗，
  所以沒有這個判斷的舊版 Node 跑不了這組測試。

## 檔案結構

`js/` 底下一個檔案一件事，刻意不合併成單一 script：

| 檔案 | 負責 |
|---|---|
| `api.js` | 唯一的 fetch 出口，統一處理 token 與 401/403 |
| `auth.js` | Google 登入按鈕與 session 建立 |
| `ui.js` | 共用元件：`el` / `select` / `field` / `toast` / 對話框 |
| `booking.js` | 玩家預約畫面 |
| `gm.js` | 主持人介面（待確認／已確認／已結束） |
| `admin.js` | 管理員介面（劇本／場次／使用者） |
| `main.js` | 外殼與畫面切換 |
| `route.js` | 網址路由（`?view=&tab=&sub=`）與網址名稱對照表 |

## 兩條硬規則

**DOM 一律用 `createElement` + `textContent` 建，不要 `innerHTML` + 字串樣板。**
劇本名稱、玩家姓名、備註都是使用者可控的內容，字串拼接等於開 XSS。

**輸入類元件要持久化,不能每次 render 都重建。**
`clear(root)` 把節點移出文件的瞬間，瀏覽器就撤銷焦點；`<input type="date">`
的年/月/日是三段式，使用者還在打「日」的時候 change 就已經觸發過了，此時重建
節點會讓他永遠打不完最後一段。詳見 `booking.js` 開頭的註解。
