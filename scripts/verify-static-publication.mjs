import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
const repository = await realpath(".");
const root = await realpath(await mkdtemp(join(tmpdir(), "astromache-publication-packed-")));
const manager = resolve("node_modules/pnpm/bin/pnpm.cjs");
const run = (args, cwd = root, env = {}) =>
  execFileSync(process.execPath, [manager, ...args], {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", ...env },
  });
const put = async (path, text) => {
  const target = join(root, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, text);
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  await mkdir(join(root, "archives"));
  run(
    ["pack", "--pack-destination", join(root, "archives")],
    join(repository, "packages/astromache"),
  );
  const archive = (await readdir(join(root, "archives"))).find((name) => name.endsWith(".tgz"));
  assert.ok(archive);
  const tarball = join(root, "archives", archive);
  await put(
    "package.json",
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          astro: "7.3.5",
          astromache: `file:${tarball}`,
          "@effortlessmetrics/astro-offline": `file:${join(repository, "vendor/effortlessmetrics-astro-offline-0.1.5.tgz")}`,
        },
        packageManager: "pnpm@10.28.0",
      },
      null,
      2,
    ),
  );
  await put("pnpm-workspace.yaml", "packages:\n  - .\n");
  run(["install", "--ignore-scripts", "--no-frozen-lockfile"]);
  run(["install", "--ignore-scripts", "--frozen-lockfile"]);
  const installed = await realpath(join(root, "node_modules/astromache"));
  const local = relative(root, installed);
  assert.ok(!local.startsWith("..") && !isAbsolute(local), "use an independent installed archive");
  const pkg = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  for (const name of ["./publication-head", "./static-publication", "./markdown-negotiation"])
    assert.ok(pkg.exports[name]);
  await put(
    "astro.config.mjs",
    `import {defineConfig} from 'astro/config';\nimport publication from 'astromache/static-publication';\nimport offline from 'astromache/static-offline';\nexport default defineConfig({site:'https://publication.example',output:'static',trailingSlash:'always',redirects:{'/old/':'/notes/public/'},integrations:[publication({origin:'https://publication.example',markdown:process.env.NO_MARKDOWN!=='1',sitemap:'sitemap.xml'}),offline({cachePrefix:'publishing-fixture-',workerFile:'sw.js',globPatterns:['**/*.{html,js,css,md,json}'],maxResources:100,maxBytes:5000000,maxFileBytes:2000000,maxHtmlBytes:256000,worker:{navigationFallback:'/offline/'}})]});\n`,
  );
  await put(
    "src/content.config.ts",
    `import {defineCollection,z} from 'astro:content';import {glob} from 'astro/loaders';export const collections={notes:defineCollection({loader:glob({pattern:'**/*.md',base:'./src/content/notes'}),schema:z.object({title:z.string(),draft:z.boolean().default(false),published:z.coerce.date()})})};`,
  );
  await put(
    "src/content/notes/public.md",
    '---\ntitle: "Public article"\npublished: 2020-01-01\n---\nExact **prose**.\n\n<!-- PRIVATE EDITORIAL COMMENT -->\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n```js\nif (a < b) run();\n```\n',
  );
  await put(
    "src/content/notes/draft.md",
    '---\ntitle: "PRIVATE DRAFT TITLE"\ndraft: true\npublished: 2020-01-01\n---\nPRIVATE DRAFT BODY\n',
  );
  await put(
    "src/content/notes/future.md",
    '---\ntitle: "PRIVATE FUTURE TITLE"\npublished: 9999-01-01\n---\nPRIVATE FUTURE BODY\n',
  );
  await put(
    "src/pages/notes/[...slug].astro",
    `---\nimport {getCollection,render} from 'astro:content';import Document from 'astromache/document';import Head from 'astromache/publication-head';\nexport async function getStaticPaths(){return (await getCollection('notes')).filter(n=>!n.data.draft&&n.data.published.getTime()<=Date.now()).map(note=>({params:{slug:note.id},props:{note}}));}\nconst {note}=Astro.props;const {Content}=await render(note);const canonical=new URL('/notes/'+note.id+'/',Astro.site);\n---\n<Document title={note.data.title} description="Fixture description" canonical={canonical} language="en"><Head slot="head" title={note.data.title} description="Fixture description" canonical={canonical} type="article" published={note.data.published} author={{name:'Fixture Editor'}} markdown={process.env.NO_MARKDOWN!=='1'}/><h1>{note.data.title}</h1><p data-publication-source>Fixture attribution.</p><article data-article-body><Content/></article></Document>`,
  );
  for (const name of ["index", "offline"])
    await put(
      `src/pages/${name}.astro`,
      `---\nimport Document from 'astromache/document';const canonical=new URL('${name === "index" ? "/" : "/offline/"}',Astro.site);\n---\n<Document title="Fixture" description="Fixture description" canonical={canonical} language="en"><h1>Fixture</h1><a href="/notes/public/">Public article</a></Document>`,
    );
  await put(
    "src/pages/custom.astro",
    `---\nconst markdown=process.env.NO_MARKDOWN!=='1';const noindex=process.env.NOINDEX_CUSTOM==='1';const media=process.env.MISSING_MEDIA==='1'?'/missing.mp4':'/recording.mp4';\n---\n<!doctype html><html lang="en"><head><title>Custom</title><meta name="DESCRIPTION" content="Custom rendered metadata"><meta property="og:type" content="website"><meta property="og:title" content="Custom"><meta property="og:description" content="Custom rendered metadata"><meta property="og:url" content="https://publication.example/custom/"><link rel="CANONICAL" href="https://publication.example/custom/">{markdown&&<link rel="ALTERNATE" type="TEXT/MARKDOWN" href="https://publication.example/_markdown/custom.md"/>}{noindex&&<meta name="ROBOTS" content="NOINDEX"/>}</head><body><h1>Custom</h1><article data-article-body><p>Case-preserved custom text.</p><aside style="display:none;color:red">HIDDEN INLINE SENTINEL</aside><video src={media} title="Fixture recording"></video><audio title="Nested recording"><source src={media}/></audio></article></body></html>`,
  );
  await put(
    "public/sitemap.xml",
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://publication.example/notes/public/</loc></url></urlset>',
  );
  await put("public/recording.mp4", "Fixture media bytes");
  await put("public/verification.html", "<html><head></head><body>Verification</body></html>");
  run(["exec", "astro", "build"]);
  const html = await readFile(join(root, "dist/notes/public/index.html"), "utf8");
  assert.match(html, /og:type.*article/);
  assert.match(await readFile(join(root, "dist/old/index.html"), "utf8"), /noindex/);
  assert.equal(
    await readFile(join(root, "dist/verification.html"), "utf8"),
    "<html><head></head><body>Verification</body></html>",
  );
  assert.match(html, /text\/markdown/);
  const md = await readFile(join(root, "dist/_markdown/notes/public.md"), "utf8");
  assert.match(md, /Exact \*\*prose\*\*/);
  assert.match(md, /Fixture attribution/);
  assert.match(md, /```js/);
  assert.doesNotMatch(md, /PRIVATE/);
  const report = JSON.parse(
    await readFile(join(root, "dist/_meta/astromache-publication.json"), "utf8"),
  );
  assert.equal(report.documents.length, 2);
  const customMarkdown = await readFile(join(root, "dist/_markdown/custom.md"), "utf8");
  assert.match(customMarkdown, /Case-preserved custom text/);
  assert.match(
    customMarkdown,
    /\[Fixture recording\]\(https:\/\/publication\.example\/recording\.mp4\)/,
  );
  assert.match(customMarkdown, /\[Nested recording\]/);
  assert.doesNotMatch(customMarkdown, /HIDDEN INLINE SENTINEL/);
  assert.equal(
    report.html.find((item) => item.path === "notes/public/index.html").sha256,
    sha(html),
  );
  assert.equal(
    report.documents.find((item) => item.canonical.endsWith("/notes/public/")).sha256,
    sha(md),
  );
  const offline = await readFile(join(root, "dist/offline-receipt.json"), "utf8");
  assert.match(offline, /_markdown\/notes\/public.md/);
  assert.doesNotMatch(offline, /draft|future/);
  for (const id of ["draft", "future"])
    await assert.rejects(readFile(join(root, `dist/notes/${id}/index.html`)), { code: "ENOENT" });
  const rejected = spawnSync(process.execPath, [manager, "exec", "astro", "build"], {
    cwd: root,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", NOINDEX_CUSTOM: "1" },
    encoding: "utf8",
  });
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  assert.match(rejected.stdout + rejected.stderr, /noindex/);
  await assert.rejects(readFile(join(root, "dist/_markdown/custom.md")), { code: "ENOENT" });
  const missingMedia = spawnSync(process.execPath, [manager, "exec", "astro", "build"], {
    cwd: root,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", MISSING_MEDIA: "1" },
    encoding: "utf8",
  });
  assert.equal(missingMedia.status, 1, missingMedia.stdout + missingMedia.stderr);
  assert.match(missingMedia.stdout + missingMedia.stderr, /Missing publication link target/);
  await assert.rejects(readFile(join(root, "dist/_markdown/custom.md")), { code: "ENOENT" });
  run(["exec", "astro", "build"], root, { NO_MARKDOWN: "1" });
  const disabled = await readFile(join(root, "dist/notes/public/index.html"), "utf8");
  assert.doesNotMatch(disabled, /text\/markdown/);
  await assert.rejects(readFile(join(root, "dist/_markdown/notes/public.md")), { code: "ENOENT" });
  const evidence = {
    package: pkg.version,
    archiveSha256: sha(await readFile(tarball)),
    node: process.version,
    checks: [
      "installed archive",
      "real Astro content rendering",
      "draft and future exclusion",
      "real GFM conversion",
      "metadata component compilation",
      "custom HTML keyword casing and noindex refusal",
      "embedded-media target checks and hidden inline exclusion",
      "HTML byte integrity",
      "offline manifest includes Markdown",
      "disabled clean rebuild",
    ],
  };
  await mkdir(join(repository, "publishing-evidence"), { recursive: true });
  await writeFile(
    join(repository, "publishing-evidence/packed-consumer.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("Packed static-publication qualification", JSON.stringify(evidence));
} finally {
  await rm(root, { recursive: true, force: true });
}
