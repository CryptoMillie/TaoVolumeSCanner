#!/bin/bash
# Apply Multi-Repo Fix to Tao Scanner
#
# This script updates GemScanner.jsx to use the enhanced API

set -e

echo "🔧 Applying Multi-Repo Fix..."
echo ""

# Check if we're in the right directory
if [ ! -f "src/GemScanner.jsx" ]; then
  echo "❌ Error: src/GemScanner.jsx not found"
  echo "   Please run this script from the tao-scanner root directory"
  exit 1
fi

# Backup original file
echo "📦 Creating backup: src/GemScanner.jsx.backup"
cp src/GemScanner.jsx src/GemScanner.jsx.backup

# Apply the fix
echo "✏️  Updating import statement..."

# Check if already using enhanced API
if grep -q 'api-enhanced.js' src/GemScanner.jsx; then
  echo "✅ Already using enhanced API!"
  echo ""
  echo "To verify, check that this line exists in src/GemScanner.jsx:"
  echo "   import { fetchAllRepoData } from \"./code/api-enhanced.js\";"
  exit 0
fi

# Replace the import
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  sed -i '' 's|from "./code/api.js"|from "./code/api-enhanced.js"|g' src/GemScanner.jsx
else
  # Linux/WSL
  sed -i 's|from "./code/api.js"|from "./code/api-enhanced.js"|g' src/GemScanner.jsx
fi

echo "✅ Fix applied successfully!"
echo ""
echo "📋 Changes made:"
echo "   - Updated: src/GemScanner.jsx"
echo "   - Backup:  src/GemScanner.jsx.backup"
echo ""
echo "🎯 Next steps:"
echo "   1. Restart your dev server (npm run dev)"
echo "   2. Open the Gem Scanner tab"
echo "   3. Click 'SCAN GEMS' to re-fetch with multi-repo support"
echo "   4. Check Chute's Engineering Practices scores (should be > 0.0)"
echo ""
echo "🔍 To verify:"
echo "   grep 'api-enhanced' src/GemScanner.jsx"
echo ""
echo "📖 For more info, see: MULTI_REPO_FIX.md"
