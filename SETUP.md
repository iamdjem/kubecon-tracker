# Full Setup Guide — Tracker + vMix Commander

End-to-end setup for the live-event recording system. Written for the
person running the event, not a developer. If you only need the daily
crew checklist, see [README.md](./README.md) instead.

---

## 1. What the system is

Two apps talking through one Firebase database:

```
  Crew phones                Production machine              vMix machines
 ┌────────────┐             ┌──────────────────┐           ┌─────────────┐
 │  Tracker   │             │  vMix Commander  │  HTTP :8088│   vMix #1   │
 │ (web app)  │◄───────────►│   (desktop app)  │◄──────────►│   vMix #2   │
 └────────────┘   Firebase  └──────────────────┘            │     ...     │
                  Realtime DB         │                     └─────────────┘
                                      │ cloudflared tunnel
                                      ▼
                              public URL for crew
```

- **Tracker** — the web app at https://iamdjem.github.io/kubecon-tracker/.
  Crew open it on their phones to tick off setup/edit/upload steps per
  room. Admins configure the event (crew, rooms, days, steps) here.
  **This is the source of truth for the room list.**

- **vMix Commander** — a desktop app (Mac/Windows) that runs on the
  production machine. It sends Start/Stop Recording/Streaming commands
  to each room's vMix instance over HTTP, and mirrors recording status
  back to the Tracker's Recording page.

- **Firebase Realtime Database** — the shared backbone. Namespace
  `e3-kc26-x7k9m` at
  `https://kubecon-tracker-default-rtdb.europe-west1.firebasedatabase.app`.
  Both apps authenticate as the same shared user. Locked behind auth —
  no public read/write.

---

## 2. Credentials

Both apps use the same two Firebase accounts. You pick a role at sign-in:

| Role  | Password  | Can do |
|-------|-----------|--------|
| ADMIN | `e3admin` | Everything: edit event config, crew, rooms, archive/delete events |
| CREW  | `e3crew`  | Operate assigned rooms only; no config access |

These are baked into both apps (`AUTH_ADMIN_PASSWORD` in the tracker,
`TRACKER_AUTH_ADMIN_PASSWORD` in Commander). Changing them means editing
both codebases + the Firebase Auth users — not a config setting.

---

## 3. One-time backend setup

Skip this if the Firebase project already exists (it does for KubeCon —
this section is for standing up a fresh deployment).

1. **Firebase project** — create one at
   [console.firebase.google.com](https://console.firebase.google.com),
   add a Realtime Database (pick a region close to the venue).
2. **Auth users** — Authentication → Users → add:
   - `admin@e3tracker.local` / `e3admin`
   - `user@e3tracker.local` / `e3crew`
   - Enable the Email/Password sign-in provider.
3. **Security rules** — deploy `database.rules.json`. Full procedure,
   verification steps, and rollback in [DEPLOYING.md](./DEPLOYING.md).
4. **Point the apps at it** — the database URL is hardcoded in both
   apps (`renderer/tracker-config.js` in Commander, the Firebase config
   block in the tracker's `index.html`). Update both if you use a new
   project.

---

## 4. vMix machine prep (each room)

For every room's vMix PC:

1. vMix → **Settings → Web Controller → Enable**. Default port **8088**.
2. Give the machine a **static IP** on the production network (or a DHCP
   reservation). Commander addresses rooms by IP — a changing IP breaks
   the room.
3. Confirm reachable: from the Commander machine, open
   `http://<room-ip>:8088/api` in a browser. You should get XML, not a
   timeout.
4. Note the IP for each room — you'll enter these in Commander (§7).

---

## 5. Install vMix Commander

Built installers live in `vmix-commander/dist/`.

### Windows
- File: **`vMix Commander Setup <version>-x64.exe`** (64-bit Intel/AMD).
  ARM machines (Surface Pro X) need an arm64 build instead.
- It's unsigned: on first run Windows shows *"Windows protected your
  PC"* → **More info → Run anyway**. One time per machine.
- Per-user install, no admin prompt. Installs to
  `%LOCALAPPDATA%\Programs\`.

### macOS
- File: **`vMix Commander-<version>-arm64.dmg`** (Apple Silicon).
- Unsigned: Gatekeeper will block double-click. Either right-click the
  app → **Open** → **Open**, or the operator runs it from a known-good
  install. (Data lives in
  `~/Library/Application Support/vmix-commander/`.)

Only that one installer file is needed — Electron runtime, app code, and
the `cloudflared` tunnel binary are all bundled. The `.blockmap` file
beside it is only for auto-update deltas; don't need it to install.

---

## 6. First run — sign in and link the event

1. Launch Commander. You'll hit the **sign-in gate**:
   - **Pick a role** — ADMIN to configure, CREW to just operate.
   - **Password** — `e3admin` or `e3crew`.
   - **Event picker** — only appears if 2+ live events exist. Pick the
     one you're running.
   - **Identity** — ADMIN types a name (shown in the audit log); CREW
     picks themselves from the event roster.
2. Commander auto-links to the live tracker event. Confirm the event
   name shows in the top tab (e.g. "OSS 2026").
3. If sync isn't on: **Settings → Cloud Sync → Sync with Crew Tracker**,
   and confirm the linked event in the dropdown.

> **Blank screen on launch?** Known regression on v0.6.23/0.6.24 (a
> script error killed the renderer). Fixed in **v0.6.26+** — make sure
> operators are on the current build.

---

## 7. Configure rooms (the part that bites people)

**The Tracker's crew assignments are the source of truth for rooms.**
Commander mirrors them. Do not maintain two separate lists.

1. On the **Tracker** (signed in as ADMIN) → **Settings → Crew & Rooms**.
   For each crew member, add their rooms with the real venue names
   (e.g. `200A`, `205C-D`, `101A-J keynote breakout`). Every room must
   be assigned to a crew member to exist.
2. Still in Tracker Settings → tap **"Reset vMix rooms from crew
   assignments"**. This pushes the crew room list into the shared
   `vmixRooms` that Commander reads. Confirm the dialog (it shows
   old-count → new-count and the names).
3. Commander redraws its tiles within a few seconds to match.
4. In **Commander → Settings → vMix Rooms** (or the ⚙ on each tile),
   enter each room's **vMix IP** (from §4).

> ⚠️ **Known issue (as of this writing):** "Reset vMix rooms from crew
> assignments" regenerates room keys and **clears existing IPs** — you
> may need to re-enter all IPs in Commander after running it. Run the
> reset *before* entering IPs, not after. (Fix pending.)

Why it works this way and the full rationale:
[ARCHITECTURE.md](./ARCHITECTURE.md) and
`vmix-commander/docs/firebase-schema.md`.

---

## 8. Crew sharing (tunnel) — optional

Commander runs a local HTTP proxy on port **8097** and a **cloudflared**
tunnel that exposes it at a public URL. This lets crew phones reach the
proxy-backed features.

- Commander → **Share** tab shows proxy status, tunnel status, a QR
  code, and a copyable link.
- Crew scan the QR / open the link to get the tracker with the proxy
  pre-configured.
- If the tunnel won't start: **Share → Restart tunnel**. If it still
  fails, the venue network may be blocking it — the tracker still works
  for checklists without the tunnel; only proxy-dependent features
  degrade.

---

## 9. Schedule tab — optional

Tracker → **Settings → Schedule Embed**. Must be a **sched.com** URL
(e.g. `https://kccnceu2026.sched.com/`). Public
`events.linuxfoundation.org` pages refuse to embed and will not load.

---

## 10. Day-of runbook

**Before doors:**
1. Production machine on, on the venue network, all room vMix PCs
   reachable (`http://<ip>:8088/api` returns XML).
2. Launch Commander → sign in (ADMIN) → confirm correct event linked.
3. Verify every room tile shows an IP and "IDLE" (not "ERROR"/"No IP").
4. If rooms drifted from the tracker: re-run the §7 reset, then re-check
   IPs.
5. Crew open the tracker on phones, filter to their name.

**During the event:**
- Recording control from Commander (per-room or START/STOP ALL).
- Crew tick steps in the tracker; status flows both ways via Firebase.
- Watch Commander → **Log** tab → **Errors** panel for rejected writes.

**Troubleshooting:**

| Symptom | Likely cause | Fix |
|---|---|---|
| Commander blank on launch | Old build (v0.6.23/24 bug) | Install v0.6.26+ |
| Room tile "No IP" | IP not set / cleared by rooms reset | Re-enter IP in Commander Settings → vMix Rooms |
| Room tile "ERROR" | vMix unreachable | Check room PC on network, web controller enabled, IP correct |
| Commander rooms ≠ tracker | Drift between lists | Tracker Settings → "Reset vMix rooms from crew assignments" |
| Crew can't reach via QR | Tunnel down / network blocks it | Share → Restart tunnel; checklists still work without it |
| "Permission denied" in Firebase | Rules issue / not signed in | Re-sign-in; verify rules deployed (DEPLOYING.md) |
| Schedule tab blank | Non-sched.com URL | Use the `*.sched.com` URL |

---

## 11. Updating the software

- **Tracker:** edit `index.html`, push to `main`. GitHub Pages
  redeploys in ~1–3 min. Crew hard-refresh (the service worker is
  network-first but caches; close all tabs + reopen if stale).
- **Firebase rules:** do **not** auto-deploy — see
  [DEPLOYING.md](./DEPLOYING.md).
- **Commander:** rebuild installers — `npm run build:mac` /
  `npm run build:win` in the `vmix-commander` repo, redistribute the
  `.dmg`/`.exe`, operators reinstall.

---

## Reference docs

| Doc | What |
|---|---|
| [README.md](./README.md) | Crew daily use + admin event config |
| [DEPLOYING.md](./DEPLOYING.md) | Firebase rules deploy, verify, rollback |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Technical architecture (dev) |
| `vmix-commander/docs/firebase-schema.md` | Data contract between the apps |
| `vmix-commander/README.md` | Commander feature reference |
