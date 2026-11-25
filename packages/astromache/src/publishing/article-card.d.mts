import type { Buffer } from "node:buffer";

export interface CardBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CardFont {
  charToGlyphIndex(text: string): number;
  getAdvanceWidth(text: string, size: number): number;
  getPath(
    text: string,
    x: number,
    y: number,
    size: number,
  ): {
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
    toPathData(precision: number): string;
  };
}

export interface CardLayout {
  left: number;
  right: number;
  top: number;
  bottom: number;
  logoSize: number;
  titleGap: number;
  maxTitleSize: number;
  minTitleSize: number;
  lineHeight: number;
  domainSize: number;
}

export interface CardReceipt {
  title: string;
  fontSize: number;
  lines: { text: string; bounds: CardBounds }[];
  domain: { text: string; bounds: CardBounds };
  logo: CardBounds;
}

export function createArticleCardRenderer(options: {
  brand: {
    background: string;
    heading: string;
    foreground: string;
    domain: string;
    logo: { mime: "image/png" | "image/jpeg"; bytes: Uint8Array };
  };
  layout: CardLayout;
  titleFont: CardFont;
  domainFont: CardFont;
  rasterize: (svg: string) => Uint8Array;
}): (title: string) => { png: Buffer; receipt: CardReceipt };
