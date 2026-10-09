import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../recipes/search-offline/src/pages/search.astro", import.meta.url),
  "utf8",
);
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "Exercise the real recipe submit/lifecycle script");
const compiled = ts.transpileModule(script.replace(/^import .*;\s*$/gm, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture({
  init = () => Promise.resolve(),
  search = (query) => Promise.resolve([{ title: query, url: "/" + query }]),
} = {}) {
  const callbacks = new Map();
  const formCallbacks = [];
  const calls = [];
  const input = { value: "" },
    status = { textContent: "" },
    list = {
      children: [],
      replaceChildren(...children) {
        this.children = children;
      },
    };
  let disposed = 0;
  const backend = {
    init(request) {
      calls.push({ kind: "init", signal: request.signal });
      return init(request);
    },
    search(query, _options, request) {
      calls.push({ kind: "search", query, signal: request.signal });
      return search(query, request);
    },
    dispose() {
      disposed++;
    },
  };
  const form = {
    addEventListener(type, callback) {
      assert.equal(type, "submit");
      formCallbacks.push(callback);
    },
  };
  vm.runInNewContext(compiled, {
    createStaticIndexLoader: () => ({}),
    createStaticSearchBackend: () => backend,
    AbortController,
    DOMException,
    document: {
      querySelector(selector) {
        return {
          "#search-form": form,
          "#query": input,
          "#search-status": status,
          "#search-results": list,
        }[selector];
      },
      createElement() {
        return {
          children: [],
          append(child) {
            this.children.push(child);
          },
        };
      },
    },
    window: {
      addEventListener(type, callback) {
        const existing = callbacks.get(type) ?? [];
        existing.push(callback);
        callbacks.set(type, existing);
      },
    },
  });
  return {
    calls,
    input,
    status,
    list,
    get disposed() {
      return disposed;
    },
    submit(query) {
      input.value = query;
      assert.equal(formCallbacks.length, 1, "One submit listener per document");
      return formCallbacks[0]({ preventDefault() {} });
    },
    hide(persisted) {
      assert.equal(callbacks.get("pagehide")?.length, 1, "One recurring hide listener");
      for (const callback of callbacks.get("pagehide")) callback({ persisted });
    },
    results() {
      return list.children.map((item) => item.children[0].textContent);
    },
  };
}

const tests = [
  [
    "cold initialization keeps the submitted query, not an unsent edit",
    async () => {
      const pending = deferred();
      const state = fixture({ init: () => pending.promise });
      const request = state.submit("submitted");
      state.input.value = "unsent edit";
      pending.resolve();
      await request;
      assert.deepEqual(state.results(), ["submitted"]);
    },
  ],
  [
    "warm supersession cannot dispatch duplicate work using replacement signal",
    async () => {
      const state = fixture();
      const first = state.submit("superseded");
      const second = state.submit("latest");
      await Promise.all([first, second]);
      assert.equal(state.calls.filter((call) => call.kind === "search").length, 1);
      assert.deepEqual(state.results(), ["latest"]);
    },
  ],
  [
    "pending init cancels only caller on persisted hide and can resume on restore",
    async () => {
      const pending = deferred();
      const state = fixture({ init: () => pending.promise });
      const request = state.submit("departing");
      state.hide(true);
      assert.equal(state.calls[0].signal.aborted, true);
      assert.equal(state.disposed, 0);
      pending.resolve();
      await request;
      assert.equal(state.calls.filter((call) => call.kind === "search").length, 0);
      await state.submit("restored");
      assert.deepEqual(state.results(), ["restored"]);
    },
  ],
  [
    "late search success cannot replace newer restored results",
    async () => {
      const old = deferred();
      const state = fixture({
        search: (query) =>
          query === "old" ? old.promise : Promise.resolve([{ title: query, url: "/" + query }]),
      });
      const request = state.submit("old");
      await tick();
      state.hide(true);
      await state.submit("new");
      old.resolve([{ title: "stale", url: "/stale" }]);
      await request;
      assert.deepEqual(state.results(), ["new"]);
      assert.equal(state.status.textContent, "1 results");
    },
  ],
  [
    "late search error cannot overwrite latest restored status",
    async () => {
      const old = deferred();
      const state = fixture({
        search: (query) =>
          query === "old" ? old.promise : Promise.resolve([{ title: query, url: "/" + query }]),
      });
      const request = state.submit("old");
      await tick();
      state.hide(true);
      await state.submit("new");
      old.reject(new Error("old failure"));
      await request;
      assert.deepEqual(state.results(), ["new"]);
      assert.equal(state.status.textContent, "1 results");
    },
  ],
  [
    "repeated persisted exits retain one listener then genuine teardown disposes",
    async () => {
      const state = fixture();
      for (let cycle = 0; cycle < 4; cycle++) {
        await state.submit("cycle" + cycle);
        state.hide(true);
        assert.equal(state.disposed, 0);
      }
      state.hide(false);
      assert.equal(state.disposed, 1);
      assert.equal(state.calls.at(-2).signal.aborted, true);
    },
  ],
  [
    "pending init cannot dispatch after nonpersisted teardown",
    async () => {
      const pending = deferred();
      const state = fixture({ init: () => pending.promise });
      const request = state.submit("discarded");
      state.hide(false);
      pending.resolve();
      await request;
      assert.equal(state.disposed, 1);
      assert.equal(state.calls.filter((call) => call.kind === "search").length, 0);
      assert.equal(state.status.textContent, "");
    },
  ],
];
let failures = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log("PASS", name);
  } catch (error) {
    failures++;
    console.error("FAIL", name, error);
  }
}
assert.equal(failures, 0, `${failures} real recipe request/lifecycle contracts failed`);
console.log(`Recipe request/lifecycle contracts passed (${tests.length}).`);
