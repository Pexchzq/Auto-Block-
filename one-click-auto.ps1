param(
  [ValidateSet("safe", "live")]
  [string]$Mode = "safe",
  [ValidateSet("balanced", "fast", "turbo")]
  [string]$SpeedProfile = "fast",
  [int]$AccountLimit = 0,
  [int]$RetryRounds = 1,
  [int]$RetryWaitSeconds = 90
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Invoke-Step {
  param(
    [string]$Name,
    [string[]]$CommandArgs
  )
  Write-Host ""
  Write-Host "== $Name ==" -ForegroundColor Cyan
  & node @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

function Get-LatestReport {
  Get-ChildItem -Path (Join-Path $Root "reports") -Filter "block-report-*.json" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

function Show-ReportSummary {
  param([string]$Path)
  $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  $s = $json.summary
  Write-Host ""
  Write-Host "Report: $(Split-Path -Leaf $Path)" -ForegroundColor Yellow
  Write-Host "command=$($json.command) accounts=$($s.validUniqueAccounts) pairs=$($s.directedPairs) blocked=$($s.blocked) already=$($s.alreadyBlockedFromApi) failed=$($s.failed) estimatedSeconds=$($s.estimatedApplySeconds)"
  if ($json.metrics) {
    Write-Host "durationMs=$($json.metrics.durationMs) requests=$($json.metrics.requestsTotal) rateLimit=$($json.metrics.rateLimitCount)"
  }
  return $json
}

function Show-DiagnosticSummary {
  $diagPath = Join-Path $Root "diagnostics\\latest-summary.txt"
  if (Test-Path -LiteralPath $diagPath) {
    Write-Host ""
    Write-Host "Diagnostic: latest-summary.txt" -ForegroundColor Yellow
    Get-Content -LiteralPath $diagPath
  }
}

function Assert-ExpectedAccounts {
  param(
    [object]$Report,
    [int]$ExpectedAccounts,
    [string]$StepName
  )

  $actual = 0
  if ($Report.summary -and $null -ne $Report.summary.validUniqueAccounts) {
    $actual = [int]$Report.summary.validUniqueAccounts
  } elseif ($Report.summary -and $null -ne $Report.summary.validAccounts) {
    $actual = [int]$Report.summary.validAccounts
  }

  if ($ExpectedAccounts -gt 0 -and $actual -lt $ExpectedAccounts) {
    throw "$StepName validated only $actual/$ExpectedAccounts accounts. Stopping to avoid an incomplete block mesh. Re-run after a short cooldown."
  }
}

function Invoke-ValidatedStep {
  param(
    [string]$Name,
    [string[]]$CommandArgs,
    [int]$ExpectedAccounts,
    [int]$Retries = 2,
    [int]$WaitSeconds = 30
  )

  for ($attempt = 1; $attempt -le ($Retries + 1); $attempt += 1) {
    Invoke-Step $Name $CommandArgs
    $latest = Get-LatestReport
    $report = Show-ReportSummary $latest.FullName

    try {
      Assert-ExpectedAccounts -Report $report -ExpectedAccounts $ExpectedAccounts -StepName $Name
      return @{ Report = $report; Path = $latest.FullName }
    } catch {
      if ($attempt -gt $Retries) {
        throw
      }
      Write-Host "$Name account count mismatch. Waiting $WaitSeconds seconds then retrying validation step. $($_.Exception.Message)" -ForegroundColor Yellow
      Start-Sleep -Seconds $WaitSeconds
    }
  }
}

function Get-RetryCommandArgs {
  param(
    [string]$ReportPath,
    [int]$Failed,
    [int]$Limit
  )

  $profile = "recovery"
  $concurrency = "4"
  $delayMin = "1200"
  $delayMax = "2200"
  $targetCooldown = "3000"
  $sourceMax = "18"
  $hold = "90000"

  if ($Failed -lt 50) {
    $profile = "fast-drain"
    $concurrency = "3"
    $delayMin = "700"
    $delayMax = "1200"
    $targetCooldown = "2200"
    $sourceMax = "18"
    $hold = "90000"
  }

  $args = @(
    "block-mesh.js",
    "retry-failed",
    "--report", $ReportPath,
    "--cookies", "cookies.txt",
    "--use-state-auth",
    "--mode", $profile,
    "--account-concurrency", $concurrency,
    "--allow-unverified-blocklist",
    "--skip-block-list-check",
    "--per-account-delay-min", $delayMin,
    "--per-account-delay-max", $delayMax,
    "--cooldown-on-429", "12000",
    "--target-cooldown", $targetCooldown,
    "--source-max-per-window", $sourceMax,
    "--recovery-hold", $hold
  )
  if ($Limit -gt 0) {
    $args += @("--account-limit", [string]$Limit)
  }
  return $args
}

function Get-RetryWaitSeconds {
  param(
    [object]$Report,
    [int]$FallbackSeconds
  )
  $rateLimit = 0
  if ($Report.metrics -and $null -ne $Report.metrics.rateLimitCount) {
    $rateLimit = [int]$Report.metrics.rateLimitCount
  }
  if ($rateLimit -ge 100) { return 180 }
  if ($rateLimit -ge 30) { return 120 }
  if ($rateLimit -gt 0) { return 75 }
  return $FallbackSeconds
}

$common = @(
  "block-mesh.js",
  "--cookies", "cookies.txt",
  "--use-state-auth",
  "--mode", $SpeedProfile,
  "--account-concurrency", $(if ($SpeedProfile -eq "turbo") { "12" } elseif ($SpeedProfile -eq "fast") { "10" } else { "8" }),
  "--allow-unverified-blocklist",
  "--skip-block-list-check",
  "--progress-only",
  "--per-account-delay-min", $(if ($SpeedProfile -eq "turbo") { "350" } elseif ($SpeedProfile -eq "fast") { "420" } else { "500" }),
  "--per-account-delay-max", $(if ($SpeedProfile -eq "turbo") { "650" } elseif ($SpeedProfile -eq "fast") { "760" } else { "900" }),
  "--cooldown-on-429", "12000",
  "--target-cooldown", $(if ($SpeedProfile -eq "turbo") { "1300" } elseif ($SpeedProfile -eq "fast") { "1500" } else { "1800" }),
  "--source-max-per-window", $(if ($SpeedProfile -eq "turbo") { "28" } elseif ($SpeedProfile -eq "fast") { "26" } else { "24" }),
  "--recovery-hold", "60000"
)
$limitArgs = @()
if ($AccountLimit -gt 0) {
  $common += @("--account-limit", [string]$AccountLimit)
  $limitArgs = @("--account-limit", [string]$AccountLimit)
}

Write-Host "Block Mesh One-Click ($Mode / $SpeedProfile)" -ForegroundColor Green
Write-Host "Cookies stay local. Reports are sanitized."

$expectedAccounts = 0
$validateJson = $null
for ($attempt = 1; $attempt -le 4; $attempt += 1) {
  Invoke-Step "validate" (@("block-mesh.js", "validate", "--cookies", "cookies.txt", "--validate-concurrency", "10") + $limitArgs)
  $validateJson = Show-ReportSummary (Get-LatestReport).FullName
  if ($validateJson.summary -and $null -ne $validateJson.summary.parsedAccounts) {
    $expectedAccounts = [int]$validateJson.summary.parsedAccounts
  }
  $validAccounts = 0
  if ($validateJson.summary -and $null -ne $validateJson.summary.validAccounts) {
    $validAccounts = [int]$validateJson.summary.validAccounts
  }
  if ($expectedAccounts -gt 0 -and $validAccounts -ge $expectedAccounts) {
    break
  }
  if ($attempt -ge 4) {
    throw "validate only found $validAccounts/$expectedAccounts accounts after $attempt attempts. Stop before incomplete mesh."
  }
  $wait = 60 + ($attempt * 30)
  Write-Host "validate found only $validAccounts/$expectedAccounts accounts. Waiting $wait seconds before retry." -ForegroundColor Yellow
  Start-Sleep -Seconds $wait
}
Invoke-Step "diagnose-validate" @("block-mesh.js", "diagnose")

Invoke-Step "plan" (@("block-mesh.js", "plan", "--cookies", "cookies.txt", "--use-state-auth", "--summary-only", "--allow-unverified-blocklist", "--skip-block-list-check") + $limitArgs)
$planJson = Show-ReportSummary (Get-LatestReport).FullName
if ($planJson.summary -and $null -ne $planJson.summary.validUniqueAccounts) {
  $expectedAccounts = [int]$planJson.summary.validUniqueAccounts
}
$expectedPairs = 0
if ($planJson.summary -and $null -ne $planJson.summary.directedPairs) {
  $expectedPairs = [int]$planJson.summary.directedPairs
}
Invoke-Step "diagnose-plan" @("block-mesh.js", "diagnose")

if ($expectedAccounts -lt 120) {
  $simStep = Invoke-ValidatedStep "simulate" ($common[0..0] + @("simulate") + $common[1..($common.Length - 1)] + @("--simulation-profile", "mixed")) $expectedAccounts 2 30
  $simReport = Get-Item -LiteralPath $simStep.Path
  Copy-Item -LiteralPath $simReport.FullName -Destination (Join-Path $Root "Sim") -Force
  $simJson = $simStep.Report
  Invoke-Step "diagnose-simulate" @("block-mesh.js", "diagnose")
  Show-DiagnosticSummary

  if (($simJson.summary.failed -as [int]) -gt 0) {
    Write-Host "Simulation warning: some pairs are expected to fail or rate limit, live mode will still continue." -ForegroundColor Yellow
  }
} else {
  Write-Host "Skipping simulation for large job ($expectedAccounts accounts) to avoid huge fake reports and wasted time." -ForegroundColor Yellow
}

if ($Mode -eq "safe") {
  Write-Host ""
  Write-Host "Safe mode finished. No block requests were sent." -ForegroundColor Green
  exit 0
}

$applyArgs = $common[0..0] + @("apply") + $common[1..($common.Length - 1)] + @("--expect-accounts", [string]$expectedAccounts)
$applyStep = Invoke-ValidatedStep "apply" $applyArgs $expectedAccounts 0 0
$latest = Get-Item -LiteralPath $applyStep.Path
$applyReport = $applyStep.Report
$report = $applyStep.Report
Invoke-Step "diagnose-apply" @("block-mesh.js", "diagnose")
Show-DiagnosticSummary

for ($round = 1; $round -le $RetryRounds; $round += 1) {
  $failed = 0
  if ($null -ne $report.summary.failed) {
    $failed = [int]$report.summary.failed
  }
  if ($failed -le 0) {
    break
  }

  $waitSeconds = Get-RetryWaitSeconds -Report $report -FallbackSeconds $RetryWaitSeconds
  $retryArgs = Get-RetryCommandArgs -ReportPath $latest.FullName -Failed $failed -Limit $AccountLimit
  Write-Host ""
  Write-Host "Retry round $round/$RetryRounds after $waitSeconds seconds. failed=$failed" -ForegroundColor Yellow
  Start-Sleep -Seconds $waitSeconds
  Invoke-Step "retry-failed-$round" $retryArgs
  $latest = Get-LatestReport
  $report = Show-ReportSummary $latest.FullName
  Invoke-Step "diagnose-retry-$round" @("block-mesh.js", "diagnose")
  Show-DiagnosticSummary
}

$applySuccess = 0
if ($applyReport.summary) {
  $applySuccess += [int]($applyReport.summary.blocked -as [int])
  $applySuccess += [int]($applyReport.summary.alreadyBlockedFromApi -as [int])
  $applySuccess += [int]($applyReport.summary.skippedKnownSuccess -as [int])
}
$lastFailed = 0
if ($report.summary -and $null -ne $report.summary.failed) {
  $lastFailed = [int]$report.summary.failed
}
if ($expectedPairs -gt 0 -and $applyReport.summary -and [int]$applyReport.summary.directedPairs -eq $expectedPairs -and $lastFailed -eq 0) {
  Write-Host "Completion check: expectedPairs=$expectedPairs applySuccess=$applySuccess finalFailed=$lastFailed" -ForegroundColor Green
} elseif ($expectedPairs -gt 0) {
  Write-Host "Warning: completion check is not clean. expectedPairs=$expectedPairs applyPairs=$($applyReport.summary.directedPairs) applySuccess=$applySuccess finalFailed=$lastFailed" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Live one-click finished." -ForegroundColor Green
