# GigaCode · web-first universal client

Run commands from the repository root:

```sh
bun install
bun run web
bun run start
bun run typecheck
bun run lint
bun run test
bun run build
bun run test:web
```

Use the sun/moon switch on any page to move between midnight-blue/cyan dark mode and ice-blue light mode. The preference is saved locally and includes the editor, autocomplete, and dialogs. This iteration verifies web only; native builds/exports are deferred without replacing the universal architecture.

See the [root README](../../README.md) for browser-testing prerequisites, keyboard shortcuts, local-storage behavior, and current backend limitations (no auth or Python runtime connected). See [ARCHITECTURE.md](./ARCHITECTURE.md) for implementation/research notes.

Within this directory, `bun run web`, `bun run ios`, and `bun run android` start the appropriate Expo target. Install SDK packages with `bunx expo install <package> --bun`; install JavaScript-only libraries with `bun add <package>`.
