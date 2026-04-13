# E3 Tracker

A mobile-first checklist app for tracking technical setup at live events (video/AV/streaming work). Multi-event, multi-device, real-time synced, with admin/user roles and per-day step filtering.

**Live URL**: https://iamdjem.github.io/kubecon-tracker/

---

## Table of contents

1. [Quick start](#quick-start)
2. [User guide](#user-guide)
3. [Admin guide](#admin-guide)
4. [Feature reference](#feature-reference)
5. [Technical architecture](#technical-architecture)
6. [Firebase setup](#firebase-setup)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)
9. [Known limitations](#known-limitations)

---

## Quick start

1. Open https://iamdjem.github.io/kubecon-tracker/
2. Sign in:
   - **Admin password**: `e3admin`
   - **User password**: `e3crew`
3. First time ever? You'll see "No events yet" — sign in as admin and click **"Create your first event"**
4. Fill in the event name (e.g. "KubeCon Amsterdam 2026") and optional venue / dates
5. Go to Settings and set up:
   - **Setup Steps** (e.g. Setup, PTZ, Keys, Tested)
   - **Conference Days** (e.g. Mon 23, Tue 24, ...)
   - **Crew & Rooms** (e.g. Alex → Hall 7A, Hall 7B, Hall 7C)
6. Go back to Setup page and start checking off boxes as crews make progress

---

## User guide

### Pages (bottom nav)

| Tab | Purpose |
|-----|---------|
| **Setup** | Main checklist — tap each step box to mark done. Per-day, per-room, per-step. |
| **Overview** | Grid view of all rooms × steps across all days. Quick scan. |
| **Schedule** | Embedded iframe of a conference schedule (sched.com, etc). |
| **Share** | Builds a WhatsApp-friendly status text and copies it to clipboard. |
| **Settings** | Events, config, account. See [Admin guide](#admin-guide) for admin sections. |

### Core concepts

- **Event** — A conference or job (e.g. "KubeCon EU 2026", "OpenSearchCon Prague"). Each event has its own crews, rooms, days, and checklist steps.
- **Day** — A single day of the event (e.g. "Mon 23", "Tue 24"). Progress is tracked per day per room.
- **Crew** — A person or group responsible for a set of rooms (e.g. "Alex", "Clayton").
- **Room** — A physical space being tracked (e.g. "Hall 7A", "Auditorium").
- **Step** — A checklist item for every room (e.g. "Setup", "PTZ", "Tested"). Steps can optionally be scoped to specific days.

### Sign in / sign out

- On first visit, a full-screen password prompt appears
- Type the password → **Enter** or **Sign in** button
- **Session persists forever** — you never get signed out automatically
- **Sign out**: Settings → Account → **Sign out** button (useful to switch between admin and user)
- **Forgot password**: there's no reset flow. Talk to whoever runs the tracker to get back in.

### Using the checklist (both roles)

- **Tap a step box** to toggle checked / unchecked
- **Switch days** by tapping a day tab at the top of Setup page
- **Filter by crew** by tapping a crew chip under FILTER
- **Reset** zeroes out all progress for the current day
- **Copy from prev** / **Fill from prev** pulls structure or checked state from the previous day into the current day
- Progress is saved immediately locally and synced to Firebase automatically

### Switching between events

- **Setup page** has a horizontal chip bar with all live (non-archived) events
- Tap any chip to switch — progress/config for that event loads instantly
- Each device independently chooses which event to view (switching on phone does not affect laptop)

### Sharing status

- **Share tab** builds a compact WhatsApp-friendly text summary and copies it
- **Settings → Export** has richer options: download / copy / print summary, or download / copy the full event as JSON

---

## Admin guide

### Roles at a glance

| Action | admin | user |
|--------|:-----:|:----:|
| View events | ✅ | ✅ |
| Toggle checkboxes (progress) | ✅ | ✅ |
| Switch between events | ✅ | ✅ |
| Export data | ✅ | ✅ |
| Sign out | ✅ | ✅ |
| Create / delete / duplicate / archive events | ✅ | ❌ |
| Rename events | ✅ | ❌ |
| Edit Setup Steps | ✅ | ❌ |
| Edit Conference Days | ✅ | ❌ |
| Edit Crew & Rooms | ✅ | ❌ |
| Change Schedule Embed URL | ✅ | ❌ |
| Change Firebase URL | ✅ | ❌ |
| View archived events | ✅ | ❌ |

### Creating an event

1. Settings → **Add event** button (or `+` on the Setup page chip bar, or empty-state **Create your first event** button)
2. Fill in name + optional venue / dates → **Create**
3. The new event starts completely empty (no crews, no rooms, no days, no steps) — you configure everything from scratch

### Configuring an event

All editors auto-save on every change — there is no "Save & Apply" button.

#### Setup Steps

- **Add step**: click `+ Add step`, type a label, pick an emoji icon
- **Reorder**: drag the handle on the left
- **Delete**: click trash icon
- **Per-day filtering**: under each step there's a **"Show on:"** row with day chips
  - **"All days"** (default, gold) → step shows on every day
  - Tap specific day chips → step only shows on those days
  - Example: `Setup` on all days, `Record` only on Tue-Fri, `Edit` only on Fri

#### Conference Days

- **Add day**: click `+ Add day`, type a label (e.g. "Mon 23")
- **Delete**: click ✕
- Labels are free-form. The app looks for `d_<month><day>` keys (e.g. `d_mar23`) to auto-select today's day when a tab matches the real date.

#### Crew & Rooms

- **Add crew member**: click `+ Add crew member`, type name
- Expand the crew to see its rooms (click the ▶ arrow)
- **Add room**: click `+ Add room` inside a crew
- **Reorder**: drag handles on crews and rooms
- Crews with 0 rooms render nothing on the Setup page — they need rooms to have checkboxes

#### Schedule Embed

- Paste any public schedule URL into Settings → Schedule Embed
- If it's a Linux Foundation event URL (which blocks iframes), the app auto-resolves it to the underlying `sched.com` URL via a CORS proxy
- On the Schedule tab, the embedded page shows. If the site blocks embedding, a fallback "Open in new tab" button appears

### Archiving and deleting events

- **Archive**: Settings → Live Events → click **Archive** on an event card. It moves to the **Archived Events** section at the bottom, hidden from the main switcher
- **Unarchive**: Settings → Archived Events → click **Unarchive**
- **Duplicate**: copies an event's entire configuration (optionally with checklist state) to a new event
- **Delete**: removes permanently. Deletions sync across devices via a shared `deletedEvents` Firebase list, so the event won't come back when another offline device reconnects

### Exporting

- **Summary**: plain text, human-readable, per-crew room status with pending step names
- **JSON**: full event snapshot with config + state, suitable for backup or migration
- **Print**: opens a new tab with styled HTML for browser printing / PDF

---

## Feature reference

### Per-day step filtering (Option A)

Each step has an optional `days` array:
- `step.days = []` (or undefined) → **all days** (default)
- `step.days = ['d_mar23', 'd_mar24']` → **only those days**

When switching day tabs on the Setup page, the app recomputes which steps apply and re-renders the checkbox columns. Room completion counts (`0/2`, `1/5`) use only the active steps for that day.

### Placeholder labels

Days / crews / rooms / steps with empty labels render as **Day 1, Crew 1, Room 1, Step 1, Event 1** etc. — so unnamed items are always visible, not invisible.

### Auto-resolve blocked schedule URLs

If you paste a schedule URL from a domain that sends `X-Frame-Options` or a restrictive `frame-ancestors` CSP (Linux Foundation, GitHub, Twitter, Facebook, Google):

1. App detects it's a blocked domain
2. Fetches the page via a CORS proxy (allorigins.win, codetabs.com)
3. Scans the response for any `<subdomain>.sched.com` link
4. Auto-replaces your URL with the resolved sched.com URL
5. Falls back to a manual "Open source page" link if auto-resolve fails

### `?reset=1` URL parameter

Visit `https://<url>/?reset=1` to wipe all local storage and reload with a clean state. Useful on mobile where there's no dev console.

### Localhost guard

If the app detects `location.hostname === 'localhost'` (or `127.0.0.1`, `file://`), **Firebase init is blocked** to prevent local dev sessions from polluting the production database. Set `window._fbAllowLocal = true` in the console to override.

### Empty state behavior

- Fresh install = no events shown, "No events yet" panel with `+ Create your first event` for admin
- Users see "Your admin hasn't created any events yet" instead
- No device ever auto-creates placeholder events — all events are explicit user action

### Deleted events sync

Each device tracks deleted event IDs in `localStorage.kc_deleted_events` and pushes them to Firebase at `/deletedEvents/<id>`. All devices subscribe to this list and remove matching events from their local data. Prevents offline devices from resurrecting deleted events when they reconnect.

---

## Technical architecture

### Stack

- **Single-file SPA** — the entire app lives in `index.html` (~3900 lines)
- **No frameworks** — vanilla JS, direct DOM manipulation, template literals for HTML
- **No build step** — deploys as-is to GitHub Pages
- **External libs**: `sortablejs` (drag-and-drop), Firebase compat SDKs (lazy-loaded)

### Data model

```javascript
appData = {
  currentEventId: 'ev_1776028...',
  events: {
    'ev_1776028...': {
      id: 'ev_1776028...',
      name: 'KubeCon EU 2026',
      location: 'Amsterdam',
      dateLabel: 'Mar 2026',
      archived: false,
      archivedAt: null,
      createdAt: 1776028000000,
      updatedAt: 1776028123456,
      config: {
        title: '',
        subtitle: '',
        firebaseUrl: 'https://...',
        scheduleEmbedUrl: 'https://...',
        crew: [
          { id: 'c_1', name: 'Alex', rooms: [{id:'r_1', name:'E103-105'}, ...] },
        ],
        steps: [
          { key: 's_1', icon: '🔧', label: 'Setup', days: [] },              // shows on all days
          { key: 's_2', icon: '⏺',  label: 'Record', days: ['d_tue24','d_wed25','d_thu26'] }
        ],
        days: [{ key: 'd_mar23', label: 'Sun 23' }, ...],
        schedSteps: []
      },
      state: {
        'd_mar23_r_1': { 's_1': 1, 's_2': 0 },   // per day+room+step
      }
    }
  }
}
```

### Storage layers

| Layer | Keys | Purpose |
|-------|------|---------|
| **localStorage** | `kc_app` | Main store: `appData` |
| | `kc_deleted_events` | List of event IDs this device knows were deleted |
| | `kc_day` | Last-viewed day (per device) |
| | `kc_page` | Last-viewed page (per device) |
| | `kc_evid_migrated` | One-time migration marker for legacy `ev_default` ID |
| | `kc_vmix_ips` | vMix room IPs (per device) |
| **Firebase Realtime DB** (`e3-kc26-x7k9m` namespace) | `events/<id>` | Per-event data, merged with `update()` |
| | `deletedEvents/<id>` | Tombstones for cross-device delete sync |
| | `config` / `state` | Legacy top-level pointers (mirrored for backwards compat) |
| | `vmix_ips` | vMix room IPs shared across devices |
| | `vmix_proxy_url` | vMix proxy URL |

**Intentionally not synced across devices**: `currentEventId`, `kc_day`, `kc_page` — each device independently chooses which event/day/page to view.

### Key module-level variables

```javascript
let appData = loadAppData();           // { currentEventId, events }
let currentEventId = ...;              // which event this device is viewing
let config = null;                     // reference to currentEvent().config
let state = null;                      // reference to currentEvent().state
let currentDay = ...;                  // which day tab is active
let filter = null;                     // crew filter on Setup page
let fbDb = null;                       // Firebase ref
let fbAuth = null;
let currentRole = null;                // 'admin' | 'user' | null
```

**Critical invariant**: `config === currentEvent().config` (same object reference). When this breaks, settings mutations get lost because saveAppData serializes the event's config, not the module-level variable. `syncEventConfigMetadata` no longer clones the config; normalization only happens in `loadAppData` and `syncActiveEvent`.

### Auth flow

1. **Page load**
   - Load Firebase SDK
   - Set LOCAL persistence (`firebase.auth.Auth.Persistence.LOCAL`)
   - Register `onAuthStateChanged` listener
2. **`onAuthStateChanged` callback**
   - User signed in? → determine role from email, set `body.role-admin` / `body.role-user`, hide sign-in, call `onAuthenticated()`
   - Not signed in? → clear role, show sign-in overlay
3. **`onAuthenticated`** → initial data sync from Firebase via `once('events')` + `once('deletedEvents')`, merge into local state, push local back to Firebase
4. **Sign in**
   - User types password → app tries `signInWithEmailAndPassword(ADMIN_EMAIL, password)`
   - If that fails → try `signInWithEmailAndPassword(USER_EMAIL, password)`
   - If both fail → show "Invalid password"
   - Firebase persists the session in IndexedDB / localStorage until explicit sign-out
5. **Sign out** → `fbAuth.signOut()` + `location.reload()`

### Firebase sync flow

**On connect (after auth)**:
1. Read `deletedEvents` once
2. Purge any local events whose ID is in the deleted set
3. Read `events` once, merge with local (prefer newer `updatedAt`)
4. Push merged local state back to Firebase (filtered to skip deleted IDs)

**Live updates**:
- `events.on('value')` — merges remote into local, respecting deleted IDs
- `deletedEvents.on('value')` — picks up new tombstones from other devices and removes matching local events
- `vmix_ips.on('value')` — per-device vMix config sync

**Conflict resolution**:
- **Per-event**: newer `updatedAt` wins. No OT/CRDT.
- **Deletions**: always win (tombstone in `deletedEvents`).
- **Simultaneous edits to same event**: last write wins. Acceptable for a small team.

### Save flow

Every settings mutation persists immediately — no "Save & Apply" button:

```
addCrew() / updateStep() / renameRoom() / etc.
  ↓
config.X.push(...) or config.X[i].field = value
  ↓
saveConfig()
  ↓
saveAppData() → localStorage
  ↓
pushEventData() → Firebase (filters deleted IDs)
  ↓
render() or renderAllIncludingSettings()
```

Field edits (`renameCrew`, `updateStep`, `updateDay`) call `render()` only — **not** `renderSettings()` — to avoid re-rendering the form while a user is typing in another input.

Structural changes (add / delete / reorder) call `renderAllIncludingSettings()` because the settings form itself needs to reflect the new structure.

### Role gating

- CSS class `.admin-only` is hidden by default
- `body.role-admin .admin-only { display: initial !important; }` shows them
- Variants: `.admin-only-block`, `.admin-only-flex` for layout-specific display

The gating is **client-side only**. A determined user could enable admin mode via DevTools. This is acceptable for an internal team tool — real protection is the password gate and the non-public URL.

### Render strategy

- Full re-render on every state change (no virtual DOM)
- `render()` — Setup page content
- `renderOverview()` — Overview grid
- `renderSettings()` — Settings sheet
- `renderAll()` — all non-settings pages
- `renderAllIncludingSettings()` — also re-renders Settings sheet (used after event lifecycle operations)

---

## Firebase setup

### Project config

- **Project**: `kubecon-tracker`
- **Database URL**: `https://kubecon-tracker-default-rtdb.europe-west1.firebasedatabase.app`
- **Database path**: `e3-kc26-x7k9m`
- **Web API key**: embedded in `index.html` (safe to commit — API keys are public identifiers)
- **Auth**: Email/password only

### Required accounts (create in Firebase Console → Authentication → Users)

| Email | Password | Role |
|-------|----------|------|
| `admin@e3tracker.local` | `e3admin` | admin |
| `user@e3tracker.local`  | `e3crew`  | user  |

⚠️ These passwords are hardcoded in `index.html` and visible in the client. They provide a defense-in-depth layer on top of the non-public URL, but a determined attacker with the URL could read the JavaScript and learn them.

### Database rules

Current rules (basic — protects from unauthenticated access):

```json
{
  "rules": {
    "e3-kc26-x7k9m": {
      ".read":  "auth != null",
      ".write": "auth != null"
    }
  }
}
```

Stricter version (only allows the two fixed accounts):

```json
{
  "rules": {
    "e3-kc26-x7k9m": {
      ".read":  "auth != null && (auth.token.email == 'admin@e3tracker.local' || auth.token.email == 'user@e3tracker.local')",
      ".write": "auth != null && (auth.token.email == 'admin@e3tracker.local' || auth.token.email == 'user@e3tracker.local')"
    }
  }
}
```

### Anonymous auth

**Disabled.** The app used to use anonymous auth; it has been removed. Only email/password accounts are accepted. Legacy anonymous sessions are auto-signed-out on page load.

---

## Deployment

### GitHub Pages

- Hosted from `main` branch of `iamdjem/kubecon-tracker`
- URL: `https://iamdjem.github.io/kubecon-tracker/`
- Every `git push` to `main` auto-deploys (~30–60 seconds)
- No CI / build pipeline — static files served as-is

### Files in the repo

| File | Purpose |
|------|---------|
| `index.html` | The entire app |
| `manifest.json` | PWA manifest (installable on mobile home screen) |
| `sw.js` | Service worker (basic caching) |
| `icon.svg` / `icon-192.png` / `icon-512.png` | App icons |
| `README.md` | Brief repo intro |
| `server.py` | Simple Python static server for local dev |
| `ARCHITECTURE.md` | This file |

### Local development

```bash
cd kubecon-tracker
python3 -m http.server 8765
# open http://localhost:8765
```

Firebase init is **blocked on localhost by default** to prevent local sessions from writing to the production DB. To override (careful):

```javascript
window._fbAllowLocal = true;
initFirebase('https://kubecon-tracker-default-rtdb.europe-west1.firebasedatabase.app');
```

---

## Troubleshooting

### Stale state on mobile (can't open DevTools)

Visit `https://<url>/?reset=1` — wipes all localStorage and reloads clean.

### Events from another device aren't showing up

Check Settings → Account → is the **Live Sync dot green** ("Connected")? If not, hit refresh. If the dot stays grey, check:
- Is the device online?
- Is Firebase down? (rare, check https://status.firebase.google.com)
- Is the Firebase URL correct in Settings → Live Sync (admin only)?

### "Invalid password" but I typed it correctly

- Make sure the two Firebase accounts exist in Firebase Console → Authentication → Users
- Check for typos (passwords are case-sensitive)
- If needed, open Firebase Console and reset the password for `admin@e3tracker.local` or `user@e3tracker.local`

### Deleted event keeps coming back

Another device has it locally and keeps pushing it back. Either:
1. Sign in on the other device and confirm the delete persists on both
2. Or run `fbCleanSync()` in the browser console on an admin device — this removes any remote event that's not in the local set

### Schedule embed URL shows "This site blocks embedding"

The site has `X-Frame-Options: DENY` or a restrictive CSP. Most Linux Foundation events auto-resolve to `sched.com`. If not:
- Click "Open source page" to open the URL in a new tab
- Find a `.sched.com` link on that page
- Copy it and paste it into Settings → Schedule Embed

### Completely broken state

Nuke everything via browser console (admin only):

```javascript
(async () => {
  if (fbDb) {
    await fbDb.child('events').remove();
    await fbDb.child('deletedEvents').remove();
    await fbDb.child('config').remove();
    await fbDb.child('state').remove();
  }
  localStorage.clear();
  location.reload();
})();
```

---

## Known limitations

- **Client-side role gating** — A technical user can enable admin mode via DevTools. Real protection would require server-side enforcement or stricter Firebase rules based on `auth.token.email`.
- **Hardcoded passwords** — Visible in the JavaScript source. Rotate by editing `index.html` and updating Firebase Console accounts.
- **No password reset** — Fake `.local` emails can't receive reset links. Rotate via Firebase Console.
- **Last-write-wins** — Two simultaneous edits to the same event can stomp on each other. No OT or CRDT. Acceptable for a small team where people usually work on different events.
- **No undo for deletes** — Deleted events are permanent (tombstoned in Firebase).
- **Per-device view state** — `currentEventId`, current day, current page are all per-device by design.
- **iframe embeds** — Sites with `X-Frame-Options: DENY` (GitHub, Google, Facebook, etc.) can't be embedded. Auto-resolve handles most Linux Foundation events.
- **Offline writes** — Firebase realtime DB has offline support, but if two devices edit simultaneously offline and both reconnect, the one that pushes later wins.

---

## Common debugging commands

Run in the browser console:

```javascript
// Inspect current state
JSON.stringify(Object.keys(appData.events));
JSON.stringify(currentEvent());
console.log({ role: currentRole, isAdmin: isAdmin() });

// Force a full resync from Firebase
fbCleanSync();

// Check deleted events tombstones
[...getDeletedIds()];

// Manually sign out
signOut();

// Inspect Firebase connection status
console.log(fbDb ? 'connected' : 'disconnected');
```

---

**Last updated**: 2026-04-13
