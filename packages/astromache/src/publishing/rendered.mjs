import { fromHtml } from "hast-util-from-html";
import { toMdast } from "hast-util-to-mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import { httpURL, markdownURL } from "./metadata.mjs";

const has = (node, key) => Object.hasOwn(node.properties ?? {}, key);
const value = (node, key) => node.properties?.[key];
const words = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/\s+/));
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
      (n) => n.tagName === "meta" && (value(n, "name") === key || value(n, "property") === key),
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
    elements(head, (n) => n.tagName === "link" && words(value(n, "rel")).includes("canonical")),
    "canonical",
    false,
  );
  const canonical = canonicalNode ? httpURL(value(canonicalNode, "href"), "Canonical") : undefined;
  const alternates = elements(
    head,
    (n) =>
      n.tagName === "link" &&
      words(value(n, "rel")).includes("alternate") &&
      value(n, "type") === "text/markdown",
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
    noindex: /(?:^|[\s,])noindex(?:$|[\s,])/i.test(meta(head, "robots") ?? ""),
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
      return {
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "a",
            properties: { href: absolute(src, canonical, false) },
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
