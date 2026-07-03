// Multi-Repo Support for Code Quality Radar
//
// Extends the existing single-repo fetcher to support subnets with multiple repos.
// Aggregates signals across all repos to get a complete engineering picture.

import { CACHE_TTL_MS } from "./constants.js";

const LS_PREFIX = "code_repo_multi_";

// Load multi-repo config
let MULTI_REPO_CONFIG = null;
async function loadMultiRepoConfig() {
  if (MULTI_REPO_CONFIG) return MULTI_REPO_CONFIG;
  try {
    const response = await fetch("/src/code/multi-repos-config.json");
    MULTI_REPO_CONFIG = await response.json();
    return MULTI_REPO_CONFIG;
  } catch (e) {
    console.warn("Failed to load multi-repo config:", e.message);
    return { multi_repo_subnets: {} };
  }
}

// Get cached multi-repo data
function getCachedMulti(key) {
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

function setCacheMulti(key, data) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage full — silently ignore
  }
}

// Parse GitHub URL → owner/repo
function parseGitHubUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.hostname.includes("github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    const m = url.match(/github\.com\/([^/]+)\/([^/\s#?]+)/);
    if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
  }
  return null;
}

// Fetch single repo data (imported from api.js logic)
async function fetchSingleRepo(repoUrl) {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return null;

  const { owner, repo } = parsed;

  try {
    // Fetch repo metadata
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (!repoRes.ok) return null;
    const repoData = await repoRes.json();

    // Fetch file tree
    const defaultBranch = repoData.default_branch || "main";
    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`);
    let tree = [];
    if (treeRes.ok) {
      const treeData = await treeRes.json();
      tree = (treeData.tree || []).filter(t => t.type === "blob").map(t => t.path);
    }

    return analyzeRepo(repoData, tree);
  } catch (e) {
    console.warn(`Failed to fetch ${owner}/${repo}:`, e.message);
    return null;
  }
}

// Analyze repo (copied from api.js)
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

  // Code file detection
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
    size: repoData.size || 0,
    isFork: repoData.fork || false,
    ageDays,
    daysSinceUpdate,
    defaultBranch: repoData.default_branch || "main",
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

// Aggregate multiple repo data into single composite
function aggregateRepos(repoDataArray, weights) {
  if (!repoDataArray || repoDataArray.length === 0) return null;
  if (repoDataArray.length === 1) return repoDataArray[0];

  // Sum numeric values
  const sum = (arr, key) => arr.reduce((acc, r) => acc + (r?.[key] || 0), 0);
  const max = (arr, key) => Math.max(...arr.map(r => r?.[key] || 0));
  const any = (arr, key) => arr.some(r => r?.[key]);

  // Weighted average for stars (by weight)
  const weightedStars = repoDataArray.reduce((acc, r, i) => {
    const w = weights[i] || 0.33;
    return acc + (r.stars || 0) * w;
  }, 0);

  // Use primary repo metadata
  const primary = repoDataArray.find((r, i) => weights[i] === Math.max(...weights)) || repoDataArray[0];

  return {
    owner: primary.owner,
    name: `${primary.name} (+${repoDataArray.length - 1} repos)`,
    stars: Math.round(weightedStars),
    forks: max(repoDataArray, 'forks'),
    openIssues: sum(repoDataArray, 'openIssues'),
    license: primary.license,
    language: primary.language,
    size: sum(repoDataArray, 'size'),
    isFork: primary.isFork,
    ageDays: primary.ageDays,
    daysSinceUpdate: Math.min(...repoDataArray.map(r => r.daysSinceUpdate)),
    defaultBranch: primary.defaultBranch,
    // Aggregate engineering signals
    totalFiles: sum(repoDataArray, 'totalFiles'),
    codeFileCount: sum(repoDataArray, 'codeFileCount'),
    hasTests: any(repoDataArray, 'hasTests'),
    testFileCount: sum(repoDataArray, 'testFileCount'),
    hasCI: any(repoDataArray, 'hasCI'),
    hasDocsFolder: any(repoDataArray, 'hasDocsFolder'),
    hasReadme: any(repoDataArray, 'hasReadme'),
    hasContributing: any(repoDataArray, 'hasContributing'),
    hasChangelog: any(repoDataArray, 'hasChangelog'),
    hasSecurityPolicy: any(repoDataArray, 'hasSecurityPolicy'),
    hasGitignore: any(repoDataArray, 'hasGitignore'),
    hasEnvFile: any(repoDataArray, 'hasEnvFile'),
    hasExposedSecrets: any(repoDataArray, 'hasExposedSecrets'),
    hasLockfile: any(repoDataArray, 'hasLockfile'),
    hasRequirements: any(repoDataArray, 'hasRequirements'),
    hasBittensorImport: any(repoDataArray, 'hasBittensorImport'),
    hasValidatorCode: any(repoDataArray, 'hasValidatorCode'),
    hasMinerCode: any(repoDataArray, 'hasMinerCode'),
    hasProtocolCode: any(repoDataArray, 'hasProtocolCode'),
    _multiRepo: true,
    _repoCount: repoDataArray.length,
  };
}

// Fetch multi-repo data for a subnet
export async function fetchMultiRepoData(subnetName, netuid, onProgress) {
  const cacheKey = `${subnetName}_${netuid}`;
  const cached = getCachedMulti(cacheKey);
  if (cached) return cached;

  const config = await loadMultiRepoConfig();
  const subnetConfig = config.multi_repo_subnets[subnetName.toLowerCase()];

  if (!subnetConfig || !subnetConfig.repos) return null;

  const repos = subnetConfig.repos;
  const repoDataArray = [];
  const weights = [];

  for (let i = 0; i < repos.length; i++) {
    const repoConf = repos[i];
    if (onProgress) onProgress({ current: i + 1, total: repos.length, url: repoConf.url });

    const data = await fetchSingleRepo(repoConf.url);
    if (data) {
      repoDataArray.push(data);
      weights.push(repoConf.weight || 0.33);
    }

    // Rate limit delay
    if (i < repos.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  const aggregated = aggregateRepos(repoDataArray, weights);
  if (aggregated) setCacheMulti(cacheKey, aggregated);

  return aggregated;
}

// Check if a subnet has multi-repo config
export async function hasMultiRepoConfig(subnetName) {
  const config = await loadMultiRepoConfig();
  return !!config.multi_repo_subnets[subnetName.toLowerCase()];
}
