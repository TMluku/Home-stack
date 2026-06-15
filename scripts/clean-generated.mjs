import { rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const generatedTargets = [
  ".next",
  "out",
  ".pages-preview",
  ".pages-static.out.log",
  ".pages-static.err.log",
  ".tmp-pnpm",
  "node_modules",
  "tsconfig.tsbuildinfo",
  ".server-state",
];

function assertInsideRoot(target) {
  const resolved = resolve(root, target);
  if (resolved !== root && resolved.startsWith(`${root}${sep}`)) return resolved;
  throw new Error(`Refusing to remove path outside project root: ${target}`);
}

for (const target of generatedTargets) {
  const resolved = assertInsideRoot(target);
  await rm(resolved, { force: true, recursive: true });
  console.log(`removed ${target}`);
}
