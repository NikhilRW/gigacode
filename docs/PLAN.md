# Plan: Product-quality web app (v2)

The platform underneath already works and is tested end to end: the API, Postgres queue, workers, nsjail sandbox,
chaos recovery, and the load test (see [TEST_REPORT.md](TEST_REPORT.md)). What's left is to make it feel like a
finished product. That means a redesigned dashboard on shadcn/ui following the reference design, the few backend
additions that design needs, and a stronger verification bar. The Expo mobile app stays out of scope.

Every phase ends with a "done when" check that is actually run, then a commit. Regression gates run after every
backend change: unit, integration, abuse suite, chaos suite.

## Design direction (from the reference screenshot)

| Element | Reference | Our app |
|---|---|---|
| Shell | Light grey sidebar, grouped nav with small uppercase section labels, active item as a white raised pill | Same: sidebar with WORKSPACE / CONFIGURE / ACCOUNT / ADMIN / RESOURCES groups, collapsing to a slide-over sheet on mobile |
| Canvas | Off-white page, hairline section dividers, "+" crosshair marks at section corners, generous whitespace | Same canvas and dividers; crosshair marks as a small decorative component, hidden on mobile |
| Headline | Two-tone large heading ("Good afternoon, Nikhil." black / "Your work, carried forward." grey) | "Good afternoon, {name}." / "Run code, safely contained." |
| Sections | Left column: title and one-line explanation. Right column: content | Every page section uses this two-column row, so each block explains itself |
| Buttons | Solid near-black primary with arrow; quiet secondary | shadcn `Button`: solid `default` (near-black, white text) for the one main action per screen, `outline`/`ghost` for the rest. Destructive actions are red and always confirmed |
| Stats | Big numerals, small grey caption, vertical dividers | Activity row: Running, Queued, Success rate (24h), CPU time today |
| Steps | Numbered rows (01, 02, 03) with arrow, full-row click target | "Get set up" checklist that ticks itself off from real data |

**Visual system:** Tailwind CSS variables, neutral (zinc/stone) palette. Near-black primary at about 4.5:1+ contrast,
radius 8–10px, Inter self-hosted via `@fontsource` (no external font fetch), JetBrains Mono for code and IDs.
Status colours appear only on small badges: green success, red failed, amber timeout, grey cancelled, purple dead-letter,
blue in progress. Light theme is the default to match the reference; dark mode stays as a toggle on the same tokens.
Copy stays plain and honest. The sandbox is described as "layered isolation and resource containment", never "secure".

**Components (shadcn/ui on Radix):** button, card, input, label, textarea, select, tabs, table, badge, dialog,
alert-dialog, dropdown-menu, sheet, sidebar, tooltip, sonner (toasts), skeleton, separator, scroll-area,
resizable (editor/output split), command (⌘K palette), toggle-group (filters). Monaco stays as the code editor, with
light and dark themes matched to the tokens.

## UX flows

1. **Sign up, then first run in under a minute.**
   - Register asks for name, workspace name, email and password, and lands on Overview.
   - The "Get set up" checklist shows three steps:
     - 01 Run your first program (opens the Playground with a starter already loaded)
     - 02 Create an API key
     - 03 Call the API from your terminal
   - Each step ticks itself off from real data: a run exists, a key exists, a run was submitted with an API key.
2. **Playground** (the main working screen).
   - Left: file tabs and the editor.
   - Right: resizable panel with Input (stdin) and Output tabs.
   - Top bar: language select, limits popover showing the tenant maximums, and a solid **Run ⌘↵** button.
   - While a job runs, a live four-step progress strip (Queued → Starting → Running → Done) replaces the raw event list.
   - Results: summary chips (exit code, wall time, CPU time, peak memory), then stdout and stderr in monospace with a
     truncation notice when output was cut.
   - Failures are explained in plain words with a next step: "Timed out after 5 s — raise the time limit",
     "Ran out of memory (256 MB) — raise the memory limit", "Compile error — see stderr". Lines from the
     compiler's output are highlighted.
   - Cancel is available while a job is active.
3. **Runs** list.
   - Filters for status, language and date, plus search by run ID.
   - Rows show status badges, relative times and durations, and the whole row is the click target.
   - Cursor pagination.
   - Empty state with a "New run" call to action.
4. **Run detail.**
   - Header: status, language, created time, and actions: Re-run, Open in Playground, Cancel, Copy ID.
   - Tabs:
     - Output
     - Timeline (readable labels, not enum names)
     - Attempts (explains retries in plain words: "worker lost, retried automatically")
     - Source (read-only)
5. **API keys.**
   - "Create key" dialog.
   - Reveal-once dialog: copy button, a warning that the key is shown only once, and code tabs (curl / JavaScript /
     Python) with the key filled in.
   - List with last-used time, and revoke with a confirm step.
6. **Settings.**
   - Profile name, change password, theme, sign out.
   - Read-only "Limits" card (concurrency, rate, time, memory) with usage bars.
7. **Admin** (platform_admin only, its own sidebar group).
   - Workers: liveness dot and slot usage.
   - Queue: depth, oldest wait, and a breakdown by tenant.
   - Dead letters: requeue with a confirm step.
   - Tenants: edit limits in a dialog, with validation.
   - Auto-refresh every 5 s, paused while the tab is hidden.
8. **Everywhere.**
   - Skeleton loaders and empty states.
   - Toasts for errors: 429 shows a retry countdown, 401 returns to sign-in, network errors show a retry button.
   - ⌘K palette: go to pages, start a new run, open a run by ID.
   - Visible focus rings, labelled controls, keyboard paths for every action.
   - Layouts verified at desktop widths (1440 and 1280 px). Phone widths are out of scope for now.

## Backend, DB and worker additions

| Change | Why |
|---|---|
| Migration: `users.name` (nullable text) and an optional `name` at register | The greeting and the profile need a name. Existing users fall back to the part of their email before the @ |
| `PATCH /v1/me` (name) and `POST /v1/me/password` (current and new password, argon2id, CSRF) | Settings page |
| `GET /v1/onboarding` → `{ ranExecution, createdApiKey, usedApiKey }`, derived from existing rows (no new table) | The self-ticking checklist |
| `GET /v1/usage/timeseries?hours=24` → runs per hour by outcome | Overview activity sparkline |
| `q` (ID prefix) filter on `GET /v1/executions` | Search on the Runs page |
| Integration tests for each of the above, including cross-tenant 404s | Same bar as the existing API |
| Workers / sandbox: no functional changes planned | Already verified. The abuse, chaos and load suites run as regression gates after every backend phase |

## Phases

Status: P1, P2, P3 and P4 done and committed. Next: P5 (Runs and run detail).

| # | Phase | Done when |
|---|---|---|
| P1 | **Design foundation**: shadcn init (Tailwind 3 compatible), tokens, fonts, sidebar app shell as in the reference, theme toggle, Toaster, Monaco loaded only on the Playground | Every existing page renders inside the new shell; `typecheck` and `build` pass; first-load JS is much smaller than today's 930 KB gzipped |
| P2 | **Backend additions** from the table above | New and existing integration tests pass; abuse suite and chaos suite still 15/15 and 7/7 |
| P3 | **Auth + Overview**: new sign-in/register screens, greeting, how-it-works strip, Activity row, Get set up checklist, recent runs | A new user sees the checklist tick off live as they complete each step (Playwright) |
| P4 | **Playground** redesign | All four languages run from the UI; live progress strip; timeout, OOM and compile-error explanations shown (Playwright) |
| P5 | **Runs + run detail** | Filter, search, paginate, re-run, cancel, open in Playground all work (Playwright) |
| P6 | **API keys + Settings** | Create a key → copy → curl snippet works against the API; rename profile; change password; sign out (Playwright) |
| P7 | **Admin** | Requeue a dead letter and edit tenant limits from the UI (Playwright, seeded admin) |
| P8 | **Polish**: empty, loading and error states; ⌘K palette; responsive sheet sidebar; accessibility | `@axe-core/playwright` reports no serious or critical issues on every page; desktop screenshots in light and dark reviewed |
| P9 | **Release check**: rebuild compose from a fresh clone, run the full regression set (unit, integration, abuse, chaos, load, Playwright suite), update README, TEST_REPORT and MILESTONES | Everything green and recorded |

## Assumptions (I'll proceed on these unless you say otherwise)

- **Product name in the sidebar:** "GigaCode" (the repo's name). Replace with your own name and logo if needed.
- **Theme:** light theme by default to match the reference; dark mode kept as a toggle.
- **Editor:** Monaco stays the code editor; shadcn covers everything around it.
- **Tailwind:** stays on v3.4 with a shadcn setup compatible with it. That avoids a risky Tailwind 4 migration now.
