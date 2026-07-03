// Universal Multi-Repo Auto-Detection
//
// Automatically discovers related repositories for any subnet by:
// 1. Parsing the organization from the primary repo URL
// 2. Fetching all repos in that org
// 3. Detecting related repos by naming patterns
// 4. Building a comprehensive repo list

const COMMON_SUFFIXES = [
  '-miner', '-validator', '-vali', '-api', '-protocol',
  '-client', '-sdk', '-core', '-node', '-server',
  '-cli', '-tools', '-audit', '-docs', '-frontend', '-backend'
];

const COMMON_PREFIXES = [
  'bittensor-', 'bt-', 'subnet-', 'sn-', 'tao-'
];

/**
 * Extract GitHub org name from a repo URL
 */
function extractOrgName(repoUrl) {
  if (!repoUrl) return null;
  const match = repoUrl.match(/github\.com\/([^/]+)\//);
  return match ? match[1] : null;
}

/**
 * Extract base repo name (without common suffixes/prefixes)
 */
function extractBaseName(repoName) {
  let name = repoName.toLowerCase();

  // Remove common suffixes
  for (const suffix of COMMON_SUFFIXES) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }

  // Remove common prefixes
  for (const prefix of COMMON_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }

  return name;
}

/**
 * Check if two repo names are related
 */
function areReposRelated(baseName, candidateName) {
  const base = baseName.toLowerCase();
  const candidate = candidateName.toLowerCase();

  // Extract base of candidate
  const candidateBase = extractBaseName(candidate);

  // Check if bases match
  if (candidateBase === base || base.includes(candidateBase) || candidateBase.includes(base)) {
    return true;
  }

  // Check if candidate starts with base
  if (candidate.startsWith(base)) {
    const remainder = candidate.slice(base.length);
    // Check if remainder is a known suffix
    if (COMMON_SUFFIXES.some(s => remainder === s || remainder === s.replace('-', ''))) {
      return true;
    }
  }

  return false;
}

/**
 * Fetch all repos from a GitHub organization
 */
async function fetchOrgRepos(orgName, maxPages = 3) {
  const repos = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const response = await fetch(
        `https://api.github.com/orgs/${orgName}/repos?per_page=100&page=${page}&sort=updated`
      );

      if (!response.ok) {
        console.warn(`Failed to fetch org repos (${response.status})`);
        break;
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) break;

      repos.push(...data);

      // If we got fewer than 100, we're done
      if (data.length < 100) break;

      // Rate limit delay
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.warn(`Error fetching org repos:`, e.message);
      break;
    }
  }

  return repos;
}

/**
 * Auto-detect related repos for a subnet
 *
 * @param {string} primaryRepoUrl - The main repo URL from TaoStats
 * @param {string} subnetName - Name of the subnet
 * @returns {Promise<Array>} - Array of related repo URLs with metadata
 */
export async function autoDetectRelatedRepos(primaryRepoUrl, subnetName) {
  if (!primaryRepoUrl) return [];

  // Extract org name
  const orgName = extractOrgName(primaryRepoUrl);
  if (!orgName) return [];

  console.log(`🔍 Auto-detecting repos for ${subnetName} in org: ${orgName}`);

  // Fetch all org repos
  const allRepos = await fetchOrgRepos(orgName);
  if (allRepos.length === 0) return [];

  console.log(`Found ${allRepos.length} repos in ${orgName}`);

  // Extract base name from primary repo
  const primaryRepoName = primaryRepoUrl.split('/').pop().replace(/\.git$/, '');
  const baseName = extractBaseName(primaryRepoName);

  // Filter related repos
  const relatedRepos = allRepos.filter(repo => {
    // Skip archived or disabled repos
    if (repo.archived || repo.disabled) return false;

    // Check if related by name
    return areReposRelated(baseName, repo.name);
  });

  console.log(`Found ${relatedRepos.length} related repos for base name "${baseName}"`);

  // Sort by importance (miner/validator first, then by stars)
  const sortedRepos = relatedRepos.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();

    // Priority order
    const getPriority = (name) => {
      if (name.includes('miner')) return 10;
      if (name.includes('validator') || name.includes('vali')) return 9;
      if (name.includes('protocol')) return 8;
      if (name.includes('core')) return 7;
      if (name.includes('api')) return 6;
      if (name.includes('client') || name.includes('sdk')) return 5;
      if (name.includes('cli')) return 4;
      if (name.includes('docs')) return 1;
      return 3;
    };

    const aPriority = getPriority(aName);
    const bPriority = getPriority(bName);

    if (aPriority !== bPriority) return bPriority - aPriority;

    // If same priority, sort by stars
    return (b.stargazers_count || 0) - (a.stargazers_count || 0);
  });

  // Build result with weights
  return sortedRepos.map((repo, index) => {
    const name = repo.name.toLowerCase();

    // Assign weights based on repo type
    let weight = 0.1;
    let isPrimary = false;

    if (name.includes('miner')) {
      weight = 0.4;
      isPrimary = true;
    } else if (name.includes('validator') || name.includes('vali')) {
      weight = 0.4;
      isPrimary = true;
    } else if (name.includes('protocol') || name.includes('core')) {
      weight = 0.3;
    } else if (name.includes('api')) {
      weight = 0.2;
    } else if (name.includes('client') || name.includes('sdk')) {
      weight = 0.15;
    } else if (name.includes('cli') || name.includes('tools')) {
      weight = 0.1;
    } else if (name.includes('docs')) {
      weight = 0.05;
    }

    return {
      url: repo.html_url,
      name: repo.name,
      primary: isPrimary,
      weight: weight,
      stars: repo.stargazers_count || 0,
      description: repo.description || `${repo.name} repository`,
      language: repo.language,
      updated_at: repo.updated_at,
    };
  });
}

/**
 * Generate multi-repo config for a subnet
 */
export async function generateMultiRepoConfig(primaryRepoUrl, subnetName, netuid) {
  const relatedRepos = await autoDetectRelatedRepos(primaryRepoUrl, subnetName);

  if (relatedRepos.length === 0) {
    return null;
  }

  // Normalize weights to sum to 1.0
  const totalWeight = relatedRepos.reduce((sum, r) => sum + r.weight, 0);
  const normalizedRepos = relatedRepos.map(r => ({
    ...r,
    weight: Math.round((r.weight / totalWeight) * 100) / 100
  }));

  return {
    netuid: netuid,
    repos: normalizedRepos,
    auto_detected: true,
    detected_at: new Date().toISOString(),
  };
}

/**
 * Save auto-detected config to localStorage for manual review
 */
export function saveAutoDetectedConfig(subnetName, config) {
  try {
    const key = `auto_detected_repos_${subnetName.toLowerCase()}`;
    localStorage.setItem(key, JSON.stringify({
      config,
      timestamp: Date.now(),
    }));
    console.log(`✅ Saved auto-detected config for ${subnetName}. Review in console:`);
    console.log(JSON.stringify(config, null, 2));
  } catch (e) {
    console.warn('Failed to save auto-detected config:', e.message);
  }
}
