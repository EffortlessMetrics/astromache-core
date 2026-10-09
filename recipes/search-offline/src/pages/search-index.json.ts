import { createHash } from "node:crypto";
import { notes, noteLink } from "../publication-content";
export async function GET() {
  const data = (await notes()).map((note) => ({
    title: note.data.title,
    text: note.body ?? "",
    url: noteLink(note.id),
  }));
  const version = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return new Response(JSON.stringify({ version, data }), {
    headers: { "Content-Type": "application/json" },
  });
}
