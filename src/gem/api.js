// Gem Scanner API — GitHub commit activity fetcher with caching + rate-limit awareness
// Handles orgs with multiple repos (sums commits across all org repos)

import { CACHE_TTL_MS, GITHUB_BATCH_SIZE, GITHUB_STAGGER_MS } from "./constants.js";

const cache = {};

function getCached(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache[key] = { data, ts: Date.now() };
}

/**
 * Parse a GitHub URL into either:
 *   { type: "repo", owner, repo }   — specific repo link
 *   { type: "org", owner }          — org/user-level link (no specific repo)
 *
 * Handles:
 *   https://github.com/org
 *   https://github.com/org/repo
 *   https://github.com/org/repo/tree/branch/...
 */
function parseGitHubUrl(url) {
  if (!url || typeof url !== "string") return null;
  // Strip trailing slashes and whitespace
  const cleaned = url.trim().replace(/\/+$/, "");
  const match = cleaned.match(/github\.com\/([^/?#]+)(?:\/([^/?#]+))?/);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2] ? match[2].replace(/\.git$/, "") : null;

  // If the "repo" part looks like a GitHub page (e.g., "orgs", "repositories"), treat as org
  const orgPageKeywords = ["orgs", "repositories", "people", "projects", "packages"];
  if (!repo || orgPageKeywords.includes(repo)) {
    return { type: "org", owner };
  }
  return { type: "repo", owner, repo };
}

/**
 * Fetch 7-day commit count for a single GitHub repo.
 * Returns count of commits in the last 7 days, or -1 if rate limited.
 */
async function fetchRepoCommits7d(owner, repo) {
  const cacheKey = `gh_commits_${owner}_${repo}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100&since=${since}`;

  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github.v3+json" },
    redirect: "follow",
  });

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
  const count = Array.isArray(data) ? data.length : 0;
  setCache(cacheKey, count);
  return count;
}

/**
 * Fetch all public repos for a GitHub org/user.
 * Returns array of repo names (up to 100, sorted by most recently pushed).
 */
async function fetchOrgRepos(owner) {
  const cacheKey = `gh_org_repos_${owner}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  // Try org endpoint first, fallback to user endpoint
  let repos = await _fetchRepoList(`https://api.github.com/orgs/${owner}/repos?per_page=100&sort=pushed&direction=desc`);
  if (repos === null) {
    repos = await _fetchRepoList(`https://api.github.com/users/${owner}/repos?per_page=100&sort=pushed&direction=desc`);
  }

  const result = repos || [];
  setCache(cacheKey, result);
  return result;
}

async function _fetchRepoList(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github.v3+json" },
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
 * Only checks repos pushed in the last 30 days (optimization — stale repos won't have 7d commits).
 */
async function fetchOrgCommits7d(owner) {
  const cacheKey = `gh_org_commits_${owner}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  const repos = await fetchOrgRepos(owner);
  if (!repos || repos.length === 0) {
    setCache(cacheKey, { total: 0, repos: [] });
    return { total: 0, repos: [] };
  }

  // Limit to top 20 most recently pushed repos to avoid rate limit exhaustion
  const reposToCheck = repos.slice(0, 20);
  let total = 0;
  let rateLimited = false;
  const repoBreakdown = [];

  // Fetch in small sub-batches within the org
  for (let i = 0; i < reposToCheck.length; i += 4) {
    const batch = reposToCheck.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map(repo => fetchRepoCommits7d(owner, repo))
    );
    results.forEach((r, idx) => {
      const count = r.status === "fulfilled" ? r.value : 0;
      if (count === -1) {
        rateLimited = true;
      } else if (count > 0) {
        total += count;
        repoBreakdown.push({ repo: batch[idx], commits: count });
      }
    });

    // Brief stagger between sub-batches
    if (i + 4 < reposToCheck.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const result = { total, rateLimited, repos: repoBreakdown, repoCount: repos.length };
  if (!rateLimited) setCache(cacheKey, result);
  return result;
}

/**
 * Fetch commit activity for all subnets that have GitHub repos/orgs.
 * Handles both single-repo links AND org-level links (sums all repos).
 *
 * Returns: Map<netuid, { commits7d, owner, repo, repoUrl, orgRepoCount?, repoBreakdown? }>
 */
export async function fetchGitHubActivityMap(subnetMeta, onProgress) {
  const fullCacheKey = "gh_activity_map";
  const cached = getCached(fullCacheKey);
  if (cached) return cached;

  // Build task list — each subnet gets classified as "repo" or "org"
  const tasks = [];
  for (const [netuid, meta] of Object.entries(subnetMeta)) {
    const parsed = parseGitHubUrl(meta.github);
    if (!parsed) continue;
    tasks.push({ netuid: parseInt(netuid, 10), ...parsed, repoUrl: meta.github });
  }

  const map = {};

  // Separate org tasks (more expensive) from single-repo tasks
  const repoTasks = tasks.filter(t => t.type === "repo");
  const orgTasks = tasks.filter(t => t.type === "org");

  // --- Phase 1: Single-repo fetches (fast) ---
  for (let i = 0; i < repoTasks.length; i += GITHUB_BATCH_SIZE) {
    const batch = repoTasks.slice(i, i + GITHUB_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(t => fetchRepoCommits7d(t.owner, t.repo))
    );

    results.forEach((result, idx) => {
      const task = batch[idx];
      const commits7d = result.status === "fulfilled" ? result.value : 0;
      map[task.netuid] = {
        commits7d: commits7d === -1 ? 0 : commits7d,
        rateLimited: commits7d === -1,
        owner: task.owner,
        repo: task.repo,
        repoUrl: task.repoUrl,
      };
    });

    if (onProgress) {
      onProgress(Math.min(i + GITHUB_BATCH_SIZE, repoTasks.length), tasks.length);
    }

    if (i + GITHUB_BATCH_SIZE < repoTasks.length) {
      await new Promise(r => setTimeout(r, GITHUB_STAGGER_MS));
    }
  }

  // --- Phase 2: For single-repo links, also check sibling repos in the same org ---
  // Group by owner to avoid duplicate org lookups
  const ownersSeen = new Set();
  const repoByOwner = {};
  for (const t of repoTasks) {
    if (!repoByOwner[t.owner]) repoByOwner[t.owner] = [];
    repoByOwner[t.owner].push(t);
  }

  // For each unique owner with a repo link, fetch full org activity
  const ownersToExpand = Object.keys(repoByOwner);
  for (let i = 0; i < ownersToExpand.length; i += 3) {
    const batch = ownersToExpand.slice(i, i + 3);
    const results = await Promise.allSettled(
      batch.map(owner => fetchOrgCommits7d(owner))
    );

    results.forEach((result, idx) => {
      const owner = batch[idx];
      if (result.status !== "fulfilled") return;
      const orgData = result.value;
      // Update all subnets linked to this owner with the full org commit count
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
      ownersSeen.add(owner);
    });

    if (onProgress) {
      const done = repoTasks.length + Math.min(i + 3, ownersToExpand.length);
      onProgress(done, tasks.length + ownersToExpand.length);
    }

    if (i + 3 < ownersToExpand.length) {
      await new Promise(r => setTimeout(r, GITHUB_STAGGER_MS));
    }
  }

  // --- Phase 3: Org-level links (no specific repo in URL) ---
  for (let i = 0; i < orgTasks.length; i += 3) {
    const batch = orgTasks.slice(i, i + 3);
    const results = await Promise.allSettled(
      batch.map(t => fetchOrgCommits7d(t.owner))
    );

    results.forEach((result, idx) => {
      const task = batch[idx];
      if (result.status === "fulfilled") {
        const orgData = result.value;
        map[task.netuid] = {
          commits7d: orgData.total,
          rateLimited: orgData.rateLimited || false,
          owner: task.owner,
          repo: null,
          repoUrl: task.repoUrl,
          orgRepoCount: orgData.repoCount,
          repoBreakdown: orgData.repos,
        };
      } else {
        map[task.netuid] = {
          commits7d: 0,
          rateLimited: false,
          owner: task.owner,
          repo: null,
          repoUrl: task.repoUrl,
        };
      }
    });

    if (onProgress) {
      const done = repoTasks.length + ownersToExpand.length + Math.min(i + 3, orgTasks.length);
      onProgress(done, tasks.length + ownersToExpand.length);
    }

    if (i + 3 < orgTasks.length) {
      await new Promise(r => setTimeout(r, GITHUB_STAGGER_MS));
    }
  }

  setCache(fullCacheKey, map);
  return map;
}
