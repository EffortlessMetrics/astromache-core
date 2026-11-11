import type { AstroIntegration } from "astro";
export interface PublicationHeadOptions {
  title: string;
  description: string;
  canonical: URL | string;
  type?: "website" | "article";
  image?: { url: URL | string; alt: string; width?: number; height?: number };
  published?: Date | string;
  modified?: Date | string;
  author?: { name: string; url?: URL | string };
  markdown?: boolean;
  body?: "marked" | "main";
}
export interface StaticPublicationOptions {
  origin: string;
  markdown?: boolean;
  sitemap?: string;
  feed?: string;
  /** Array or {data: array}; each entry has a canonical root-relative or absolute url. */
  searchIndex?: string;
  /** Replace search entries' text from their rendered public bodies before offline hashing. */
  renderedSearch?: boolean;
  /** Exact same-origin routes served by the host rather than emitted as files. */
  externalRoutes?: readonly string[];
}
export interface PublicationReport {
  schemaVersion: number;
  html: Array<{ path: string; sha256: string }>;
  documents: Array<{ html: string; canonical: string; markdown: string; sha256: string }>;
  /** Present when renderedSearch rewrote the search index. */
  searchSha256?: string;
}
export function markdownURL(canonical: URL | string): URL;
export function publicationHead(input: PublicationHeadOptions): {
  title: string;
  description: string;
  canonical: string;
  type: "website" | "article";
  image?: { url: string; alt: string; width?: number; height?: number };
  published?: string;
  modified?: string;
  author?: { name: string; url?: string };
  alternate?: string;
  body: "marked" | "main";
  structured?: Record<string, unknown>;
};
export function jsonForHTML(value: unknown): string;
export function buildPublication(
  directory: string,
  options: StaticPublicationOptions,
): Promise<PublicationReport>;
export function auditPublication(
  directory: string,
  options: StaticPublicationOptions,
): Promise<unknown>;
export default function staticPublication(options: StaticPublicationOptions): AstroIntegration;
