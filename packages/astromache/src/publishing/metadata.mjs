/** Publication delivery metadata. No site identity or content-use policy is implied. */
export function httpURL(value, label = "URL") {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute HTTP(S) URL`);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new TypeError(`${label} must be an HTTP(S) URL without credentials`);
  }
  return url;
}

function text(value, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    // eslint-disable-next-line no-control-regex -- Reject invalid public metadata and path control bytes.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${label} must be nonempty text without control characters`);
  }
  return value;
}

export function markdownURL(canonical) {
  const url = httpURL(canonical, "Canonical");
  if (url.search || url.hash || url.href.includes("#"))
    throw new TypeError("Canonical cannot have a query or fragment");
  // A disjoint static namespace avoids article/asset and root/index collisions.
  url.pathname =
    "/_markdown" + (url.pathname === "/" ? "/index" : url.pathname.replace(/\/$/, "")) + ".md";
  return url;
}

function iso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if ((typeof value !== "string" && !(value instanceof Date)) || !Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} must be a valid Date or date string`);
  }
  return date.toISOString();
}

export function publicationHead(input) {
  if (!input || typeof input !== "object") throw new TypeError("Publication metadata is required");
  const title = text(input.title, "Title");
  const description = text(input.description, "Description");
  const canonical = httpURL(input.canonical, "Canonical");
  if (canonical.search || canonical.hash || canonical.href.includes("#"))
    throw new TypeError("Canonical cannot have a query or fragment");
  const type = input.type ?? "website";
  if (!["website", "article"].includes(type))
    throw new TypeError("Publication type must be website or article");
  if (input.markdown !== undefined && typeof input.markdown !== "boolean")
    throw new TypeError("markdown must be a boolean");
  const image =
    input.image === undefined
      ? undefined
      : {
          url: httpURL(input.image.url, "Social image").href,
          alt: text(input.image.alt, "Social image alt"),
          width: input.image.width,
          height: input.image.height,
        };
  if (
    image &&
    [image.width, image.height].some((n) => n !== undefined && (!Number.isInteger(n) || n <= 0))
  ) {
    throw new TypeError("Social image dimensions must be positive integers");
  }
  const published =
    input.published === undefined ? undefined : iso(input.published, "Publication date");
  const modified =
    input.modified === undefined ? undefined : iso(input.modified, "Modification date");
  if (modified && published && modified < published)
    throw new TypeError("Modification date precedes publication date");
  const author =
    input.author === undefined
      ? undefined
      : {
          name: text(input.author.name, "Author name"),
          ...(input.author.url === undefined
            ? {}
            : { url: httpURL(input.author.url, "Author URL").href }),
        };
  const body = input.body ?? "marked";
  if (!["marked", "main"].includes(body))
    throw new TypeError("Publication body must be marked or main");
  const alternate = input.markdown ? markdownURL(canonical).href : undefined;
  const structured =
    type === "article" && author && published
      ? {
          "@context": "https://schema.org",
          "@type": "Article",
          "@id": canonical.href,
          headline: title,
          description,
          url: canonical.href,
          datePublished: published,
          ...(modified ? { dateModified: modified } : {}),
          author: { "@type": "Person", ...author },
          ...(image ? { image: image.url } : {}),
        }
      : undefined;
  return {
    title,
    description,
    canonical: canonical.href,
    type,
    image,
    published,
    modified,
    author,
    alternate,
    body,
    structured,
  };
}

export function jsonForHTML(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
