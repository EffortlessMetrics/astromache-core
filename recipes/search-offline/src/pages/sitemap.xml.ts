import type { APIContext } from "astro";
import { notes, noteLink, taxonomyRoutes } from "../publication-content";
import { xml } from "../xml";
export async function GET({ site }: APIContext) {
  const entries = await notes();
  const paths = [
    "/",
    "/posts/",
    "/portfolio/",
    "/search/",
    ...entries.map((note) => noteLink(encodeURIComponent(note.id))),
    ...taxonomyRoutes(entries).map((route) => "/tags/" + route.params.tag + "/"),
  ];
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      paths.map((href) => "<url><loc>" + xml(site?.origin + href) + "</loc></url>").join("") +
      "</urlset>",
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
}
