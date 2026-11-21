# Defensive QA + auth-gate checks for MCP / health (authorized local portal only).
# Exit 0 only when every check passes.
param(
    [string]$PortalUrl = ""
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
function Fail([string]$Name, [string]$Msg) { Write-Host "FAIL $Name - $Msg"; $script:failed++ }
function Ok([string]$Name) { Write-Host "OK   $Name" }

function Get-Http {
    param(
        [string]$Url,
        [string]$Method = "GET",
        [hashtable]$Headers = @{},
        [string]$Body
    )
    $params = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; TimeoutSec = 30 }
    if ($Headers.Count -gt 0) { $params.Headers = $Headers }
    # [string]$Body = $null becomes "" in PowerShell — only attach body when explicitly provided.
    if ($PSBoundParameters.ContainsKey("Body") -and -not [string]::IsNullOrEmpty($Body)) {
        $params.Body = $Body
        $params.ContentType = "application/json"
    }
    try {
        return Invoke-WebRequest @params
    } catch {
        $resp = $_.Exception.Response
        if ($resp -and $resp.StatusCode) {
            $code = [int]$resp.StatusCode
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $content = $reader.ReadToEnd()
            $reader.Close()
            return [PSCustomObject]@{ StatusCode = $code; Content = $content; Headers = $resp.Headers }
        }
        throw
    }
}

Write-Host "QA/security (defensive) against $PortalUrl"
Write-Host ""

# 1) Homepage layout signals
try {
    $landing = Get-Http "$PortalUrl/"
    if ($landing.StatusCode -ne 200) { Fail "Homepage" "HTTP $($landing.StatusCode)" }
    elseif ($landing.Content -notmatch "Gridwire") { Fail "Homepage" "missing Gridwire brand" }
    elseif ($landing.Content -notmatch "MCP") { Fail "Homepage" "missing MCP marketing" }
    elseif ($landing.Content -notmatch "2xl:px-16") { Fail "Homepage layout" "expected fluid shell padding 2xl:px-16" }
    elseif ($landing.Content -match "max-w-7xl") { Fail "Homepage layout" "hero shell still capped at max-w-7xl" }
    else { Ok "Homepage brand + MCP + fluid full-width layout" }
} catch { Fail "Homepage" $_.Exception.Message }

# 2) MCP zip download
try {
    $dl = Get-Http "$PortalUrl/api/public/mcp/download"
    if ($dl.StatusCode -ne 200) { Fail "MCP download" "HTTP $($dl.StatusCode) $($dl.Content)" }
    else {
        $bytes = if ($dl.RawContentStream) {
            $ms = New-Object System.IO.MemoryStream
            $dl.RawContentStream.CopyTo($ms)
            $ms.ToArray()
        } else {
            [System.Text.Encoding]::GetEncoding("iso-8859-1").GetBytes([string]$dl.Content)
        }
        # Prefer Content as byte array when available
        $tmp = Join-Path $env:TEMP "gridwire-mcp-qa.zip"
        Invoke-WebRequest -Uri "$PortalUrl/api/public/mcp/download" -OutFile $tmp -UseBasicParsing -TimeoutSec 30
        $hdr = [System.IO.File]::ReadAllBytes($tmp)[0..3]
        $isZip = ($hdr[0] -eq 0x50 -and $hdr[1] -eq 0x4B)
        $len = (Get-Item $tmp).Length
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        if (-not $isZip) { Fail "MCP download" "not a ZIP (missing PK header)" }
        elseif ($len -lt 1000) { Fail "MCP download" "zip too small ($len bytes)" }
        else { Ok "MCP download ZIP ($len bytes)" }
    }
} catch { Fail "MCP download" $_.Exception.Message }

# 3) Hosted MCP auth gates
try {
    $noKey = Get-Http "$PortalUrl/api/mcp" -Method "POST" -Body "{}"
    if ($noKey.StatusCode -ne 401) { Fail "MCP no-key" "expected 401 got $($noKey.StatusCode)" }
    elseif ($noKey.Content -match "at Object\.|stack|TypeError") { Fail "MCP no-key" "possible stack leak" }
    else { Ok "MCP POST without key → 401" }
} catch { Fail "MCP no-key" $_.Exception.Message }

try {
    $bad = Get-Http "$PortalUrl/api/mcp" -Method "POST" -Headers @{ Authorization = "Bearer gw_invalid_key_xxxxxxxxxxxx" } -Body "{}"
    if ($bad.StatusCode -ne 401) { Fail "MCP bad-key" "expected 401 got $($bad.StatusCode)" }
    elseif ($bad.Content -match "at Object\.|stack|TypeError") { Fail "MCP bad-key" "possible stack leak" }
    else { Ok "MCP POST invalid key → 401" }
} catch { Fail "MCP bad-key" $_.Exception.Message }

# 4) Discovery API gate
try {
    $ds = Get-Http "$PortalUrl/api/v1/datasets"
    if ($ds.StatusCode -ne 401) { Fail "datasets no-key" "expected 401 got $($ds.StatusCode)" }
    else { Ok "GET /api/v1/datasets without key → 401" }
} catch { Fail "datasets no-key" $_.Exception.Message }

try {
    $dsBad = Get-Http "$PortalUrl/api/v1/datasets" -Headers @{ Authorization = "Bearer gw_invalid_key_xxxxxxxxxxxx" }
    if ($dsBad.StatusCode -ne 401) { Fail "datasets bad-key" "expected 401 got $($dsBad.StatusCode)" }
    else { Ok "GET /api/v1/datasets invalid key → 401" }
} catch { Fail "datasets bad-key" $_.Exception.Message }

# 5) Health probes
try {
    $h = Get-Http "$PortalUrl/api/public/health"
    if ($h.StatusCode -ne 200 -or $h.Content -notmatch '"status":"ok"') { Fail "health" $h.Content }
    else { Ok "GET /api/public/health" }
} catch { Fail "health" $_.Exception.Message }

try {
    $r = Get-Http "$PortalUrl/api/public/ready"
    if ($r.StatusCode -ne 200 -or $r.Content -notmatch '"status":"ready"') { Fail "ready" $r.Content }
    else { Ok "GET /api/public/ready" }
} catch { Fail "ready" $_.Exception.Message }

# 6) Features page
try {
    $feat = Get-Http "$PortalUrl/features"
    if ($feat.StatusCode -ne 200) { Fail "features" "HTTP $($feat.StatusCode)" }
    elseif ($feat.Content -notmatch "MCP") { Fail "features" "missing MCP feature copy" }
    else { Ok "Features page includes MCP" }
} catch { Fail "features" $_.Exception.Message }

# 7) DB column (on-prem docker)
try {
    Push-Location $Root
    $col = docker compose -f docker-compose.onprem.yml exec -T -e "PGPASSWORD=$($env:POSTGRES_PASSWORD)" db `
        psql -U postgres -d postgres -t -A -c "SELECT data_type || '|' || column_default FROM information_schema.columns WHERE table_name='datasets' AND column_name='mcp_enabled';" 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "DB mcp_enabled" "$col" }
    elseif ("$col" -notmatch "boolean") { Fail "DB mcp_enabled" "unexpected: $col" }
    else { Ok "DB datasets.mcp_enabled present ($($col.ToString().Trim()))" }
} catch { Fail "DB mcp_enabled" $_.Exception.Message }
finally { Pop-Location }

Write-Host ""
if ($failed -gt 0) {
    Write-Host "QA/security FAILED ($failed failures)"
    exit 1
}
Write-Host "QA/security passed (100%)"
exit 0
