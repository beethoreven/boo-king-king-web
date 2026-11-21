// index.html、_headers、.assetsignore 三份要對得上（理由見 _headers 開頭）。
//
//     node --test          （在 repo 根目錄；不必安裝任何套件）
//
// ★ 每條店家分支的 index.html 不一樣（店名、後端主機…），所以這組測試要在每一條分支上
//   都跑過：某條分支換了後端主機、_headers 卻沒跟著加，那家店的頁面就打不了任何 API，
//   而症狀只是畫面上的「Failed to fetch」。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(path.join(ROOT, name), 'utf8');
// 註解拿掉再看：註解裡寫到「<script>」這幾個字不是標籤。
const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');

function policy() {
  const line = read('_headers').split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:'));
  assert.ok(line, '_headers 裡找不到 Content-Security-Policy');
  const directives = {};
  for (const part of line.split(':').slice(1).join(':').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name] = sources;
  }
  return directives;
}

function siteConfig() {
  const match = html.match(/<script type="application\/json" id="site-config">([\s\S]*?)<\/script>/);
  assert.ok(match, 'index.html 裡找不到 id="site-config" 的 JSON 設定');
  return JSON.parse(match[1]);
}

function allowedBy(sources, url) {
  return sources.some((s) => s.startsWith('https://') && (url === s || (s.endsWith('/') && url.startsWith(s))));
}

test('index.html 裡沒有會執行的行內 script（CSP 會擋下）', () => {
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(attrs)) {
      assert.equal(body.trim(), '', `有 src 的 <script> 不該再有內容：${attrs}`);
    } else {
      assert.match(attrs, /type="application\/json"/, `行內 <script${attrs}> 會被 CSP 擋下`);
    }
  }
});

test('設定的四個值都在，而且是字串', () => {
  const config = siteConfig();
  for (const key of ['__BOO_KING_KING_SITE_NAME__', '__BOO_KING_KING_API_HOST__',
                     '__BOO_KING_KING_VARIANT__', '__GOOGLE_CLIENT_ID__']) {
    assert.equal(typeof config[key], 'string', key);
  }
});

test('這家店的後端主機在 connect-src 與 img-src 裡', () => {
  const host = new URL(siteConfig().__BOO_KING_KING_API_HOST__).origin;
  const csp = policy();
  assert.ok(csp['connect-src'].includes(host), `connect-src 沒有 ${host}：頁面打不了 API`);
  assert.ok(csp['img-src'].includes(host), `img-src 沒有 ${host}：簡介頁的圖載不出來`);
});

test('程式只能從自己與 Google 登入元件來，而且不准行內程式', () => {
  const csp = policy();
  assert.ok(!csp['script-src'].includes("'unsafe-inline'"));
  assert.ok(!csp['script-src'].includes("'unsafe-eval'"));
  for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    assert.ok(src.startsWith('/') || allowedBy(csp['script-src'], src), `script-src 沒有放行 ${src}`);
  }
});

test('外部樣式表在 style-src 裡、字型在 font-src 裡', () => {
  const csp = policy();
  for (const [, href] of html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) {
    if (href.startsWith('/')) continue;
    const origin = new URL(href).origin;
    assert.ok(csp['style-src'].includes(origin), `style-src 沒有 ${origin}`);
  }
  if (html.includes('fonts.googleapis.com')) {
    assert.ok(csp['font-src'].includes('https://fonts.gstatic.com'));
  }
});

test('.assetsignore 擋掉不該變成公開網址的檔案', () => {
  const ignored = read('.assetsignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const name of ['.git', 'README.md', 'wrangler.jsonc', 'tests']) {
    assert.ok(ignored.includes(name), `.assetsignore 少了 ${name}`);
  }
});
