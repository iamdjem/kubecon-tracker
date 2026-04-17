# Deploying

This repo serves two artifacts:

1. **The Crew Tracker web app** — `index.html` published via GitHub Pages. Pushing to `main` deploys automatically; no action needed.
2. **The Firebase Realtime Database security rules** — `database.rules.json`. Edits to this file do **not** auto-deploy. You must run a CLI command (or paste into the Firebase Console).

This document covers #2.

## What `database.rules.json` does

Defines who can read/write what under the `e3-kc26-x7k9m/` Firebase namespace. Both this app and [vMix Commander](https://github.com/iamdjem/vmix-commander) authenticate as a single shared Firebase user, so the rules:

- **Lock the entire namespace behind auth** — no public reads or writes.
- **Validate shape** on critical paths: `controller`, `audit`, `errors`, `roomLocks`, `vmixProxyUrl`.
- **Make `audit` and `errors` append-only** — created entries cannot be edited or deleted by clients.
- **Cap `errors.message` and `errors.stack`** at 8 KB each.

The full data contract lives in [vMix Commander's `docs/firebase-schema.md`](https://github.com/iamdjem/vmix-commander/blob/main/docs/firebase-schema.md).

## Pre-deploy checklist

- [ ] All Commander operators are on **v0.6.5 or newer**. Earlier versions could write `null` identity payloads, which the rules reject.
- [ ] You have access to the `kubecon-tracker` Firebase project under your Google account.
- [ ] You're not in the middle of a live event. Deploy during a quiet window so you have time to roll back if needed.

## One-time CLI setup

Skip this if you've already deployed once from this machine.

```bash
# Install the CLI
npm install -g firebase-tools

# Log in (opens a browser)
firebase login

# Pin this directory to the project
cd /path/to/kubecon-tracker
firebase use kubecon-tracker
```

## Deploy

```bash
cd /path/to/kubecon-tracker

# Dry-run first — validates syntax without touching prod
firebase deploy --only database --dry-run

# If the dry-run says "rules syntax is valid", deploy for real
firebase deploy --only database
```

Output ends with `✔ Deploy complete!` on success. Rules propagate globally in ~2 seconds.

### Alternative: Firebase Console (no CLI)

1. Open https://console.firebase.google.com/project/kubecon-tracker/database/kubecon-tracker-default-rtdb/rules
2. **Save the current rules to a local file** as a backup (e.g. `rules-backup-YYYY-MM-DD.json`). This is your rollback.
3. Paste the contents of `database.rules.json` into the editor, replacing everything.
4. Click **Publish**.

## Verification (run right after deploy)

1. **Authenticated writes still work.** Open the tracker, sign in, click Start Recording on a test room. You should see the recording start in vMix and an audit entry appear in Commander's Log tab with a "via Tracker" badge.

2. **Unauthenticated access is rejected.** In an incognito window, hit:
   ```
   https://kubecon-tracker-default-rtdb.europe-west1.firebasedatabase.app/e3-kc26-x7k9m/events.json
   ```
   You should get `{"error":"Permission denied"}`.

3. **Presence heartbeat is arriving.** In Firebase Console → Realtime Database → Data tab, navigate to `e3-kc26-x7k9m/events/<event-id>/controller`. The `lastHeartbeat` field should update every ~5 seconds while Commander is open.

4. **No new entries in Commander's Errors panel.** Open Commander → Log tab → expand "Errors". If you see new `pushAuditToTracker` or `presenceHeartbeat` errors, a write was rejected — investigate.

5. **Firebase Rules Monitor shows no denials.** Console → Realtime Database → Usage tab → look for "rules denials" in the recent timeframe.

## Rollback

If something breaks:

### CLI rollback

```bash
cd /path/to/kubecon-tracker
git show HEAD~1:database.rules.json > database.rules.json
firebase deploy --only database
# Once you've fixed the new rules:
git checkout database.rules.json
```

### Console rollback

1. Open the rules editor in the Firebase Console.
2. Look for **Rules history** (right-hand panel) — every published revision is listed with a timestamp.
3. Click the previous revision → **Rollback** → **Publish**.

Or paste your backup file from the pre-deploy step.

## Common deploy failures

| Symptom | Cause | Fix |
|---|---|---|
| `Error: Failed to load function definition from source` | Wrong directory | `cd` into the repo root before running `firebase deploy` |
| `Error: Invalid project id` | Project not linked | Run `firebase use kubecon-tracker` |
| Dry-run reports `parse error` | Bad JSON in `database.rules.json` | Fix the syntax error reported by the CLI; common cause is a stray comma |
| `HTTP 403: The caller does not have permission` | Logged-in account lacks Editor role on the project | Ask the project owner to grant access in IAM, or `firebase login --reauth` |

## Related

- Schema reference: [vMix Commander `docs/firebase-schema.md`](https://github.com/iamdjem/vmix-commander/blob/main/docs/firebase-schema.md)
- Rules file: [`database.rules.json`](./database.rules.json)
- One-command deploy via Claude Code: see `.claude/skills/deploy-rules.md`
