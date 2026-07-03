// Enhanced Code Quality API with Universal Multi-Repo Support
//
// Drop-in replacement for code/api.js that adds:
// - Manual multi-repo configuration
// - Auto-detection of related repos
// - Graceful fallback to single-repo mode
//
// Usage: Import from this file instead of code/api.js

import { CACHE_TTL_MS } from "./constants.js";
import {
  autoDetectRelatedRepos,
  generateMultiRepoConfig,
  saveAutoDetectedConfig
} from "./auto-detect-repos.js";

const LS_PREFIX = "code_repo_";
const MULTI_CONFIG_KEY = "multi_repo_config_v1";

// ─── Configuration Management ───────────────────────────────────

let cachedConfig = null;

async function loadMultiRepoConfig() {
  if (cachedConfig) return cachedConfig;

  try {
    // Try to fetch from file
    const response = await fetch("/src/code/multi-repos-config.json");
    if (response.ok) {
      cachedConfig = await response.json();
      return cachedConfig;
    }
  } catch (e) {
    console.warn("Could not load multi-repo config file:", e.message);
  }

  // Fallback to localStorage
  try {
    const stored = localStorage.getItem(MULTI_CONFIG_KEY);
    if (stored) {
      cachedConfig = JSON.parse(stored);
      return cachedConfig;
    }
  } catch (e) {
    console.warn("Could not load config from localStorage:", e.message);
  }

  return { multi_repo_subnets: {} };
}

function saveMultiRepoConfig(config) {
  try {
    localStorage.setItem(MULTI_CONFIG_KEY, JSON.stringify(config));
    cachedConfig = config;
  } catch (e) {
    console.warn("Failed to save config:", e.message);
  }
}

// ─── Cache Management ───────────────────────────────────────────

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

// ─── GitHub API Functions (from original api.js) ────────────────

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

async function fetchGitHubRepoData(repoUrl) {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return null;

  const { owner, repo } = parsed;
  const cacheKey = `${owner}/${repo}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

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

    const result = analyzeRepo(repoData, tree);
    setCache(cacheKey, result);
    return result;
  } catch (e) {
    console.warn(`Failed to fetch ${owner}/${repo}:`, e.message);
    return null;
  }
}

function analyzeRepo(repoData, tree) {
  const lowerPaths = tree.map(p => p.toLowerCase());

  const testPatterns = [/^tests?\//, /__tests__\//, /_test\.(py|go|rs|js|ts)$/, /\.test\.(js|ts|jsx|tsx)$/, /\.spec\.(js|ts|jsx|tsx)$/, /test_.*\.py$/];
  const testFiles = lowerPaths.filter(p => testPatterns.some(rx => rx.test(p)));

  const ciPatterns = [/^\.github\/workflows\//, /^\.circleci\//, /^jenkinsfile$/i, /^\.gitlab-ci\.yml$/, /^\.travis\.yml$/];
  const hasCI = lowerPaths.some(p => ciPatterns.some(rx => rx.test(p)));

  const hasDocsFolder = lowerPaths.some(p => p.startsWith("docs/"));
  const hasReadme = lowerPaths.some(p => p === "readme.md" || p === "readme.rst" || p === "readme.txt" || p === "readme");
  const hasContributing = lowerPaths.some(p => p.includes("contributing"));
  const hasChangelog = lowerPaths.some(p => p.includes("changelog") || p.includes("changes.md") || p.includes("history.md"));

  const hasSecurityPolicy = lowerPaths.some(p => p.includes("security.md") || p.includes("security.txt"));
  const hasGitignore = lowerPaths.some(p => p === ".gitignore");
  const hasEnvFile = lowerPaths.some(p => p === ".env" || p === ".env.local" || p === ".env.production");
  const hasExposedSecrets = lowerPaths.some(p => /\.(pem|key|secret)$/.test(p));

  const lockfiles = ["poetry.lock", "pipfile.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "cargo.lock", "go.sum", "gemfile.lock"];
  const hasLockfile = lowerPaths.some(p => lockfiles.some(lf => p.endsWith(lf)));
  const reqFiles = ["requirements.txt", "pyproject.toml", "setup.py", "setup.cfg", "cargo.toml", "go.mod", "package.json", "gemfile"];
  const hasRequirements = lowerPaths.some(p => reqFiles.some(rf => p.endsWith(rf)));

  const codeExts = /\.(py|js|ts|jsx|tsx|rs|go|sol|java|cpp|c|h|rb|ex|exs|swift|kt|scala|zig)$/;
  const codeFiles = lowerPaths.filter(p => codeExts.test(p));

  const btPatterns = ["bittensor", "subtensor", "metagraph", "neuron", "axon", "dendrite", "synapse"];
  const hasBittensorImport = lowerPaths.some(p => btPatterns.some(kw => p.includes(kw)));

  const hasValidatorCode = lowerPaths.some(p => p.includes("validator") || p.includes("vali"));
  const hasMinerCode = lowerPaths.some(p => p.includes("miner"));
  const hasProtocolCode = lowerPaths.some(p => p.includes("protocol") || p.includes("api/") || p.includes("server") || p.includes("network"));

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

// ─── Multi-Repo Aggregation ────────────────────────────────────

function aggregateRepos(repoDataArray, weights) {
  if (!repoDataArray || repoDataArray.length === 0) return null;
  if (repoDataArray.length === 1) return repoDataArray[0];

  const sum = (arr, key) => arr.reduce((acc, r) => acc + (r?.[key] || 0), 0);
  const max = (arr, key) => Math.max(...arr.map(r => r?.[key] || 0));
  const any = (arr, key) => arr.some(r => r?.[key]);

  const weightedStars = repoDataArray.reduce((acc, r, i) => {
    const w = weights[i] || 0.33;
    return acc + (r.stars || 0) * w;
  }, 0);

  const primary = repoDataArray.find((r, i) => weights[i] === Math.max(...weights)) || repoDataArray[0];

  return {
    ...primary,
    name: `${primary.name} (+${repoDataArray.length - 1} repos)`,
    stars: Math.round(weightedStars),
    forks: max(repoDataArray, 'forks'),
    openIssues: sum(repoDataArray, 'openIssues'),
    size: sum(repoDataArray, 'size'),
    daysSinceUpdate: Math.min(...repoDataArray.map(r => r.daysSinceUpdate)),
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

// ─── Enhanced Batch Fetch with Multi-Repo Support ───────────────

export async function fetchAllRepoData(subnetMetaMap, devActivityMap, onProgress) {
  const config = await loadMultiRepoConfig();
  const repoUrls = new Map(); // netuid -> {url, name, netuid}

  // Collect primary repo URLs
  if (devActivityMap) {
    for (const [netuid, dev] of Object.entries(devActivityMap)) {
      if (dev.repoUrl) {
        const name = subnetMetaMap?.[netuid]?.name || `Subnet ${netuid}`;
        repoUrls.set(Number(netuid), { url: dev.repoUrl, name, netuid: Number(netuid) });
      }
    }
  }
  if (subnetMetaMap) {
    for (const [netuid, meta] of Object.entries(subnetMetaMap)) {
      if (meta.github && !repoUrls.has(Number(netuid))) {
        repoUrls.set(Number(netuid), { url: meta.github, name: meta.name || `Subnet ${netuid}`, netuid: Number(netuid) });
      }
    }
  }

  const total = repoUrls.size;
  const result = new Map();
  let completed = 0;
  let failed = 0;

  for (const [netuid, {url, name}] of repoUrls) {
    try {
      // Check if subnet has multi-repo config
      const subnetKey = name.toLowerCase();
      const multiConfig = config.multi_repo_subnets[subnetKey];

      let repoData = null;

      if (multiConfig && multiConfig.repos && multiConfig.repos.length > 1) {
        // Use manual multi-repo config
        console.log(`📦 Using multi-repo config for ${name} (${multiConfig.repos.length} repos)`);
        const repoDataArray = [];
        const weights = [];

        for (const repoConf of multiConfig.repos) {
          const data = await fetchGitHubRepoData(repoConf.url);
          if (data) {
            repoDataArray.push(data);
            weights.push(repoConf.weight || 0.33);
          }
          await new Promise(r => setTimeout(r, 1500));
        }

        repoData = aggregateRepos(repoDataArray, weights);

      } else {
        // Try auto-detection
        console.log(`🔍 Trying auto-detection for ${name}...`);
        const relatedRepos = await autoDetectRelatedRepos(url, name);

        if (relatedRepos.length > 1) {
          console.log(`✅ Auto-detected ${relatedRepos.length} repos for ${name}`);

          // Save for manual review
          const autoConfig = await generateMultiRepoConfig(url, name, netuid);
          saveAutoDetectedConfig(name, autoConfig);

          // Fetch all detected repos
          const repoDataArray = [];
          const weights = [];

          for (const repoConf of relatedRepos) {
            const data = await fetchGitHubRepoData(repoConf.url);
            if (data) {
              repoDataArray.push(data);
              weights.push(repoConf.weight || 0.33);
            }
            await new Promise(r => setTimeout(r, 1500));
          }

          repoData = aggregateRepos(repoDataArray, weights);

        } else {
          // Fallback to single repo
          repoData = await fetchGitHubRepoData(url);
        }
      }

      if (repoData) {
        result.set(netuid, repoData);
      } else {
        failed++;
      }

    } catch (e) {
      console.warn(`Failed to fetch repos for ${name}:`, e.message);
      failed++;
    }

    completed++;
    if (onProgress) onProgress({ completed, total, failed });

    // Rate limit delay
    if (completed < total) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  return result;
}

// Re-export for backward compatibility
export { parseGitHubUrl, analyzeRepo, fetchGitHubRepoData };
