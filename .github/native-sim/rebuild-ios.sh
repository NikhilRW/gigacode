#!/bin/bash
# native-sim-template-version: 1
set -euo pipefail

if [ -z "${NATIVE_SIM_DEV_CONFIG:-}" ] || [ ! -f "$NATIVE_SIM_DEV_CONFIG" ]; then
  echo "Run native-sim-rebuild inside a native-sim --framework native --ssh session." >&2
  exit 1
fi
# Generated privately by the workflow with shell-escaped values.
# shellcheck source=/dev/null
source "$NATIVE_SIM_DEV_CONFIG"
cd "${NATIVE_SIM_PROJECT_DIR:?Missing app directory}"
: "${NATIVE_SIM_UDID:?Missing simulator UDID}"
: "${NATIVE_SIM_CONFIGURATION:?Missing build configuration}"

CONTAINER=""
for NATIVE_DIR in ios .; do
  [ -d "$NATIVE_DIR" ] || continue
  CANDIDATES=()
  for WORKSPACE in "$NATIVE_DIR"/*.xcworkspace; do
    if [ -f "$WORKSPACE/contents.xcworkspacedata" ]; then
      CANDIDATES+=("$WORKSPACE")
    fi
  done
  if [ "${#CANDIDATES[@]}" -eq 0 ]; then
    for PROJECT in "$NATIVE_DIR"/*.xcodeproj; do
      if [ -f "$PROJECT/project.pbxproj" ]; then
        CANDIDATES+=("$PROJECT")
      fi
    done
  fi
  if [ "${#CANDIDATES[@]}" -gt 1 ]; then
    echo "Multiple Xcode projects or workspaces in $NATIVE_DIR; select one app directory." >&2
    exit 1
  fi
  if [ "${#CANDIDATES[@]}" -eq 1 ]; then
    CONTAINER="${CANDIDATES[0]}"
    break
  fi
done
[ -n "$CONTAINER" ] || { echo "No Xcode project or workspace found." >&2; exit 1; }

case "$CONTAINER" in
  *.xcworkspace) XCODE_ARGS=(-workspace "$CONTAINER"); DEFAULT_SCHEME=$(basename "$CONTAINER" .xcworkspace) ;;
  *.xcodeproj) XCODE_ARGS=(-project "$CONTAINER"); DEFAULT_SCHEME=$(basename "$CONTAINER" .xcodeproj) ;;
esac
SCHEME="${NATIVE_SIM_SCHEME:-$DEFAULT_SCHEME}"
echo "Rebuilding $SCHEME ($NATIVE_SIM_CONFIGURATION) for $NATIVE_SIM_UDID"
xcodebuild "${XCODE_ARGS[@]}" \
  -scheme "$SCHEME" \
  -configuration "$NATIVE_SIM_CONFIGURATION" \
  -sdk iphonesimulator \
  -destination "id=$NATIVE_SIM_UDID" \
  -derivedDataPath build/ios \
  CODE_SIGNING_ALLOWED=NO \
  build

APP=$(find "build/ios/Build/Products/$NATIVE_SIM_CONFIGURATION-iphonesimulator" -maxdepth 1 -name '*.app' | head -1)
[ -n "$APP" ] || { echo "No .app produced." >&2; exit 1; }
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")
xcrun simctl terminate "$NATIVE_SIM_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install "$NATIVE_SIM_UDID" "$APP"
xcrun simctl launch "$NATIVE_SIM_UDID" "$BUNDLE_ID"
echo "Relaunched $BUNDLE_ID. Your existing browser preview shows the rebuilt app."
