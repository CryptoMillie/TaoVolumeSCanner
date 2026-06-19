// Code Quality Radar — 12-Dimension Scoring Engine
//
// Approximates IntoCode-style engineering scores from public signals:
// TaoStats dev_activity, GitHub API repo metadata + file tree, on-chain data.

import { DIMENSIONS, DIMENSION_WEIGHTS, PILLARS } from "./constants.js";

function num(v) {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function clamp(v, min = 0, max = 10) {
  return Math.max(min, Math.min(max, v));
}

// Scale a value to 0-10 given a range
function scale(value, maxForTen, minForZero = 0) {
  if (maxForTen <= minForZero) return 0;
  return clamp(((value - minForZero) / (maxForTen - minForZero)) * 10);
}

function resolveName(subnet, pool, netuid, meta) {
  if (pool?.name && pool.name !== "Unknown") return pool.name;
  const metaEntry = meta?.[String(netuid)];
  if (metaEntry?.name) return metaEntry.name;
  if (subnet?.name && subnet.name !== "Unknown") return subnet.name;
  if (subnet?.subnet_name && subnet.subnet_name !== "Unknown") return subnet.subnet_name;
  return `Subnet ${netuid}`;
}

// ─── Individual dimension scorers (each returns 0-10) ────────────

function scoreIncentiveDesign(repo, dev) {
  if (!repo) return dev ? scale(dev.commits30d, 200) * 0.5 : 0;
  let s = 0;
  // Custom code beyond template baseline (>20 code files = substantial)
  s += scale(repo.codeFileCount, 100) * 3;
  // Repo age maturity (older = more refined)
  s += scale(repo.ageDays, 365 * 2) * 2;
  // Bittensor integration signals
  if (repo.hasBittensorImport) s += 2;
  // Has validator AND miner code = complete incentive design
  if (repo.hasValidatorCode && repo.hasMinerCode) s += 2;
  else if (repo.hasValidatorCode || repo.hasMinerCode) s += 1;
  return clamp(s);
}

function scoreValidatorConsensus(repo, dev, subnet) {
  let s = 0;
  // Active validators vs permitted
  const activeVal = num(subnet?.active_validators);
  const maxVal = num(subnet?.max_validators || subnet?.immunity_period);
  if (activeVal > 0) s += scale(activeVal, 64) * 3;
  if (maxVal > 0 && activeVal > 0) s += scale(activeVal / maxVal, 1) * 2;
  // Contributor diversity
  if (dev) s += scale(dev.uniqueContributors7d, 10) * 2;
  // Has validator code
  if (repo?.hasValidatorCode) s += 2;
  // Has protocol code
  if (repo?.hasProtocolCode) s += 1;
  return clamp(s);
}

function scoreProtocolDesign(repo, dev) {
  if (!repo) return 0;
  let s = 0;
  // Repo size / complexity
  s += scale(repo.size, 50000) * 2; // KB
  // File count (non-trivial codebase)
  s += scale(repo.totalFiles, 500) * 2;
  // Has protocol/API/network code
  if (repo.hasProtocolCode) s += 2;
  // Code file count (actual substance)
  s += scale(repo.codeFileCount, 200) * 2;
  // Bittensor integration
  if (repo.hasBittensorImport) s += 2;
  return clamp(s);
}

function scoreDecentralization(coldkeyData) {
  if (!coldkeyData || !coldkeyData.entries || coldkeyData.entries.length === 0) return 5; // neutral
  const entries = coldkeyData.entries;
  const totalCount = coldkeyData.totalCount || entries.reduce((sum, e) => sum + (e.count || 0), 0);
  if (totalCount <= 0) return 5;

  let s = 0;
  // Unique holders (more = better)
  s += scale(coldkeyData.uniqueColdkeys, 200) * 3;
  // HHI (lower = more distributed, invert)
  const sorted = [...entries].sort((a, b) => (b.count || 0) - (a.count || 0));
  let hhi = 0;
  for (const e of sorted) {
    const share = (e.count || 0) / totalCount;
    hhi += share * share;
  }
  hhi *= 10000;
  // HHI < 1000 is great, > 5000 is bad
  s += clamp(10 - scale(hhi, 5000)) * 4;
  // Top 1 holder share (lower is better)
  const top1Share = sorted.length > 0 ? (sorted[0].count || 0) / totalCount : 0;
  s += clamp(10 - scale(top1Share, 0.5)) * 3;
  return clamp(s);
}

function scoreCodeQuality(repo, dev) {
  let s = 0;
  // PR merge rate (merged / opened)
  if (dev && dev.prsOpened7d > 0) {
    s += scale(dev.prsMerged7d / dev.prsOpened7d, 1) * 3;
  } else if (dev && dev.prsMerged7d > 0) {
    s += 3;
  }
  // Code reviews
  if (dev) s += scale(dev.reviews7d, 20) * 2;
  // Contributor count
  if (dev) s += scale(dev.uniqueContributors7d, 10) * 2;
  // Issues closed ratio
  if (dev && dev.issuesOpened7d > 0) {
    s += scale(dev.issuesClosed7d / dev.issuesOpened7d, 1) * 2;
  } else if (dev && dev.issuesClosed7d > 0) {
    s += 2;
  }
  // Has tests as proxy for quality culture
  if (repo?.hasTests) s += 1;
  return clamp(s);
}

function scoreTesting(repo) {
  if (!repo) return 0;
  let s = 0;
  // Has test files
  if (repo.hasTests) s += 3;
  // Test file count
  s += scale(repo.testFileCount, 50) * 3;
  // CI config present
  if (repo.hasCI) s += 2;
  // Test-to-code ratio
  if (repo.codeFileCount > 0) {
    const ratio = repo.testFileCount / repo.codeFileCount;
    s += scale(ratio, 0.3) * 2;
  }
  return clamp(s);
}

function scoreSecurity(repo) {
  if (!repo) return 0;
  let s = 5; // baseline — absence of evidence isn't evidence of absence
  // Has .gitignore
  if (repo.hasGitignore) s += 2;
  // Has security policy
  if (repo.hasSecurityPolicy) s += 2;
  // Penalties
  if (repo.hasEnvFile) s -= 3;
  if (repo.hasExposedSecrets) s -= 4;
  // No exposed .env and no secrets = clean
  if (!repo.hasEnvFile && !repo.hasExposedSecrets) s += 1;
  return clamp(s);
}

function scoreDependencyHygiene(repo) {
  if (!repo) return 0;
  let s = 0;
  // Has lockfile (pinned dependencies)
  if (repo.hasLockfile) s += 4;
  // Has requirements/dependency file
  if (repo.hasRequirements) s += 3;
  // Has both = well managed
  if (repo.hasLockfile && repo.hasRequirements) s += 2;
  // License present = professional
  if (repo.license) s += 1;
  return clamp(s);
}

function scoreDocumentation(repo) {
  if (!repo) return 0;
  let s = 0;
  // README exists
  if (repo.hasReadme) s += 3;
  // Docs folder
  if (repo.hasDocsFolder) s += 3;
  // CONTRIBUTING guide
  if (repo.hasContributing) s += 2;
  // CHANGELOG
  if (repo.hasChangelog) s += 1;
  // Repo description via size proxy (large = more likely documented)
  s += scale(repo.size, 20000) * 1;
  return clamp(s);
}

function scoreTeamVelocity(dev) {
  if (!dev) return 0;
  let s = 0;
  // 7d commits (most important velocity signal)
  s += scale(dev.commits7d, 50) * 4;
  // 30d commits (sustained activity)
  s += scale(dev.commits30d, 200) * 2;
  // Unique contributors in 7d
  s += scale(dev.uniqueContributors7d, 8) * 2;
  // Recency: days since last event (lower = better)
  if (dev.daysSinceLastEvent != null) {
    s += clamp(10 - scale(dev.daysSinceLastEvent, 30)) * 2;
  } else if (dev.commits7d > 0) {
    s += 2; // active in last week
  }
  return clamp(s);
}

function scoreExecutionRisk(dev, repo) {
  let s = 5; // baseline neutral
  if (dev) {
    // Commit cadence (7d vs 30d ratio — consistent = good)
    if (dev.commits30d > 0) {
      const weeklyRate = dev.commits7d / (dev.commits30d / 4.3);
      s += scale(Math.min(weeklyRate, 2), 1.5) * 2; // consistent ~1.0 is ideal
    }
    // Open issues manageable
    if (repo && repo.openIssues > 0) {
      // Fewer open issues relative to activity = lower risk
      const issueRatio = repo.openIssues / Math.max(dev.commits30d, 1);
      s += clamp(10 - scale(issueRatio, 5)) * 1.5;
    }
    // Last activity recency
    if (dev.daysSinceLastEvent != null) {
      s += clamp(10 - scale(dev.daysSinceLastEvent, 60)) * 1.5;
    }
  }
  if (repo) {
    // Repo not abandoned (updated recently)
    s += clamp(10 - scale(repo.daysSinceUpdate, 90)) * 1;
  }
  return clamp(s);
}

function scoreOriginality(repo) {
  if (!repo) return 0;
  let s = 0;
  // Not a fork = original work
  if (!repo.isFork) s += 3;
  else s += 1;
  // Stars (community validation)
  s += scale(repo.stars, 100) * 2;
  // Code size beyond template baseline (~10 code files = template, ~50+ = substantial)
  s += scale(repo.codeFileCount, 80, 10) * 3;
  // Bittensor integration (unique to this ecosystem)
  if (repo.hasBittensorImport) s += 1;
  // Forks of this repo (others building on it)
  s += scale(repo.forks, 30) * 1;
  return clamp(s);
}

// ─── Main scoring function ──────────────────────────────────────

export function scoreCode(subnetsRaw, poolsRaw, meta, devActivityMap, repoDataMap, coldkeyMap) {
  const subnets = Array.isArray(subnetsRaw) ? subnetsRaw : (subnetsRaw?.data || []);
  const pools = Array.isArray(poolsRaw) ? poolsRaw : (poolsRaw?.data || []);

  const poolMap = {};
  pools.forEach(p => {
    const id = p.netuid ?? p.subnet_id;
    if (id != null) poolMap[id] = p;
  });

  const results = [];

  for (const s of subnets) {
    const netuid = s.netuid ?? s.subnet_id;
    const pool = poolMap[netuid] || null;
    const dev = devActivityMap?.[netuid] || null;
    const repo = repoDataMap?.get(netuid) || null;
    const coldkey = coldkeyMap?.[netuid] || null;
    const repoUrl = dev?.repoUrl || meta?.[String(netuid)]?.github || "";

    // Skip subnets with no repo data AND no dev activity
    if (!repo && !dev) continue;

    const name = resolveName(s, pool, netuid, meta);

    // Score each dimension
    const dimensions = {
      incentiveDesign:    round1(scoreIncentiveDesign(repo, dev)),
      validatorConsensus: round1(scoreValidatorConsensus(repo, dev, s)),
      protocolDesign:     round1(scoreProtocolDesign(repo, dev)),
      decentralization:   round1(scoreDecentralization(coldkey)),
      codeQuality:        round1(scoreCodeQuality(repo, dev)),
      testing:            round1(scoreTesting(repo)),
      security:           round1(scoreSecurity(repo)),
      dependencyHygiene:  round1(scoreDependencyHygiene(repo)),
      documentation:      round1(scoreDocumentation(repo)),
      teamVelocity:       round1(scoreTeamVelocity(dev)),
      executionRisk:      round1(scoreExecutionRisk(dev, repo)),
      originality:        round1(scoreOriginality(repo)),
    };

    // Composite score: weighted average by pillar
    const pillarScores = {};
    for (const [pillarKey, pillarDef] of Object.entries(PILLARS)) {
      const dims = DIMENSIONS.filter(d => d.pillar === pillarKey);
      let weightedSum = 0;
      let totalWeight = 0;
      for (const dim of dims) {
        const w = DIMENSION_WEIGHTS[dim.key] || 0;
        weightedSum += dimensions[dim.key] * w;
        totalWeight += w;
      }
      pillarScores[pillarKey] = totalWeight > 0 ? weightedSum / totalWeight : 0;
    }

    // Overall composite: weighted by pillar weights
    let composite = 0;
    for (const [pillarKey, pillarDef] of Object.entries(PILLARS)) {
      composite += (pillarScores[pillarKey] || 0) * pillarDef.weight;
    }
    composite = round1(composite);

    results.push({
      netuid,
      name,
      repoUrl,
      hasRepoData: !!repo,
      dimensions,
      pillarScores: {
        BITTENSOR: round1(pillarScores.BITTENSOR || 0),
        ENGINEERING: round1(pillarScores.ENGINEERING || 0),
        SUSTAINABILITY: round1(pillarScores.SUSTAINABILITY || 0),
      },
      composite,
    });
  }

  results.sort((a, b) => b.composite - a.composite);
  return results;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
