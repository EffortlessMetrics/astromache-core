import type { APIContext } from "astro";
import { notes, noteLink } from "../publication-content";
import { xml } from "../xml";
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
            xml(note.data.title, `RSS title for note ${note.id}`) +
            "</title><link>" +
            xml(origin + noteLink(note.id)) +
            "</link><guid>" +
            xml(origin + noteLink(note.id)) +
            "</guid><description>" +
            xml(note.data.description, `RSS description for note ${note.id}`) +
            "</description><pubDate>" +
            note.data.published.toUTCString() +
            "</pubDate></item>",
        )
        .join("") +
      "</channel></rss>",
    { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
  );
}
