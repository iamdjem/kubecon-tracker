---
description: Deploy the Firebase Realtime Database security rules from database.rules.json to the kubecon-tracker project. Runs a dry-run first, surfaces any syntax errors, then deploys for real with explicit confirmation. Stops cleanly if anything fails. Reference doc lives at DEPLOYING.md in this repo.
user-invocable: true
---

# /deploy-rules — Push `database.rules.json` to Firebase

Deploy the Realtime Database security rules in this repo to the live `kubecon-tracker` Firebase project.

## When to use this

The user just edited `database.rules.json` (or wants the in-repo version live), and asks to deploy / push the rules / publish them. This is the right tool. Do **not** use this for anything else (the GitHub Pages site auto-deploys; this skill only handles Firebase rules).

## Critical safety rules

- Rules deployment affects **production**. A bad deploy can lock out clients or silently reject writes.
- Always run the dry-run first. If it fails, stop and report — do not deploy.
- Always show the user the exact dry-run output and **confirm before the real deploy**, unless they explicitly said "deploy without asking" in the same message.
- Never deploy if `git status` shows uncommitted changes to `database.rules.json` — the deployed rules should match what's in version control. Ask the user to commit first.
- Never run `firebase init`, `firebase login --reauth`, or any command that mutates Firebase project settings beyond rules.

## Steps

1. **Verify state.** From the repo root (`/Users/alex/kubecon-tracker/`):
   - `ls database.rules.json firebase.json` — both must exist. If `firebase.json` is missing, fall back to **First-time setup** below before continuing.
   - `git status database.rules.json` — if it shows modifications, ask the user to commit before deploying. Don't auto-commit.
   - `git log -1 --format='%h %s' database.rules.json` — show the user which committed version is about to ship.

2. **Dry-run.** Run `firebase deploy --only database --dry-run` from the repo root. Capture the output.
   - On success it ends with `✔ Dry run complete!`. Show that line to the user.
   - On failure (syntax error, auth error, project mismatch), show the error verbatim and stop. Do not proceed.

3. **Confirm with the user.** Print exactly which commit + which file is about to ship and ask: "Dry-run passed. Deploy for real? (yes/no)" — unless the user's invoking message already said something like "deploy now" / "go ahead" / "yes deploy". Be conservative; if in doubt, ask.

4. **Real deploy.** Run `firebase deploy --only database`. Wait for completion.
   - Success ends with `✔ Deploy complete!`. Show that line plus the project console URL.
   - On failure, show the error verbatim. Suggest checking `firebase login` or `firebase use kubecon-tracker` if it's an auth/project issue.

5. **Post-deploy reminders.** After a successful deploy, tell the user:
   - "Rules are live globally in ~2 seconds."
   - Three quick verification steps from `DEPLOYING.md`:
     - In an incognito window, hitting `https://kubecon-tracker-default-rtdb.europe-west1.firebasedatabase.app/e3-kc26-x7k9m/events.json` should return permission-denied.
     - In the Firebase Console, `events/<event-id>/controller.lastHeartbeat` should still update every ~5s while Commander is open.
     - Commander's Log tab → Errors panel should not show new `pushAuditToTracker` / `presenceHeartbeat` denials.
   - The rollback command in case anything's wrong:
     ```
     git show HEAD~1:database.rules.json > database.rules.json
     firebase deploy --only database
     git checkout database.rules.json
     ```

## First-time setup (only if `firebase.json` is missing)

1. Check that `firebase` CLI is installed: `firebase --version`. If not, tell the user `npm install -g firebase-tools` and stop — do not auto-install global tooling.
2. Check login: `firebase projects:list | head -5`. If it fails with auth error, ask the user to run `firebase login` and stop — do not auto-login (it opens a browser).
3. Write `firebase.json` at the repo root with:
   ```json
   {
     "database": {
       "rules": "database.rules.json"
     }
   }
   ```
4. Run `firebase use kubecon-tracker`.
5. Now resume from step 1 of the main flow.

## Important constraints

- Do not modify `database.rules.json` itself in this skill. If it has a syntax error, surface it and stop.
- Do not commit or push automatically. Versioning is the user's call. (If the user asks to commit + deploy, do those as separate explicit steps.)
- If the user is in a hurry ("just deploy"), still run the dry-run — it's 3 seconds and prevents shipping a typo.
- If the dry-run is already passing in the previous message and the user is following up with "yes deploy", you can skip steps 1-2 and go straight to 4.
