param(
    [Parameter(Mandatory = $true)]
    [string]$SupabaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$SupabaseAnonKey,

    [Parameter(Mandatory = $true)]
    [string]$SupabaseServiceRoleKey,

    [string]$SiteUrl = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function New-Secret {
    param([int]$Bytes = 32)

    $buffer = New-Object byte[] $Bytes
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($buffer)
    }
    finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Content
    )

    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, $Content, $utf8)
}

$workerToken = New-Secret
$botToken = New-Secret
$jobEncryptionKey = New-Secret
$webhookSecret = New-Secret
$nodeExe = Join-Path $repoRoot "web\.tools\node-v22.22.3-win-x64\node.exe"
$engineScript = Join-Path $repoRoot "block-mesh.js"
$workerWorkspace = Join-Path $repoRoot "worker\.work"

$webEnv = @"
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_SITE_URL=$SiteUrl
NEXT_PUBLIC_SUPABASE_URL=$SupabaseUrl
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SupabaseAnonKey
SUPABASE_SERVICE_ROLE_KEY=$SupabaseServiceRoleKey
JOB_INPUT_ENCRYPTION_KEY=$jobEncryptionKey
BLOCKMESH_LOCAL_WORKER=0
WORKER_API_BASE=http://127.0.0.1:4567
WORKER_API_TOKEN=$workerToken
BOT_API_TOKEN=$botToken
BOT_FREE_MODE=true
PAYMENT_PROVIDER_MODE=placeholder
ALLOW_PLACEHOLDER_TOPUP=0
MAX_ACTIVE_JOBS_PER_USER=2
TRUEMONEY_WEBHOOK_SECRET=$webhookSecret
"@

$workerEnv = @"
PORT=4567
WORKER_API_TOKEN=$workerToken
WEB_CALLBACK_BASE=http://127.0.0.1:3000
BLOCKMESH_EXE=$nodeExe
BLOCKMESH_SCRIPT=$engineScript
WORKER_WORKSPACE=$workerWorkspace
WORKER_CONCURRENCY=1
WORKER_STATUS_INTERVAL_MS=10000
WORKER_KEEP_WORKSPACES=0
"@

$botEnv = @"
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DISCORD_PANEL_CHANNEL_ID=
DISCORD_ALLOWED_ROLE_IDS=
WEB_API_BASE=http://127.0.0.1:3000
BOT_API_TOKEN=$botToken
POLL_INTERVAL_MS=10000
COOKIE_URL_MAX_BYTES=2097152
COOKIE_DOWNLOAD_TIMEOUT_MS=15000
DISCORD_PANEL_IMAGE_URL=
DISCORD_REPORT_MAX_BYTES=7500000
"@

Write-Utf8NoBom (Join-Path $repoRoot "web\.env.local") $webEnv
Write-Utf8NoBom (Join-Path $repoRoot "worker\.env") $workerEnv
Write-Utf8NoBom (Join-Path $repoRoot "discord-bot\.env") $botEnv

Write-Host "Local environment files created."
Write-Host "Discord IDs/token remain blank in discord-bot\.env until the application is ready."
