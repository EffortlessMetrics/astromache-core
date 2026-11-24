import { fromHtml } from "hast-util-from-html";
import { toMdast } from "hast-util-to-mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import { httpURL, markdownURL } from "./metadata.mjs";

const has = (node, key) => Object.hasOwn(node.properties ?? {}, key);
const value = (node, key) => node.properties?.[key];
const words = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/\s+/));
const asciiLower = (value) =>
  String(value ?? "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const hasRel = (node, token) =>
  words(value(node, "rel")).some((word) => asciiLower(word) === token);
const text = (node) =>
  node.type === "text" ? node.value : (node.children ?? []).map(text).join("");
export function elements(tree, predicate) {
  const found = [];
  const walk = (node) => {
    if (node.type === "element" && predicate(node)) found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return found;
}
function hidden(node) {
  const style = String(value(node, "style") ?? "");
  return (
    has(node, "hidden") ||
    value(node, "ariaHidden") === "true" ||
    value(node, "ariaHidden") === true ||
    has(node, "dataPublicationExclude") ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important)?\s*(?:;|$)/i.test(
      style,
    )
  );
}
function visibleElements(tree, predicate) {
  const found = [];
  const walk = (node) => {
    if (
      node.type === "element" &&
      (hidden(node) || ["script", "style", "template"].includes(node.tagName))
    )
      return;
    if (node.type === "element" && predicate(node)) found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return found;
}
function one(nodes, label, required = true) {
  if (nodes.length > 1 || (required && !nodes.length))
    throw new Error(`Publication requires exactly one ${label}`);
  return nodes[0];
}
function meta(head, key, required = false) {
  const node = one(
    elements(
      head,
      (n) =>
        n.tagName === "meta" &&
        (asciiLower(value(n, "name")) === key || value(n, "property") === key),
    ),
    key,
    required,
  );
  return node ? String(value(node, "content") ?? "") : undefined;
}
export function readDocument(html) {
  const tree = fromHtml(html);
  const head = one(
    elements(tree, (n) => n.tagName === "head"),
    "head",
  );
  const canonicalNode = one(
    elements(head, (n) => n.tagName === "link" && hasRel(n, "canonical")),
    "canonical",
    false,
  );
  const canonical = canonicalNode ? httpURL(value(canonicalNode, "href"), "Canonical") : undefined;
  const alternates = elements(
    head,
    (n) =>
      n.tagName === "link" &&
      hasRel(n, "alternate") &&
      asciiLower(value(n, "type")) === "text/markdown",
  );
  const alternate = one(alternates, "Markdown alternate", false);
  if (!canonical)
    return {
      tree,
      head,
      canonical,
      alternate: alternate && httpURL(value(alternate, "href"), "Markdown alternate"),
    };
  if (elements(head, (n) => n.tagName === "base").length)
    throw new Error("Publication does not support a base element");
  return {
    tree,
    head,
    canonical,
    hasBody:
      visibleElements(tree, (n) => has(n, "dataArticleBody") || has(n, "dataPublicationBody"))
        .length > 0,
    alternate: alternate && httpURL(value(alternate, "href"), "Markdown alternate"),
    title: text(
      one(
        elements(head, (n) => n.tagName === "title"),
        "title",
      ),
    ),
    description: meta(head, "description"),
    author: meta(head, "author"),
    published: meta(head, "article:published_time"),
    modified: meta(head, "article:modified_time"),
    bodyMode: meta(head, "astromache:body") ?? "marked",
    noindex: ["robots", "googlebot", "bingbot"].some((agent) =>
      /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(meta(head, agent) ?? ""),
    ),
  };
}
function absolute(value, canonical, asset) {
  const url = new URL(value, canonical);
  if (!["http:", "https:", ...(asset ? [] : ["mailto:", "tel:"])].includes(url.protocol)) {
    throw new Error(`Unsupported publication URL protocol: ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error("Publication links cannot contain credentials");
  return url.href;
}
function selectedBody(document) {
  if (!["marked", "main"].includes(document.bodyMode))
    throw new Error("Unsupported publication body mode");
  return one(
    visibleElements(
      document.tree,
      document.bodyMode === "main"
        ? (node) => node.tagName === "main"
        : (node) => has(node, "dataArticleBody") || has(node, "dataPublicationBody"),
    ),
    "visible publication body",
  );
}
function clean(node, canonical, assets, links, skip) {
  if (node === skip) return undefined;
  if (node.type === "comment" || node.type === "doctype") return undefined;
  if (node.type === "element") {
    if (
      hidden(node) ||
      ["script", "style", "template", "button", "input", "select", "textarea"].includes(
        node.tagName,
      )
    )
      return undefined;
    if (has(node, "dataPublicationText"))
      return { type: "text", value: String(value(node, "dataPublicationText")) };
    if (["svg", "math", "canvas", "object", "embed"].includes(node.tagName))
      throw new Error(`${node.tagName} requires a data-publication-text alternative`);
    if (["iframe", "video", "audio"].includes(node.tagName)) {
      const src =
        value(node, "src") ?? elements(node, (n) => n.tagName === "source")[0]?.properties?.src;
      const label = value(node, "title") ?? value(node, "ariaLabel");
      if (!src || !label)
        throw new Error(`${node.tagName} requires a source and accessible title for Markdown`);
      const href = absolute(src, canonical, false);
      if (/^https?:/i.test(href)) links.add(href);
      return {
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "a",
            properties: { href },
            children: [{ type: "text", value: String(label) }],
          },
        ],
      };
    }
    if (
      ["td", "th"].includes(node.tagName) &&
      [value(node, "colSpan"), value(node, "rowSpan")].some(
        (n) => n !== undefined && Number(n) !== 1,
      )
    ) {
      throw new Error("Spanning table cells require a data-publication-text alternative");
    }
    // Astro/Shiki writes the language on PRE; the Markdown converter reads CODE.
    if (node.tagName === "pre" && value(node, "dataLanguage")) {
      const language = String(value(node, "dataLanguage"));
      if (!/^[a-zA-Z0-9_+.#-]+$/.test(language))
        throw new Error("Invalid code language annotation");
      node = {
        ...node,
        children: (node.children ?? []).map((child) => {
          if (child.type !== "element" || child.tagName !== "code") return child;
          const classes = words(value(child, "className")).filter(Boolean);
          const declared = classes.find((name) => name.startsWith("language-"));
          if (declared && declared !== "language-" + language)
            throw new Error("Conflicting code language annotations");
          return {
            ...child,
            properties: {
              ...child.properties,
              className: declared ? classes : [...classes, "language-" + language],
            },
          };
        }),
      };
    }
    const properties = { ...node.properties };
    for (const key of Object.keys(properties)) if (/^on/i.test(key)) delete properties[key];
    for (const key of ["href", "src"])
      if (properties[key]) properties[key] = absolute(properties[key], canonical, key === "src");
    if (node.tagName === "a" && properties.href && /^https?:/i.test(properties.href))
      links.add(properties.href);
    if (node.tagName === "img") {
      if (!has(node, "alt"))
        throw new Error("Publication images require alt text (empty is allowed for decoration)");
      if (properties.src) assets.add(properties.src);
    }
    node = { ...node, properties };
  }
  if (node.children)
    return {
      ...node,
      children: node.children.map((n) => clean(n, canonical, assets, links, skip)).filter(Boolean),
    };
  return { ...node };
}
export function renderedPublication(document) {
  const { tree, head, canonical, alternate } = document;
  if (!canonical || !alternate || alternate.href !== markdownURL(canonical).href)
    throw new Error("Markdown alternate must match the canonical publication URL");
  if (document.noindex) throw new Error("A noindex document cannot advertise public Markdown");
  for (const key of ["og:title", "og:description", "og:url", "og:type"]) {
    if (!meta(head, key, true)?.trim()) throw new Error(`Publication metadata ${key} is empty`);
  }
  if (meta(head, "og:url") !== canonical.href)
    throw new Error("Open Graph URL disagrees with canonical");
  const body = selectedBody(document);
  const assets = new Set();
  const links = new Set();
  const sources = visibleElements(tree, (n) => has(n, "dataPublicationSource"));
  const bodyNodes = new Set(elements(body, () => true));
  const sourceNodes = sources.filter((n) => !bodyNodes.has(n));
  const heading = visibleElements(tree, (n) => n.tagName === "h1");
  const title = heading.length === 1 ? renderedText(heading[0]) : document.title;
  const cleaned = clean(
    { type: "root", children: [...sourceNodes, ...body.children] },
    canonical,
    assets,
    links,
    document.bodyMode === "main" && heading.length === 1 ? heading[0] : undefined,
  );
  const metadata = [
    { type: "heading", depth: 1, children: [{ type: "text", value: title }] },
    {
      type: "paragraph",
      children: [
        {
          type: "link",
          url: canonical.href,
          children: [{ type: "text", value: "Canonical publication" }],
        },
      ],
    },
  ];
  for (const [label, content] of [
    ["Author", document.author],
    ["Published", document.published],
    ["Modified", document.modified],
  ]) {
    if (content)
      metadata.push({
        type: "paragraph",
        children: [{ type: "text", value: `${label}: ${content}` }],
      });
  }
  const mdast = toMdast(cleaned);
  const markdown = toMarkdown(
    { type: "root", children: [...metadata, ...mdast.children] },
    { extensions: [gfmToMarkdown()], fences: true },
  );
  return {
    markdown,
    assets: [...assets],
    links: [...links],
    canonical: canonical.href,
    alternate: alternate.href,
    title,
  };
}

/** Text for search is derived from the published body, never source comments/frontmatter. */
export function publicationText(document) {
  return renderedText(selectedBody(document));
}
function renderedText(body) {
  const walk = (node) => {
    if (node.type === "comment") return "";
    if (node.type === "text") return node.value;
    if (node.type === "element") {
      if (
        hidden(node) ||
        ["script", "style", "template", "button", "input", "select", "textarea"].includes(
          node.tagName,
        )
      )
        return "";
      if (has(node, "dataPublicationText")) return String(value(node, "dataPublicationText"));
      if (node.tagName === "img") return String(value(node, "alt") ?? "");
    }
    const content = (node.children ?? []).map(walk).join("");
    const block = [
      "address",
      "article",
      "aside",
      "blockquote",
      "br",
      "dd",
      "div",
      "dl",
      "dt",
      "figcaption",
      "figure",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "li",
      "ol",
      "p",
      "pre",
      "section",
      "table",
      "td",
      "th",
      "tr",
      "ul",
    ].includes(node.tagName);
    return block ? " " + content + " " : content;
  };
  return walk(body).replace(/\s+/g, " ").trim();
}

function discoveryBody(document) {
  return document.hasBody
    ? selectedBody({ ...document, bodyMode: "marked" })
    : one(
        visibleElements(document.tree, (node) => node.tagName === "main"),
        "discovery main",
      );
}

/** Primary static media references, independently verified from the rendered HTML. */
export function discoveryMedia(document) {
  const main = discoveryBody(document);
  const contained = new Set(elements(main, () => true));
  const sources = visibleElements(document.tree, (node) => has(node, "dataPublicationSource"))
    .filter((node) => !contained.has(node));
  const urls = new Set();
  const add = (candidate) => {
    if (!candidate) return;
    const url = new URL(candidate, document.canonical);
    if (url.origin !== document.canonical.origin) return;
    if (url.username || url.password) throw new Error("Discovery media URL has credentials");
    url.search = "";
    url.hash = "";
    urls.add(url.href);
  };
  const srcset = (input) => {
    // The URL token may itself contain a comma (notably data URLs).
    // Follow the URL-token/descriptor boundary rather than splitting on commas.
    let remaining = String(input ?? "");
    while (remaining.length) {
      remaining = remaining.replace(/^[\s,]+/, "");
      if (!remaining) break;
      const token = /^\S+/.exec(remaining)[0];
      remaining = remaining.slice(token.length);
      add(token.replace(/,+$/, ""));
      if (token.endsWith(",")) continue;
      let depth = 0, end = 0;
      while (end < remaining.length) {
        const char = remaining[end++];
        if (char === "(") depth++;
        else if (char === ")" && depth) depth--;
        else if (char === "," && depth === 0) break;
      }
      remaining = remaining.slice(end);
    }
  };
  for (const region of [main, ...sources]) {
    for (const node of visibleElements(region, (n) =>
      ["img", "source", "video", "audio"].includes(n.tagName),
    )) {
      add(value(node, "src"));
      add(value(node, "poster"));
      srcset(value(node, "srcSet"));
    }
  }
  add(meta(document.head, "og:image"));
  return [...urls].sort();
}

/** Bounded content projection, independent of Markdown and bundled presentation. */
export function discoveryContent(document) {
  const tree = document.tree;
  const main = discoveryBody(document);
  const semantic = (node) => {
    if (node.type === "text") return [node.value];
    if (node.type !== "element" || hidden(node)) return [];
    if (
      ["script", "style", "template", "button", "input", "select", "textarea"].includes(
        node.tagName,
      )
    )
      return [];
    if (has(node, "dataPublicationText")) return [String(value(node, "dataPublicationText"))];
    const properties = Object.fromEntries(
      Object.entries(node.properties ?? {})
        .filter(([key]) => !/^(?:className$|style$|on|dataAstro|dataVite|tabIndex$|width$|height$|loading$|decoding$|fetchPriority$)/i.test(key))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const children = [];
    for (const child of (node.children ?? []).flatMap(semantic)) {
      if (typeof child === "string" && typeof children.at(-1) === "string")
        children[children.length - 1] += child;
      else children.push(child);
    }
    // Syntax highlighting and styling-only inline wrappers are not content.
    if (node.tagName === "span" && Object.keys(properties).length === 0) return children;
    return [[node.tagName, properties, children]];
  };
  const normalizeStructured = (node) => {
    if (Array.isArray(node)) return node.map(normalizeStructured);
    if (node === null || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.keys(node)
        .sort()
        .filter((key) => !["dateModified", "datePublished"].includes(key))
        .map((key) => [key, normalizeStructured(node[key])]),
    );
  };
  const contained = new Set(elements(main, () => true));
  const sources = visibleElements(tree, (node) => has(node, "dataPublicationSource")).filter(
    (node) => !contained.has(node),
  );
  return {
    title: document.title,
    description: document.description,
    author: document.author,
    headings: visibleElements(tree, (node) => node.tagName === "h1").map(renderedText),
    content: semantic(main),
    sources: sources.map(semantic),
    socialImage: meta(document.head, "og:image"),
    structured: elements(
      document.head,
      (node) => node.tagName === "script" && value(node, "type") === "application/ld+json",
    ).map((node) => normalizeStructured(JSON.parse(text(node)))),
  };
}
