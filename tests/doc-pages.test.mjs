// privacy.html、terms.html 各自的 meta CSP（理由見兩頁 <head> 開頭的註解）。
//
//     node --test          （在 repo 根目錄；不必安裝任何套件）
//
// CSP 擋到頁面自己要用的東西時，頁面不會壞得很明顯（字型退回系統字、圖不見），
// 只有 console 會說；所以這裡逐一比對頁面要載入的每個網址。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(path.join(ROOT, name), 'utf8');

function parse(text) {
  const directives = {};
  for (const part of text.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name] = sources;
  }
  return directives;
}

// 正式站每個回應都帶的 CSP 標頭（全站共用）。
function headerPolicy() {
  const line = read('_headers').split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:'));
  assert.ok(line, '_headers 裡找不到 Content-Security-Policy');
  return parse(line.split(':').slice(1).join(':'));
}

// 沒寫的指令退回 default-src（base-uri、form-action 不會退回，所以要另外寫）。
const sourcesFor = (csp, name) => csp[name] ?? csp['default-src'] ?? [];

const SELF = 'https://this-site.invalid';

function allows(sources, url) {
  const target = new URL(url, `${SELF}/`);
  if (target.origin === SELF) return sources.includes("'self'");  // 相對路徑＝本站
  return sources.some((s) => {
    if (!s.startsWith('https://')) return false;
    const source = new URL(s);
    if (source.origin !== target.origin) return false;
    if (!s.slice('https://'.length).includes('/')) return true;  // 只寫主機：整個主機都放行
    return source.pathname.endsWith('/') ? target.pathname.startsWith(source.pathname)
                                         : target.pathname === source.pathname;
  });
}

// 標籤裡某個屬性的值，不管屬性順序（這兩頁的屬性值一律用雙引號）。
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1];

// 頁面要載入的每個網址，配上管它的指令。
function resources(html) {
  const found = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(tag, 'rel');
    if (rel === 'stylesheet') found.push(['style-src', attr(tag, 'href')]);
    else if (rel === 'icon') found.push(['img-src', attr(tag, 'href')]);
    // preconnect 只是先連線、不載東西，CSP 不管。其他種類要先想清楚 CSP 哪一條管它。
    else assert.equal(rel, 'preconnect', `不認得的 ${tag}：先確定 CSP 哪一條管它，再加進這個測試`);
  }
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (attr(tag, 'src')) found.push(['script-src', attr(tag, 'src')]);
  }
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) found.push(['img-src', attr(tag, 'src')]);
  // Google Fonts 的樣式表會再去 fonts.gstatic.com 載字型檔。
  if (found.some(([, url]) => url?.startsWith('https://fonts.googleapis.com/'))) {
    found.push(['font-src', 'https://fonts.gstatic.com/s/']);
  }
  return found;
}

for (const page of ['privacy.html', 'terms.html']) {
  // 註解拿掉再看：註解裡寫到的標籤名稱不是標籤。
  const html = read(page).replace(/<!--[\s\S]*?-->/g, '');
  const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)];

  test(`${page}：有一份 meta CSP，排在所有載入資源的元素前面`, () => {
    assert.equal(metas.length, 1, '要有一份、而且只有一份 meta CSP');
    const first = html.search(/<(link|script|style|img)\b/);
    assert.ok(first === -1 || metas[0].index < first, 'meta 的 CSP 只管它後面的元素');
  });

  test(`${page}：該有的限制都在`, () => {
    const csp = parse(metas[0][1]);
    assert.deepEqual(csp['object-src'], ["'none'"]);
    assert.deepEqual(csp['base-uri'], ["'self'"]);
    assert.deepEqual(csp['form-action'], ["'self'"]);
    assert.ok(!('frame-ancestors' in csp), 'frame-ancestors 寫在 meta 裡無效，防內嵌靠 _headers');
    for (const name of ['script-src', 'style-src']) {
      assert.ok(!sourcesFor(csp, name).includes("'unsafe-inline'"), `${name} 不該有 'unsafe-inline'`);
    }
    assert.ok(!sourcesFor(csp, 'script-src').includes("'unsafe-eval'"));
  });

  test(`${page}：沒有行內程式與行內樣式（CSP 會擋下）`, () => {
    for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
      assert.ok(attr(tag, 'src'), `行內 ${tag}：改成外部檔案`);
    }
    assert.doesNotMatch(html, /<style\b/i, '<style> 區塊：寫進 style.css');
    assert.doesNotMatch(html, /\sstyle\s*=/i, 'style 屬性：改成 style.css 的 class');
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'onclick 這類屬性是行內程式');
  });

  test(`${page}：要載入的東西，meta 與 _headers 的 CSP 都有放行`, () => {
    const policies = { 'meta CSP': parse(metas[0][1]), '_headers 的 CSP': headerPolicy() };
    const found = resources(html);
    assert.ok(found.length > 0, '一個資源都沒找到：比對用的寫法可能跟頁面對不上了');
    for (const [directive, url] of found) {
      for (const [label, csp] of Object.entries(policies)) {
        assert.ok(allows(sourcesFor(csp, directive), url), `${label} 的 ${directive} 沒有放行 ${url}`);
      }
    }
  });
}
