import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
export const collections = {
  notes: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),
    schema: z.object({
      title: z.string(),
      description: z.string(),
      published: z.preprocess(
        (value) =>
          typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/i.test(value)
            ? `${value}Z`
            : value,
        z.coerce.date(),
      ),
      tags: z.array(z.string()),
      category: z.string(),
    }),
  }),
};
