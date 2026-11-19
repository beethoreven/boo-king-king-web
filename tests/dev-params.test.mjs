// ?apiBase= 與 ?googleClientId= 只在本機有效（理由見 js/api.js 的 devParam）。
//
//     node --test          （在 repo 根目錄；不必安裝任何套件）
//
// 兩種檢查，兩邊都要過：
//   行為——把模組載進一個假的瀏覽器環境，看請求實際送去哪裡（probe.mjs）。
//   寫法——掃 js/，沒有人繞過 devParam 自己讀這兩個參數。行為那一組只測得到
//          今天存在的模組；之後新加的檔案自己去讀參數，要靠這一條擋。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const JS = path.resolve(HERE, '../js');

// 別人寫進連結裡的值。主機與用戶端 ID 都是對方的。
const FOREIGN = '?apiBase=https://other-host.example&googleClientId=other-client-id';

function open(hostname, search = '') {
  const out = execFileSync(process.execPath, [path.join(HERE, 'probe.mjs'), hostname, search], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

// 這幾個都不是本機。後三個是「看起來像本機」的：判斷寫成「開頭是 localhost」
// 或「含有 127.0.0.1」的話，它們會被當成本機。
const NOT_LOCAL = [
  'eli.boo-king-king.workers.dev',
  'localhost.other-host.example',
  '127.0.0.1.other-host.example',
  'eli.localhost',
];

for (const hostname of NOT_LOCAL) {
  test(`${hostname}：帶了參數也照部署時的設定走`, () => {
    const page = open(hostname, FOREIGN);

    assert.deepEqual(
      page.requests.map((r) => r.url),
      ['https://backend.example/v/shop/auth/status'],
      '請求要送往 index.html 寫的後端，而且只有這一個請求',
    );
    assert.equal(page.requests[0].carriesToken, true, '送往自己後端的請求照常帶憑證');
    assert.equal(page.clientId, 'deployed-client-id');
  });
}

for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
  test(`${hostname}：參數照舊可以覆寫（本機開發）`, () => {
    const page = open(hostname, '?apiBase=http://localhost:9999&googleClientId=dev-client-id');

    assert.deepEqual(page.requests.map((r) => r.url), ['http://localhost:9999/auth/status']);
    assert.equal(page.clientId, 'dev-client-id');
  });
}

test('localhost 沒帶參數：打本機後端的預設位址，不打正式後端', () => {
  const page = open('localhost');

  assert.deepEqual(page.requests.map((r) => r.url), ['http://localhost:5001/v/shop/auth/status']);
  assert.equal(page.clientId, 'deployed-client-id');
});

test('js/ 底下沒有人繞過 devParam 自己讀這兩個參數', () => {
  // devParam('apiBase') 不會被這一條抓到——它前面沒有 .get。
  const direct = /\.get\(\s*['"`](apiBase|googleClientId)['"`]\s*\)/;
  const offenders = readdirSync(JS)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => direct.test(readFileSync(path.join(JS, name), 'utf8')));

  assert.deepEqual(offenders, [], '改用 api.js 的 devParam(...)，它只在本機回傳值');
});
