import { expect, test } from "vite-plus/test";
import { safeSearchLinks } from "./surface.js";

test("keeps local result rows and excludes unsafe destinations", () => {
  const good = { href: "/notes/one/", title: "One", summary: "Example" };
  const invalid = ["javascript:alert(1)", "//example.test", "/\\evil.test", "/a\nb", "relative"];
  expect(safeSearchLinks([good, ...invalid.map((href) => ({ ...good, href }))])).toEqual([good]);
});
