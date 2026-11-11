import { markdownURL } from "./metadata.mjs";

/** An explicit Markdown preference is required. Ties, wildcards and invalid syntax keep HTML. */
export function prefersMarkdown(accept = "") {
  let malformed = false;
  const entries = accept
    .toLowerCase()
    .split(",")
    .map((item) => {
      const [type, ...params] = item
        .trim()
        .split(";")
        .map((s) => s.trim());
      let q = 1;
      for (const param of params) {
        if (!param.startsWith("q=")) continue;
        if (!/^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(param)) {
          malformed = true;
          return { type, q: 0 };
        }
        q = Number(param.slice(2));
      }
      return { type, q };
    });
  if (malformed) return false;
  const quality = (type) => {
    for (const range of [type, type.split("/")[0] + "/*", "*/*"]) {
      const matches = entries.filter((item) => item.type === range);
      if (matches.length) return Math.min(...matches.map((item) => item.q));
    }
    return 0;
  };
  return (
    entries.some((item) => item.type === "text/markdown") &&
    quality("text/markdown") > quality("text/html")
  );
}

/** Optional adapter helper, never installed by the static publishing integration.
 * Pass a static-asset fetcher, NOT a recursive fetch to the public Worker route.
 * Provider quota bypass must be configured outside this function.
 */
export async function negotiateMarkdown(request, fetchAsset) {
  const original = new URL(request.url);
  if (
    !["GET", "HEAD"].includes(request.method) ||
    original.pathname.startsWith("/_markdown/") ||
    request.headers.has("authorization") ||
    request.headers.has("cookie")
  )
    return fetchAsset(request);
  let response;
  try {
    if (prefersMarkdown(request.headers.get("accept") ?? "")) {
      const canonical = new URL(original);
      canonical.search = "";
      canonical.hash = "";
      const target = markdownURL(canonical);
      target.search = original.search;
      const headers = new Headers(request.headers);
      // An HTML validator must never produce a Markdown 304 (or an HTML byte range).
      for (const name of ["if-none-match", "if-modified-since", "range", "if-range"])
        headers.delete(name);
      response = await fetchAsset(
        new Request(target, { method: request.method, headers, signal: request.signal }),
      );
      if (
        !response.ok ||
        !/^text\/markdown(?:;|$)/i.test(response.headers.get("content-type") ?? "")
      )
        response = undefined;
    }
  } catch {
    /* The public HTML page remains the baseline. */
  }
  response ??= await fetchAsset(request);
  const headers = new Headers(response.headers);
  const vary = new Set(
    (headers.get("vary") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (![...vary].some((s) => s.toLowerCase() === "accept")) vary.add("Accept");
  headers.set("vary", [...vary].join(", "));
  // Host-specific variant caching is not presumed. Direct asset URLs remain cacheable.
  headers.set("cache-control", "private, no-store");
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
