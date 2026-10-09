export interface ConnectionHints {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
  readonly downlink?: number;
  readonly rtt?: number;
}

/** No persistent preferences, prompts, provider calls or analytics. */
export function backgroundDownloadsAllowed(connection?: ConnectionHints, online = true): boolean {
  return (
    online &&
    !connection?.saveData &&
    !/^(slow-2g|2g|3g)$/i.test(connection?.effectiveType ?? "") &&
    !(
      typeof connection?.downlink === "number" &&
      connection.downlink > 0 &&
      connection.downlink < 1.5
    ) &&
    !(typeof connection?.rtt === "number" && connection.rtt >= 500)
  );
}

export interface NavigationPrefetchOptions {
  /** Per document, 0 disables; bounded to at most 12 distinct targets. Default 6. */
  maxTargets?: number;
  /** Intent debounce, default 120ms. */
  delayMs?: number;
  /** Additional consumer-owned route restrictions. */
  include?: (url: URL) => boolean;
}

/** Consumer injects Astro's native prefetch; no second fetch/cache implementation. */
export function installNavigationPrefetch(
  prefetch: (url: string) => void,
  options: NavigationPrefetchOptions = {},
): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};
  const maximum = options.maxTargets ?? 6;
  const delay = options.delayMs ?? 120;
  if (
    !Number.isInteger(maximum) ||
    maximum < 0 ||
    maximum > 12 ||
    !Number.isFinite(delay) ||
    delay < 0 ||
    delay > 2000
  )
    throw new RangeError("Prefetch requires a bounded target count and delay");
  const requested = new Set<string>();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const allowed = () =>
    backgroundDownloadsAllowed(
      (navigator as Navigator & { connection?: ConnectionHints }).connection,
      navigator.onLine,
    ) && document.visibilityState !== "hidden";
  const anchor = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
  const cancel = () => clearTimeout(timer);
  const schedule = (event: Event) => {
    const link = anchor(event.target);
    if (
      !link ||
      link.hasAttribute("download") ||
      (link.target && link.target !== "_self") ||
      requested.size >= maximum ||
      !allowed()
    )
      return;
    if (event instanceof MouseEvent && anchor(event.relatedTarget) === link) return;
    const url = new URL(link.href, location.href);
    if (
      url.origin !== location.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname === location.pathname ||
      /^\/(api|share)(\/|$)/.test(url.pathname) ||
      /\.[^/]+$/.test(url.pathname) ||
      options.include?.(url) === false ||
      requested.has(url.href)
    )
      return;
    cancel();
    timer = setTimeout(() => {
      if (!allowed() || requested.size >= maximum || requested.has(url.href)) return;
      requested.add(url.href);
      prefetch(url.href);
    }, delay);
  };
  const leave = (event: Event) => {
    if (event instanceof MouseEvent && anchor(event.relatedTarget) === anchor(event.target)) return;
    cancel();
  };
  for (const name of ["mouseover", "focusin"])
    document.addEventListener(name, schedule, { passive: true, signal: controller.signal });
  for (const name of ["mouseout", "focusout"])
    document.addEventListener(name, leave, { passive: true, signal: controller.signal });
  return () => {
    cancel();
    controller.abort();
  };
}
