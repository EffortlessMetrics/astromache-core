import { expect, test } from "vite-plus/test";
import { publicationMetadata } from "./metadata.js";

const base = {
  title: "A publication",
  description: "An independent consumer",
  language: "en",
  canonical: new URL("https://example.test/article/"),
};

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
