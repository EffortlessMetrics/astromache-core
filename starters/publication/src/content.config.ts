import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
export const collections = {
  notes: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),
    schema: z.object({
      title: z.string(),
      description: z.string(),
      published: z.coerce.date(),
      tags: z.array(z.string()),
      category: z.string(),
    }),
  }),
};
