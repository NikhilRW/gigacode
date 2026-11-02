# Dispatch the generated native-sim workflow's Expo IPA export path.
# native-sim 0.2.2's `up --export-ipa` CLI guard still permits only native Xcode apps.
[CmdletBinding()]
param(
    [string]$Branch = '',
    [ValidateRange(1, 350)][int]$Minutes = 1
)

$ErrorActionPreference = 'Stop'
foreach ($command in @('git', 'gh')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Install $command before dispatching native-sim." }
}
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
Push-Location -LiteralPath $repoRoot
try {
    if (-not $Branch) {
        $Branch = (& git branch --show-current).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $Branch) { throw 'Select a Git branch or pass -Branch explicitly.' }
    }
    $session = 'gigacode-' + (Get-Date -Format 'yyyyMMddHHmmss') + '-' + [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(4)).ToLowerInvariant()
    $gate = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
    # This builds the remote branch. It deliberately does not commit or push local files.
    & gh workflow run native-sim.yml --ref $Branch `
        -f "session=$session" -f "gate_token=$gate" -f "minutes=$Minutes" `
        -f 'framework=expo' -f 'project_dir=apps/expo' -f 'mode=build' `
        -f 'dev=false' -f 'export_app=true' -f 'export_ipa=true' -f 'cache=false' -f 'runner=macos-26'
    if ($LASTEXITCODE -ne 0) { throw 'Dispatch failed. Check gh auth status and push the generated workflow to the default branch first.' }
    Write-Output "native-sim dispatched for remote branch '$Branch'. Session: $session"
    Write-Output 'Open GitHub Actions > native-sim; download the following artifact after its upload step:'
    Write-Output "native-sim-ipa-$session (contains unsigned.ipa)"
    Write-Output 'The simulator stream closes after the requested hold period; the IPA artifact remains for seven days.'
} finally {
    Pop-Location
}
