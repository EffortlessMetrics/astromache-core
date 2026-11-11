import { lstat, mkdir, readFile, readdir, writeFile, realpath } from "node:fs/promises";
import { relative, resolve, dirname, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import { readDocument, renderedPublication, publicationText, elements } from "./rendered.mjs";
import { httpURL } from "./metadata.mjs";
export { publicationHead, markdownURL, jsonForHTML } from "./metadata.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipt = "_meta/astromache-publication.json";
async function files(root, prefix = "") {
  const result = [];
  for (const item of await readdir(resolve(root, prefix), { withFileTypes: true })) {
    const name = prefix ? prefix + "/" + item.name : item.name;
    if (item.isSymbolicLink())
      throw new Error(`Publication output must not contain symlinks: ${name}`);
    if (item.isDirectory()) result.push(...(await files(root, name)));
    else if (item.isFile()) result.push(name);
  }
  return result.sort();
}
function localPath(url, origin) {
  const parsed = httpURL(url);
  if (parsed.origin !== origin) return undefined;
  const parts = parsed.pathname
    .split("/")
    .slice(1)
    .map((part) => decodeURIComponent(part));
  // eslint-disable-next-line no-control-regex -- Reject path control bytes before filesystem access.
  if (parts.some((part) => part === "." || part === ".." || /[/\\\u0000-\u001f\u007f]/.test(part)))
    throw new Error(`Unsafe publication path: ${parsed.pathname}`);
  return parts.join("/");
}
async function contained(root, name) {
  const target = resolve(root, name);
  const rel = relative(root, target);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(".." + sep) ||
    resolve(target) === resolve(root)
  )
    throw new Error(`Unsafe output destination: ${name}`);
  let cursor = target;
  while (cursor !== root) {
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error(`Symlink output destination: ${name}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    cursor = dirname(cursor);
  }
  return target;
}
function xmlValues(xml, wanted) {
  const parser = new SaxesParser({ xmlns: true });
  const stack = [],
    values = [];
  let capture;
  parser.on("doctype", () => {
    throw new Error("Publication discovery XML must not contain a doctype");
  });
  parser.on("opentag", (node) => {
    stack.push(node.local);
    if (wanted(stack.join("/"))) capture = { depth: stack.length, value: "" };
  });
  parser.on("text", (value) => {
    if (capture) capture.value += value;
  });
  parser.on("cdata", (value) => {
    if (capture) capture.value += value;
  });
  parser.on("closetag", () => {
    if (capture?.depth === stack.length) {
      values.push(capture.value.trim());
      capture = undefined;
    }
    stack.pop();
  });
  parser.write(xml).close();
  return values;
}
export async function auditPublication(rootDirectory, options = {}) {
  const root = await realpath(rootDirectory);
  const inventory = await files(root);
  const origin = httpURL(options.origin, "Publication origin").origin;
  const documents = [];
  const htmlDocuments = new Map();
  const canonicals = new Map();
  const noindexCanonicals = new Set();
  for (const path of inventory.filter((name) => name.endsWith(".html"))) {
    const html = await readFile(resolve(root, path), "utf8");
    const document = readDocument(html);
    htmlDocuments.set(path, document);
    if (!document.canonical) {
      if (document.alternate) throw new Error("Markdown alternate has no canonical");
      continue;
    }
    const item = { path, hash: digest(html), document };
    documents.push(item);
    const identity = document.canonical.href;
    if (document.noindex) {
      if (document.alternate) throw new Error("noindex content cannot advertise Markdown");
      noindexCanonicals.add(identity);
      continue;
    }
    const previous = canonicals.get(identity);
    if (previous && previous.hash !== digest(html))
      throw new Error(`Conflicting canonical publication: ${identity}`);
    canonicals.set(identity, item);
  }
  const targetPath = (url) => {
    const path = localPath(url, origin);
    if (path === undefined) return undefined;
    return [
      path,
      path.replace(/\/$/, "") + "/index.html",
      ...(path === "" ? ["index.html"] : []),
      path + ".html",
    ].find((candidate) => inventory.includes(candidate));
  };
  const resolves = (url) => targetPath(url) !== undefined;
  for (const item of documents) {
    const url = item.document.canonical.href;
    if (item.document.canonical.origin !== origin) continue;
    const target = targetPath(url);
    if (!target) throw new Error(`Canonical URL has no static target: ${url}`);
    if (item.document.noindex) continue;
    const destination = documents.find((entry) => entry.path === target)?.document;
    if (destination?.noindex) throw new Error(`Canonical URL resolves to noindex content: ${url}`);
    if (destination?.canonical.href !== url)
      throw new Error(`Canonical target does not declare the same identity: ${url}`);
  }
  const requireCanonical = (url, surface) => {
    if (!canonicals.has(url) && noindexCanonicals.has(url))
      throw new Error(`${surface} advertises noindex content: ${url}`);
    if (!canonicals.has(url) || !resolves(url))
      throw new Error(`${surface} URL is not an emitted canonical: ${url}`);
    if (canonicals.get(url).document.noindex)
      throw new Error(`${surface} advertises noindex content: ${url}`);
  };
  const readLocal = async (path) => readFile(await contained(root, path), "utf8");
  if (options.sitemap) {
    const visited = new Set(),
      advertised = new Set();
    const visit = async (path) => {
      if (visited.has(path)) throw new Error(`Duplicate or cyclic sitemap: ${path}`);
      visited.add(path);
      const xml = await readLocal(path);
      for (const child of xmlValues(xml, (key) => key === "sitemapindex/sitemap/loc")) {
        const local = localPath(child, origin);
        if (local === undefined)
          throw new Error("Sitemap index must stay on the publication origin");
        await visit(local);
      }
      for (const url of xmlValues(xml, (key) => key === "urlset/url/loc")) {
        if (advertised.has(url)) throw new Error(`Duplicate sitemap canonical: ${url}`);
        advertised.add(url);
        requireCanonical(url, "Sitemap");
      }
    };
    await visit(options.sitemap);
  }
  if (options.feed) {
    for (const url of xmlValues(
      await readLocal(options.feed),
      (key) => key === "rss/channel/item/link",
    ))
      requireCanonical(url, "RSS");
  }
  let searchOutput;
  if (options.searchIndex) {
    const snapshot = JSON.parse(await readLocal(options.searchIndex));
    const rows = Array.isArray(snapshot) ? snapshot : snapshot.data;
    if (!Array.isArray(rows)) throw new Error("Search index requires an array or data array");
    for (const row of rows) {
      if (typeof row.url !== "string") throw new Error("Search entry requires a URL");
      const url = new URL(row.url, origin).href;
      requireCanonical(url, "Search");
      if (options.renderedSearch) row.text = publicationText(canonicals.get(url).document);
    }
    if (options.renderedSearch) {
      if (!Array.isArray(snapshot)) snapshot.version = digest(JSON.stringify(rows));
      searchOutput = JSON.stringify(snapshot);
    }
  }
  const generated = [],
    planned = new Map();
  for (const item of documents) {
    if (!item.document.alternate) {
      if (options.markdown !== false && item.document.hasBody && !item.document.noindex)
        throw new Error(`Publication body has no Markdown alternate: ${item.path}`);
      continue;
    }
    if (options.markdown === false)
      throw new Error("Markdown disabled but HTML still advertises it");
    const rendered = renderedPublication(item.document);
    const path = localPath(rendered.alternate, origin);
    if (!path?.startsWith("_markdown/"))
      throw new Error("Markdown must use the publication's static namespace");
    if (
      [...planned.keys()].some(
        (name) => name.normalize("NFC").toLowerCase() === path.normalize("NFC").toLowerCase(),
      )
    )
      throw new Error(`Duplicate Markdown destination: ${path}`);
    if (
      inventory.some(
        (name) => name.normalize("NFC").toLowerCase() === path.normalize("NFC").toLowerCase(),
      )
    )
      throw new Error(`Markdown output collision: ${path}; use a clean build`);
    for (const asset of rendered.assets) {
      const local = localPath(asset, origin);
      if (local !== undefined && !inventory.includes(local))
        throw new Error(`Missing publication asset: ${asset}`);
    }
    for (const link of rendered.links) {
      const url = new URL(link);
      if (url.origin !== origin) continue;
      if ((options.externalRoutes ?? []).includes(url.pathname)) continue;
      const target = targetPath(url);
      if (!target) throw new Error(`Missing publication link target: ${link}`);
      const fragment = decodeURIComponent(url.hash.slice(1).split(":~:")[0]);
      if (fragment && target.endsWith(".html")) {
        const targetDocument = htmlDocuments.get(target);
        if (
          !targetDocument ||
          !elements(
            targetDocument.tree,
            (node) =>
              String(node.properties?.id ?? "") === fragment ||
              (node.tagName === "a" && String(node.properties?.name ?? "") === fragment),
          ).length
        ) {
          throw new Error(`Missing publication fragment: ${link}`);
        }
      }
    }
    planned.set(path, rendered.markdown);
    generated.push({
      html: item.path,
      canonical: rendered.canonical,
      markdown: rendered.alternate,
      sha256: digest(rendered.markdown),
    });
  }
  if (inventory.some((name) => name.startsWith("_markdown/")) || inventory.includes(receipt))
    throw new Error("Stale or consumer-owned publication output; use a clean build");
  for (const path of [...planned.keys(), receipt]) await contained(root, path);
  return {
    root,
    inventory,
    generated,
    planned,
    searchOutput,
    html: documents.map(({ path, hash }) => ({ path, sha256: hash })),
  };
}
export async function buildPublication(directory, options) {
  const result = await auditPublication(directory, options);
  for (const [path, content] of result.planned) {
    const target = await contained(result.root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { flag: "wx" });
  }
  if (result.searchOutput !== undefined)
    await writeFile(await contained(result.root, options.searchIndex), result.searchOutput);
  const report = {
    schemaVersion: 1,
    html: result.html,
    documents: result.generated,
    ...(result.searchOutput === undefined ? {} : { searchSha256: digest(result.searchOutput) }),
  };
  const target = await contained(result.root, receipt);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  return report;
}
export default function staticPublication(options) {
  if (!options || !options.origin) throw new TypeError("staticPublication requires an origin");
  const suppliedOrigin = httpURL(options.origin);
  if (suppliedOrigin.pathname !== "/" || suppliedOrigin.search || suppliedOrigin.hash)
    throw new TypeError("Publication origin must not contain a path, query or fragment");
  if (options.markdown !== undefined && typeof options.markdown !== "boolean")
    throw new TypeError("markdown must be a boolean");
  if (options.renderedSearch && !options.searchIndex)
    throw new TypeError("renderedSearch requires searchIndex");
  if (
    options.externalRoutes !== undefined &&
    (!Array.isArray(options.externalRoutes) ||
      options.externalRoutes.some(
        (path) =>
          typeof path !== "string" ||
          !path.startsWith("/") ||
          path.startsWith("//") ||
          new URL(path, suppliedOrigin).pathname !== path,
      ))
  )
    throw new TypeError("externalRoutes requires exact root-relative paths");
  const origin = suppliedOrigin.origin;
  return {
    name: "astromache-static-publication",
    hooks: {
      "astro:config:done": ({ config }) => {
        if (config.output !== "static" || config.base !== "/")
          throw new Error("Static publication requires root-mounted static output");
        if (config.site && new URL(config.site).origin !== origin)
          throw new Error("Publication origin disagrees with Astro site");
        const names = config.integrations.map((integration) => integration.name);
        const publication = names.indexOf("astromache-static-publication");
        if (names.lastIndexOf("astromache-static-publication") !== publication)
          throw new Error("Configure static publication once");
        if (names.some((name, index) => /offline/i.test(name) && index < publication))
          throw new Error("Static publication must run before offline hashing");
      },
      "astro:build:done": async ({ dir, logger }) => {
        const report = await buildPublication(fileURLToPath(dir), options);
        logger.info(
          `Verified ${report.html.length} HTML documents; emitted ${report.documents.length} static Markdown documents`,
        );
      },
    },
  };
}
