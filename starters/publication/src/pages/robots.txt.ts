import type { APIContext } from "astro";
export function GET({ site }: APIContext) {
  return new Response(
    "User-agent: *\nAllow: /\nSitemap: " + site?.origin + "/sitemap-index.xml\n",
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
