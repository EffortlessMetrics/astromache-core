import { expect, test } from "vite-plus/test";
import { profileProps, type ProfileProps } from "./profile.js";

test("keeps authored wording and supplied relationships unchanged", () => {
  const input = {
    title: "Example & author",
    speakingLabel: "Talks and appearances",
    followLabel: "Elsewhere",
    links: [
      { label: "My profile", href: "https://example.test/person/?from=site#work", rel: "me" },
      { label: "Speaking", href: "/speaking/" },
      { label: "About", href: "#about" },
    ],
  };
  expect(profileProps(input)).toEqual(input);
});

test("has no implicit social links or relationships", () => {
  expect(profileProps({ title: "Example author" })).toEqual({
    title: "Example author",
    speakingLabel: "Speaking",
    followLabel: "Follow me",
    links: [],
  });
  const output = profileProps({
    title: "Example author",
    links: [{ label: "Publication", href: "https://publication.example/" }],
  });
  expect(output.links[0]).not.toHaveProperty("rel");
});

test.each([undefined, null, 0, "", "   "])("rejects an unreadable title: %j", (title) => {
  expect(() => profileProps({ title } as unknown as ProfileProps)).toThrow("Profile title");
});

test.each(["speakingLabel", "followLabel"] as const)("rejects an empty %s", (field) => {
  expect(() => profileProps({ title: "Example", [field]: " " })).toThrow(field);
});

test.each([
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "//external.example/",
  "/\\external.example/",
  "https://user:secret@example.test/",
  "https://example.test/\nunsafe",
  " https://example.test/",
  "relative-path",
  "https:/external.example/",
  "",
])("rejects an ambiguous or unsafe follow URL: %s", (href) => {
  expect(() => profileProps({ title: "Example", links: [{ label: "Link", href }] })).toThrow(
    "Profile link href",
  );
});

test.each([null, {}, "links"])("rejects a non-array links value: %j", (links) => {
  expect(() => profileProps({ title: "Example", links } as unknown as ProfileProps)).toThrow(
    "Profile links must be an array",
  );
});

test.each([null, "not a record", { label: " ", href: "/" }, { label: "Home", href: null }])(
  "rejects malformed runtime link records: %j",
  (link) => {
    expect(() =>
      profileProps({ title: "Example", links: [link] } as unknown as ProfileProps),
    ).toThrow();
  },
);

test("does not let later caller mutations rewrite the validated records", () => {
  const link = { label: "Profile", href: "https://example.test/" };
  const output = profileProps({ title: "Example", links: [link] });
  link.href = "javascript:alert(1)";
  expect(output.links[0].href).toBe("https://example.test/");
});

test("rejects sparse link arrays rather than rendering an empty Follow me section", () => {
  const links: NonNullable<ProfileProps["links"]>[number][] = [];
  links.length = 1;
  expect(() => profileProps({ title: "Example", links })).toThrow(
    "Profile links must contain label and href records",
  );
});
