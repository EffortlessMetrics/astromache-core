import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { verifyPublicationBrowser } from "./verify-publication-browser.mjs";
import { verifyRecipeBFCache } from "./verify-recipe-bfcache.mjs";
import { verifyRecipeFreshness } from "./verify-recipe-freshness.mjs";
import { verifyRecipeLifecycle } from "./verify-recipe-lifecycle.mjs";
import { verifyRecipeCanonical } from "./verify-recipe-canonical.mjs";
import {
  packCurrentPublication,
  upgradePublication,
  verifyPublicationUpgradeNegatives,
} from "./verify-publication-upgrade.mjs";
import { verifyPublicationWorkerUpgrade } from "./verify-publication-worker-upgrade.mjs";

await import("./verify-recipe-request-contracts.mjs");

const producer = await realpath(fileURLToPath(new URL("../", import.meta.url)));
execFileSync(process.execPath, [join(producer, "scripts/verify-starter-paths.mjs")], {
  cwd: producer,
  stdio: "inherit",
});
const manager = join(producer, "node_modules/pnpm/bin/pnpm.cjs");
assert.match(process.version, /^v24\./, "Use the qualification Node 24 toolchain");
const root = await realpath(
  await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "astromache-products-")),
);
assert.ok(
  !relative(producer, root).startsWith(`.${sep}`) && !root.startsWith(producer + sep),
  "Products must be copied outside producer",
);
const current = process.argv.includes("--current-packed");
const candidate = current ? await packCurrentPublication(producer, root, manager) : undefined;
const products = [
  ["starters/publication", false],
  ["recipes/search-offline", true],
];
for (const [source, recipe] of products.filter(
  ([, recipe]) => !process.argv.includes("--recipe-only") || recipe,
)) {
  const directory = resolve(root, recipe ? "recipe" : "starter");
  execFileSync(
    process.execPath,
    [
      join(producer, "scripts/create-starter.mjs"),
      recipe ? "search-offline" : "publication",
      directory,
    ],
    {
      cwd: producer,
      stdio: "inherit",
    },
  );
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  assert.equal(
    manifest.pnpm?.overrides,
    undefined,
    "Ordinary Astro product must not override Vite",
  );
  assert.equal(
    manifest.pnpm?.patchedDependencies,
    undefined,
    "Ordinary Astro product must not patch compiler",
  );
  const run = (args, cwd = directory) =>
    execFileSync(process.execPath, [manager, ...args], {
      cwd,
      stdio: "inherit",
      timeout: 300000,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? process.env.Path ?? ""}`,
      },
    });
  const upgrade = current
    ? await upgradePublication(directory, candidate, run, { recipe })
    : undefined;
  if (!current) run(["install", "--frozen-lockfile", "--ignore-scripts"]);
  run(["qualify"]);
  await verifyPublicationBrowser(directory, { recipe, current });
  if (recipe) {
    await verifyRecipeBFCache(directory);
    await verifyRecipeFreshness(directory);
    await verifyRecipeLifecycle(directory);
    await verifyRecipeCanonical(directory);
    if (current) {
      upgrade.receipt.naturalWorkerUpgrade = await verifyPublicationWorkerUpgrade(
        upgrade.baseline,
        directory,
      );
      upgrade.receipt.negatives = await verifyPublicationUpgradeNegatives(
        directory,
        candidate,
        run,
      );
    }
  }
  if (current) {
    await upgrade.verifyUnchanged();
    await writeFile(
      join(directory, "CURRENT-PACKED-QUALIFICATION.json"),
      JSON.stringify({ pass: true, ...upgrade.receipt }, null, 2) + "\n",
    );
    console.log("Current full-consumer receipt", JSON.stringify(upgrade.receipt));
  }
  console.log(
    `Independent ${source}${current ? ` upgraded to freshly packed ${candidate.manifest.version}` : " historical 0.2.0"}: frozen installation, ordinary Astro qualification and browser flows passed (${directory})`,
  );
}
