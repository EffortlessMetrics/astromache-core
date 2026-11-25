import assert from "node:assert/strict";
import { test } from "node:test";
import { createArticleCardRenderer } from "../packages/astromache/src/publishing/article-card.mjs";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
// Geometry-only test double. Native rasterization and actual font bytes are
// consumer qualification obligations, not established by this stub.
const png = Buffer.alloc(24);
signature.copy(png);
png.write("IHDR", 12);
png.writeUInt32BE(1200, 16);
png.writeUInt32BE(630, 20);
const font = {
  charToGlyphIndex: (text) => text === "☃" ? 0 : 1,
  getAdvanceWidth: (text, size) => text.length * size * 0.6,
  getPath: (text, _x, _y, size) => ({
    getBoundingBox: () => ({ x1: -1, y1: -size * 0.75, x2: text.length * size * 0.6, y2: size * 0.2 }),
    toPathData: () => "M0 0L10 0L10 -10Z",
  }),
};
const fixture = () => ({
  brand: {
    background: "#ffffff", heading: "#223344", foreground: "#111111", domain: "example.org",
    logo: { mime: "image/png", bytes: signature },
  },
  layout: {
    left: 80, right: 60, top: 60, bottom: 60, logoSize: 130, titleGap: 40,
    maxTitleSize: 80, minTitleSize: 38, lineHeight: 1.2, domainSize: 40,
  },
  titleFont: font,
  domainFont: font,
  rasterize: () => png,
});

test("domain ink and logo share an anchor; title expands upward", () => {
  const render = createArticleCardRenderer(fixture());
  const short = render("Short").receipt;
  const long = render("A longer article title with several lines and no lost words").receipt;
  assert.equal(short.domain.bounds.top, short.logo.top);
  assert.deepEqual(short.domain, long.domain);
  assert.deepEqual(short.logo, long.logo);
  assert.equal(short.lines.at(-1).bounds.bottom, short.logo.top - 40);
  assert.equal(long.lines.at(-1).bounds.bottom, long.logo.top - 40);
  assert.equal(long.lines.map((line) => line.text).join(" "), long.title);
  assert.ok(long.lines.length > short.lines.length);
  assert.ok(long.lines[0].bounds.top < short.lines[0].bounds.top);
});

test("long titles shrink rather than truncate; all ink stays within the safe area", () => {
  const render = createArticleCardRenderer(fixture());
  const result = render("A remarkably long title ".repeat(10)).receipt;
  assert.ok(result.fontSize < 80);
  assert.equal(result.lines.map((line) => line.text).join(" "), result.title);
  for (const { bounds } of result.lines) {
    assert.ok(bounds.left >= 80 && bounds.right <= 1140 && bounds.top >= 60);
    assert.ok(bounds.bottom <= result.logo.top - 40);
  }
});

test("missing glyphs and impossible titles fail explicitly", () => {
  const render = createArticleCardRenderer(fixture());
  assert.throws(() => render("Snow ☃"), /Missing sharing-card glyph U\+2603/);
  assert.throws(() => render("W".repeat(500)), /cannot fit/);
  assert.throws(() => render(" "), /text is required/);
});

test("renderer uses embedded artwork and paths, not raw title markup or web fonts", () => {
  let svg;
  const render = createArticleCardRenderer({
    ...fixture(),
    rasterize: (input) => { svg = input; return png; },
  });
  render("Title <tag> & café");
  assert.match(svg, /data:image\/png;base64,/);
  assert.doesNotMatch(svg, /<tag>|<text|<style|@font-face/);
});

test("invalid raster dimensions fail the build", () => {
  const render = createArticleCardRenderer({ ...fixture(), rasterize: () => Buffer.alloc(24) });
  assert.throws(() => render("Short"), /1200x630 PNG/);
});
