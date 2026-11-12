# Genesys Cloud — Queue Profile Switcher

A lightweight agent workspace for switching between **Eparchia**, **Athina01**, and **Thessaloniki01**. Sign in with a personal Genesys account, click a profile once, and see verified queue activation results. Greek is the default language; English, dark mode, responsive layouts, and an explicit demo are included.

- **App:** https://intracom-power-team.github.io/Genesys_Cloud-Custom-Queue-Activation/
- **Demo:** https://intracom-power-team.github.io/Genesys_Cloud-Custom-Queue-Activation/?demo=1
- **Repository:** https://github.com/Intracom-Power-Team/Genesys_Cloud-Custom-Queue-Activation
- **Region:** Frankfurt, `mypurecloud.de`
- **OAuth client:** `6f2d2766-80d7-4e7e-9eb0-aa74c114b215`

This is an independent static application. It does not depend on or modify the Custom Answer KPI reporting app. No framework, backend, runtime dependency, client secret, or paid hosting service is needed.

## Before the first real sign-in

An administrator of the **target Genesys organization** must complete these steps:

1. Open **Menu → IT and Integrations → OAuth** (or **Admin → Integrations → OAuth** in the older navigation), and edit the existing client above.
2. Confirm **Code Authorization / PKCE**, for a public browser client. No client secret is used by this app.
3. Register this **exact Authorized Redirect URI**, preserving the repository path's capitalization:

   ```text
   https://intracom-power-team.github.io/Genesys_Cloud-Custom-Queue-Activation/oauth/callback.html
   ```

4. Configure and authorize **`users` and `user-basic-info`**. The originally supplied `routing` + `users:readonly` scopes do **not** permit the specified bulk queue PATCH. `users` is required for that write endpoint and also covers reading memberships; `user-basic-info` is the live Swagger requirement for `/users/me`. This app does not request `routing`, wildcard access, or additional scopes. See the [verified API contract](docs/api-contract.md) for evidence and the scope change rationale. If this OAuth client serves other apps, coordinate changes with its owner rather than removing scopes those apps need.
5. Where organization policy requires application approval, authorize this client and these scopes under **Authorized Applications**. Follow [Genesys client authorization](https://help.genesys.cloud/articles/authorize-an-oauth-client-2/).
6. Grant pilot agents **Routing → Queue → View** and **Routing → Queue → Join**, with access to the queues' divisions. Normal agents do not need Administrator or Queue Member Manage permissions for this app.
7. Assign the agent membership in every queue of a profile they need. For access to all three profiles, assign all nine memberships. The app never creates memberships.

Client scope configuration, organization authorization, division access, existing memberships, browser/SSO popup behavior, and live queue propagation must be validated in the target organization. Automated checks do not prove those settings are correct.

## Configured profiles

All UUIDs are in [`config.js`](config.js), separate from the switching logic.

| Profile | Queue | UUID |
| --- | --- | --- |
| Eparchia | Eparxia_Ioannina | `c6c17832-7037-435b-ab67-1d90d002026d` |
| Eparchia | Eparxia_Patra | `5db40671-686d-4711-afd2-e26b60822ac7` |
| Eparchia | Eparxia_Volos | `8cee0d80-ac94-47af-8ddc-e6b9276f3d9c` |
| Athina01 | Athina_Argiroupoli | `3e456ddf-66a0-4c05-9c6b-d6c721433571` |
| Athina01 | Athina_Chalandri | `f222dd09-e394-461c-9be7-4fe910403909` |
| Athina01 | Athina_Pirgos_Athinon | `4c5b8916-02c1-4eef-b2a5-309ad55b453c` |
| Thessaloniki01 | Thessaloniki_Chalkidiki | `5e46e959-c51f-4e0a-bf2b-5851dc6b205a` |
| Thessaloniki01 | Thessaloniki_Papanastasiou | `4c7eb100-4e80-452a-8243-871607a86741` |
| Thessaloniki01 | Thessaloniki_Thermi | `f186f5b6-098d-4d2b-b2e7-e37effe7205c` |

These are logical profiles, not Genesys Directory Groups.

## What a click does

1. Identify the authenticated agent through `GET /api/v2/users/me`. There is no editable user ID.
2. Read all pages of active **and** inactive memberships. The current endpoint defaults `joined` to `true`, so the app explicitly queries both `joined=true` and `joined=false`. It rejects malformed or inconsistent snapshots.
3. Check membership in all three target queues. If any are missing, stop and display their names.
4. Calculate only changed `{id, joined}` pairs among the nine configured queues. Ignore all unrelated queues. Already-active profiles send no PATCH.
5. Make one `PATCH /api/v2/users/{authenticatedUserId}/queues` call.
6. Because updates are asynchronous, verify with delayed reads at bounded intervals. Display success only when the target's three queues are active and all other managed memberships are inactive. Non-membership in an unselected queue means it cannot be active.
7. On failure or partial/uncertain results, retrieve actual statuses and show the error. If the new state cannot be read, switches stay disabled until refresh succeeds. There is no automatic rollback or blind PATCH retry.

The controller prevents concurrent actions in one app instance. Another tab, client, supervisor, or agent action may change the same queues concurrently. Genesys does not provide an atomic snapshot or compare-and-swap guarantee for this flow. The preflight read and post-update verification reduce uncertainty but cannot prevent external changes after verification. Avoid concurrent queue tools during the pilot.

### Three different concepts

- **Membership:** an administrator associates an agent with a queue. The app never modifies this.
- **Activation (`joined`):** whether an existing member participates in that queue. This is what the app changes.
- **On Queue / Off Queue availability:** agent routing availability/presence. The app never calls those endpoints; selecting a profile does not put the agent On Queue.

The active profile is always detected from the latest observed Genesys state, ignoring unrelated queues. A mixed state is shown as **Custom / No matching profile**. No selected profile is persisted as a source of truth.

## Local development and verification

Install Node.js 22 or later; Node 24 was used for validation. No dependency installation is required.

```sh
node scripts/serve.mjs
```

Open `http://127.0.0.1:4173/Genesys_Cloud-Custom-Queue-Activation/?demo=1`. The local server also serves `/`. Use HTTP, not a `file://` URL, for ES modules and Web Crypto. Local sign-in intentionally fails while the production callback is configured. For a controlled local authentication test, register a separate localhost callback and temporarily change `DEPLOYMENT.redirectUri` to match its exact URL; restore the production value before committing.

```sh
node --test
node scripts/check.mjs
node scripts/build.mjs
```

Equivalent `npm test`, `npm run check`, `npm run build`, and `npm run dev` scripts are available when npm is installed. Build copies an allowlist of public files into `dist/`; tests, docs, Git metadata, and QA assets are not deployed.

Optional real-browser verification, using an installed Chrome/Chromium/Edge:

```sh
node scripts/browser-check.mjs
```

Set `CHROME_PATH` if automatic browser detection does not find it. This launches an isolated headless browser, blocks the Genesys hosts, exercises the UI with demo/mocked API data, and saves screenshots in ignored `.qa/`. A local HTTP fixture also verifies OAuth token exchange and API reads using native browser `fetch`, without replacing it with a JavaScript mock. It never changes live queues. Unit tests cover transitions, no-op switching, custom states, missing memberships, permissions, rate limits, token expiry, partial updates, unrelated queues, bad/duplicate UUIDs, OAuth state, forged messages, popup blocking, session reload, refresh, rapid clicks, subdirectory paths, pagination, and the native fetch receiver requirement.

Demo mode requires `?demo=1`, prominently labels all sample data, and only changes in-memory state. Reloading demo resets its sample state. Live failures never trigger demo mode.

## Deploy to GitHub Pages

1. Use this organization-owned repository. Do not deploy from a personal repository.
2. In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Permit the included GitHub Actions workflow under the organization's Actions policy. The deployment job requires `pages: write` and `id-token: write`; all other jobs use read-only repository access.
4. Push the application to `main`, or use **Actions → Test and deploy GitHub Pages → Run workflow**.
5. The workflow runs mocked tests, syntax checks, and the static packaging script before deployment. Check that both jobs finish successfully, then open the app and demo URLs above.
6. Complete the Genesys OAuth configuration before real use. Hosting the files does not create a Genesys menu entry.

Public organization repositories support Pages on GitHub Free. Private repository Pages support depends on the organization's plan, and organization/enterprise policies may restrict Pages or public publishing. The repository administrator must resolve any policy restriction; this project does not change repository visibility. See [GitHub's Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

All assets are relative to the project path. A dedicated `oauth/callback.html` and `.nojekyll` are included. If changing the organization, repository name, or domain, update both deployment URLs in `config.js` and the OAuth authorized redirect URI. Changing only one breaks authentication.

## Embed in Genesys Cloud

First validate the standalone app. Client Applications support full-page and sidebar placements; an interaction widget is also available but is not needed for this workflow. Integration availability and licensing depend on the organization. The person installing it needs the **Integrations → Integration** permissions; end users need only the app's access and queue permissions.

1. In Genesys, open **Menu → IT and Integrations → Integrations** (or the older **Admin → Integrations** view).
2. Add/install the appropriate **Client Application** integration tile. Select the sidebar client application where available; use the full-page client application as the fallback. Give it a name such as **Queue Profile Switcher**.
3. In **Configuration → Properties**, set **Application URL** to:

   ```text
   https://intracom-power-team.github.io/Genesys_Cloud-Custom-Queue-Activation/
   ```

4. Where the integration exposes iframe sandbox options, allow the capabilities required by this app and the authentication popup:

   ```text
   allow-scripts,allow-same-origin,allow-popups,allow-forms
   ```

   These names are documented Genesys sandbox options. Configure only options supported by the selected integration. Browser and SSO restrictions may still prevent popup communication. The app does not embed the Genesys login page in the iframe or weaken nonce/source/origin checks. If the popup fails, use **Open in a separate tab**, then **Sign in in this tab** as needed. If the host blocks new tabs too, open the published URL directly from the browser.

5. Configure **Group Filtering**/application visibility for the appropriate existing official directory groups as offered by that integration. Do not create Eparchia/Athina/Thessaloniki Directory Groups for these logical profiles. The app has no group API calls.
6. Save the configuration. In **Details**, activate the integration and confirm activation.
7. Have a permitted agent refresh Genesys Cloud, launch the named app from the Apps/sidebar launcher appropriate to the chosen placement, and click **Continue with Genesys Cloud**. If it is absent, recheck activation, group filtering, integration type, and license availability.

Official references: [Client Application placements](https://help.genesys.cloud/?p=131847), [installation and activation](https://help.genesys.cloud/131851/), [documented sandbox options and official-group filtering](https://help.genesys.cloud/articles/set-up-an-interaction-widget-integration/). Menu labels can vary with Genesys navigation and integration type; use the selected tile's actual configuration controls.

## Authentication and security

- The custom app needs its own delegated authorization even when launched inside Genesys Cloud. Its temporary authorization popup can reuse an existing Genesys login session; the app does not force another password prompt. Any consent or reauthentication requirement is controlled by the organization and its identity provider. A valid app token is reused on reload where session storage is available.
- Authorization Code + PKCE S256 uses cryptographically random state and verifier values, validates state and transaction age, and uses an exact configured callback URI.
- Popup authentication keeps the verifier in the opener's memory. The callback strips the code from the address bar and sends only the code/state to the opener with an exact target origin. The opener validates origin, window source, message type, and nonce before exchanging it.
- Same-tab fallback is permitted only outside an iframe and uses a short-lived transaction in sessionStorage. It is removed before exchange. If opener access or session storage is blocked, sign-in fails safely.
- Tokens are stored in memory and, where allowed, sessionStorage for the tab session. Only language/theme preferences use localStorage. Refresh tokens are discarded, actual expiry is respected, and 401 responses clear the session.
- **Sign out** clears this app's session; it does not sign the user out of Genesys SSO or revoke their organization session. Browser session-restoration behavior may preserve sessionStorage; expiry is still enforced.
- No tokens or secrets appear in URLs or application logs. Responses/user names use text nodes. A restrictive Content Security Policy, no-referrer policy, local assets, and HTTPS production URLs reduce exposure.
- Static HTML, queue names/UUIDs and OAuth client ID are public. They are not access controls. Genesys enforces delegated user authorization, OAuth scopes, permissions, and divisions. `users` is a broad API scope required by this endpoint; assign minimal agent permissions.
- JavaScript running on the same origin can read sessionStorage. Treat other apps published on the same organization Pages origin as trusted, keep repository write access restricted, and review source changes. This frontend does not guarantee isolation from a compromised browser, same-origin app, or organization administrator.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Invalid redirect / sign-in fails | Compare the exact registered callback with `DEPLOYMENT.redirectUri`; check client region, Code Authorization / PKCE grant, and required scopes. |
| State mismatch, popup closes, timeout | Start a new sign-in. Do not reuse a callback URL. Try standalone mode if SSO or browser policies sever opener access. |
| Popup blocked | Allow popups, check integration sandbox settings, or open the app directly in a standalone tab. |
| 401 / session expired | Sign in again. Expiry uses the token response, not an assumed one-hour lifetime. |
| 403 | Verify `users` and `user-basic-info` authorization, Queue View/Join permissions, and division access. |
| Missing memberships | Read the named missing queues and have an administrator check assignment/division visibility. The app cannot add membership. |
| 400 / 404 | Check exact queue IDs, region, authenticated user, and current API contract. |
| 429 | Wait for the displayed Retry-After interval before refresh. Reads retry only short rate limits, at most twice; PATCH is never retried automatically. |
| Partial or unverified result | Expand all nine statuses, wait and refresh. A delayed update may still be propagating. Do not use another queue tool at the same time. |
| Network error / 5xx | Refresh when connectivity/service returns. If the outcome cannot be read, profile buttons remain disabled. |
| Custom / No matching profile | Current managed activation is mixed or none is active. Selecting a permitted profile normalizes the nine managed queues. |

## Controlled one-agent pilot

1. Choose a pilot agent with access to all nine queues and an appropriate operational window. Keep their routing availability as agreed with the supervisor; this app will not change it.
2. Record the initial activation of all managed queues, at least one unrelated queue, and the agent's On Queue/Off Queue state.
3. Open the standalone app, sign in as that agent, and compare the displayed identity/statuses with Genesys.
4. Select Eparchia, Athina01, then Thessaloniki01, waiting for verification each time. Independently confirm the target three are active and other managed memberships inactive.
5. Confirm unrelated queues, membership assignments and routing availability did not change. Click the active profile again and verify that no PATCH is sent.
6. Refresh/reload and confirm profile detection. Test a controlled mixed state and an agent missing a target membership; confirm the missing-membership case sends no update.
7. Validate popup login within the chosen integration and the standalone fallback under the organization's browser/SSO policies. Confirm sign-out and reauthentication.
8. Restore the recorded initial activation manually if required by the pilot plan. Record results before wider rollout.

## Project layout

`config.js` contains public settings; `auth.js` and `oauth/` handle sign-in; `genesys-api.js` enforces API boundaries; `profiles.js` calculates deltas; `controller.js` coordinates reads, updates and verification; `app.js` and `i18n.js` render the UI. `tests/` uses only mocked data. `scripts/` contains dependency-free build, preview, syntax and optional browser checks.

Remaining external configuration: OAuth authorized redirect and scopes/approval, agent permissions/divisions/memberships, organization Pages policy, and optional Client Application integration/access. No queue UUID, OAuth client ID, repository or production URL placeholders remain.
