param(
  [switch]$SkipExeBuild
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ReleaseRoot = Join-Path $Root "release"
$AppDir = Join-Path $ReleaseRoot "BlockMeshCLI"
$FallbackAppDir = Join-Path $ReleaseRoot "BlockMeshCLI.next"
$ZipPath = Join-Path $ReleaseRoot "BlockMeshCLI.zip"
$FallbackZipPath = Join-Path $ReleaseRoot "BlockMeshCLI-next.zip"
$StageDir = Join-Path $ReleaseRoot ("_stage_" + [guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "reports") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "state") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $StageDir "Sim") | Out-Null

Copy-Item -LiteralPath (Join-Path $Root "block-mesh.js") -Destination (Join-Path $StageDir "block-mesh.js")
Copy-Item -LiteralPath (Join-Path $Root "server.js") -Destination (Join-Path $StageDir "server.js")
Copy-Item -LiteralPath (Join-Path $Root "settings.json") -Destination (Join-Path $StageDir "settings.json")
Copy-Item -LiteralPath (Join-Path $Root "README.md") -Destination (Join-Path $StageDir "README.txt")
Copy-Item -LiteralPath (Join-Path $Root "public") -Destination (Join-Path $StageDir "public") -Recurse
Copy-Item -LiteralPath (Join-Path $Root "one-click-auto.ps1") -Destination (Join-Path $StageDir "one-click-auto.ps1")

@"
# Put accounts here, one per line:
# username:password:_|WARNING:-DO-NOT-SHARE-THIS...
"@ | Set-Content -LiteralPath (Join-Path $StageDir "cookies.txt") -Encoding UTF8

@"
QUICK START

1. Open cookies.txt.
2. Paste one account per line:
   username:password:_|WARNING:-DO-NOT-SHARE-THIS...
3. Run run-validate.bat.
4. Run run-plan.bat.
5. Run run-simulate.bat to test timing without blocking.
6. Run run-one-click-live.bat when you want validate + plan + apply in one click.

The tool writes sanitized reports to the reports folder.
Do not share cookies.txt.
"@ | Set-Content -LiteralPath (Join-Path $StageDir "QUICK_START.txt") -Encoding UTF8

@"
@echo off
setlocal
cd /d "%~dp0"
if exist blockmesh.exe (
  blockmesh.exe validate --cookies cookies.txt
) else (
  node block-mesh.js validate --cookies cookies.txt
)
pause
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-validate.bat") -Encoding ASCII

@"
@echo off
setlocal
cd /d "%~dp0"
if exist blockmesh.exe (
  blockmesh.exe plan --cookies cookies.txt --skip-block-list-check --allow-unverified-blocklist
) else (
  node block-mesh.js plan --cookies cookies.txt --skip-block-list-check --allow-unverified-blocklist
)
pause
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-plan.bat") -Encoding ASCII

@"
@echo off
setlocal
cd /d "%~dp0"
if exist blockmesh.exe (
  blockmesh.exe simulate --cookies cookies.txt --mode fast --account-concurrency 10 --allow-unverified-blocklist --skip-block-list-check --simulation-profile mixed
) else (
  node block-mesh.js simulate --cookies cookies.txt --mode fast --account-concurrency 10 --allow-unverified-blocklist --skip-block-list-check --simulation-profile mixed
)
copy /y reports\block-report-*.json Sim\ >nul
pause
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-simulate.bat") -Encoding ASCII

@"
@echo off
setlocal
cd /d "%~dp0"
echo SAFE ONE CLICK: validate, plan, simulate. No block requests are sent.
if exist blockmesh.exe (
  blockmesh.exe validate --cookies cookies.txt
  if errorlevel 1 goto fail
  blockmesh.exe plan --cookies cookies.txt --skip-block-list-check --allow-unverified-blocklist
  if errorlevel 1 goto fail
  blockmesh.exe simulate --cookies cookies.txt --mode fast --account-concurrency 10 --allow-unverified-blocklist --skip-block-list-check --simulation-profile mixed
) else (
  node block-mesh.js validate --cookies cookies.txt
  if errorlevel 1 goto fail
  node block-mesh.js plan --cookies cookies.txt --skip-block-list-check --allow-unverified-blocklist
  if errorlevel 1 goto fail
  node block-mesh.js simulate --cookies cookies.txt --mode fast --account-concurrency 10 --allow-unverified-blocklist --skip-block-list-check --simulation-profile mixed
)
copy /y reports\block-report-*.json Sim\ >nul
echo Done. Check reports and Sim folders.
pause
exit /b 0
:fail
echo Failed. Check the message above.
pause
exit /b 1
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-one-click-safe.bat") -Encoding ASCII

@"
@echo off
setlocal
cd /d "%~dp0"
echo This sends real Roblox block requests.
choice /m "Continue"
if errorlevel 2 exit /b 1
if exist blockmesh.exe (
  blockmesh.exe apply --cookies cookies.txt --mode fast --account-concurrency 10 --allow-unverified-blocklist --skip-block-list-check --per-account-delay-min 420 --per-account-delay-max 760 --cooldown-on-429 12000
) else (
  node block-mesh.js apply --cookies cookies.txt --mode fast --account-concurrency 10 --allow-unverified-blocklist --skip-block-list-check --per-account-delay-min 420 --per-account-delay-max 760 --cooldown-on-429 12000
)
pause
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-apply.bat") -Encoding ASCII

@"
@echo off
setlocal
cd /d "%~dp0"
echo LIVE ONE CLICK: validate, plan, apply real Roblox block requests.
echo Use run-one-click-safe.bat first if you only want to test.
choice /m "Continue with real apply"
if errorlevel 2 exit /b 1
if exist blockmesh.exe (
  blockmesh.exe validate --cookies cookies.txt
  if errorlevel 1 goto fail
  blockmesh.exe plan --cookies cookies.txt --skip-block-list-check --allow-unverified-blocklist
  if errorlevel 1 goto fail
  blockmesh.exe apply --cookies cookies.txt --mode fast --account-concurrency 10 --allow-unverified-blocklist --skip-block-list-check --per-account-delay-min 420 --per-account-delay-max 760 --cooldown-on-429 12000
) else (
  node block-mesh.js validate --cookies cookies.txt
  if errorlevel 1 goto fail
  node block-mesh.js plan --cookies cookies.txt --skip-block-list-check --allow-unverified-blocklist
  if errorlevel 1 goto fail
  node block-mesh.js apply --cookies cookies.txt --mode fast --account-concurrency 10 --allow-unverified-blocklist --skip-block-list-check --per-account-delay-min 420 --per-account-delay-max 760 --cooldown-on-429 12000
)
echo Done. If there are failed 429 pairs, run run-retry-failed.bat after waiting 1-3 minutes.
pause
exit /b 0
:fail
echo Failed. Check the message above.
pause
exit /b 1
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-one-click-live.bat") -Encoding ASCII

@"
@echo off
setlocal
cd /d "%~dp0"
set /p REPORT=Report path or name from reports folder:
if "%REPORT%"=="" exit /b 1
if exist "%REPORT%" (
  set REPORT_ARG=%REPORT%
) else (
  set REPORT_ARG=reports\%REPORT%
)
if exist blockmesh.exe (
  blockmesh.exe retry-failed --cookies cookies.txt --report "%REPORT_ARG%" --mode fast-drain --account-concurrency 3 --allow-unverified-blocklist --skip-block-list-check --per-account-delay-min 700 --per-account-delay-max 1200 --cooldown-on-429 12000
) else (
  node block-mesh.js retry-failed --cookies cookies.txt --report "%REPORT_ARG%" --mode fast-drain --account-concurrency 3 --allow-unverified-blocklist --skip-block-list-check --per-account-delay-min 700 --per-account-delay-max 1200 --cooldown-on-429 12000
)
pause
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-retry-failed.bat") -Encoding ASCII

@"
@echo off
setlocal
cd /d "%~dp0"
node server.js
pause
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-web-ui.bat") -Encoding ASCII

@"
@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0one-click-auto.ps1" -Mode safe
pause
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-one-click-auto-safe.bat") -Encoding ASCII

@"
@echo off
setlocal
cd /d "%~dp0"
echo This will send real Roblox block requests and auto retry failed pairs.
choice /m "Continue"
if errorlevel 2 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0one-click-auto.ps1" -Mode live -RetryRounds 2 -RetryWaitSeconds 90
pause
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-one-click-auto-live.bat") -Encoding ASCII

@"
@echo off
setlocal
cd /d "%~dp0"
if exist blockmesh.exe (
  blockmesh.exe status
) else (
  node block-mesh.js status
)
pause
"@ | Set-Content -LiteralPath (Join-Path $StageDir "run-status.bat") -Encoding ASCII

if (-not $SkipExeBuild) {
  $npx = Get-Command npx -ErrorAction SilentlyContinue
  if ($npx) {
    Push-Location $Root
    try {
      & npx --yes pkg@5.8.1 ".\block-mesh.js" --targets node18-win-x64 --output (Join-Path $StageDir "blockmesh.exe")
    } finally {
      Pop-Location
    }
  } else {
    Write-Warning "npx was not found. Release will use node fallback scripts."
  }
}

function TryReplaceDirectory {
  param(
    [string]$SourceDir,
    [string]$PrimaryDir,
    [string]$FallbackDir
  )
  try {
    if (Test-Path $PrimaryDir) {
      Remove-Item -LiteralPath $PrimaryDir -Recurse -Force
    }
    Move-Item -LiteralPath $SourceDir -Destination $PrimaryDir -Force
    return @{ Directory = $PrimaryDir; UsedFallback = $false }
  } catch {
    if (Test-Path $FallbackDir) {
      Remove-Item -LiteralPath $FallbackDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Move-Item -LiteralPath $SourceDir -Destination $FallbackDir -Force
    return @{ Directory = $FallbackDir; UsedFallback = $true }
  }
}

$result = TryReplaceDirectory -SourceDir $StageDir -PrimaryDir $AppDir -FallbackDir $FallbackAppDir
$FinalDir = $result.Directory
$FinalZipPath = if ($result.UsedFallback) { $FallbackZipPath } else { $ZipPath }

if (Test-Path $FinalZipPath) {
  Remove-Item -LiteralPath $FinalZipPath -Force
}
Compress-Archive -Path (Join-Path $FinalDir "*") -DestinationPath $FinalZipPath -Force

Write-Host "Release folder: $FinalDir"
Write-Host "Release zip: $FinalZipPath"
if ($result.UsedFallback) {
  Write-Warning "Primary release folder was locked. Wrote fallback release to $FinalDir"
}

