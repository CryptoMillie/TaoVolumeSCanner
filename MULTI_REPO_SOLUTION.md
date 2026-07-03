# Multi-Repository Support Solution

## Problem
Chute (and potentially other subnets) have **multiple GitHub repositories**, but the scanner only evaluates **ONE repo per subnet**. This causes:
- Engineering Practice scores to be 0.0 if the wrong repo is analyzed
- Missing validator/miner code signals
- Incomplete code quality assessment

## Current Limitation (src/code/api.js:164-180)
```javascript
// Only takes FIRST repo URL found
const repoUrls = new Map(); // netuid -> repoUrl (SINGLE)
if (dev.repoUrl) repoUrls.set(netuid, dev.repoUrl);
if (meta.github) repoUrls.set(netuid, meta.github);
```

## Solution Options

### Option 1: Aggregate Multiple Repos (Best for accuracy)
**Change data structure to support multiple repos per subnet:**

```javascript
// Instead of: Map<netuid, repoData>
// Use: Map<netuid, repoData[]>

const repoUrls = new Map(); // netuid -> repoUrl[]

// Collect ALL repos for each subnet
for (const [netuid, dev] of Object.entries(devActivityMap)) {
  if (!repoUrls.has(netuid)) repoUrls.set(netuid, []);
  if (dev.repoUrl) repoUrls.get(netuid).push(dev.repoUrl);
  // Add additional repos from metadata
  if (meta[netuid]?.additionalRepos) {
    repoUrls.get(netuid).push(...meta[netuid].additionalRepos);
  }
}

// Aggregate analysis across all repos
function aggregateRepoData(repoDataArray) {
  return {
    // Combine signals across repos
    totalFiles: sum(repoDataArray, 'totalFiles'),
    codeFileCount: sum(repoDataArray, 'codeFileCount'),
    testFileCount: sum(repoDataArray, 'testFileCount'),
    hasTests: repoDataArray.some(r => r.hasTests),
    hasCI: repoDataArray.some(r => r.hasCI),
    hasDocsFolder: repoDataArray.some(r => r.hasDocsFolder),
    hasValidatorCode: repoDataArray.some(r => r.hasValidatorCode),
    hasMinerCode: repoDataArray.some(r => r.hasMinerCode),
    // Take max for numeric scores
    stars: max(repoDataArray, 'stars'),
    // etc...
  };
}
```

### Option 2: Manual Configuration (Quick fix)
**Add a config file to specify multiple repos per subnet:**

Create `src/code/multi-repos.json`:
```json
{
  "chute": {
    "netuid": [FIND_THIS],
    "repos": [
      "https://github.com/chuteai/chute-validator",
      "https://github.com/chuteai/chute-miner",
      "https://github.com/chuteai/chute-protocol"
    ],
    "primary": "https://github.com/chuteai/chute-validator"
  }
}
```

### Option 3: Smart Repo Detection (Future enhancement)
**Auto-detect related repos by GitHub API:**
- Search for repos by organization
- Detect repos with matching topics/keywords
- Use GitHub's "related repos" feature

## Recommended Action
1. **First**: Use debug-chute.html to identify ALL Chute repos
2. **Second**: Determine which repo has the actual code (validator/miner)
3. **Third**: Either:
   - Update TaoStats dev_activity to point to the correct repo, OR
   - Implement Option 2 (manual config) as quick fix, OR
   - Implement Option 1 (full multi-repo support) for comprehensive solution

## Files to Modify
- `src/code/api.js` - fetchAllRepoData() function
- `src/code/scoring.js` - aggregation logic
- `src/code/constants.js` - add multi-repo config
