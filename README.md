# GigaCode

A quiet, neon-edged Python playground. This design iteration is **web-first**, with midnight-blue/cyan dark mode and an ice-blue light mode. The Expo SDK 57 / React Native universal architecture is preserved; native builds and device verification are deferred.

## Run with Bun

Use Bun 1.3+ and Node 22.13+ (required by Expo's tooling). All package management uses Bun.

```sh
bun install
bun run web        # browser
bun run start      # Expo development server / Expo Go QR code
bun run ios        # iOS simulator (macOS required)
bun run android    # Android emulator
```

Focus current development on `bun run web`. The existing iOS/Android start commands remain available for future work, not a claim of native readiness. Only the code editor is a DOM component; navigation, forms, file library, and output use shared React Native primitives.

## What works now

- Explicit sun/moon theme switch on the workspace, sign-in, and sign-up pages. Dark is the default. The preference is persisted with AsyncStorage under `gigacode.theme.v1`, survives routing/reloads, and updates all surfaces, forms, dialogs, CodeMirror syntax, suggestions, selection, and cursor live. If storage is unavailable, the selected theme still works for the session and the UI reports the failure. Content waits for preference hydration to avoid flashing the wrong workspace theme.
- Editable, syntax-highlighted Python with real package-provided suggestions, local-symbol completion, snippets, line numbers, and undo/redo.
- New, open, rename, and save device-local `.py` drafts. Changes autosave after a short idle period; Save writes immediately and reports storage failures. These are app-private drafts, not exported filesystem documents.
- Validated login/signup UI with password visibility controls and an explicit account-service-unavailable response.
- An execution console that honestly reports **runtime not connected**. No code is executed and no successful login or account is simulated.

Device drafts persist in browser storage on web and AsyncStorage on native. They are not encrypted, cloud-synced, or shared across browsers/devices. Don't put secrets in them. Clearing site/app data removes them. Accounts and signed-in cloud files await the Python backend; the Files panel distinguishes that future feature from working local storage.

### Editor controls

| Action | Keyboard / touch |
| --- | --- |
| Python suggestions | Type `pri`, or Ctrl+Space, or tap **Suggest** |
| Choose a suggestion | Arrow keys + Enter, or tap the item |
| Dismiss suggestions | Escape |
| Request execution | Cmd/Ctrl+Enter or **Run** (currently explains offline runtime) |
| Save local draft | Cmd/Ctrl+S or **Save** |

## Verify / export

```sh
bun run typecheck
bun run lint
bun run test             # draft, storage queue, form validation, theme/contrast tests
bun run build            # static web export → apps/expo/dist
bunx playwright install chromium  # once, browser test prerequisite
bun run test:web         # browser checks against the exported web app
```

Browser checks cover 390, 768, 1024, and 1440px in both modes: workspace/login/signup, live editor colors and Python completion, local create/save/rename/open/reload, honest offline messages, theme persistence, and horizontal overflow. Set `SCREENSHOT_DIR` to an existing directory to capture screenshots. `REVIEW_PORT` overrides the default 4175 port. Playwright is a development-only dependency; the app uses CodeMirror, React Hook Form/Zod, AsyncStorage, Expo LinearGradient, Feather icons, and bundled Space Grotesk (no new runtime UI library).

No native build/export is part of this iteration. The existing `build:native` script is retained for later; device/simulator testing is still required before native release. The existing template app icons remain placeholders.

## Layout

```text
apps/expo/    Universal app (routes in src/app, shared UI in src/components)
apps/api/     Reserved for the future Python API
apps/worker/  Reserved for isolated execution workers
```

See [the UI architecture and research notes](apps/expo/ARCHITECTURE.md) for package rationale and the proposed backend boundary. The legacy `bun run web:web` alias also opens the actual Expo app.
