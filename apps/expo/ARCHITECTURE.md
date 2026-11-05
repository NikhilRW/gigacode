# Universal client architecture

## Design

`apps/web/src/index.css` is the visual source of truth. `src/lib/palette.ts` maps its warm neutral
light/dark, semantic and sidebar tokens to native colors; `src/theme.ts` shares Inter faces,
JetBrains Mono and 10 px radii. `src/state/ThemeProvider.tsx` retains persisted mode selection.
Static TTFs from the SIL-OFL-licensed Expo Google Fonts packages are loaded with `expo-font`.
The DOM editor resolves its own bundled JetBrains Mono regular/italic with the web `expo-asset`
pipeline and injects `@font-face` rules, with no
native font module imported across the DOM boundary. Auth uses a restrained form and a neutral
informational split on wide displays, without decorative artwork. Web and Android/iOS editors use
`plainEditorPalettes` for matching warm neutral light/dark surfaces
and completion menus, retain readable light/dark syntax colors without active-line decoration,
and keep the line-number gutter close to the code. The workspace clips its editor and output surfaces
inside a subtle rounded frame with matching neutral backgrounds and no glow.

## Native/browser boundary

Expo Router routes in `src/app/` use React Native views, safe areas, keyboard avoidance, forms,
navigation and themed reusable components. They adapt from phones to tablets/desktop and landscape.
`AppShell` provides a fixed safe-area-aware header and a dismissible navigation modal below 900 px,
or a persistent neutral sidebar above it. Links remain typed Expo Router routes and retain guest,
session and administrator visibility. The shell does not own a content ScrollView: workspace and
account screens each provide one main page scroll, avoiding a second scroll around the DOM editor.

**Only `src/components/CodeEditor.tsx` has `'use dom'`.** CodeMirror and its language/view packages
need a browser; they are not imported by the native screens as native UI. Expo replaces the DOM
component with a native wrapper and bundles its browser code separately. SDK 57 uses
`@expo/dom-webview` by default. On web the same editor renders directly into the page.

Editor props are JSON-serializable. Top-level callbacks are asynchronous native actions. File IDs
travel with changes so delayed events cannot edit a different selected file. The editor owns its live
document rather than echoing asynchronous native text updates back over new keystrokes. Native Run/Save
uses `useDOMImperativeHandle` to request the current document and waits for a native-action reply
before taking a draft snapshot. Native imperative calls are one-way, so `useEditorBridge` correlates
replies by request ID, times out missing replies and cancels pending requests on editor replacement. Theme and
font updates reconfigure the existing editor without losing its document. File selection remounts it.

The editor has natural content height, line wrapping and no internal scroll or bottom toolbar. Native
`matchContents` measures the DOM body and grows the WebView. `nestedScrollEnabled=false` stops Expo's
Android DOM WebView from requesting exclusive touch interception, allowing the outer page ScrollView
to handle swipes over code. Output also grows without a nested ScrollView or maximum-height clipping.
Focus mode hides the introduction while retaining the same page-scroll layout and editor instance.
Completion is a curated set of snippets/builtins plus identifiers from the document; there is no
language-server connection, remote package installation, or AI completion claim.

## State and network

- **DraftProvider:** versioned local files, per-language entry points, stdin and run/editor settings.
  CPU quota, process limit, Internet mode and usage/advanced-panel preferences default safely for old drafts.
  It reads old Python drafts with defaults, preserves other languages when switching, and serializes
  autosave/manual writes. Failed hydration does not overwrite stored work.
- **AuthProvider:** restores the API origin and a matching session, verifies `/v1/me`, manages expiry,
  and prevents old-session responses from overwriting a changed connection. Credential writes are
  serialized. Logout/server changes clear account state without deleting drafts.
- **Credential storage:** iOS uses basic unencrypted AsyncStorage; web uses sessionStorage. Metro selects
  `credentialStore.android.ts` on Android to retain SecureStore there. Apple autolinking explicitly
  excludes `expo-secure-store`, and the shared plugin disables the unused iOS Face ID permission.
  Existing iOS users sign in again rather than migrating Keychain credentials. Server/API-key secrets
  are not embedded in the app or passed into the DOM editor.
- **ApiClient:** normalizes origins, attaches a user Bearer token only to its matching origin,
  omits cookies, aborts timed-out requests, and surfaces structured errors. Public authentication
  requests do not attach a stale credential. Codespaces proxy HTML is not accepted as a session.
- **useResource/useLiveRun:** focus/foreground-only, single-flight polling with cancellation and stale
  response guards. Terminal execution polling stops. Logs are inline API responses; S3 does not need
  public forwarding. There is no simulated execution or offline account-data cache.

## Backend addition

Native login and registration share account validation/password handling with browser login. Native
session JWTs have a distinct prefix, audience and type, are HS256-verified and schema-validated, and
cannot be interchanged with cookie tokens. Native real-user sessions can manage profiles/passwords
and create API keys; API-key callers still cannot perform user-session-only actions. Browser cookie
mutations retain CSRF protection. Token lifetime is seven days, with local sign-out and no new
server-side revocation system.

## Deployment

Per-execution `network` is validated by the API and stored in the source manifest (absent on old runs
means false). The worker uses it only for program execution; compilation stays offline. Online nsjail
runs retain user/mount/PID/cgroup isolation but share the worker's network namespace after installing
per-UID IPv4/IPv6 egress rules. DNS to configured resolvers and public TCP/UDP destinations are allowed;
private/local ranges are rejected. Missing firewall support fails setup before code starts. Source and
result endpoints expose the submitted mode, and both clients retain it for reruns. No database migration
is needed because the immutable source manifest stores the execution policy.

The Expo app has its own `bun.lock` and is installed from `apps/expo`. Backend packages retain their
pnpm workspace. `app.json` enables tablets, landscape and Android keyboard resize;
`eas.json` defines device development/preview and production profiles. EAS ownership and signing remain
configured through the user's account.

`.devcontainer/` and `infra/docker-compose.codespaces.yml` prepare the development backend and forwarded
API origin. The nsjail worker still requires cgroup v2 delegation and Linux namespaces. Codespaces
capabilities must be established by the existing worker startup self-test and a real completed run;
API readiness by itself does not establish execution capability. See `docs/CODESPACES.md`.

## Research and verification boundary

Official references consulted on 2026-11-02:

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) — SDK/React Native/Node requirements.
- [Expo DOM components](https://docs.expo.dev/guides/dom-components/) — SDK 56+ built-in WebView,
  separate JS engines, async native actions, imperative handles and native exports.
- [CodeMirror system guide](https://codemirror.net/docs/guide/) — DOM-dependent view and state model.
- [Keyboard handling](https://docs.expo.dev/guides/keyboard-handling/) — native keyboard avoidance.
- [SecureStore SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/) — native credential storage.
- [EAS configuration](https://docs.expo.dev/build/eas-json/) — device build profiles.

Lint, TypeScript and platform exports can establish source/bundling compatibility. They cannot prove
physical-device IME/selection/keyboard behavior, signed EAS builds, tunnel reachability, or a live
Codespaces sandbox. Those need the user's device/account/runtime environment.
