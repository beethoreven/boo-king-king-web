# booking-king-web

劇本殺預約系統前端。純靜態站：原生 ES modules，沒有框架、沒有 build step，
改完存檔重新整理就生效。

## 本機開發

```bash
python3 -m http.server 5173
```

然後開 **http://localhost:5173/?apiBase=http://localhost:5001**

`?apiBase=` 不能省。前端預設把 API 打到同一個 origin（正式環境是這樣沒錯），
本機開發時後端在 5001、前端在 5173，不覆寫的話請求會打到 5173 自己身上，
症狀是登入畫面卡住或整排 404——看起來像登入壞了，其實是打錯位址。

後端要另外起，見 booking-king-backend 的 README。

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
