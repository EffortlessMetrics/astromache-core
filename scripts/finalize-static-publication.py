from pathlib import Path
import json
import subprocess
root = Path.cwd()
p = root / 'packages/astromache/package.json'
j = json.loads(p.read_text()); j['version'] = '0.3.0-publishing.1'; p.write_text(json.dumps(j, indent=2) + '\n')
p = root / 'packages/astromache/src/publishing/index.mjs'
s = p.read_text().replace('relative, resolve, dirname, sep', 'relative, resolve, dirname, sep, isAbsolute')
s = s.replace('if (rel === ".." || rel.startsWith(".." + sep) || resolve(target) === resolve(root))', 'if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep) || resolve(target) === resolve(root))')
s = s.replace('  const origin = httpURL(options.origin).origin;\n  return {', '''  const suppliedOrigin = httpURL(options.origin);
  if (suppliedOrigin.pathname !== "/" || suppliedOrigin.search || suppliedOrigin.hash) throw new TypeError("Publication origin must not contain a path, query or fragment");
  if (options.markdown !== undefined && typeof options.markdown !== "boolean") throw new TypeError("markdown must be a boolean");
  if (options.renderedSearch && !options.searchIndex) throw new TypeError("renderedSearch requires searchIndex");
  const origin = suppliedOrigin.origin;
  return {'''); p.write_text(s)
p = root / 'scripts/verify-packed-consumers.mjs'
s = p.read_text().replace('  "src/search.css",', '''  "src/search.css",
  "src/PublicationHead.astro",
  "src/publishing/index.d.ts",
  "src/publishing/index.mjs",
  "src/publishing/metadata.d.mts",
  "src/publishing/metadata.mjs",
  "src/publishing/negotiation.d.ts",
  "src/publishing/negotiation.mjs",
  "src/publishing/rendered.mjs",'''); p.write_text(s)
p = root / 'packages/astromache/src/publishing/negotiation.mjs'
s = p.read_text().replace('  const entries = accept.toLowerCase()', '  let malformed = false;\n  const entries = accept.toLowerCase()')
s = s.replace('if (!/^q=(?:0(?:\\.\\d{0,3})?|1(?:\\.0{0,3})?)$/.test(param)) return { type, q: 0 };', 'if (!/^q=(?:0(?:\\.\\d{0,3})?|1(?:\\.0{0,3})?)$/.test(param)) { malformed = true; return { type, q: 0 }; }')
s = s.replace('  const quality = (type) => {', '  if (malformed) return false;\n  const quality = (type) => {')
s = s.replace('request.headers.has("authorization") || request.headers.has("cookie") ||\n      !prefersMarkdown(request.headers.get("accept") ?? "")) return fetchAsset(request);', 'request.headers.has("authorization") || request.headers.has("cookie")) return fetchAsset(request);')
s = s.replace('  try {\n    const target = markdownURL', '  try {\n    if (prefersMarkdown(request.headers.get("accept") ?? "")) {\n    const target = markdownURL')
s = s.replace('response = undefined;\n  } catch', 'response = undefined;\n    }\n  } catch'); p.write_text(s)
p = root / 'scripts/publishing-contract.test.mjs'
s = p.read_text().replace('["text/markdown;q=1,text/html;q=.5", true]', '["text/markdown;q=1,text/html;q=.5", false]')
s += '''

test("HTML requests carry the same variant boundary as negotiated Markdown", async () => {
  let count = 0;
  const response = await negotiateMarkdown(new Request("https://example.test/a/", { headers: { accept: "text/html" } }), async (request) => {
    count++; assert.equal(new URL(request.url).pathname, "/a/");
    return new Response("HTML", { headers: { "content-type": "text/html", "cache-control": "public, max-age=3600" } });
  });
  assert.equal(count, 1); assert.equal(response.headers.get("vary"), "Accept");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
'''; p.write_text(s)
p = root / 'package.json'; j = json.loads(p.read_text()); j['scripts']['verify:publication:static'] = 'node --test scripts/publishing-*.test.mjs'; j['scripts']['verify:publication:packed'] = 'node scripts/verify-static-publication.mjs'; j['scripts']['qualify'] += ' && pnpm verify:publication:static'; p.write_text(json.dumps(j, indent=2) + '\n')
p = root / 'packages/astromache/README.md'; s = '''# Static publication candidate 0.3.0-publishing.1

This unpublished candidate adds `astromache/publication-head`,
`astromache/static-publication` and `astromache/markdown-negotiation`.
See [the static publishing guide](STATIC-PUBLICATION.md).
The integration emits Markdown from rendered public bodies at build time and
checks discovery outputs before offline hashing. It never rewrites emitted HTML.
The optional negotiation helper is not installed automatically.

The sections below retain the previous 0.2.x and original published contracts;
they do not identify this candidate as released or approve deployment.

''' + p.read_text(); p.write_text(s)
p = root / 'README.md'; s = p.read_text().replace('Version **0.2.13** is an unpublished repair candidate;', 'Version **0.3.0-publishing.1** is an unpublished static-publication candidate;'); s += '''

## Static publication output

The new publishing capability and optional host adapter are described in
[the static publishing guide](packages/astromache/STATIC-PUBLICATION.md).
`pnpm verify:publication:static` runs real parser, filesystem, metadata and
negotiation controls. `pnpm verify:publication:packed` independently installs
an archive and builds real Astro content with the offline integration.
'''; p.write_text(s)
p = root / 'packages/astromache/CHANGELOG.md'; p.write_text('''## 0.3.0-publishing.1 — unpublished

- Add reusable social metadata and Markdown discovery without replacing existing document APIs.
- Generate static Markdown from marked rendered content, preserve Shiki language fences, and reject unsupported lossy rich content.
- Reconcile sitemap/RSS/search references with emitted canonicals; optionally derive search text from rendered bodies before offline hashing.
- Add explicit HTML-fallback negotiation helper. No Worker route or hosting security setting is installed.
- Preserve original HTML bytes, detect output/path collisions, and qualify disabled clean rebuilds with actual Astro and independent archives.

''' + p.read_text())
format_paths = ["packages/astromache/src/PublicationHead.astro", "packages/astromache/src/publishing", "scripts/publishing-contract.test.mjs", "scripts/publishing-rendered.test.mjs", "scripts/publishing-fidelity.test.mjs", "scripts/verify-static-publication.mjs", "scripts/verify-packed-consumers.mjs", "packages/astromache/package.json", "package.json", "README.md", "packages/astromache/README.md", "packages/astromache/CHANGELOG.md", "packages/astromache/STATIC-PUBLICATION.md", ".github/workflows/qualification.yml"]
def format_files():
    subprocess.run(["node", "node_modules/pnpm/bin/pnpm.cjs", "exec", "vp", "fmt", *format_paths], check=True)
format_files()
p = Path('packages/astromache/package.json'); j = json.loads(p.read_text()); j['files'].append('STATIC-PUBLICATION.md'); p.write_text(json.dumps(j, indent=2) + '\n')
p = Path('scripts/verify-packed-consumers.mjs'); s = p.read_text().replace('  "CHANGELOG.md",', '  "CHANGELOG.md",\n  "STATIC-PUBLICATION.md",'); p.write_text(s)
p = Path('.github/workflows/qualification.yml'); s = p.read_text().replace('      - name: Independent packed consumers', '      - name: Installed static publication consumer\n        run: pnpm verify:publication:packed\n      - name: Independent packed consumers'); p.write_text(s)
for file, needle in [('packages/astromache/src/publishing/metadata.mjs', '    /[\\u0000'), ('packages/astromache/src/publishing/index.mjs', '  if (parts.some')]:
    p = Path(file); s = p.read_text(); s = s.replace(needle, '    // eslint-disable-next-line no-control-regex -- Reject invalid public metadata and path control bytes.\n' + needle if 'metadata' in file else '  // eslint-disable-next-line no-control-regex -- Reject path control bytes before filesystem access.\n' + needle); p.write_text(s)
p = Path('packages/astromache/src/publishing/metadata.mjs'); s = p.read_text().replace('  const alternate = input.markdown ?', '''  const body = input.body ?? "marked";
  if (!["marked", "main"].includes(body)) throw new TypeError("Publication body must be marked or main");
  const alternate = input.markdown ?''').replace('    alternate,\n', '    alternate,\n    body,\n'); p.write_text(s)
p = Path('packages/astromache/src/PublicationHead.astro'); s = p.read_text().replace('{meta.alternate && <link rel="alternate" type="text/markdown" href={meta.alternate} />}', '{meta.alternate && <>\n  <link rel="alternate" type="text/markdown" href={meta.alternate} />\n  <meta name="astromache:body" content={meta.body} />\n</>}'); p.write_text(s)
p = Path('packages/astromache/src/publishing/index.d.ts'); s = p.read_text().replace('  markdown?: boolean;', '  markdown?: boolean;\n  body?: "marked" | "main";', 1).replace('  renderedSearch?: boolean;', '  renderedSearch?: boolean;\n  /** Exact same-origin routes served by the host rather than emitted as files. */\n  externalRoutes?: readonly string[];').replace('  alternate?: string;', '  alternate?: string;\n  body: "marked" | "main";'); p.write_text(s)
p = Path('packages/astromache/src/publishing/rendered.mjs'); s = p.read_text().replace('    noindex: /', '    bodyMode: meta(head, "astromache:body") ?? "marked",\n    noindex: /')
s = s.replace('function clean(node, canonical, assets) {', '''function selectedBody(document) {
  if (!["marked", "main"].includes(document.bodyMode)) throw new Error("Unsupported publication body mode");
  return one(visibleElements(document.tree, document.bodyMode === "main"
    ? (node) => node.tagName === "main"
    : (node) => has(node, "dataArticleBody") || has(node, "dataPublicationBody")), "visible publication body");
}
function clean(node, canonical, assets, links, skip) {
  if (node === skip) return undefined;''')
s = s.replace('clean(n, canonical, assets)', 'clean(n, canonical, assets, links, skip)').replace('    if (node.tagName === "img") {', '    if (node.tagName === "a" && properties.href && /^https?:/i.test(properties.href)) links.add(properties.href);\n    if (node.tagName === "img") {')
s = s.replace('  const bodies = visibleElements(\n    tree,\n    (n) => has(n, "dataArticleBody") || has(n, "dataPublicationBody"),\n  );\n  const body = one(bodies, "visible publication body");', '  const body = selectedBody(document);').replace('  const assets = new Set();', '  const assets = new Set();\n  const links = new Set();')
s = s.replace('  const cleaned = clean(', '  const heading = visibleElements(tree, (n) => n.tagName === "h1");\n  const title = heading.length === 1 ? renderedText(heading[0]) : document.title;\n  const cleaned = clean(')
s = s.replace('    assets,\n  );\n  const heading = visibleElements(tree, (n) => n.tagName === "h1");\n  const title = heading.length === 1 ? text(heading[0]) : document.title;', '    assets,\n    links,\n    document.bodyMode === "main" && heading.length === 1 ? heading[0] : undefined,\n  );').replace('    assets: [...assets],', '    assets: [...assets],\n    links: [...links],')
start = s.index('export function publicationText(document) {'); walk = s.index('  const walk = (node) => {', start)
s = s[:start] + 'export function publicationText(document) {\n  return renderedText(selectedBody(document));\n}\nfunction renderedText(body) {\n' + s[walk:]; p.write_text(s)
p = Path('packages/astromache/src/publishing/index.mjs'); s = p.read_text().replace('readDocument, renderedPublication, publicationText', 'readDocument, renderedPublication, publicationText, elements')
old = '''  const resolves = (url) => {
    const path = localPath(url, origin);
    return (
      path !== undefined &&
      (inventory.includes(path) ||
        inventory.includes(path.replace(/\\/$/, "") + "/index.html") ||
        (path === "" && inventory.includes("index.html")) ||
        inventory.includes(path + ".html"))
    );
  };'''
new = '''  const targetPath = (url) => {
    const path = localPath(url, origin);
    if (path === undefined) return undefined;
    return [path, path.replace(/\\/$/, "") + "/index.html", ...(path === "" ? ["index.html"] : []), path + ".html"].find((candidate) => inventory.includes(candidate));
  };
  const resolves = (url) => targetPath(url) !== undefined;'''
assert old in s; s = s.replace(old, new)
needle = '    planned.set(path, rendered.markdown);'
s = s.replace(needle, '''    for (const link of rendered.links) {
      const url = new URL(link);
      if (url.origin !== origin) continue;
      if ((options.externalRoutes ?? []).includes(url.pathname)) continue;
      const target = targetPath(url);
      if (!target) throw new Error(`Missing publication link target: ${link}`);
      const fragment = decodeURIComponent(url.hash.slice(1).split(":~:")[0]);
      if (fragment && target.endsWith(".html")) {
        const targetDocument = documents.find((entry) => entry.path === target)?.document;
        if (!targetDocument || !elements(targetDocument.tree, (node) => String(node.properties?.id ?? "") === fragment || (node.tagName === "a" && String(node.properties?.name ?? "") === fragment)).length) {
          throw new Error(`Missing publication fragment: ${link}`);
        }
      }
    }
''' + needle)
s = s.replace('  const origin = suppliedOrigin.origin;', '  if (options.externalRoutes !== undefined && (!Array.isArray(options.externalRoutes) || options.externalRoutes.some((path) => typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || new URL(path, suppliedOrigin).pathname !== path))) throw new TypeError("externalRoutes requires exact root-relative paths");\n  const origin = suppliedOrigin.origin;'); p.write_text(s)
p = Path('scripts/publishing-fidelity.test.mjs'); s = p.read_text(); s += '''

test("main-body publication exports the page without duplicating its heading", () => {
  const page = document('<p>Home contents</p>');
  page.bodyMode = "main";
  const body = page.tree.children.find(node => node.tagName === "html").children.find(node => node.tagName === "body");
  body.children = [{type:"element",tagName:"main",properties:{},children:body.children}];
  const md = renderedPublication(page).markdown;
  assert.equal(md.match(/^# Article$/gm)?.length, 1);
  assert.match(md, /Home contents/);
});
test("hidden title descendants are not copied into Markdown", () => {
  const page = document('<p>Content</p>');
  const body = page.tree.children.find(node => node.tagName === "html").children.find(node => node.tagName === "body");
  body.children.find(node => node.tagName === "h1").children.push({type:"element",tagName:"span",properties:{hidden:true},children:[{type:"text",value:"SECRET"}]});
  assert.doesNotMatch(renderedPublication(page).markdown, /SECRET/);
});
'''; p.write_text(s)
p = Path('scripts/publishing-rendered.test.mjs'); s = p.read_text(); s += '''

test("body links and fragments are checked against actual output", () => fixture(async (root) => {
  await writeFile(join(root, "article/index.html"), page('<h2 id="part">Part</h2><a href="#part">Good</a><a href="https://elsewhere.example/">External</a>'));
  await auditPublication(root, options);
  await writeFile(join(root, "article/index.html"), page('<a href="#missing">Bad fragment</a>'));
  await assert.rejects(auditPublication(root, options), /Missing publication fragment/);
  await writeFile(join(root, "article/index.html"), page('<a href="/unpublished/">Bad route</a>'));
  await assert.rejects(auditPublication(root, options), /Missing publication link target/);
}));
'''; p.write_text(s)
format_files()
