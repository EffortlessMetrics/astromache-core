import { expect, test } from "vite-plus/test";
import { createSearchResultsController, mountSearchPalette } from "./client.js";
import type { SearchResultsState } from "./client.js";

test("connects the original openSearch event and removes the listener on disposal", () => {
  const document = new EventTarget();
  const trigger = new EventTarget();
  Object.assign(trigger, { ownerDocument: document });
  const mount = { ownerDocument: document } as unknown as HTMLElement;
  let opened = 0;
  let mounted = 0;
  let unmounted = 0;
  document.addEventListener("openSearch", () => opened++);
  const dispose = mountSearchPalette(
    mount,
    () => {
      mounted++;
      return () => unmounted++;
    },
    trigger as unknown as HTMLElement,
  );
  trigger.dispatchEvent(new Event("click"));
  dispose();
  dispose();
  trigger.dispatchEvent(new Event("click"));
  expect({ opened, mounted, unmounted }).toEqual({ opened: 1, mounted: 1, unmounted: 1 });
});

test("invalidates earlier requests even when the backend ignores cancellation", async () => {
  const earlier = Promise.withResolvers<string>();
  const latest = Promise.withResolvers<string>();
  const states: SearchResultsState<string>[] = [];
  const signals: AbortSignal[] = [];
  const controller = createSearchResultsController({
    execute(query, signal) {
      signals.push(signal);
      return query === "earlier" ? earlier.promise : latest.promise;
    },
    onState: (state) => states.push(state),
  });
  controller.submit("earlier", true);
  controller.submit("latest", true);
  expect(signals[0].aborted).toBe(true);
  latest.resolve("new");
  await latest.promise;
  earlier.resolve("old");
  await earlier.promise;
  expect(states.at(-1)).toEqual({ status: "ready", query: "latest", results: "new" });
  controller.dispose();
});

test("distinguishes failure from no results and allows retry", async () => {
  const states: SearchResultsState<string[]>[] = [];
  let attempts = 0;
  const controller = createSearchResultsController({
    async execute() {
      if (++attempts === 1) throw new Error("unavailable");
      return [];
    },
    onState: (state) => states.push(state),
  });
  controller.submit("one", true);
  await Promise.resolve();
  expect(states.at(-1)?.status).toBe("failed");
  controller.retry();
  await Promise.resolve();
  expect(states.at(-1)).toEqual({ status: "ready", query: "one", results: [] });
  controller.dispose();
});

test("clearing or disposing invalidates delayed execution", async () => {
  const states: SearchResultsState<string>[] = [];
  let attempts = 0;
  const controller = createSearchResultsController({
    delayMs: 1,
    async execute(query) {
      attempts++;
      return query;
    },
    onState: (state) => states.push(state),
  });
  controller.submit("queued");
  controller.submit("");
  expect(states.at(-1)).toEqual({ status: "idle", query: "" });
  controller.submit("also queued");
  controller.dispose();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(attempts).toBe(0);
});
