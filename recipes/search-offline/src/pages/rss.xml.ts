import type { APIContext } from "astro";
import { notes, noteLink } from "../publication-content";
const xml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]!,
  );
export async function GET({ site }: APIContext) {
  const origin = site?.origin ?? "https://publication.example";
  const entries = await notes();
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Field Notes</title><link>' +
      origin +
      "/</link><description>Careful observations and practical experiments.</description>" +
      entries
        .map(
          (note) =>
            "<item><title>" +
            xml(note.data.title) +
            "</title><link>" +
            origin +
            noteLink(note.id) +
            "</link><guid>" +
            origin +
            noteLink(note.id) +
            "</guid><description>" +
            xml(note.data.description) +
            "</description><pubDate>" +
            note.data.published.toUTCString() +
            "</pubDate></item>",
        )
        .join("") +
      "</channel></rss>",
    { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
  );
}
