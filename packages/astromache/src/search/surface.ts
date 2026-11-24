import { createSearchResultsController } from "./client.js";

export interface SearchLink {
  href: string;
  title: string;
  summary: string;
  tags?: readonly string[];
}

export interface SearchSurfaceOptions {
  execute(query: string, signal: AbortSignal, limit: number): Promise<readonly SearchLink[]>;
  disposeBackend?: () => void;
  failureMessage?: string;
  delayMs?: number;
  autofocusRecovery?: boolean;
}

/** Reject malformed or cross-origin destinations without discarding valid neighbors. */
export function safeSearchLinks(rows: readonly SearchLink[]): SearchLink[] {
  return rows.filter((row) => {
    if (
      !row ||
      typeof row.href !== "string" ||
      typeof row.title !== "string" ||
      typeof row.summary !== "string" ||
      !row.href.startsWith("/") ||
      row.href.startsWith("//") ||
      /[\\\u0000-\u0020\u007f]/u.test(row.href)
    )
      return false;
    try {
      return new URL(row.href, "https://search.invalid").origin === "https://search.invalid";
    } catch {
      return false;
    }
  });
}

/** Bind one server-rendered search surface to a consumer-provided backend. */
export function bindSearchSurface(root: HTMLElement, options: SearchSurfaceOptions): () => void {
  const owner = root.ownerDocument;
  const view = owner.defaultView;
  const input = root.querySelector<HTMLInputElement>("[data-search-input]");
  const status = root.querySelector<HTMLElement>("[data-search-status]");
  const retry = root.querySelector<HTMLButtonElement>("[data-search-retry]");
  const results = root.querySelector<HTMLElement>("[data-search-results]");
  const kind = root.dataset.searchSurface;
  if (!view || !input || !status || !retry || !results || !["page", "recovery"].includes(kind ?? ""))
    throw new Error("Invalid search surface");
  const recovery = kind === "recovery";
  const limit = recovery ? 5 : 50;
  const listeners = new AbortController();
  const listen = { signal: listeners.signal };
  let selected = 0;
  let pending = false;
  let resume = false;
  const links = () => [...results.querySelectorAll<HTMLAnchorElement>("a[href]")];
  const select = (index: number) => {
    const rows = links();
    selected = Math.max(0, Math.min(index, rows.length - 1));
    rows.forEach((link, i) => link.toggleAttribute("data-selected", i === selected));
  };
  const controller = createSearchResultsController({
    delayMs: options.delayMs,
    minLength: recovery ? 1 : 2,
    execute: (query, signal) => options.execute(query, signal, limit),
    onState(state) {
      pending = state.status === "pending";
      root.setAttribute("aria-busy", String(pending));
      results.replaceChildren();
      retry.hidden = state.status !== "failed";
      if (state.status === "idle") {
        status.textContent = recovery
          ? root.dataset.idleMessage ?? ""
          : state.query
            ? "Type at least 2 characters."
            : "";
      } else if (state.status === "pending") {
        status.textContent = "Searching...";
      } else if (state.status === "failed") {
        status.textContent = options.failureMessage ?? "Search is currently unavailable.";
      } else if (state.status === "ready") {
        const rows = safeSearchLinks(state.results).slice(0, limit);
        status.textContent = rows.length
          ? rows.length + (rows.length === 1 ? " result" : " results") + (recovery ? "" : " found")
          : recovery
            ? "No results found"
            : "No results found for “" + state.query + "”.";
        for (const row of rows) {
          const card = owner.createElement(recovery ? "li" : "article");
          const link = owner.createElement("a");
          link.href = row.href;
          link.textContent = row.title;
          const summary = owner.createElement(recovery ? "small" : "p");
          summary.textContent = row.summary;
          if (recovery) {
            link.append(summary);
            card.append(link);
          } else {
            const heading = owner.createElement("h2");
            heading.append(link);
            card.append(heading, summary);
            if (Array.isArray(row.tags) && row.tags.length) {
              const tags = owner.createElement("ul");
              tags.className = "result-tags";
              tags.setAttribute("aria-label", "Tags");
              for (const tag of row.tags.slice(0, 5)) {
                if (typeof tag !== "string") continue;
                const item = owner.createElement("li");
                item.textContent = tag;
                tags.append(item);
              }
              card.append(tags);
            }
          }
          results.append(card);
        }
        if (recovery) select(0);
      }
    },
  });
  input.addEventListener(
    "input",
    (event) => {
      if (!(event as InputEvent).isComposing) controller.submit(input.value);
    },
    listen,
  );
  input.addEventListener("compositionend", () => controller.submit(input.value), listen);
  input.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing) return;
      if (recovery && (event.key === "ArrowDown" || event.key === "ArrowUp") && links().length) {
        event.preventDefault();
        select(selected + (event.key === "ArrowDown" ? 1 : -1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const selectedLink = recovery && links()[selected];
        if (selectedLink) selectedLink.click();
        else controller.submit(input.value, true);
      } else if (recovery && event.key === "Escape") {
        input.value = "";
        controller.submit("");
      }
    },
    listen,
  );
  retry.addEventListener("click", controller.retry, listen);
  const dispose = () => {
    if (listeners.signal.aborted) return;
    listeners.abort();
    controller.dispose();
    options.disposeBackend?.();
  };
  view.addEventListener(
    "pagehide",
    (event) => {
      if (!event.persisted) return dispose();
      resume = pending;
      controller.cancel();
      pending = false;
      root.setAttribute("aria-busy", "false");
    },
    listen,
  );
  view.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted && resume) {
        resume = false;
        controller.submit(input.value, true);
      }
    },
    listen,
  );
  if (!recovery) {
    input.value = new URLSearchParams(view.location.search).get("q") ?? "";
    if (input.value) controller.submit(input.value, true);
  } else if (options.autofocusRecovery) {
    input.focus({ preventScroll: true });
  }
  return dispose;
}
