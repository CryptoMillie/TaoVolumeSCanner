// Code Quality Radar — GitHub API layer with caching
//
// Fetches repo metadata + file tree from GitHub API (unauthenticated).
// Rate limit: 60 req/hr, so we cache aggressively and fetch sequentially.

import { CACHE_TTL_MS } from "./constants.js";

const LS_PREFIX = "code_repo_";

// ─── localStorage cache per repo ────────────────────────────────
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

// ─── Parse GitHub URL → owner/repo ─────────────────────────────
function parseGitHubUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.hostname.includes("github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    // Try regex fallback for non-URL strings like "owner/repo"
    const m = url.match(/github\.com\/([^/]+)\/([^/\s#?]+)/);
    if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
  }
  return null;
}

// ─── Fetch a single repo's data ────────────────────────────────
async function fetchGitHubRepoData(repoUrl) {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return null;

  const { owner, repo } = parsed;
  const cacheKey = `${owner}/${repo}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Fetch repo metadata
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
  if (!repoRes.ok) return null;
  const repoData = await repoRes.json();

  // Fetch file tree (recursive, single call)
  const defaultBranch = repoData.default_branch || "main";
  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`);
  let tree = [];
  if (treeRes.ok) {
    const treeData = await treeRes.json();
    tree = (treeData.tree || []).filter(t => t.type === "blob").map(t => t.path);
  }

  const result = analyzeRepo(repoData, tree);
  setCache(cacheKey, result);
  return result;
}

// ─── Analyze repo data + tree into scoring signals ──────────────
function analyzeRepo(repoData, tree) {
  const lowerPaths = tree.map(p => p.toLowerCase());

  // Test detection
  const testPatterns = [/^tests?\//, /__tests__\//, /_test\.(py|go|rs|js|ts)$/, /\.test\.(js|ts|jsx|tsx)$/, /\.spec\.(js|ts|jsx|tsx)$/, /test_.*\.py$/];
  const testFiles = lowerPaths.filter(p => testPatterns.some(rx => rx.test(p)));

  // CI detection
  const ciPatterns = [/^\.github\/workflows\//, /^\.circleci\//, /^jenkinsfile$/i, /^\.gitlab-ci\.yml$/, /^\.travis\.yml$/];
  const hasCI = lowerPaths.some(p => ciPatterns.some(rx => rx.test(p)));

  // Docs detection
  const hasDocsFolder = lowerPaths.some(p => p.startsWith("docs/"));
  const hasReadme = lowerPaths.some(p => p === "readme.md" || p === "readme.rst" || p === "readme.txt" || p === "readme");
  const hasContributing = lowerPaths.some(p => p.includes("contributing"));
  const hasChangelog = lowerPaths.some(p => p.includes("changelog") || p.includes("changes.md") || p.includes("history.md"));

  // Security
  const hasSecurityPolicy = lowerPaths.some(p => p.includes("security.md") || p.includes("security.txt"));
  const hasGitignore = lowerPaths.some(p => p === ".gitignore");
  const hasEnvFile = lowerPaths.some(p => p === ".env" || p === ".env.local" || p === ".env.production");
  const hasExposedSecrets = lowerPaths.some(p => /\.(pem|key|secret)$/.test(p));

  // Dependency hygiene
  const lockfiles = ["poetry.lock", "pipfile.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "cargo.lock", "go.sum", "gemfile.lock"];
  const hasLockfile = lowerPaths.some(p => lockfiles.some(lf => p.endsWith(lf)));
  const reqFiles = ["requirements.txt", "pyproject.toml", "setup.py", "setup.cfg", "cargo.toml", "go.mod", "package.json", "gemfile"];
  const hasRequirements = lowerPaths.some(p => reqFiles.some(rf => p.endsWith(rf)));

  // Code file detection (exclude docs, configs, data)
  const codeExts = /\.(py|js|ts|jsx|tsx|rs|go|sol|java|cpp|c|h|rb|ex|exs|swift|kt|scala|zig)$/;
  const codeFiles = lowerPaths.filter(p => codeExts.test(p));

  // Bittensor integration signals
  const btPatterns = ["bittensor", "subtensor", "metagraph", "neuron", "axon", "dendrite", "synapse"];
  const hasBittensorImport = lowerPaths.some(p => btPatterns.some(kw => p.includes(kw)));

  // Validator / miner code
  const hasValidatorCode = lowerPaths.some(p => p.includes("validator") || p.includes("vali"));
  const hasMinerCode = lowerPaths.some(p => p.includes("miner"));
  const hasProtocolCode = lowerPaths.some(p => p.includes("protocol") || p.includes("api/") || p.includes("server") || p.includes("network"));

  // Age in days
  const createdAt = repoData.created_at ? new Date(repoData.created_at) : null;
  const updatedAt = repoData.updated_at ? new Date(repoData.updated_at) : null;
  const ageDays = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / 86400000) : 0;
  const daysSinceUpdate = updatedAt ? Math.floor((Date.now() - updatedAt.getTime()) / 86400000) : 999;

  return {
    owner: repoData.owner?.login || "",
    name: repoData.name || "",
    stars: repoData.stargazers_count || 0,
    forks: repoData.forks_count || 0,
    openIssues: repoData.open_issues_count || 0,
    license: repoData.license?.spdx_id || null,
    language: repoData.language || null,
    size: repoData.size || 0, // KB
    isFork: repoData.fork || false,
    ageDays,
    daysSinceUpdate,
    defaultBranch: repoData.default_branch || "main",
    // Tree signals
    totalFiles: tree.length,
    codeFileCount: codeFiles.length,
    hasTests: testFiles.length > 0,
    testFileCount: testFiles.length,
    hasCI,
    hasDocsFolder,
    hasReadme,
    hasContributing,
    hasChangelog,
    hasSecurityPolicy,
    hasGitignore,
    hasEnvFile,
    hasExposedSecrets,
    hasLockfile,
    hasRequirements,
    hasBittensorImport,
    hasValidatorCode,
    hasMinerCode,
    hasProtocolCode,
  };
}

// ─── Batch fetch for all subnets with GitHub repos ──────────────
// Sequential with 1.5s delay to stay within rate limits.
export async function fetchAllRepoData(subnetMetaMap, devActivityMap, onProgress) {
  // Collect all unique repo URLs from meta + devActivity
  const repoUrls = new Map(); // netuid -> repoUrl
  if (devActivityMap) {
    for (const [netuid, dev] of Object.entries(devActivityMap)) {
      if (dev.repoUrl) repoUrls.set(Number(netuid), dev.repoUrl);
    }
  }
  if (subnetMetaMap) {
    for (const [netuid, meta] of Object.entries(subnetMetaMap)) {
      if (meta.github && !repoUrls.has(Number(netuid))) {
        repoUrls.set(Number(netuid), meta.github);
      }
    }
  }

  const total = repoUrls.size;
  const result = new Map();
  let completed = 0;
  let failed = 0;

  for (const [netuid, url] of repoUrls) {
    try {
      const data = await fetchGitHubRepoData(url);
      if (data) {
        result.set(netuid, data);
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
    completed++;
    if (onProgress) onProgress({ completed, total, failed });
    // Rate limit delay — skip if this was cached (fast return)
    if (completed < total) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  return result;
}
