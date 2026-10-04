# Code Runner

Starter monorepo for the online code submission system.

## Workspace layout

```text
apps/
  web/       Expo app (web, iOS, and Android)
  api/       Reserved for the backend API
  worker/    Reserved for isolated code execution workers
```

## Run the Expo app

Requirements: Bun 1.2 or newer.

```sh
bun install
bun run web
```

To run the web target in a browser:

```sh
bun run web:web
```

The API and worker directories are placeholders; they are not implemented yet.
