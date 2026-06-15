import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const env = {
  ...process.env,
  NEXT_OUTPUT_EXPORT: "true",
  NEXT_PUBLIC_STATIC_EXPORT: "true",
};
const pnpmCli = process.env.npm_execpath;

if (pnpmCli) {
  await run(process.execPath, [pnpmCli, "run", "build"], { env });
} else {
  await run("pnpm", ["run", "build"], { env });
}
await writeFile(resolve("out", ".nojekyll"), "", "utf8");

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
}
