// Gem Scanner API — GitHub commit activity fetcher with caching + rate-limit awareness
// Handles orgs with multiple repos (sums commits across all org repos)
//
// Auth: Set VITE_GITHUB_TOKEN env var to a GitHub PAT for 5,000 req/hr (vs 60 unauthenticated).
// Caching: localStorage-backed, 30-min TTL — survives page reloads.
// Queuing: Individual requests are spaced 200ms apart to avoid secondary rate limits.

import { CACHE_TTL_MS, GITHUB_REQUEST_DELAY_MS } from "./constants.js";

// ─── GitHub Auth ────────────────────────────────────────────
const GITHUB_TOKEN = import.meta.env.VITE_GITHUB_TOKEN || "";

function githubHeaders() {
  const h = { Accept: "application/vnd.github.v3+json" };
  if (GITHUB_TOKEN) h.Authorization = `token ${GITHUB_TOKEN}`;
  return h;
}

// ─── localStorage Cache (30-min TTL) ────────────────────────
const LS_PREFIX = "gem_gh_";

function getCached(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      localStorage.removeItem(LS_PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function setCache(key, data) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage full — silently ignore
  }
}

// ─── Request Queue (200ms spacing) ──────────────────────────
let lastRequestTime = 0;

async function throttledFetch(url, opts) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < GITHUB_REQUEST_DELAY_MS) {
    await new Promise(r => setTimeout(r, GITHUB_REQUEST_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url, opts);
}

/**
 * Parse a GitHub URL into either:
 *   { type: "repo", owner, repo }   — specific repo link
 *   { type: "org", owner }          — org/user-level link (no specific repo)
 */
function parseGitHubUrl(url) {
  if (!url || typeof url !== "string") return null;
  const cleaned = url.trim().replace(/\/+$/, "");
  const match = cleaned.match(/github\.com\/([^/?#]+)(?:\/([^/?#]+))?/);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2] ? match[2].replace(/\.git$/, "") : null;

  const orgPageKeywords = ["orgs", "repositories", "people", "projects", "packages"];
  if (!repo || orgPageKeywords.includes(repo)) {
    return { type: "org", owner };
  }
  return { type: "repo", owner, repo };
}

/**
 * Fetch 7-day commit count for a single GitHub repo using the participation stats endpoint.
 * Returns the most recent week's total commits (all contributors), or -1 if rate limited.
 */
async function fetchRepoCommits7d(owner, repo) {
  const cacheKey = `commits_${owner}_${repo}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  const url = `https://api.github.com/repos/${owner}/${repo}/stats/participation`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await throttledFetch(url, {
      headers: githubHeaders(),
      redirect: "follow",
    });

    if (res.status === 202) {
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      return getCached(cacheKey) ?? -1;
    }
    if (res.status === 404 || res.status === 451) {
      setCache(cacheKey, 0);
      return 0;
    }
    if (res.status === 403 || res.status === 429) {
      return getCached(cacheKey) ?? -1;
    }
    if (!res.ok) {
      setCache(cacheKey, 0);
      return 0;
    }

    const data = await res.json();
    const allWeeks = data?.all;
    const count = Array.isArray(allWeeks) && allWeeks.length > 0
      ? allWeeks[allWeeks.length - 1]
      : 0;
    setCache(cacheKey, count);
    return count;
  }

  return getCached(cacheKey) ?? 0;
}

/**
 * Fetch all public repos for a GitHub org/user.
 * Returns array of repo names (up to 100, sorted by most recently pushed).
 */
async function fetchOrgRepos(owner) {
  const cacheKey = `org_repos_${owner}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  let repos = await _fetchRepoList(`https://api.github.com/orgs/${owner}/repos?per_page=100&sort=pushed&direction=desc`);
  if (repos === null) {
    repos = await _fetchRepoList(`https://api.github.com/users/${owner}/repos?per_page=100&sort=pushed&direction=desc`);
  }

  const result = repos || [];
  setCache(cacheKey, result);
  return result;
}

async function _fetchRepoList(url) {
  const res = await throttledFetch(url, {
    headers: githubHeaders(),
    redirect: "follow",
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data)) return null;
  return data
    .filter(r => !r.fork && !r.archived)
    .map(r => r.name);
}

/**
 * Fetch total 7-day commits across ALL repos in an org/user account.
 * Checks top 30 most recently pushed repos, queued sequentially.
 */
async function fetchOrgCommits7d(owner) {
  const cacheKey = `org_commits_${owner}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  const repos = await fetchOrgRepos(owner);
  if (!repos || repos.length === 0) {
    setCache(cacheKey, { total: 0, repos: [] });
    return { total: 0, repos: [] };
  }

  const reposToCheck = repos.slice(0, 30);
  let total = 0;
  let rateLimited = false;
  const repoBreakdown = [];

  // Fetch sequentially — throttledFetch handles the 200ms spacing
  for (const repo of reposToCheck) {
    const count = await fetchRepoCommits7d(owner, repo);
    if (count === -1) {
      rateLimited = true;
    } else if (count > 0) {
      total += count;
      repoBreakdown.push({ repo, commits: count });
    }
  }

  const result = { total, rateLimited, repos: repoBreakdown, repoCount: repos.length };
  if (!rateLimited) setCache(cacheKey, result);
  return result;
}

/**
 * Fetch commit activity for all subnets that have GitHub repos/orgs.
 * Requests are queued with 200ms delays to avoid secondary rate limits.
 *
 * Returns: Map<netuid, { commits7d, owner, repo, repoUrl, orgRepoCount?, repoBreakdown? }>
 */
export async function fetchGitHubActivityMap(subnetMeta, onProgress) {
  const fullCacheKey = "activity_map";
  const cached = getCached(fullCacheKey);
  if (cached) return cached;

  // Build task list
  const tasks = [];
  for (const [netuid, meta] of Object.entries(subnetMeta)) {
    const parsed = parseGitHubUrl(meta.github);
    if (!parsed) continue;
    tasks.push({ netuid: parseInt(netuid, 10), ...parsed, repoUrl: meta.github });
  }

  const map = {};
  const repoTasks = tasks.filter(t => t.type === "repo");
  const orgTasks = tasks.filter(t => t.type === "org");
  const totalWork = tasks.length;
  let completed = 0;

  // --- Phase 1: Single-repo fetches (queued sequentially) ---
  for (const task of repoTasks) {
    const commits7d = await fetchRepoCommits7d(task.owner, task.repo);
    map[task.netuid] = {
      commits7d: commits7d === -1 ? 0 : commits7d,
      rateLimited: commits7d === -1,
      owner: task.owner,
      repo: task.repo,
      repoUrl: task.repoUrl,
    };
    completed++;
    if (onProgress) onProgress(completed, totalWork);
  }

  // --- Phase 2: Expand single-repo owners to full org activity ---
  const repoByOwner = {};
  for (const t of repoTasks) {
    if (!repoByOwner[t.owner]) repoByOwner[t.owner] = [];
    repoByOwner[t.owner].push(t);
  }

  for (const owner of Object.keys(repoByOwner)) {
    const orgData = await fetchOrgCommits7d(owner);
    for (const task of repoByOwner[owner]) {
      const existing = map[task.netuid];
      if (existing && orgData.total > existing.commits7d) {
        map[task.netuid] = {
          ...existing,
          commits7d: orgData.total,
          orgRepoCount: orgData.repoCount,
          repoBreakdown: orgData.repos,
          rateLimited: orgData.rateLimited || false,
        };
      }
    }
  }

  // --- Phase 3: Org-level links ---
  for (const task of orgTasks) {
    const orgData = await fetchOrgCommits7d(task.owner);
    map[task.netuid] = {
      commits7d: orgData.total,
      rateLimited: orgData.rateLimited || false,
      owner: task.owner,
      repo: null,
      repoUrl: task.repoUrl,
      orgRepoCount: orgData.repoCount,
      repoBreakdown: orgData.repos,
    };
    completed++;
    if (onProgress) onProgress(completed, totalWork);
  }

  setCache(fullCacheKey, map);
  return map;
}
