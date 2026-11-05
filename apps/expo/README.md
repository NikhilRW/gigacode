# GigaCode · Android, iOS, and web

The universal client matches `apps/web` with warm neutral light/dark surfaces, Inter UI text and
JetBrains Mono code. It
connects to the API and execution worker in this repository; code executes on the server, not the phone.

## Start here

Use **Node 22.13+** and **Bun 1.3.13**. Open a terminal in **`apps/expo`**, not the repository root:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
```

Set `EXPO_PUBLIC_API_URL` to your reachable API origin, or enter it in the app's **Connection** screen.
It must be an origin without `/v1` or a trailing path, for example:

```sh
# Bash / Codespaces
export EXPO_PUBLIC_API_URL="https://your-codespace-3000.app.github.dev"
bunx expo start --dev-client --tunnel
```

```powershell
# PowerShell, with an installed development build
$env:EXPO_PUBLIC_API_URL = "https://your-codespace-3000.app.github.dev"
bunx expo start --dev-client --tunnel
```

This URL is public configuration, not a secret. Never put API keys or server JWT secrets in
`EXPO_PUBLIC_*`. Changing the server in Connection signs you out and preserves local drafts. A phone's
`localhost` means the phone. Prefer the Codespaces HTTPS URL; local HTTP also needs compatible platform
transport settings and a reachable LAN address.

**Full backend, Codespaces, Android APK and iPhone setup:** [docs/CODESPACES.md](../../docs/CODESPACES.md).
`expo-dev-client` and development/preview/production EAS profiles are included. Run `bunx eas-cli login`
and `bunx eas-cli init` to link your own Expo project before building. Adjust the application identifiers
in `app.json` to your ownership before distributing. No EAS project ID or signing credential is embedded.

## Included screens

- **Workspace:** Python, JavaScript/Node, C and C++; per-language files and entry point; standard input,
  timeout/memory settings, advanced CPU/process limits, an Internet toggle; authenticated run, progress,
  cancellation, output and toggleable resource measurements.
- **Dashboard:** usage, workspace limits, hourly activity, onboarding and recent executions.
- **History:** language/status/ID-prefix and date-range filters, cursor pagination and refresh.
- **Execution:** source/input, output, compiler information, attempts/timeline, cancel and rerun.
- **Account:** real registration/login, profile name, password change and device sign-out.
- **API keys:** create, list and revoke. The raw created key is displayed once and not saved by the app.
- **Admin:** role-gated worker health, queue, dead letters/requeue, and tenant limits.
- **Connection:** persisted API origin, with sign-out when changing servers.

Guests can edit/save device drafts without an account. Drafts and editor preferences live in AsyncStorage;
they are not automatically cloud-synced. Submitted source and results are available through server history.

## Editor and native compatibility

On web and Android/iOS the editor uses neutral light/dark surfaces with readable syntax colors, no
active-line decoration, and compact line-number spacing. The workspace has subtle rounded, clipped
corners and matching editor/output backgrounds, without glow. Native file actions remain available
without a language badge. Shared controls use subtle borders, 10 px radii and 44–48 px touch targets.
Phones have a fixed safe-area header and navigation drawer; tablets/desktop use a persistent sidebar
from 900 px. Workspace content retains its own single page scroll, separate from navigation.

Fonts are bundled static TTFs from `@expo-google-fonts/inter` (400/500/600/700) and
`@expo-google-fonts/jetbrains-mono` (400). Both font families use the SIL Open Font License 1.1;
the packages include `LICENSE_FONT` and upstream attribution. `expo-font` loads native/UI faces before
rendering. The DOM editor independently bundles regular and italic JetBrains Mono through CSS
`@font-face`, so offline WebViews do not depend on native font registration or a Google Fonts request.

CodeMirror is **browser-only**. `src/components/CodeEditor.tsx` is explicitly an Expo **`'use dom'` component**:

- **Web:** CodeMirror runs in the page's browser DOM.
- **Android/iOS:** Expo bundles the editor into an embedded WebView. SDK 57 uses its bundled
  `@expo/dom-webview` by default. CodeMirror does not run in the native Hermes view renderer.
- All other screens use React Native components. Only serializable editor props and asynchronous native
  actions cross the WebView boundary. The editor has no access to session tokens or API clients.
- The editor owns live text locally, avoiding stale native prop echoes. Native Run/Save requests the
  latest document through a one-way imperative call and waits for a native-action reply before
  submitting/saving. It does not rely on an unsupported return value from a native DOM ref.

Code defaults to **17 px**, with a saved font-size range of **8–26 px**. The editor grows with its content,
wraps long lines and has no inner scrolling or bottom toolbar. The output below also expands fully;
one page scroll handles the whole workspace, including swipes that start over the editor. Focus editor
hides the introduction without creating a separate scroll area. Landscape and tablets are supported.
Phones use a Files sheet; wider displays can show the file sidebar.

Suggestions combine language-specific snippets/builtins with words in the current file. This is local
completion, not AI or a full language server. Suggestions open while typing and can be selected by touch.
Keyboard shortcuts: Ctrl/Cmd+Enter runs, Ctrl/Cmd+S saves, Ctrl+Space suggests, Tab indents. Suggestions
work without a backend connection. The Suggest/Indent/Outdent/Next field toolbar has been removed.

## Run controls

Below the editor, **Run settings** provides time/memory presets and steppers, an **Advanced run settings**
switch for CPU allowance/process limits, **Show resource usage**, and **Program internet access**.
Preferences are saved with device drafts. CPU allowance is a quota relative to one core; usage cards
show completed execution measurements, not live host/phone CPU. Internet traffic bytes are not measured.

Internet is off by default. On enables outbound public TCP/UDP and DNS for the next submitted run;
private/local destinations are filtered by the worker. It does not change an already-running job or
the app's own API connection. Source history and reruns preserve it. The backend API and nsjail worker
must both be rebuilt for this feature; the worker image now includes iptables. The development Docker
driver supports offline execution only. A firewall setup failure fails the run and appears in stderr.

## Authentication

The app uses `/v1/auth/native/register` and `/v1/auth/native/login`, then sends the returned user session
as `Authorization: Bearer ce_session_...`. **iOS uses basic AsyncStorage (unencrypted)** and excludes
SecureStore from Apple autolinking; no Keychain API is used by the iOS client. Android keeps SecureStore
through its platform-specific credential module. Expo web uses the current tab's sessionStorage.
After switching an existing iOS installation from SecureStore, sign in again; the app does not access
the previous Keychain entry to migrate it. Browser-cookie login in the original dashboard remains available separately.
Sessions expire after seven days; a protected 401 clears the app's session. Sign-out removes the local
credential; it does not revoke all server JWT copies. Passwords are never persisted by the client.

Execution status polling runs while the route is focused and the app is foregrounded. It stops after a
terminal outcome and resumes on refresh/focus. Output is fetched inline through the authenticated API,
so the phone does not need access to MinIO or an internal S3 URL.

## Build commands

For downloadable GitHub Actions IPAs and a local POCO X4 ARM64 APK, see
**[Native build instructions](../../docs/NATIVE_BUILDS.md)**. The generated native-sim workflow provides
a live simulator, simulator `.app` export and unsigned device IPA. Signed distribution uses the EAS profile.

```sh
bun run web             # Browser development
bun run build           # Static browser export to dist/
bun run build:native    # Android/iOS JS + DOM exports to .expo/export-native/
bun run apk:arm64       # Windows/PowerShell 7: local ARM64 Release APK (Android SDK/JDK required)
bun run ios:ipa         # Windows/PowerShell 7 + gh: dispatch native-sim Expo IPA export on GitHub
bunx eas-cli build --platform android --profile development
bunx eas-cli build --platform ios --profile development
```

Platform exports validate bundling; they do not compile an APK/IPA or prove keyboard behavior on hardware.
EAS builds need your Expo account and, for physical iPhone internal distribution, Apple provisioning.
Native-module/config changes require a new development build. A matching SDK 57 Expo Go can also run
DOM components, but check runtime compatibility rather than assuming any installed Expo Go matches.

See [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries and official research references.
