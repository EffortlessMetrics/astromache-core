import { expect, it } from "vite-plus/test";
import type { Link, RelatedLink } from "./article-types.js";

it("accepts pre-existing link variables carrying an unrelated Date field", () => {
  const legacy = { label: "Earlier", href: "/earlier/", date: new Date("2025-01-01") };
  const ordinary: Link = legacy;
  const related: RelatedLink = legacy;
  expect(ordinary.href).toBe(related.href);
});
