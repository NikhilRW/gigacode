# UI architecture & research

## Design

GigaCode uses ink-navy surfaces, electric azure actions, icy cyan highlights and restrained glows in dark mode; light mode uses an ice-blue canvas, white chrome, navy text and darker blue actions. Shared semantic palettes live in `src/lib/palette.ts`, including syntax colors. `ThemeProvider` hydrates the persisted preference before showing route content, defaults to dark, survives navigation, and applies page background/color-scheme without reading browser globals during SSR. CodeMirror receives the mode as a serializable prop and reconfigures theme/highlight extensions live rather than remounting or inverting the editor.

Space Grotesk typography, rounded layered editor chrome and a static refractive blue lens keep the workspace cinematic without obstructing the code. Mobile web replaces the Files sidebar with a modal sheet and stacks editor/output; authentication becomes a single keyboard-aware column. All lens artwork is static and hidden from accessibility tools. The universal architecture remains intact; this iteration deliberately focuses on browser design and verification, not native builds.

## Boundaries and packages

- **Expo Router / React Native:** native navigation, safe areas, keyboard avoidance, forms, buttons, file library, and output. No web-only shell or parallel mobile UI.
- **`@uiw/react-codemirror` + `@codemirror/lang-python`:** mature editor behavior, parser-backed highlighting, indentation, built-in globals (including `print`), local variables, and snippets. `python()` registers both local and global completion sources; there is deliberately no hand-maintained completion dictionary. The button uses CodeMirror's `startCompletion` for touch access. Cmd/Ctrl shortcuts use CodeMirror keymaps.
- **Expo DOM component:** only `PythonEditor.tsx` begins with `'use dom'`. Web renders it directly; iOS/Android embed its bundle. SDK 57 uses the built-in `@expo/dom-webview`, so no additional native WebView dependency is needed. Explicit parent height and `dom.style.flex` size it on native. Props are serializable; function props are top-level async actions. File IDs accompany editor changes to protect against a delayed bridge event editing the newly selected file. CodeMirror mounts after hydration.
- **AsyncStorage:** working guest persistence without inventing an auth backend. A versioned Zod schema validates restored data; invalid data is not overwritten. The root provider survives route changes. Debounced autosave plus explicit Save share an ordered write queue to prevent stale writes. Save feedback is only shown after the storage promise resolves. Storage errors keep the in-memory edits and offer retry. If opening storage fails, editing is locked to avoid replacing existing data.
- **React Hook Form / Zod / resolvers:** cross-platform controlled inputs and shared validation. Sign-up password requirements are not imposed on sign-in. Credentials are never sent, logged, or persisted. The async service guard always rejects clearly; no fake session is produced.
- **Expo LinearGradient / vector icons / bundled Google font:** lightweight native-compatible visual primitives; no runtime font CDN or animation loop.

## Honest offline behavior

There is no Python interpreter, execution API, token store, or simulated network latency in this UI. Run creates a timestamped local explanation, not a Python result. There is no Stop button because there is no running request. Cloud Save is represented by the signed-out cloud-files panel and sign-in navigation, not a pretend save. Guest saves are explicitly device-local. The screen continues to offer guest editing while account services are absent.

## Future Python boundary (proposal, not an implemented API)

Keep backend implementation separate from the DOM editor. Choose the actual auth/session and execution sandbox design before wiring these client interactions:

| Proposed endpoint | Purpose / response |
| --- | --- |
| `POST /auth/signup` | Validated account creation; verification status, no assumed session |
| `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` | Real session lifecycle; secure platform-appropriate session handling |
| `GET /files`, `POST /files`, `PATCH /files/:id` | Authenticated, user-scoped cloud Python files; stable ID, filename, code, revision, timestamps |
| `POST /executions` | Submit code to a separately sandboxed Python worker; execution ID / status |
| `GET /executions/:id`, `DELETE /executions/:id` | Bounded stdout/stderr, exit status, timeout, and actual cancellation |

When implemented, add a client adapter configured by `EXPO_PUBLIC_API_URL` (never secrets), response validation, abort/timeouts, typed HTTP errors, and a real loading/cancellation state. Use authenticated authorization for cloud files; do not silently upload local drafts. Never execute arbitrary Python inside the API process. This release deliberately does **not** consume that environment variable or send credentials to a configurable unverified endpoint.

## Research sources checked for this implementation

- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/) — React Native / React versions and SDK-compatible package installation.
- [Expo documentation index](https://docs.expo.dev/llms.txt) — current API/documentation entry points.
- [Using React DOM in Expo native apps](https://docs.expo.dev/guides/dom-components/) (updated September 29, 2026) — SDK 56+ bundled WebView, async native actions, serialization, manual sizing, Expo Go support.
- [CodeMirror Python language source](https://github.com/codemirror/lang-python/blob/main/src/python.ts) — verified `python()` registers `localCompletionSource` and `globalCompletion`.

## Verification scope

Unit tests target validation, versioned draft restoration, filename rules, write ordering, storage retry, the unavailable account boundary, theme preference decoding and WCAG normal-text contrast for both palettes. `scripts/review-web.mts` uses development-only Playwright under Node (for reliable browser child-process handling on Windows) to check both modes at 390/768/1024/1440px, live syntax/cursor changes, suggestions, file operations, auth validation/offline notices, reload/route persistence, browser runtime errors and overflow. `bun run build` exports web only. No native build/export or device validation is included in this iteration. Before a future native release, test the editor's touch suggestions and soft-keyboard sizing on both iOS and Android; configure production icons, auth, and a sandboxed execution backend separately.
