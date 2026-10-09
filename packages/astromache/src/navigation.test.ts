import { expect, test } from "vite-plus/test";
import { backgroundDownloadsAllowed, installNavigationPrefetch } from "./navigation.js";

test("background intent respects offline, Save-Data and slow network hints", () => {
  expect(backgroundDownloadsAllowed(undefined, false)).toBe(false);
  for (const hints of [
    { saveData: true },
    { effectiveType: "slow-2g" },
    { effectiveType: "2g" },
    { effectiveType: "3g" },
    { downlink: 1 },
    { rtt: 500 },
  ])
    expect(backgroundDownloadsAllowed(hints)).toBe(false);
  for (const hints of [
    undefined,
    { effectiveType: "4g", downlink: 5, rtt: 100 },
    { downlink: 0, rtt: 0 },
  ])
    expect(backgroundDownloadsAllowed(hints)).toBe(true);
});
test("navigation helper is inert during SSR", () => {
  const calls: string[] = [];
  const dispose = installNavigationPrefetch((url) => calls.push(url));
  dispose();
  expect(calls).toEqual([]);
});
