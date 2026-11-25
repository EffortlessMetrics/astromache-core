import { expect, test } from "vite-plus/test";
import { directoryTitle, linkGroupProps, sectionProps, type LinkGroupProps } from "./directory.js";

test("keeps authored group labels, destinations, descriptions and relationships", () => {
  const links = [
    {
      label: "Example profile",
      href: "https://profiles.example/person/",
      rel: "me",
      iconSrc: "/icons/profile.svg",
    },
    { label: "Publication", href: "/", description: "Notes", external: true },
  ];
  const group = linkGroupProps({ id: "follow", title: "Follow Me", links });
  expect(group.id).toBe("follow");
  expect(group.title).toBe("Follow Me");
  expect(group.layout).toBe("inline");
  expect(group.links[0]).toMatchObject(links[0]);
  expect(group.links[1]).toMatchObject(links[1]);
  expect(group.links[1]).not.toHaveProperty("rel");
  links[0].href = "javascript:alert(1)";
  expect(group.links[0].href).toBe("https://profiles.example/person/");
});

test("accepts stack layout and an independent generic content heading", () => {
  expect(directoryTitle("Example & author")).toBe("Example & author");
  expect(sectionProps({ id: "work", title: "Projects" })).toEqual({
    id: "work",
    title: "Projects",
  });
  expect(
    linkGroupProps({
      id: "websites",
      title: "Sites",
      links: [{ label: "Example", href: "/" }],
      layout: "stack",
    }).layout,
  ).toBe("stack");
});

test.each(["", "two words", 'quoted"id', "bad#id"])("rejects an invalid section id: %s", (id) => {
  expect(() => sectionProps({ id, title: "Example" })).toThrow("section id");
});

test.each([
  { label: "Bad", href: "javascript:alert(1)" },
  { label: "Bad", href: "//example.test/" },
  { label: "Bad", href: "/", iconSrc: '/bad");color:red;/*' },
  { label: "Bad", href: "/", iconSrc: "https://example.test/icon.svg" },
  { label: "Bad", href: "/", description: " " },
  { label: "Bad", href: "/", external: "true" },
])("rejects malformed link input: %j", (link) => {
  expect(() =>
    linkGroupProps({ id: "links", title: "Links", links: [link] } as LinkGroupProps),
  ).toThrow();
});

test("rejects empty groups, unreadable titles and unknown layouts", () => {
  expect(() => directoryTitle(" ")).toThrow();
  expect(() => linkGroupProps({ id: "links", title: "Links", links: [] })).toThrow();
  expect(() =>
    linkGroupProps({
      id: "links",
      title: "Links",
      links: [{ label: "Home", href: "/" }],
      layout: "other",
    } as unknown as LinkGroupProps),
  ).toThrow();
});

test("reserves derived heading IDs against other directory sections", () => {
  expect(sectionProps({ id: "work", title: "Work" }).id).toBe("work");
  expect(() => sectionProps({ id: "work-title", title: "Other work" })).toThrow("reserved -title");
  expect(() =>
    linkGroupProps({ id: "follow-title", title: "Links", links: [{ label: "Home", href: "/" }] }),
  ).toThrow("reserved -title");
});
