import { expect, test } from "vite-plus/test";
import { publicationMetadata } from "./metadata.js";

const base = {
  title: "A publication",
  description: "An independent consumer",
  language: "en",
  canonical: new URL("https://example.test/article/"),
};

test.each([
  undefined,
  null,
  "https://example.test/article/",
  { protocol: "https:", href: "javascript:alert(1)" },
])("diagnoses canonical values that are not URL objects: %j", (canonical) => {
  // JavaScript consumers and runtime Astro props can violate the typed contract.
  expect(() => publicationMetadata({ ...base, canonical } as unknown as typeof base)).toThrow(
    "Canonical publication URL must be a URL object",
  );
});

test.each(["http://example.test/article/", "https://example.test/article/"])(
  "preserves valid canonical URL objects: %s",
  (canonical) => {
    expect(publicationMetadata({ ...base, canonical: new URL(canonical) }).canonical.href).toBe(
      canonical,
    );
  },
);

test("validates the URL brand independently of its prototype identity", () => {
  const canonical = new URL(base.canonical);
  Object.setPrototypeOf(canonical, null);
  expect(publicationMetadata({ ...base, canonical }).canonical.href).toBe(base.canonical.href);
});

test.each([
  "en_US",
  "en-x",
  "sl-rozaj-rozaj",
  "sl-rozaj-ROZAJ",
  "en-u-ca-gregory-u-nu-latn",
  "en-u-ca-gregory-U-nu-latn",
])("rejects malformed language tags: %s", (language) => {
  expect(() => publicationMetadata({ ...base, language })).toThrow("BCP 47");
});

test.each(["en-CA", "zh-cmn-Hans-CN", "en-u-ca-gregory", "x-private", "i-klingon"])(
  "preserves valid language tags without normalization: %s",
  (language) => {
    expect(publicationMetadata({ ...base, language }).language).toBe(language);
  },
);

test.each([
  "javascript:alert(1)",
  "file:///article",
  "https://user:secret@example.test/",
  "https://example.test/#fragment",
  "https://example.test/#",
])("rejects an unsafe or noncanonical document URL: %s", (canonical) => {
  expect(() => publicationMetadata({ ...base, canonical: new URL(canonical) })).toThrow();
});

test("metadata is isolated from later caller URL mutations", () => {
  const input = { ...base, canonical: new URL(base.canonical) };
  const output = publicationMetadata(input);
  input.canonical.pathname = "/changed/";
  expect(output.canonical.href).toBe("https://example.test/article/");
});

test.each(["title", "description", "language"] as const)("rejects missing %s", (key) => {
  expect(() => publicationMetadata({ ...base, [key]: " " })).toThrow();
});

test.each(["title", "description", "language"] as const)(
  "diagnoses non-string %s values from runtime consumers",
  (key) => {
    for (const value of [undefined, null, 42, {}]) {
      expect(() => publicationMetadata({ ...base, [key]: value } as typeof base)).toThrow(
        "Publication metadata requires a title, description and language",
      );
    }
  },
);

test("accepts an encoded hash in a canonical path", () => {
  const canonical = new URL("https://example.test/%23section");
  expect(publicationMetadata({ ...base, canonical }).canonical.href).toBe(canonical.href);
});
