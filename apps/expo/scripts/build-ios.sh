#!/usr/bin/env bash
# Run on a Mac after Expo Prebuild and pod install. No generated native files are edited.
set -euo pipefail

[[ "$(uname -s)" == Darwin ]] || { echo 'An iOS native build requires macOS/Xcode.' >&2; exit 1; }
target="${1:-unsigned-ipa}"
case "$target" in unsigned-ipa|simulator) ;; *) echo 'Usage: build-ios.sh unsigned-ipa|simulator' >&2; exit 1 ;; esac

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="$app_root/build/ios-export"
mkdir -p "$output/artifacts"

workspaces=()
for workspace in "$app_root"/ios/*.xcworkspace; do
  [[ -f "$workspace/contents.xcworkspacedata" ]] && workspaces+=("$workspace")
done
[[ ${#workspaces[@]} -eq 1 ]] || { echo 'Expected one workspace. Run Expo Prebuild and pod install first.' >&2; exit 1; }
workspace="${workspaces[0]}"
scheme="${IOS_SCHEME:-$(basename "$workspace" .xcworkspace)}"

if [[ "$target" == unsigned-ipa ]]; then
  sdk=iphoneos
  destination='generic/platform=iOS'
  supported_platform=iPhoneOS
else
  sdk=iphonesimulator
  destination='generic/platform=iOS Simulator'
  supported_platform=iPhoneSimulator
fi

echo "Building $scheme / Release / $sdk..."
# Release invokes Expo's generated bundle phase, including the editor's DOM bundle.
# A device build is deliberately separate from the simulator's products.
xcodebuild -workspace "$workspace" -scheme "$scheme" \
  -configuration Release -sdk "$sdk" -destination "$destination" \
  -derivedDataPath "$output/$target" \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
  build 2>&1 | tee "$output/xcodebuild.log"

apps=()
for bundle in "$output/$target/Build/Products/Release-$sdk"/*.app; do
  [[ -d "$bundle" ]] && apps+=("$bundle")
done
[[ ${#apps[@]} -eq 1 ]] || { echo 'Expected exactly one built .app.' >&2; exit 1; }
app="${apps[0]}"
platform=$(/usr/libexec/PlistBuddy -c 'Print CFBundleSupportedPlatforms:0' "$app/Info.plist")
[[ "$platform" == "$supported_platform" ]] || { echo "Wrong platform: $platform; expected $supported_platform." >&2; exit 1; }
executable=$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$app/Info.plist")
lipo -verify_arch arm64 "$app/$executable"
[[ -f "$app/main.jsbundle" ]] || { echo 'The Release app is missing its embedded JavaScript bundle.' >&2; exit 1; }

if [[ "$target" == unsigned-ipa ]]; then
  staging="$(mktemp -d "$output/ipa.XXXXXX")"
  trap 'rm -rf "$staging"' EXIT
  mkdir "$staging/Payload"
  ditto "$app" "$staging/Payload/$(basename "$app")"
  rm -rf "$staging/Payload/$(basename "$app")/_CodeSignature"
  rm -f "$staging/Payload/$(basename "$app")/embedded.mobileprovision"
  artifact="$output/artifacts/GigaCode-unsigned.ipa"
  ditto -c -k --keepParent "$staging/Payload" "$staging/GigaCode-unsigned.ipa"
  mv -f "$staging/GigaCode-unsigned.ipa" "$artifact"
  echo 'Device IPA packaged. Apple signing is still required before installation.'
else
  artifact="$output/artifacts/GigaCode-simulator.app.tar.gz"
  # Tar preserves executable permissions that a raw .app artifact ZIP can lose.
  tar -C "$(dirname "$app")" -czf "$artifact" "$(basename "$app")"
fi

echo "Artifact: $artifact"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf 'artifact_path=%s\n' "$artifact" >> "$GITHUB_OUTPUT"; fi
