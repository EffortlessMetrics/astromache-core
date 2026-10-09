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

export const taxonomyRoutes = (entries: Awaited<ReturnType<typeof notes>>) => {
  const labels = [...new Set(entries.flatMap((note) => [note.data.category, ...note.data.tags]))];
  const slugs = new Map<string, string>();
  return labels.map((label) => {
    const slug = tagSlug(label);
    if (!slug) throw new Error(`Taxonomy label has no URL slug: ${JSON.stringify(label)}`);
    const previous = slugs.get(slug);
    if (previous !== undefined) {
      throw new Error(
        `Taxonomy slug collision: ${JSON.stringify(previous)} and ${JSON.stringify(label)} both resolve to /tags/${slug}/. Rename one label.`,
      );
    }
    slugs.set(slug, label);
    return {
      params: { tag: slug },
      props: {
        label,
        entries: entries.filter(
          (note) => note.data.category === label || note.data.tags.includes(label),
        ),
      },
    };
  });
};
