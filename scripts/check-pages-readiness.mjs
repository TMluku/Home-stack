import { spawnSync } from "node:child_process";

const repo = process.env.GITHUB_REPOSITORY || getRepoFromRemote();
const pagesUrl = process.env.HOME_STACK_PAGES_URL || (repo ? buildPagesUrl(repo) : "");
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const report = {
  ok: true,
  repo,
  pagesUrl,
  checks: {
    remoteMain: hasRemoteHead("main"),
    remoteGhPages: hasRemoteHead("gh-pages"),
    pagesUrlReachable: false,
  },
  github: null,
  nextSteps: [],
};

if (!report.checks.remoteMain) {
  report.ok = false;
  report.nextSteps.push("Push the main branch to origin.");
}

if (!report.checks.remoteGhPages) {
  report.ok = false;
  report.nextSteps.push("Run pnpm run build:pages and pnpm run deploy:pages-branch to publish gh-pages.");
}

if (repo && token) {
  const repoResponse = await githubJson(`https://api.github.com/repos/${repo}`, token);
  if (repoResponse.ok) {
    report.github = {
      private: Boolean(repoResponse.data.private),
      visibility: repoResponse.data.visibility,
      hasPages: Boolean(repoResponse.data.has_pages),
      defaultBranch: repoResponse.data.default_branch,
      permissions: repoResponse.data.permissions,
    };

    if (repoResponse.data.private) {
      report.ok = false;
      report.nextSteps.push(
        "This repository is private. For public QA and external release links, change visibility to public (recommended for this MVP workflow).",
      );
    } else if (!repoResponse.data.has_pages) {
      report.ok = false;
      report.nextSteps.push("Enable GitHub Pages in repository Settings > Pages.");
    }
  } else {
    report.ok = false;
    report.github = { error: repoResponse.error };
    report.nextSteps.push("Provide a GitHub token with repository read permissions to inspect Pages settings.");
  }
} else if (!token) {
  report.nextSteps.push("Set GITHUB_TOKEN or GH_TOKEN to inspect repository Pages settings.");
}

if (pagesUrl) {
  const pagesResponse = await fetchStatus(pagesUrl);
  report.checks.pagesUrlReachable = pagesResponse.ok;
  report.checks.pagesStatus = pagesResponse.status;
  if (!pagesResponse.ok) {
    report.ok = false;
    report.nextSteps.push(`Pages URL is not reachable yet: ${pagesUrl}`);
  }
}

report.nextSteps = [...new Set(report.nextSteps)];
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

function hasRemoteHead(branch) {
  const result = spawnSync("git", ["ls-remote", "--heads", "origin", branch], { encoding: "utf8" });
  return result.status === 0 && result.stdout.includes(`refs/heads/${branch}`);
}

function getRepoFromRemote() {
  const result = spawnSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" });
  const remote = result.stdout.trim();
  const match = remote.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/);
  return match?.groups ? `${match.groups.owner}/${match.groups.repo}` : "";
}

function buildPagesUrl(repoName) {
  const [owner, repository] = repoName.split("/");
  return owner && repository ? `https://${owner.toLowerCase()}.github.io/${repository}/` : "";
}

async function githubJson(url, authToken) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${authToken}`,
        "User-Agent": "home-stack-pages-readiness",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return { ok: false, error: `${response.status} ${response.statusText}` };
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "GitHub request failed" };
  }
}

async function fetchStatus(url) {
  try {
    const response = await fetch(url, { redirect: "follow" });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: error instanceof Error ? error.message : "request failed" };
  }
}
