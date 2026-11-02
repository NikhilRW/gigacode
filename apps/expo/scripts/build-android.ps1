# Windows local ARM64 Release APK. Generated android/ stays managed by Expo Prebuild.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $appRoot 'android'

if (-not (Get-Command java -ErrorAction SilentlyContinue)) { throw 'Install a JDK and configure JAVA_HOME/PATH first.' }
if (-not (Get-Command bunx -ErrorAction SilentlyContinue)) { throw 'Install Bun 1.3.13 first.' }
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules/expo'))) { throw 'Run bun install --frozen-lockfile in apps/expo first.' }

Push-Location -LiteralPath $appRoot
try {
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
