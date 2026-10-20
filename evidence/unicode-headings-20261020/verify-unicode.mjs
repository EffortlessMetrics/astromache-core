import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, symlink, realpath } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Disposable control: never modifies either source checkout or held PR candidate.
const evidence = dirname(fileURLToPath(import.meta.url));
const checkout = resolve(process.argv[2]);
const require = createRequire(join(checkout, 'package.json'));
const { chromium } = require('@playwright/test');
const fixture = join(evidence, 'fixture');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const variants = [
  { name: 'main', commit: '219278c7b275755e1b69636c1f7b88466c0658e7', path: join(checkout, 'packages/astromache/src/Article.astro') },
  { name: 'pr28', commit: '967124eaec4247e6c7375e5d876a02d6639f0822', path: join(evidence, 'Article-pr28.astro') },
];
// Expected strings are literal observations to test, not a second slugger implementation.
const headings = [
  [2, '中文 标题', '中文-标题'],
  [3, '日本語の見出し', '日本語の見出し'],
  [4, '한국어 제목', '한국어-제목'],
  [5, 'Привет мир', 'привет-мир'],
  [6, 'مرحبا بالعالم', 'مرحبا-بالعالم'],
  [2, 'नमस्ते दुनिया', 'नमस्ते-दुनिया'],
  [2, 'ภาษาไทย', 'ภาษาไทย'],
  [2, 'Café', 'café'],
  [2, 'Cafe\u0301', 'cafe\u0301'],
  [2, 'CAFÉ', 'café-1'],
  [2, 'CAFE\u0301', 'cafe\u0301-1'],
  [2, '東京', '東京'],
  [2, '東京', '東京-1'],
  [2, '東京-1', '東京-1-1'],
  [2, '東京', '東京-2'],
  [2, 'A\u030a', 'a\u030a'],
  [2, 'a\u0323\u0301', 'a\u0323\u0301'],
  [2, 'a\u0301\u0323', 'a\u0301\u0323'],
  [2, '한글', '한글'],
  [2, '\u1112\u1161\u11ab\u1100\u1173\u11af', '\u1112\u1161\u11ab\u1100\u1173\u11af'],
  [2, 'İstanbul', 'i\u0307stanbul'],
  [2, 'ΟΣ', 'ος'],
  [2, 'ASCII Control', 'ascii-control'],
  [2, '😀', ''],
  [2, '😀', '-1'],
  [2, '!!!', '-2'],
];
const results = { observedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, astro: require('astro/package.json').version, playwright: require('@playwright/test/package.json').version, variants, headings, cases: [], normalizationControls: [], emptyIdControls: [], boundaryControls: [] };
let browser, server;
await mkdir(join(fixture, 'src/pages'), { recursive: true });
await mkdir(join(fixture, 'src/components'), { recursive: true });
try { await symlink(await realpath(join(checkout, 'node_modules')), join(fixture, 'node_modules'), 'dir'); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await writeFile(join(fixture, 'package.json'), JSON.stringify({ type: 'module' }));
await writeFile(join(fixture, 'src/headings.md'), headings.map(([depth, text]) => `${'#'.repeat(depth)} ${text}\n\nA disposable Unicode navigation control.\n`).join('\n'));
await writeFile(join(fixture, 'src/emoji.md'), '## 😀\n\nFirst symbol-only heading.\n\n## 😀\n\nRepeated symbol-only heading.\n');
await writeFile(join(fixture, 'src/punctuation.md'), '## !!!\n\nFirst punctuation-only heading.\n\n## !!!\n\nRepeated punctuation-only heading.\n');
for (const variant of variants) {
  const source = await readFile(variant.path);
  variant.sourceSHA256 = sha256(source);
  await writeFile(join(fixture, `src/components/Article-${variant.name}.astro`), source);
  await writeFile(join(fixture, `src/pages/${variant.name}.astro`), `---
import Article from '../components/Article-${variant.name}.astro';
import { Content, getHeadings } from '../headings.md';
const headings = getHeadings();
---
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/><title>Disposable Unicode control</title><style>body{margin:20px}h2,h3,h4,h5,h6{min-height:160px;scroll-margin:5px}.heading-link{opacity:1!important}footer{height:900px}</style></head><body><main><Article title="Unicode controls" published={{datetime:'2026-10-20',label:'October'}}><Content/></Article></main><script id="compiled-headings" type="application/json" set:html={JSON.stringify(headings)}/><footer/></body></html>`);
  for (const kind of ['emoji', 'punctuation', 'explicit']) {
    await writeFile(join(fixture, `src/pages/${variant.name}-${kind}.astro`), `---
import Article from '../components/Article-${variant.name}.astro';
${kind === 'explicit' ? '' : `import { Content } from '../${kind}.md';`}
---
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/><title>Empty-ID boundary</title><style>h2{min-height:250px}header{height:900px}footer{height:900px}.heading-link{opacity:1!important}</style></head><body><header/><main><Article title="Boundary control" published={{datetime:'2026-10-20',label:'October'}}>${kind === 'explicit' ? '<h2 id="emoji-😀">😀</h2><h2 id="punctuation">!!!</h2>' : '<Content/>'}</Article></main><footer/></body></html>`);
  }
}
try {
  execFileSync(process.execPath, [join(dirname(require.resolve('astro/package.json')), 'bin/astro.mjs'), 'build'], { cwd: fixture, stdio: 'inherit', timeout: 60000, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = join(fixture, 'dist', pathname.endsWith('/') ? pathname + 'index.html' : pathname);
      response.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  browser = await chromium.launch();
  results.browser = browser.version();
  for (const variant of variants) {
    const url = `http://127.0.0.1:${server.address().port}/${variant.name}/?control=unicode`;
    for (const width of [1440, 390, 280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      page.setDefaultTimeout(4000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('.heading-link'));
      const inventory = await page.locator('[data-article-body] :is(h2,h3,h4,h5,h6)').evaluateAll((elements) => elements.map((heading) => ({ id: heading.id, tag: heading.tagName, links: heading.querySelectorAll('.heading-link').length, label: heading.querySelector('.heading-link')?.getAttribute('aria-label') })));
      const compiled = await page.locator('#compiled-headings').textContent().then(JSON.parse);
      assert.deepEqual(inventory.map((heading) => heading.id), headings.map((heading) => heading[2]));
      assert.deepEqual(compiled.map((heading) => heading.slug), headings.map((heading) => heading[2]));
      assert.equal(new Set(inventory.map((heading) => heading.id)).size, headings.length);
      assert.ok(inventory.every((heading) => heading.links === 1));
      for (const [index, [depth, text, id]] of headings.entries()) {
        if (!id) continue;
        const row = { variant: variant.name, width, index, depth, text, id, pass: false };
        try {
          await page.goto(url);
          const link = page.locator('[data-article-body] :is(h2,h3,h4,h5,h6)').nth(index).locator('.heading-link');
          await link.waitFor();
          row.href = await link.getAttribute('href');
          assert.equal(decodeURIComponent(row.href.slice(1)), id);
          assert.equal(await link.getAttribute('aria-label'), 'Link to ' + text);
          await link.focus();
          await page.keyboard.press('Enter');
          await page.waitForFunction((wanted) => document.querySelector(':target')?.id === wanted, id);
          row.click = await page.evaluate(() => ({ target: document.querySelector(':target')?.id, hash: location.hash, search: location.search, top: document.querySelector(':target')?.getBoundingClientRect().top }));
          assert.equal(decodeURIComponent(row.click.hash.slice(1)), id);
          assert.equal(row.click.search, '?control=unicode');
          // Native fragment scrolling rounds scrollY; tolerate <1 CSS px at the top.
          assert.ok(row.click.top >= -1 && row.click.top < 844);
          await page.goto(url + '#' + encodeURIComponent(id));
          await page.waitForFunction((wanted) => document.querySelector(':target')?.id === wanted, id);
          row.deepLink = await page.evaluate(() => ({ target: document.querySelector(':target')?.id, hash: location.hash, top: document.querySelector(':target')?.getBoundingClientRect().top }));
          assert.ok(row.deepLink.top >= -1 && row.deepLink.top < 844);
          row.pass = true;
        } catch (error) { row.error = error.message; }
        results.cases.push(row);
      }
      // Deliberately normalize a fragment: exact IDs must not collapse to visual equivalents.
      for (const [original, normalized, target] of [
        ['cafe\u0301', 'café', 'café'],
        ['a\u030a', 'å', null],
        ['a\u0323\u0301', 'ạ\u0301', null],
        ['a\u0301\u0323', 'ạ\u0301', null],
        ['\u1112\u1161\u11ab\u1100\u1173\u11af', '한글', '한글'],
      ]) {
        assert.equal(original.normalize('NFC'), normalized.normalize('NFC'));
        await page.goto(url + '#' + encodeURIComponent(normalized));
        const actual = await page.evaluate(() => document.querySelector(':target')?.id ?? null);
        results.normalizationControls.push({ variant: variant.name, width, original, normalized, expectedTarget: target, actual, pass: actual === target });
      }
      await page.goto(url);
      const empty = page.locator('[data-article-body] :is(h2,h3,h4,h5,h6)').nth(23).locator('.heading-link');
      await empty.waitFor();
      const href = await empty.getAttribute('href');
      await empty.focus();
      await page.keyboard.press('Enter');
      const actual = await page.evaluate(() => ({ target: document.querySelector(':target')?.id ?? null, hash: location.hash, top: window.scrollY }));
      results.emptyIdControls.push({ variant: variant.name, width, id: '', text: '😀', href, ...actual, unresolved: actual.target === null });
      for (const [kind, expectedIds] of [['emoji', ['', '-1']], ['punctuation', ['', '-1']], ['explicit', ['emoji-😀', 'punctuation']]]) {
        for (const [index, expectedId] of expectedIds.entries()) {
          await page.goto(`http://127.0.0.1:${server.address().port}/${variant.name}-${kind}/`);
          const heading = page.locator('[data-article-body] h2').nth(index);
          const link = heading.locator('.heading-link');
          await link.waitFor();
          assert.equal(await heading.getAttribute('id'), expectedId);
          const href = await link.getAttribute('href');
          await link.focus();
          await page.keyboard.press('Enter');
          await page.waitForFunction((wanted) => (document.querySelector(':target')?.id ?? null) === wanted, expectedId || null);
          const actual = await page.evaluate(() => ({ target: document.querySelector(':target')?.id ?? null, hash: location.hash, top: window.scrollY }));
          const pass = actual.target === (expectedId || null) && (expectedId ? actual.top > 500 : actual.top === 0);
          results.boundaryControls.push({ variant: variant.name, width, kind, index, id: expectedId, href, ...actual, pass });
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  results.summary = { navigationPass: results.cases.filter((row) => row.pass).length, navigationTotal: results.cases.length, normalizationPass: results.normalizationControls.filter((row) => row.pass).length, normalizationTotal: results.normalizationControls.length, emptyUnresolved: results.emptyIdControls.filter((row) => row.unresolved).length, boundaryControlPass: results.boundaryControls.filter((row) => row.pass).length, boundaryControlTotal: results.boundaryControls.length };
  results.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results.summary));
  assert.ok(results.cases.every((row) => row.pass), 'Unicode navigation control failed');
  assert.ok(results.normalizationControls.every((row) => row.pass), 'Normalization boundary control failed');
  assert.ok(results.boundaryControls.every((row) => row.pass), 'Empty-ID causal control failed');
} finally {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
}
