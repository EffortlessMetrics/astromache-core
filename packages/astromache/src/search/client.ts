/** Connect the existing TypeAnywhereSearch event without owning its UI or engine. */
export function mountSearchPalette(
  target: HTMLElement,
  render: (target: HTMLElement) => () => void,
  trigger?: HTMLElement | null,
): () => void {
  if (trigger && trigger.ownerDocument !== target.ownerDocument) {
    throw new Error("Search trigger and mount must belong to the same document");
  }
  const unmount = render(target);
  const open = () => target.ownerDocument.dispatchEvent(new CustomEvent("openSearch"));
  trigger?.addEventListener("click", open);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    trigger?.removeEventListener("click", open);
    unmount();
  };
}

export type SearchResultsState<T> =
  | { status: "idle" | "pending"; query: string }
  | { status: "ready"; query: string; results: T }
  | { status: "failed"; query: string; error: unknown };

export interface SearchResultsOptions<T> {
  execute(query: string, signal: AbortSignal): Promise<T>;
  onState(state: SearchResultsState<T>): void;
  delayMs?: number;
  minLength?: number;
}

/** Dedicated and recovery search share request ownership, not the palette's internals. */
export function createSearchResultsController<T>(options: SearchResultsOptions<T>) {
  const delay = options.delayMs ?? 300;
  const minimum = options.minLength ?? 2;
  if (
    !Number.isInteger(delay) ||
    delay < 0 ||
    delay > 2000 ||
    !Number.isInteger(minimum) ||
    minimum < 1
  ) {
    throw new RangeError("Search requires a bounded debounce and positive minimum query length");
  }
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined;
  let query = "";
  let disposed = false;
  const cancel = () => {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    active?.abort();
    active = undefined;
  };
  const submit = (value: string, immediate = false) => {
    if (disposed) return;
    cancel();
    query = value.trim();
    const current = generation;
    const requested = query;
    if (requested.length < minimum) {
      options.onState({ status: "idle", query: requested });
      return;
    }
    options.onState({ status: "pending", query: requested });
    const run = async () => {
      if (disposed || generation !== current) return;
      const controller = new AbortController();
      active = controller;
      let state: SearchResultsState<T>;
      try {
        const results = await options.execute(requested, controller.signal);
        state = { status: "ready", query: requested, results };
      } catch (error) {
        state = { status: "failed", query: requested, error };
      }
      if (disposed || generation !== current || controller.signal.aborted) return;
      active = undefined;
      options.onState(state);
    };
    if (immediate) void run();
    else timer = setTimeout(() => void run(), delay);
  };
  return {
    submit,
    retry: () => submit(query, true),
    cancel,
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
