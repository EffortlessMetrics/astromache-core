import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { verifyPackedPortfolioBrowser } from "./verify-packed-portfolio-browser.mjs";

// Windows hosted tmpdir can use a DOS alias (RUNNER~1). Astro/Vite CSS module
// identities must use the same canonical path as the files they resolve.
const root = await realpath(
  await mkdtemp(
    join(
      process.env.ASTROMACHE_QUALIFICATION_ROOT ?? process.env.RUNNER_TEMP ?? tmpdir(),
      "astromache-qualification-",
    ),
  ),
);
const manager = resolve("node_modules/pnpm/bin/pnpm.cjs");
await mkdir(root, { recursive: true });
const run = await mkdtemp(join(root, "packed-"));
execFileSync(process.execPath, [manager, "pack", "--pack-destination", run], {
  cwd: "packages/astromache",
  stdio: "inherit",
});
const archive = (await readdir(run)).find((file) => file.endsWith(".tgz"));
assert.ok(archive);
const tarball = join(run, archive);
const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/)
  .filter((entry) => !entry.endsWith("/"));
const expected = [
  "CHANGELOG.md",
  "LICENSE",
  "LICENSE-MIT",
  "LICENSE-APACHE",
  "README.md",
  "package.json",
  "fonts/OFL.txt",
  "fonts/provenance.json",
  "fonts/IBMPlexSans-Regular.woff2",
  "fonts/IBMPlexMono-Regular.woff2",
  "src/fonts.css",
  "src/Portfolio.astro",
  "src/PortfolioLightbox.astro",
  "src/Document.astro",
  "src/metadata.ts",
  "src/navigation.ts",
  "src/static-offline.mjs",
  "src/static-offline.d.ts",
  "src/Publication.astro",
  "src/Header.astro",
  "src/Footer.astro",
  "src/Article.astro",
  "src/PostList.astro",
  "src/TaxonomySection.astro",
  "src/TagList.astro",
  "src/ReadingProgress.astro",
  "src/FocusMode.astro",
  "src/CopyLink.astro",
  "src/reading-time.ts",
  "src/publication.css",
  "src/search.css",
];
assert.deepEqual(
  entries.sort(),
  expected.map((entry) => "package/" + entry).sort(),
  "Packed files must match the reviewed allowlist",
);
const dir = join(run, "neutral");
await mkdir(dir);
await cp("consumers/neutral/src", join(dir, "src"), { recursive: true });
await cp("consumers/neutral/public", join(dir, "public"), { recursive: true });
await cp("patches", join(dir, "patches"), { recursive: true });
const manifest = JSON.parse(await readFile("consumers/neutral/package.json", "utf8"));
manifest.dependencies["astromache"] = `file:${tarball}`;
const workspacePackage = JSON.parse(await readFile("package.json", "utf8"));
manifest.devDependencies = {
  "@astrojs/ts-content-mapper": workspacePackage.devDependencies["@astrojs/ts-content-mapper"],
  "@types/node": workspacePackage.devDependencies["@types/node"],
  "typescript-native": workspacePackage.devDependencies["typescript-native"],
};
manifest.pnpm = workspacePackage.pnpm;
await writeFile(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
await writeFile(join(dir, "pnpm-workspace.yaml"), "packages:\n  - .\n");
const native = JSON.parse(await readFile("tsconfig.native.json", "utf8"));
delete native.extends;
native.compilerOptions = {
  ...JSON.parse(await readFile("tsconfig.json", "utf8")).compilerOptions,
  ...native.compilerOptions,
};
native.include = ["src/**/*.astro", "src/**/*.ts"];
await writeFile(join(dir, "tsconfig.native.json"), JSON.stringify(native, null, 2));
execFileSync(
  process.execPath,
  [
    manager,
    "install",
    "--ignore-scripts",
    "--store-dir",
    process.env.ASTROMACHE_QUALIFICATION_STORE ?? join(root, "store"),
  ],
  { cwd: dir, stdio: "inherit" },
);
const installed = await realpath(join(dir, "node_modules/astromache"));
const installedRelative = relative(await realpath(dir), installed);
assert.ok(
  installedRelative &&
    installedRelative !== ".." &&
    !installedRelative.startsWith(`..${sep}`) &&
    !isAbsolute(installedRelative),
  "Packed consumer must resolve an installed archive inside its own installation",
);
const checkoutRelative = relative(await realpath("."), await realpath(dir));
assert.ok(
  checkoutRelative === ".." ||
    checkoutRelative.startsWith(`..${sep}`) ||
    isAbsolute(checkoutRelative),
  "Packed consumer must be outside the repository",
);
execFileSync(
  process.execPath,
  [
    join(dir, "node_modules/typescript-native/bin/tsc"),
    "--noEmit",
    "-p",
    "tsconfig.native.json",
    "--runExternalCode",
  ],
  { cwd: dir, stdio: "inherit" },
);
execFileSync(process.execPath, [manager, "build"], { cwd: dir, stdio: "inherit" });
const html = await readFile(join(dir, "dist/index.html"));
const workspace = await readFile("consumers/neutral/dist/index.html");
assert.deepEqual(html, workspace, "Packed and workspace outputs must match");
const gallery = await readFile(join(dir, "dist/portfolio/index.html"), "utf8");
// Styled Astro components hash their compilation paths into scope identifiers.
// Preserve every structure/style/script byte except consistently renaming those
// identifiers; their CSS-to-element associations must still match exactly.
const canonicalScopes = (value) => {
  const scopes = new Map();
  const normalized = value.replace(/data-astro-cid-[a-z0-9]+/g, (scope) => {
    if (!scopes.has(scope)) scopes.set(scope, `data-astro-cid-module${scopes.size}`);
    return scopes.get(scope);
  });
  assert.equal(scopes.size, 2, "Gallery and lightbox each retain a distinct CSS scope");
  return normalized;
};
assert.equal(
  canonicalScopes(gallery),
  canonicalScopes(await readFile("consumers/neutral/dist/portfolio/index.html", "utf8")),
  "Packed portfolio structure, styles and scripts must match after path-derived scope renaming",
);
assert.match(gallery, /data-portfolio-trigger="0"/);
assert.match(gallery, /portfolio-placeholder\.svg/);
assert.doesNotMatch(gallery, /Low Shot|Steven Zimmerman|effortlesssteven\.com|profile\.jpg/);
assert.equal(
  await readFile(join(dir, "dist/portfolio-placeholder.svg"), "utf8"),
  await readFile("consumers/neutral/public/portfolio-placeholder.svg", "utf8"),
);
const receipt = {
  packageSha256: createHash("sha256")
    .update(await readFile(tarball))
    .digest("hex"),
  htmlBytes: html.length,
  htmlSha256: createHash("sha256").update(html).digest("hex"),
  portfolioCanonicalSha256: createHash("sha256").update(canonicalScopes(gallery)).digest("hex"),
};
await verifyPackedPortfolioBrowser(dir);
await writeFile(join(run, "receipt.json"), JSON.stringify(receipt, null, 2));
console.log("Independent packed native consumer receipt", JSON.stringify(receipt));
