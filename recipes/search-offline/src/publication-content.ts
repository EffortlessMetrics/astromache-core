import { getCollection } from "astro:content";
export const notes = async () =>
  (await getCollection("notes")).sort(
    (a, b) => b.data.published.getTime() - a.data.published.getTime(),
  );
export const noteLink = (id: string) => "/notes/" + id + "/";
export const tagSlug = (tag: string) =>
  tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export const card = (note: Awaited<ReturnType<typeof notes>>[number]) => ({
  title: note.data.title,
  description: note.data.description,
  href: noteLink(note.id),
});
