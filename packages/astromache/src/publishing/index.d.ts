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
  /** Opt-in discovery audit with an independent consumer-owned route inventory. */
  discovery?: (
    | { expectedRoutes: readonly string[]; expectedRoutesFile?: never }
    | { expectedRoutesFile: string; expectedRoutes?: never }
  ) & { excludePaths?: readonly string[] };
}
export interface PublicationReport {
  schemaVersion: number;
  html: Array<{ path: string; sha256: string }>;
  documents: Array<{ html: string; canonical: string; markdown: string; sha256: string }>;
  /** Present when renderedSearch rewrote the search index. */
  searchSha256?: string;
  discovery?: DiscoveryManifest;
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

export interface DiscoveryPage {
  url: string;
  lastmod?: string;
  contentSha256: string;
}
export interface DiscoveryManifest {
  schemaVersion: 1;
  fingerprintVersion: 2;
  origin: string;
  sitemap: string;
  pages: DiscoveryPage[];
}
export interface DiscoveryDelta {
  added: string[];
  modified: string[];
  removed: string[];
  dateWarnings: string[];
}
export function sitemapLastmod(
  published?: Date | string | null,
  modified?: Date | string | null,
): string | undefined;
export function diffDiscoveryManifests(
  previous: DiscoveryManifest | null,
  current: DiscoveryManifest,
): DiscoveryDelta;
export function verifyHostedDiscovery(
  manifest: DiscoveryManifest,
  fetcher?: typeof fetch,
): Promise<{ origin: string; pages: number; sitemap: string }>;
export function submitIndexNow(
  input: { previous: DiscoveryManifest | null; current: DiscoveryManifest; key: string },
  fetcher?: typeof fetch,
): Promise<
  DiscoveryDelta & {
    complete: boolean;
    batches: {
      urls: string[];
      status: number | null;
      outcome: "acknowledged" | "key-pending" | "retryable" | "rejected";
      retryAfter?: string;
    }[];
  }
>;

export type NotificationPageState = Pick<DiscoveryPage, "contentSha256" | "lastmod"> | null;
export interface AcceptedDiscoveryDeployment {
  environment: "production";
  deploymentId: string;
  sourceSha: string;
  manifestSha256: string;
  hostedReceiptSha256: string;
  manifest: DiscoveryManifest;
}
export interface NotificationRow {
  url: string;
  state: NotificationPageState;
}
export interface PendingNotification extends NotificationRow {
  status: "ready" | "retryable" | "key-pending" | "rejected";
  attempts: number;
  notBefore: number | null;
  lastStatus: number | null;
}
export interface NotificationIntent {
  attemptId: string;
  deploymentId: string;
  manifestSha256: string;
  startedAt: number;
  rows: NotificationRow[];
}
export interface NotificationLedger {
  schemaVersion: 1;
  origin: string;
  revision: number;
  deployed: AcceptedDiscoveryDeployment | null;
  acknowledged: NotificationRow[];
  pending: PendingNotification[];
  inFlight: NotificationIntent | null;
}
export interface NotificationReceipt {
  attemptId: string;
  deploymentId: string;
  manifestSha256: string;
  startedAt: number;
  finishedAt: number;
  status: number | null;
  outcome: "acknowledged" | "key-pending" | "retryable" | "rejected";
  retryAfter?: string;
  urls: string[];
}
export function discoveryManifestSha256(manifest: DiscoveryManifest): string;
export function createNotificationLedger(origin: string, retiredUrls?: readonly string[]): NotificationLedger;
export function observeNotificationDeployment(
  ledger: NotificationLedger,
  acceptance: AcceptedDiscoveryDeployment,
): NotificationLedger;
export function beginNotificationBatch(
  ledger: NotificationLedger,
  options: { now: number; limit?: number },
): { ledger: NotificationLedger; intent: NotificationIntent | null };
export function settleNotificationBatch(
  ledger: NotificationLedger,
  response: { attemptId: string; status: number | null; retryAfter?: string; now: number },
): { ledger: NotificationLedger; receipt: NotificationReceipt };
export function recoverNotificationBatch(
  ledger: NotificationLedger,
  now: number,
): { ledger: NotificationLedger; receipt: NotificationReceipt | null };
export function resetRejectedNotifications(
  ledger: NotificationLedger,
  urls: readonly string[],
): NotificationLedger;
