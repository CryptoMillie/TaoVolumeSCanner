@echo off
REM Apply Multi-Repo Fix to Tao Scanner (Windows)

echo.
echo 🔧 Applying Multi-Repo Fix...
echo.

REM Check if we're in the right directory
if not exist "src\GemScanner.jsx" (
  echo ❌ Error: src\GemScanner.jsx not found
  echo    Please run this script from the tao-scanner root directory
  exit /b 1
)

REM Backup original file
echo 📦 Creating backup: src\GemScanner.jsx.backup
copy /Y src\GemScanner.jsx src\GemScanner.jsx.backup >nul

REM Check if already using enhanced API
findstr /C:"api-enhanced.js" src\GemScanner.jsx >nul 2>&1
if %errorlevel% equ 0 (
  echo ✅ Already using enhanced API!
  echo.
  echo To verify, check that this line exists in src\GemScanner.jsx:
  echo    import { fetchAllRepoData } from "./code/api-enhanced.js";
  exit /b 0
)

REM Apply the fix using PowerShell
echo ✏️  Updating import statement...
powershell -Command "(Get-Content src\GemScanner.jsx) -replace 'from \"./code/api.js\"', 'from \"./code/api-enhanced.js\"' | Set-Content src\GemScanner.jsx"

echo ✅ Fix applied successfully!
echo.
echo 📋 Changes made:
echo    - Updated: src\GemScanner.jsx
echo    - Backup:  src\GemScanner.jsx.backup
echo.
echo 🎯 Next steps:
echo    1. Restart your dev server (npm run dev)
echo    2. Open the Gem Scanner tab
echo    3. Click 'SCAN GEMS' to re-fetch with multi-repo support
echo    4. Check Chute's Engineering Practices scores (should be ^> 0.0)
echo.
echo 🔍 To verify:
echo    findstr "api-enhanced" src\GemScanner.jsx
echo.
echo 📖 For more info, see: MULTI_REPO_FIX.md
echo.
pause
