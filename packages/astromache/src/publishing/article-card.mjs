import { Buffer } from "node:buffer";

const WIDTH = 1200;
const HEIGHT = 630;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const color = (value) => {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error("Sharing card requires a six-digit hex color");
  }
  return value;
};
const finite = (value) => Number.isFinite(value);
const normalize = (text) => {
  if (typeof text !== "string" || !text.trim()) throw new Error("Sharing card text is required");
  return text.normalize("NFC").trim().replace(/\s+/gu, " ");
};

function assertGlyphs(font, text) {
  for (const character of text) {
    if (!font.charToGlyphIndex(character)) {
      throw new Error(
        `Missing sharing-card glyph U+${character.codePointAt(0).toString(16).toUpperCase()}`,
      );
    }
  }
}

function measure(font, text, size) {
  const path = font.getPath(text, 0, 0, size);
  const { x1, y1, x2, y2 } = path.getBoundingBox();
  const advance = font.getAdvanceWidth(text, size);
  if (![x1, y1, x2, y2, advance].every(finite) || x2 < x1 || y2 < y1 || advance < 0) {
    throw new Error("Invalid sharing-card font metrics");
  }
  return { text, path, x1, y1, x2, y2, width: Math.max(advance, x2) - Math.min(0, x1) };
}

function wrap(font, text, size, maxWidth) {
  const whole = measure(font, text, size);
  if (whole.width <= maxWidth) return [whole];
  const words = text.split(" ");
  const best = new Array(words.length + 1);
  best[words.length] = { count: 0, cost: 0, lines: [] };
  // Minimize line count first, then squared line widths. For a fixed count,
  // this favors balanced lines over a full line followed by an orphan word.
  for (let i = words.length - 1; i >= 0; i--) {
    let lineText = "";
    for (let j = i; j < words.length; j++) {
      lineText = lineText ? `${lineText} ${words[j]}` : words[j];
      const line = measure(font, lineText, size);
      if (line.width > maxWidth) break;
      const remainder = best[j + 1];
      if (!remainder) continue;
      const count = 1 + remainder.count;
      const cost = line.width ** 2 + remainder.cost;
      const current = best[i];
      if (!current || count < current.count || (count === current.count && cost < current.cost)) {
        best[i] = { count, cost, lines: [line, ...remainder.lines] };
      }
    }
  }
  return best[0]?.lines;
}

function placement(line, x, baseline) {
  const origin = x - Math.min(0, line.x1);
  const { text, path, x1, y1, x2, y2 } = line;
  return {
    text,
    path: path.toPathData(3),
    x: origin,
    baseline,
    bounds: { left: origin + x1, top: baseline + y1, right: origin + x2, bottom: baseline + y2 },
  };
}

/**
 * Create a static article card using caller-supplied complete local fonts,
 * artwork and a deterministic SVG rasterizer. No web fonts, network or browser.
 * Layout values are in 1200x630 output pixels, not CSS or preview pixels.
 */
export function createArticleCardRenderer({ brand, layout, titleFont, domainFont, rasterize }) {
  const { background, heading, foreground } = brand;
  [background, heading, foreground].forEach(color);
  const domain = normalize(brand.domain);
  const logo = Buffer.from(brand.logo.bytes);
  const mime = brand.logo.mime;
  if (
    !logo.length ||
    !(
      (mime === "image/png" && logo.subarray(0, 8).equals(PNG_SIGNATURE)) ||
      (mime === "image/jpeg" && logo[0] === 255 && logo[1] === 216)
    )
  ) {
    throw new Error("Sharing card logo must be a local PNG or JPEG");
  }
  const {
    left,
    right,
    top,
    bottom,
    logoSize,
    titleGap,
    maxTitleSize,
    minTitleSize,
    lineHeight,
    domainSize,
  } = layout;
  const sizes = [
    left,
    right,
    top,
    bottom,
    logoSize,
    titleGap,
    maxTitleSize,
    minTitleSize,
    domainSize,
  ];
  if (
    !sizes.every((value) => Number.isSafeInteger(value) && value > 0) ||
    !finite(lineHeight) ||
    lineHeight < 1 ||
    lineHeight > 2 ||
    maxTitleSize < minTitleSize ||
    maxTitleSize > 200 ||
    left + right + logoSize >= WIDTH ||
    top + bottom + logoSize + titleGap >= HEIGHT
  ) {
    throw new Error("Invalid sharing-card layout");
  }
  const anchor = HEIGHT - bottom - logoSize;
  const titleBottom = anchor - titleGap;
  const logoLeft = WIDTH - right - logoSize;
  const maxWidth = WIDTH - left - right;
  assertGlyphs(domainFont, domain);
  const domainLine = measure(domainFont, domain, domainSize);
  const domainPlacement = placement(domainLine, left, anchor - domainLine.y1);
  if (
    domainPlacement.bounds.right > logoLeft - titleGap ||
    domainPlacement.bounds.bottom > HEIGHT - bottom
  ) {
    throw new Error("Sharing-card domain overlaps the logo or safe area");
  }
  const logoUri = `data:${mime};base64,${logo.toString("base64")}`;
  const svgPath = ({ path, x, baseline }, fill) =>
    `<path fill="${fill}" transform="translate(${x} ${baseline})" d="${path}"/>`;

  return function renderArticleCard(rawTitle) {
    const title = normalize(rawTitle);
    assertGlyphs(titleFont, title);
    for (let fontSize = maxTitleSize; fontSize >= minTitleSize; fontSize--) {
      const lines = wrap(titleFont, title, fontSize, maxWidth);
      if (!lines) continue;
      const step = fontSize * lineHeight;
      const lastBaseline = titleBottom - lines[lines.length - 1].y2;
      const placed = lines.map((line, index) =>
        placement(line, left, lastBaseline - (lines.length - 1 - index) * step),
      );
      if (
        placed.some(
          ({ bounds }, index) =>
            bounds.top < top ||
            bounds.bottom > titleBottom ||
            bounds.left < left ||
            bounds.right > WIDTH - right ||
            (index > 0 && bounds.top < placed[index - 1].bounds.bottom),
        )
      )
        continue;

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="${background}"/>${placed.map((line) => svgPath(line, heading)).join("")}${svgPath(domainPlacement, foreground)}<image x="${logoLeft}" y="${anchor}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMaxYMin meet" xlink:href="${logoUri}"/></svg>`;
      const png = Buffer.from(rasterize(svg));
      if (
        png.length < 24 ||
        !png.subarray(0, 8).equals(PNG_SIGNATURE) ||
        png.toString("ascii", 12, 16) !== "IHDR" ||
        png.readUInt32BE(16) !== WIDTH ||
        png.readUInt32BE(20) !== HEIGHT
      ) {
        throw new Error("Sharing-card rasterizer must return a 1200x630 PNG");
      }
      const receipt = {
        title,
        fontSize,
        lines: placed.map(({ text, bounds }) => ({ text, bounds })),
        domain: { text: domain, bounds: { ...domainPlacement.bounds } },
        logo: { left: logoLeft, top: anchor, right: WIDTH - right, bottom: HEIGHT - bottom },
      };
      return { png, receipt };
    }
    throw new Error(`Sharing-card title cannot fit without clipping: ${title}`);
  };
}
