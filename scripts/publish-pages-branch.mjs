import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const outDir = resolve("out");
const branch = process.env.HOME_STACK_PAGES_BRANCH || "gh-pages";
const tempDir = await mkdtemp(resolve(tmpdir(), "home-stack-pages-"));

try {
  const outStat = await stat(outDir);
  if (!outStat.isDirectory()) throw new Error("out is not a directory");

  await cp(outDir, tempDir, { recursive: true });
  await run("git", ["init", "-b", branch], { cwd: tempDir });
  await run("git", ["config", "user.name", "github-actions[bot]"], { cwd: tempDir });
  await run("git", ["config", "user.email", "github-actions[bot]@users.noreply.github.com"], { cwd: tempDir });
  await run("git", ["add", "."], { cwd: tempDir });
  await run("git", ["commit", "-m", "Deploy GitHub Pages"], { cwd: tempDir });
  await run("git", ["remote", "add", "origin", getRemoteUrl()], { cwd: tempDir });
  await run("git", ["push", "--force", "origin", `${branch}:${branch}`], { cwd: tempDir });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function getRemoteUrl() {
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_TOKEN) {
    return `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`;
  }
  if (process.env.HOME_STACK_PAGES_REMOTE) return process.env.HOME_STACK_PAGES_REMOTE;

  const result = spawnSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" });
  const remote = result.stdout.trim();
  if (!remote) throw new Error("Could not resolve remote.origin.url. Set HOME_STACK_PAGES_REMOTE to publish manually.");
  return remote;
}

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
