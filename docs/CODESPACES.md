# Run GigaCode in Codespaces and use it on Android/iOS

The Codespace runs the **API, database, Redis, MinIO, execution worker and Expo development server**.
Your phone runs the app. Submitted Python/JavaScript/C/C++ executes on the Linux worker, not the phone.

The checked-in configuration has not been run in a live Codespace. The worker needs writable cgroup v2
delegation and Linux namespaces. Docker-in-Docker makes nested containers available but does not
guarantee those capabilities on every Codespace. The worker's existing startup self-test must pass.

## 1. Create the Codespace

On GitHub, create a Codespace from the branch containing these changes. Its dev-container configuration
is `.devcontainer/devcontainer.json`. Rebuild an existing Codespace to apply it.

Start with 4 cores, 8 GB memory and 32 GB storage: the worker image includes three language filesystems.
The dev container provides Node 22, Bun 1.3.13 and the official Docker-in-Docker feature. Post-create
checks tooling and creates **`.devcontainer/.env.codespaces`** once, with generated local credentials.
It preserves existing files and does not start services or install application dependencies.

If you need to repeat setup, run from the repository root:

```bash
node .devcontainer/setup.mjs
docker version
docker compose version
```

The env file is ignored by Git. Keep it out of the app. When recreating/renaming a Codespace, update
its `CODESPACES_WEB_ORIGIN` to the new port-8081 forwarded origin without replacing its existing secrets.

## 2. Start the backend

Run from the **repository root** in the Codespace's Bash terminal:

```bash
bash .devcontainer/compose.sh config --quiet
bash .devcontainer/compose.sh up -d --build api worker
bash .devcontainer/compose.sh ps -a
bash .devcontainer/compose.sh logs --tail=100 worker
curl --fail http://127.0.0.1:3000/readyz
```

Use this Compose wrapper for subsequent commands too: it selects the base Compose file, Codespaces
override, generated env and separate `gigacode-codespaces` project. Compose **2.24.4+** is needed for
the override's port replacement syntax. The API depends on initialization completing successfully;
the initializer applies migrations, prepares the worker DB login and creates the object bucket.

The worker logs should show **`self-test passed`** and **`claiming jobs`**. If it exits with cgroup,
namespace or permission errors, see the troubleshooting section. A healthy API is not proof of a
working worker. Register in the app and complete a real Run to establish the full execution path.

This override keeps the nsjail sandbox, uses one worker slot, and does not publish database, Redis or
MinIO ports. The original web dashboard is outside the default startup. Logs travel through the API;
the app does not use phone-inaccessible MinIO presigned links.

### Optional demo/admin accounts

You can register normally in the app. For an admin account and the demo workspace:

```bash
bash .devcontainer/compose.sh exec api pnpm --filter @engine/api seed
```

This prints account passwords and an API key in your terminal. The Codespaces override uses generated
passwords, not the default README passwords. Existing accounts are not reset by rerunning seed.

## 3. Make the API reachable from the phone

Get its HTTPS origin:

```bash
node .devcontainer/setup.mjs api-url
# https://<codespace-name>-3000.app.github.dev
```

In Codespaces **Ports**, set **3000 → Port Visibility → Public** for device access. Keep the backend
port protocol as HTTP: the API listens on HTTP and the GitHub proxy supplies the external HTTPS URL.
Open the forwarded `/readyz` URL on the phone; it should show JSON, not a GitHub sign-in page.

Public forwarding makes the development API Internet-reachable; app login is still required for runs.
Use your own account, and make the port private again after the demo. Organization policy may prohibit
public ports. A private forwarded port needs GitHub authentication that the app does not provide;
never embed a GitHub token in the app. Use a reachable HTTPS backend host if public forwarding is unavailable.

Keep all data-store ports unforwarded. Port 8081 can stay private for an authenticated web preview;
native Metro access uses Expo's tunnel in step 5.

## 4. Install and configure the app

Open a terminal in **`apps/expo`**:

```bash
bun install --frozen-lockfile
export EXPO_PUBLIC_API_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
```

The app has its own Bun lockfile. The backend's pnpm workspace and legacy root Bun lock are not used
for this install. Expo SDK 57 needs **Node 22.13+**; the API/worker images' Node 20 is separate from Metro.

You can also enter that URL in the app's **Connection** screen. Use the full origin, with no `/v1` path.
Changing servers signs you out and preserves drafts. `localhost` on a phone means the phone.

The app signs in through `/v1/auth/native/login` or `/v1/auth/native/register`, then sends the returned
user Bearer token. Native storage is SecureStore. No API key, cookie copying, or CSRF workaround is needed.
The original dashboard's cookie/CSRF flow remains available separately.

## 5. Install the Android/iOS app and connect Metro

`expo-dev-client` and `eas.json` are included. In **`apps/expo`**, link your own Expo project:

```bash
bunx eas-cli login
bunx eas-cli init
```

Review the Android package/iOS bundle identifier in `app.json` and choose identifiers you own before
distribution. Do not enter someone else's EAS project ID. Rebuild a development client after adding
native dependencies or changing native configuration.

### Android phone

```bash
bunx eas-cli build --platform android --profile development
```

Install the resulting **APK** through the EAS installation link. Permit installation from that source
if Android asks. An AAB is not directly installable this way. Publishing to Google Play is not needed
for this development build.

### Physical iPhone

EAS internal distribution requires an Apple Developer Program membership and device provisioning:

```bash
bunx eas-cli device:create
bunx eas-cli build --platform ios --profile development
```

Open the registration link on the iPhone, include the device when building, and install from the EAS
link. Enable Developer Mode when prompted. Newly registered devices may have Apple provisioning delays.
An iOS Simulator binary cannot be installed on an iPhone. Codespaces cannot run Xcode or an iOS Simulator;
EAS performs the native build remotely.

### Connect either installed development build

Still in `apps/expo`, with the public API URL configured:

```bash
# Tunnel helper is development tooling, not an app dependency.
npm install --global @expo/ngrok@^4.1.0
bunx expo start --dev-client --tunnel --port 8081
```

Open the emitted QR/deep link in the installed development app. Keep this terminal and the Codespace
running. The **Expo tunnel serves Metro/bundles/assets**; it does not expose the API. The API uses the
separate forwarded port-3000 HTTPS URL.

SDK 57 uses built-in `@expo/dom-webview` for the CodeMirror DOM component. The rest of the UI is native.
CodeMirror is browser-only and deliberately runs in that WebView, with async actions back to native.
A compatible SDK 57 Expo Go can also run DOM components; if using it, start with
`bunx expo start --go --tunnel --port 8081`. A development build remains the documented device workflow.

For browser preview instead, use `bunx expo start --web --port 8081` and open the forwarded 8081 URL.
The override configures that exact origin in API CORS. Native fetch does not use browser CORS. Do not
run a second Metro server on the same port.

## 6. Everyday use

1. In the app, confirm **Connection** points to the forwarded API origin.
2. Register/sign in. Existing seed accounts can use the same native login screen.
3. In Workspace, enter `print(6 * 7)` and tap **Run**. Expect a completed outcome and stdout `42`.
4. Use **Focus editor** for keyboard-sized editing, **A+** for larger code, and **Suggest** for snippets.
5. Open History to inspect source, attempts, output and resource use, or rerun a submission.

### Internet and CPU controls

Expo's **Run settings → Program internet access** controls the next submission. The original web
Playground also has an **Internet On/Off** switch. The API accepts `"network": true` at the top level
of an execution request; omitted/false stays offline. Source history and reruns preserve this choice.
Advanced controls set a CPU quota and process/thread limit; the usage toggle only changes the display.

After updating this feature, rebuild **both API and worker**, since the schema, policies and worker
image changed:

```bash
# Repository root:
bash .devcontainer/compose.sh up -d --build api worker
```

Online nsjail runs require working iptables/owner/conntrack rules (and ip6tables unless IPv6 is disabled).
The worker image installs the tools; Codespaces must permit those kernel operations. If rule installation
fails, the run fails before program startup and its stderr explains the setup error. Normal offline
startup checks do not establish online connectivity. The development Docker driver remains offline-only.
Existing database volumes can be kept; the mode is saved in source manifests, with old submissions
defaulting to off.

Internet On permits public outbound TCP/UDP and DNS, while local/private destinations remain filtered.
It does not install Python/Node packages: use the bundled standard libraries (for example Python's
`urllib.request`). The runner does not report network traffic byte counts.

Drafts remain on the device. Execution history/source/results live on the server. This is not automatic
cross-device draft synchronization.

For a standalone preview build without Metro, configure `EXPO_PUBLIC_API_URL` in the preview EAS
environment/profile or set it through Connection after installation, then run:

```bash
bunx eas-cli build --platform android --profile preview
# iOS preview also requires device provisioning:
bunx eas-cli build --platform ios --profile preview
```

EAS does not automatically inherit Codespaces shell variables. No URL in a build is permanent hosting:
the Codespace must stay running. Use a stable API host for a distributed app.

## Troubleshooting and shutdown

| Symptom | What to check |
| --- | --- |
| Missing Docker/Compose | Rebuild the dev container and inspect Docker-in-Docker startup logs. |
| Worker cgroup v2/delegation/namespace failure | The runtime cannot support this sandbox configuration. Keep the error logs; do not bypass the worker's checks or remove isolation. |
| API readiness fails | `bash .devcontainer/compose.sh logs migrate api postgres minio redis` |
| Jobs stay queued | Worker startup logs, self-test completion and DB credentials. |
| Native-auth endpoint returns 404 | Rebuild the API image from this checkout. |
| Phone receives HTML or redirects | Wrong URL or port 3000 still private. |
| Editor blank/missing native module | Matching SDK/dev client, Metro tunnel, device logs; rebuild after native changes. |
| Browser CORS error | Match the actual forwarded 8081 origin to `CODESPACES_WEB_ORIGIN`, then recreate the API service. |

If Codespaces does not provide the worker's required cgroup delegation/namespaces, run the complete
backend on a Linux VM with cgroup v2 and the required privileges. See `infra/worker-vm/` and
[RUNBOOK.md](RUNBOOK.md). Point the app at that host's HTTPS API; Metro can remain in Codespaces.
Simply setting `SANDBOX_DRIVER=docker` is not a working substitute: the existing worker image does not
include the Docker CLI/socket setup and shared daemon-host workspace paths that driver needs.

```bash
# Repository-root terminal:
bash .devcontainer/compose.sh logs -f api worker
bash .devcontainer/compose.sh stop    # preserve data
bash .devcontainer/compose.sh down    # remove containers, preserve named volumes
```

Stop Metro, make API port 3000 private again, and stop the Codespace when finished. Adding `-v` to
`down` deletes that Compose project's stored database and artifacts.

## Official references

- [GitHub port forwarding](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)
- [Docker-in-Docker feature](https://github.com/devcontainers/features/tree/main/src/docker-in-docker)
- [Expo SDK 57 requirements](https://docs.expo.dev/versions/v57.0.0/)
- [Expo DOM components](https://docs.expo.dev/guides/dom-components/)
- [EAS device build profiles](https://docs.expo.dev/build/eas-json/)
- [iPhone device provisioning](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/)
