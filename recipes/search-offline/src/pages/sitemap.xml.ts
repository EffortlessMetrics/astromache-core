import type { APIContext } from "astro";
import { notes, noteLink, tagSlug } from "../publication-content";
export async function GET({ site }: APIContext) {
  const entries = await notes();
  const paths = [
    "/",
    "/posts/",
    "/portfolio/",
    "/search/",
    ...entries.map((note) => noteLink(note.id)),
    ...[...new Set(entries.flatMap((note) => note.data.tags))].map(
      (tag) => "/tags/" + tagSlug(tag) + "/",
    ),
  ];
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      paths.map((href) => "<url><loc>" + site?.origin + href + "</loc></url>").join("") +
      "</urlset>",
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
}
