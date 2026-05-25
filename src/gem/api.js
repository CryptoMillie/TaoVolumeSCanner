// Gem Scanner API — GitHub commit activity fetcher with caching + rate-limit awareness

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
 * Parse a GitHub repo URL into {owner, repo}.
 * Handles: https://github.com/owner/repo, https://github.com/owner/repo/tree/..., etc.
 */
function parseGitHubUrl(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

/**
 * Fetch 7-day commit count for a single GitHub repo.
 * Uses the commits endpoint with `since` param.
 * Returns count of commits in the last 7 days.
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
    // Repo not found, DMCA, or private
    setCache(cacheKey, 0);
    return 0;
  }
  if (res.status === 403 || res.status === 429) {
    // Rate limited — return cached or 0, don't cache the failure
    return getCached(cacheKey) ?? -1; // -1 = rate limited
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
 * Fetch commit activity for all subnets that have GitHub repos.
 * Takes the subnet metadata map (from GitHub subnets.json).
 * Returns: Map<netuid, { commits7d, owner, repo, repoUrl }>
 *
 * Batches requests to respect GitHub's 60/hr rate limit.
 * Uses onProgress callback to update UI during fetch.
 */
export async function fetchGitHubActivityMap(subnetMeta, onProgress) {
  const fullCacheKey = "gh_activity_map";
  const cached = getCached(fullCacheKey);
  if (cached) return cached;

  // Build list of repos to fetch
  const tasks = [];
  for (const [netuid, meta] of Object.entries(subnetMeta)) {
    const parsed = parseGitHubUrl(meta.github);
    if (!parsed) continue;
    tasks.push({ netuid: parseInt(netuid, 10), ...parsed, repoUrl: meta.github });
  }

  const map = {};

  // Fetch in batches
  for (let i = 0; i < tasks.length; i += GITHUB_BATCH_SIZE) {
    const batch = tasks.slice(i, i + GITHUB_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(t => fetchRepoCommits7d(t.owner, t.repo))
    );

    results.forEach((result, idx) => {
      const task = batch[idx];
      const commits7d = result.status === "fulfilled" ? result.value : 0;
      map[task.netuid] = {
        commits7d: commits7d === -1 ? 0 : commits7d, // treat rate-limited as 0
        rateLimited: commits7d === -1,
        owner: task.owner,
        repo: task.repo,
        repoUrl: task.repoUrl,
      };
    });

    if (onProgress) {
      onProgress(Math.min(i + GITHUB_BATCH_SIZE, tasks.length), tasks.length);
    }

    // Stagger between batches to avoid rate limits
    if (i + GITHUB_BATCH_SIZE < tasks.length) {
      await new Promise(r => setTimeout(r, GITHUB_STAGGER_MS));
    }
  }

  setCache(fullCacheKey, map);
  return map;
}
