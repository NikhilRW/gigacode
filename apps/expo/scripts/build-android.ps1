# Windows local ARM64 Release APK. Generated android/ stays managed by Expo Prebuild.
[CmdletBinding()]
param(
    [switch]$ResetNativeCache
)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $appRoot 'android'

if (-not (Get-Command java -ErrorAction SilentlyContinue)) { throw 'Install a JDK and configure JAVA_HOME/PATH first.' }
if (-not (Get-Command bunx -ErrorAction SilentlyContinue)) { throw 'Install Bun 1.3.13 first.' }
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules/expo'))) { throw 'Run bun install --frozen-lockfile in apps/expo first.' }

# Native compilation can write gigabytes of C++ objects. Report exhausted volumes
# before Gradle starts rather than burying the real cause in unrelated failures.
$projectDrive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($appRoot))
if ($projectDrive.AvailableFreeSpace -lt 1GB) {
    $freeMiB = [Math]::Round($projectDrive.AvailableFreeSpace / 1MB)
    throw "Only $freeMiB MiB is free on $($projectDrive.Name). Free several GB or use a short checkout on a larger drive before building the APK."
}

Push-Location -LiteralPath $appRoot
try {
    # React Native's autolinking cache hashes package/lockfiles, not the absolute
    # checkout path. A copied android/build can therefore keep pointing at F:
    # even when the source and dependencies now live on D:.
    $autolinking = Join-Path $androidRoot 'build/generated/autolinking/autolinking.json'
    $movedCheckout = $false
    if (Test-Path -LiteralPath $autolinking) {
        try {
            $cachedRoot = (Get-Content -LiteralPath $autolinking -Raw | ConvertFrom-Json).root
            if ($cachedRoot) {
                $movedCheckout = -not [string]::Equals(
                    [System.IO.Path]::GetFullPath($cachedRoot).TrimEnd('\', '/'),
                    [System.IO.Path]::GetFullPath($appRoot).TrimEnd('\', '/'),
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            }
        } catch {
            # An unreadable/incomplete generated JSON should be regenerated too.
            $movedCheckout = $true
        }
    }
    if ($ResetNativeCache -or $movedCheckout) {
        Write-Output 'Regenerating relocated/stale Android autolinking and native build caches.'
        $existingWrapper = Join-Path $androidRoot 'gradlew.bat'
        if (Test-Path -LiteralPath $existingWrapper) {
            & $existingWrapper -p $androidRoot --stop
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop Gradle before removing generated build caches.' }
        }
        $cachePaths = @(
            (Join-Path $androidRoot 'build'),
            (Join-Path $androidRoot '.cxx'),
            (Join-Path $androidRoot '.gradle'),
            (Join-Path $androidRoot 'app/build'),
            (Join-Path $androidRoot 'app/.cxx')
        )
        $modulesRoot = Join-Path $appRoot 'node_modules'
        $packages = foreach ($directory in Get-ChildItem -LiteralPath $modulesRoot -Directory) {
            if ($directory.Name.StartsWith('@')) {
                Get-ChildItem -LiteralPath $directory.FullName -Directory
            } elseif (-not $directory.Name.StartsWith('.')) {
                $directory
            }
        }
        foreach ($package in $packages) {
            $cachePaths += Join-Path $package.FullName 'android/.cxx'
            $cachePaths += Join-Path $package.FullName 'android/build'
        }
        # Only known generated outputs are removed. Native sources/configuration,
        # signing keys, .env files, dependencies and global Gradle caches stay.
        foreach ($cache in $cachePaths) {
            if (Test-Path -LiteralPath $cache) { Remove-Item -LiteralPath $cache -Recurse -Force }
        }
    }

    & bunx expo prebuild --platform android --no-install --no-clean --skip-dependency-update react,react-native
    if ($LASTEXITCODE -ne 0) { throw "Expo Prebuild failed (exit $LASTEXITCODE)." }

    $gradlew = Join-Path $androidRoot 'gradlew.bat'
    if (-not (Test-Path -LiteralPath $gradlew)) { throw 'Prebuild did not generate android/gradlew.bat.' }
    & $gradlew -p $androidRoot ':app:assembleRelease' '-PreactNativeArchitectures=arm64-v8a' '--console=plain'
    if ($LASTEXITCODE -ne 0) { throw "Gradle failed (exit $LASTEXITCODE)." }

    $apk = Join-Path $androidRoot 'app/build/outputs/apk/release/app-release.apk'
    if (-not (Test-Path -LiteralPath $apk)) { throw "No APK found at $apk. Check the Gradle output for a custom artifact name." }
    Write-Output "ARM64 Release APK: $apk"
    Write-Output 'Install on a connected POCO X4: adb install -r "<APK path above>"'
    Write-Output 'This uses the generated template signing configuration; it is a local sideload build, not a Play Store release.'
} finally {
    Pop-Location
}
