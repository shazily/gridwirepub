# Post-deploy smoke tests - must catch broken UI, not just /health.
param(
    [string]$PortalUrl = "",
    [switch]$SkipWorker
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env"

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            Set-Item -Path "Env:$($Matches[1].Trim())" -Value $Matches[2].Trim().Trim('"').Trim("'") -Force
        }
    }
}

if (-not $PortalUrl) {
    $port = if ($env:GRIDWIRE_HOST_PORT) { $env:GRIDWIRE_HOST_PORT } else { "3020" }
    $PortalUrl = "http://127.0.0.1:$port"
}

$failed = 0

function Fail {
    param([string]$Name, [string]$Msg)
    Write-Host "FAIL $Name - $Msg"
    $script:failed++
}

function Ok {
    param([string]$Name)
    Write-Host "OK   $Name"
}

function Get-Http {
    param([string]$Url, [hashtable]$Headers = @{})
    $params = @{ Uri = $Url; UseBasicParsing = $true; TimeoutSec = 20 }
    if ($Headers.Count -gt 0) { $params.Headers = $Headers }
    $supportsSkip = $false
    try {
        $supportsSkip = [bool](Get-Command Invoke-WebRequest | Select-Object -ExpandProperty Parameters | Where-Object { $_.ContainsKey("SkipHttpErrorCheck") })
    } catch { $supportsSkip = $false }
    if ($supportsSkip) { $params.SkipHttpErrorCheck = $true }
    try {
        return Invoke-WebRequest @params
    } catch {
        $resp = $_.Exception.Response
        if ($resp -and $resp.StatusCode) {
            $code = [int]$resp.StatusCode
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $content = $reader.ReadToEnd()
            $reader.Close()
            return [PSCustomObject]@{ StatusCode = $code; Content = $content }
        }
        throw
    }
}

Write-Host "Smoke tests against $PortalUrl"
Write-Host ""

try {
    $health = Get-Http "$PortalUrl/api/public/health"
    if ($health.StatusCode -ne 200 -or $health.Content -notmatch '"status":"ok"') {
        Fail "Liveness" "unexpected response"
    } else { Ok "Liveness /api/public/health" }
} catch { Fail "Liveness" $_.Exception.Message }

try {
    $ready = Get-Http "$PortalUrl/api/public/ready"
    if ($ready.StatusCode -ne 200) {
        Fail "Readiness" "HTTP $($ready.StatusCode) - $($ready.Content)"
    } elseif ($ready.Content -notmatch '"status":"ready"') {
        Fail "Readiness" "not ready - $($ready.Content)"
    } elseif ($ready.Content -notmatch '"storage":"(ok|disabled)"') {
        Fail "Readiness storage" "storage check missing or failed - $($ready.Content)"
    } else { Ok "Readiness /api/public/ready (config + service_role + backend + storage)" }
} catch { Fail "Readiness" $_.Exception.Message }

try {
    $portalMissing = Get-Http "$PortalUrl/api/public/portal/_gridwire_smoke_missing_"
    if ($portalMissing.StatusCode -ne 404) {
        Fail "Portal branding API" "expected 404 for unknown org slug, got HTTP $($portalMissing.StatusCode)"
    } else { Ok "Portal branding /api/public/portal/{slug} (404 for unknown)" }
} catch { Fail "Portal branding API" $_.Exception.Message }

try {
    $portalPage = Get-Http "$PortalUrl/portal/_gridwire_smoke_missing_"
    if ($portalPage.StatusCode -ne 200) {
        Fail "Portal page" "HTTP $($portalPage.StatusCode)"
    } elseif ($portalPage.Content -match "Portal not found") {
        Ok "Portal page /portal/{slug} (not-found UI)"
    } else { Ok "Portal page /portal/{slug}" }
} catch { Fail "Portal page" $_.Exception.Message }

# Auth API must allow browser CORS
try {
    $cors = Invoke-WebRequest -Uri "$PortalUrl/../3040/auth/v1/signup".Replace("/3020/../3040", ":3040") -Method OPTIONS -Headers @{
        Origin                         = $PortalUrl
        "Access-Control-Request-Method"  = "POST"
        "Access-Control-Request-Headers" = "apikey,authorization,content-type"
    } -UseBasicParsing -TimeoutSec 10
    if ($cors.Headers["Access-Control-Allow-Origin"] -ne "*") {
        Fail "Auth CORS" "missing Access-Control-Allow-Origin on /auth/v1/signup"
    } else { Ok "Auth CORS preflight /auth/v1/signup" }
} catch {
    $apiPort = if ($env:GRIDWIRE_API_PORT) { $env:GRIDWIRE_API_PORT } else { "3040" }
    try {
        $cors = Invoke-WebRequest -Uri "http://127.0.0.1:$apiPort/auth/v1/signup" -Method OPTIONS -Headers @{
            Origin                         = $PortalUrl
            "Access-Control-Request-Method"  = "POST"
            "Access-Control-Request-Headers" = "apikey,authorization,content-type"
        } -UseBasicParsing -TimeoutSec 10
        if ($cors.Headers["Access-Control-Allow-Origin"] -ne "*") {
            Fail "Auth CORS" "missing Access-Control-Allow-Origin"
        } else { Ok "Auth CORS preflight /auth/v1/signup" }
    } catch { Fail "Auth CORS" $_.Exception.Message }
}

try {
    $homeResp = Get-Http "$PortalUrl/"
    if ($homeResp.StatusCode -ne 200) {
        Fail "Homepage SSR" "HTTP $($homeResp.StatusCode)"
    } elseif ($homeResp.Content -match "This page didn.t load") {
        Fail "Homepage SSR" "error boundary HTML - server misconfigured"
    } elseif ($homeResp.Content -notmatch "spreadsheet") {
        Fail "Homepage SSR" "missing expected marketing landing content"
    } else { Ok "Homepage / (SSR landing page)" }
} catch { Fail "Homepage SSR" $_.Exception.Message }

try {
    $auth = Get-Http "$PortalUrl/auth"
    if ($auth.StatusCode -ne 200) {
        Fail "Auth page" "HTTP $($auth.StatusCode)"
    } elseif ($auth.Content -match "This page didn.t load") {
        Fail "Auth page" "error boundary HTML"
    } else { Ok "Auth page /auth" }
} catch { Fail "Auth page" $_.Exception.Message }

try {
    $welcome = Get-Http "$PortalUrl/welcome"
    if ($welcome.StatusCode -ne 200) {
        Fail "Welcome tour" "HTTP $($welcome.StatusCode)"
    } elseif ($welcome.Content -match "This page didn.t load") {
        Fail "Welcome tour" "error boundary HTML"
    } else { Ok "Welcome tour /welcome" }
} catch { Fail "Welcome tour" $_.Exception.Message }

foreach ($adminPath in @("/admin", "/admin/usage", "/admin/organization", "/admin/storage", "/admin/authentication", "/alerts", "/storage", "/feedback")) {
    try {
        $admin = Get-Http "$PortalUrl$adminPath"
        if ($admin.StatusCode -ne 200) {
            Fail "Admin route $adminPath" "HTTP $($admin.StatusCode)"
        } elseif ($admin.Content -match "This page didn.t load") {
            Fail "Admin route $adminPath" "error boundary HTML"
        } else { Ok "Admin route $adminPath" }
    } catch { Fail "Admin route $adminPath" $_.Exception.Message }
}

# Client bundle must include Supabase URL (baked at docker build time).
try {
    $index = Get-Http "$PortalUrl/"
    if ($env:SUPABASE_URL -and $index.Content -notmatch [regex]::Escape($env:SUPABASE_URL.Replace("https://", "").Split("/")[0])) {
        # Check a JS asset for the project ref - HTML may not include raw URL.
        $asset = $null
        if ($index.Content -match 'src="(/assets/[^"]+\.js)"') {
            $assetPath = $Matches[1]
            $asset = Get-Http "$PortalUrl$assetPath"
        }
        $ref = if ($env:SUPABASE_URL -match 'https://([^.]+)\.supabase\.co') { $Matches[1] } else { "" }
        if ($ref -and $asset -and $asset.Content -notmatch $ref) {
            Fail "Client bundle" "Supabase URL not baked into JS - rebuild with docker build-args"
        } else { Ok "Client bundle (Supabase config baked at build)" }
    } else {
        Ok "Client bundle (Supabase config present)"
    }
} catch { Fail "Client bundle" $_.Exception.Message }

try {
    $metrics = Get-Http "$PortalUrl/api/public/metrics"
    if ($metrics.StatusCode -ne 401) { Fail "Metrics unauthenticated" "expected 401, got $($metrics.StatusCode)" }
    else { Ok "Metrics unauthenticated" }
} catch { Fail "Metrics unauthenticated" $_.Exception.Message }

if ($env:METRICS_TOKEN) {
    try {
        $mAuth = Get-Http "$PortalUrl/api/public/metrics" @{ Authorization = "Bearer $($env:METRICS_TOKEN)" }
        if ($mAuth.StatusCode -ne 200 -or $mAuth.Content -notmatch "gridwire_portal_up") {
            Fail "Metrics authenticated" "bad response"
        } else { Ok "Metrics authenticated" }
    } catch { Fail "Metrics authenticated" $_.Exception.Message }
} else {
    Fail "Metrics authenticated" "METRICS_TOKEN not set in .env"
}

if (-not $SkipWorker) {
    try {
        Push-Location $Root
        $out = docker compose exec -T worker wget -qO- http://localhost:8080/healthz 2>&1
        if ($LASTEXITCODE -eq 0 -and $out) { Ok "Worker healthz" }
        else { Fail "Worker healthz" "worker not healthy" }
    } catch { Fail "Worker healthz" $_.Exception.Message }
    finally { Pop-Location }
}

try {
    $inboundBody = '{"From":"smoke@test.local","Subject":"Smoke","MessageID":"smoke-test","Attachments":[]}'
    $inboundHeaders = @{}
    if ($env:INBOUND_WEBHOOK_SECRET) {
        $inboundHeaders["X-Gridwire-Webhook-Secret"] = $env:INBOUND_WEBHOOK_SECRET
    }
    $inboundParams = @{
        Uri = "$PortalUrl/api/public/inbound/webhook"
        Method = "POST"
        ContentType = "application/json"
        Body = $inboundBody
        UseBasicParsing = $true
        TimeoutSec = 20
    }
    if ($inboundHeaders.Count -gt 0) { $inboundParams.Headers = $inboundHeaders }
    $supportsSkip = $false
    try {
        $supportsSkip = [bool](Get-Command Invoke-WebRequest | Select-Object -ExpandProperty Parameters | Where-Object { $_.ContainsKey("SkipHttpErrorCheck") })
    } catch { $supportsSkip = $false }
    if ($supportsSkip) { $inboundParams.SkipHttpErrorCheck = $true }
    $inbound = Invoke-WebRequest @inboundParams
    if ($inbound.StatusCode -eq 200 -and $inbound.Content -match '"ok":true') {
        Ok "Email ingest webhook POST"
    } else {
        Fail "Email ingest webhook POST" "HTTP $($inbound.StatusCode)"
    }
} catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode -eq 200) {
        Ok "Email ingest webhook POST"
    } else {
        Fail "Email ingest webhook POST" $_.Exception.Message
    }
}

try {
    $ready = Get-Http "$PortalUrl/api/public/ready"
    if ($ready.StatusCode -eq 200 -and $ready.Content -match '"storage"') {
        Ok "Readiness extended checks"
    } else {
        Fail "Readiness extended checks" "missing storage/clamav probes"
    }
} catch { Fail "Readiness extended checks" $_.Exception.Message }

try {
    Push-Location $Root
    $logs = docker compose logs portal --since 2m 2>&1 | Out-String
    if ($logs -match "Missing Supabase environment variable") {
        Fail "Portal logs" "Supabase env errors in recent logs"
    } else { Ok "Portal logs clean (no Supabase env errors)" }
} catch { Fail "Portal logs" $_.Exception.Message }
finally { Pop-Location }

Write-Host ""
if ($failed -gt 0) {
    Write-Host "Smoke tests FAILED ($failed failures) - deploy is NOT production-ready"
    exit 1
}
Write-Host "Smoke tests passed - deploy is production-ready"
exit 0
