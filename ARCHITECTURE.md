# E3 Tracker — Architecture & Feature Reference

Single-file HTML SPA for tracking conference setup progress across multiple events, devices, and days. Backed by Firebase Realtime Database for cross-device sync.

---

## 1. What the App Does (User Perspective)

E3 Tracker is a mobile-first checklist app for tracking technical setup at events. It lets a small crew (video/AV team) track which rooms have been set up, recorded, uploaded, etc. — per day, per event.

### Core Concepts

- **Event** — A conference or job (e.g. "KubeCon EU 2026", "OpenSearchCon Prague"). Each event has its own crews, rooms, days, and checklist steps.
- **Day** — A single day of the event (e.g. "Mon 23", "Tue 24"). Progress is tracked per day per room.
- **Crew** — A person or group responsible for a set of rooms (e.g. "Alex", "Clayton").
- **Room** — A physical space being tracked (e.g. "Hall 7A", "Auditorium").
- **Step** — A checklist item for every room (e.g. "Setup", "PTZ", "Tested").

### Pages (Bottom Nav)

| Tab | Purpose |
|-----|---------|
| **Setup** | Main checklist — tap each step box to mark done. Per-day, per-room, per-step checkboxes. |
| **Overview** | Grid view of all rooms × steps across all days. Quick scan of what's done. |
| **Schedule** | Embedded iframe of a conference schedule (sched.com, etc). URL configured in Settings. |
| **Share** | Builds a WhatsApp-friendly status text and copies it to clipboard. |
| **Settings** | Event management, event config (crew/rooms/days/steps), Firebase URL, schedule embed URL, export/print. |

### Event Lifecycle

1. **Empty state** — Fresh install shows "No events yet" with a "Create your first event" button.
2. **Create** — Click `+` in the Setup-page event bar or "Add event" in Settings. Modal asks for name (+ optional venue/dates). Creates an empty event with 0 crews/rooms/days/steps.
3. **Configure** — Open Settings and add crews, rooms, days, and steps for this specific event. All fields auto-save on blur.
4. **Switch** — Tap an event chip on the Setup page to switch active event. Each device independently chooses which event to view (switching on phone doesn't affect laptop).
5. **Archive** — Archive an event in Settings to hide it from the Setup page switcher without deleting the data. Archived events stay editable and can be restored.
6. **Duplicate** — Copy an existing event's structure (and optionally its state) to a new event.
7. **Delete** — Removes the event from localStorage and Firebase. Persistent across devices via a `deletedEvents` Firebase list.

### Progress Tracking

- Each room has N checkboxes (one per step).
- Each day is a separate set of checkboxes — progress on Mon 23 is independent from Tue 24.
- **Filter by crew** — Tap a crew chip to filter rooms.
- **Copy from prev / Fill from prev** — Copy structure (reset) or actual progress from the previous day.
- **Reset** — Zero out all progress for the current day.

### Cross-Device Sync

- Event **data** (config + state) syncs in real-time between all devices via Firebase.
- **Which event you're viewing** is per-device — switching events on one device doesn't affect the others.
- **Deletions** propagate through a shared `deletedEvents` Firebase list so deleted events don't come back when another device reconnects.

### Export

- **Download / Copy / Print** a plain-text status summary of the current event.
- **Download / Copy** the full event as JSON (for backup or migration).

---

## 2. Technical Architecture

### Single File, No Build Step

- **`index.html`** — the entire app: HTML, CSS, JavaScript, default config. ~3800 lines.
- **No frameworks** — vanilla JS, direct DOM manipulation, template literals for HTML.
- **No build/bundler** — deploys as-is to GitHub Pages.
- External CDN: `sortablejs` for drag-and-drop, Firebase compat SDKs loaded lazily.

### Data Model

```javascript
appData = {
  currentEventId: 'ev_1776028...',
  events: {
    'ev_1776028...': {
      id: 'ev_1776028...',
      name: 'KubeCon EU 2026',
      location: 'Amsterdam',      // metadata only
      dateLabel: 'Mar 2026',       // metadata only
      archived: false,
      archivedAt: null,
      createdAt: 1776028000000,
      updatedAt: 1776028123456,
      config: {
        title: '',                 // legacy, unused for display
        subtitle: '',              // legacy, unused for display
        firebaseUrl: 'https://...',
        scheduleEmbedUrl: 'https://...',
        crew: [
          { id: 'c_1', name: 'Alex', rooms: [{id:'r_1', name:'E103-105'}, ...] },
          ...
        ],
        steps: [{ key: 's_1', icon: '🔧', label: 'Setup' }, ...],
        days: [{ key: 'd_mar23', label: 'Sun 23' }, ...],
        schedSteps: [...]          // per-session schedule checklist
      },
      state: {
        'd_mar23_r_1': { 's_1': 1, 's_2': 0, ... },   // per day+room+step
        ...
      }
    }
  }
}
```

### Storage Layers

| Layer | Keys | Purpose |
|-------|------|---------|
| **localStorage** | `kc_app` | Main store: `appData` (events, currentEventId) |
| | `kc_deleted_events` | List of event IDs deleted on this device |
| | `kc_day` | Last-viewed day (per device) |
| | `kc_page` | Last-viewed page (per device) |
| | `kc_evid_migrated` | Marker for one-time `ev_default` → unique ID migration |
| | `kc_vmix_ips` | vMix room IPs (per device) |
| **Firebase Realtime DB** | `events/<id>` | Per-event data, merged with `update()` |
| | `deletedEvents/<id>` | Tombstones so deletions sync across devices |
| | `config` / `state` | Legacy top-level pointers to current event's config/state (mirrored for backwards compat) |
| | `currentEventId` | **Intentionally not synced** — each device picks its own |
| | `vmix_ips` | vMix room IPs shared across devices |

Firebase DB path: `e3-kc26-x7k9m` (top-level namespace).

### Key Module-Level Variables

```javascript
let appData = loadAppData();           // { currentEventId, events }
let currentEventId = ...;              // which event is active on THIS device
let config = null;                     // shortcut to currentEvent().config
let state = null;                      // shortcut to currentEvent().state
let currentDay = ...;                  // which day tab is active
let filter = null;                     // crew filter on Setup page
let fbDb = null;                       // Firebase ref
let fbAuth = null;
let _fbPushing = false;                // suppress listener echo (partial)
```

**Critical invariant**: `config === currentEvent().config` (same object reference). When this breaks, settings mutations are lost. Any function that reassigns `currentEvent().config` must also update the module-level `config` variable (via `syncActiveEvent()`).

### Firebase Sync Flow

#### Init sequence (on page load)

```
1. loadAppData() reads localStorage → appData (may be empty)
2. syncActiveEvent() — sets config/state refs or empty skeleton
3. render() — shows content or "No events yet" prompt
4. initFirebase() loads Firebase SDK, signs in anonymously
5. once('events') + once('deletedEvents') — batch read
6. Merge remote deletedEvents into local set
7. Purge any local events in the deleted set
8. Import remote events (preferring newer updatedAt)
9. syncActiveEvent + saveAppData + render
10. pushEventData() — push local state back to Firebase
    (filtered to skip deleted IDs)
11. Set up on('value') listeners for live updates
```

#### Live updates

- `events` listener: merges remote events, skipping deleted IDs. Local-only events (not yet pushed) are preserved.
- `deletedEvents` listener: pulls new tombstones from remote, removes matching local events.

#### Conflict resolution

- **Per-event**: `updatedAt` timestamp wins. Newer timestamp overwrites older.
- **Deletions**: Always win over edits (tombstone in `deletedEvents`).
- **No OT or CRDT**: Simultaneous edits to the same event will stomp on each other (last write wins). Acceptable for a small-team use case.

### Save Flow

Every settings mutation calls `saveConfig()` immediately (no "Save & Apply" button):

```
User mutation (e.g. addCrew)
  ↓
config.crew.push(...)           // mutate in-place (ref to currentEvent().config)
  ↓
saveConfig()
  ↓
saveAppData() → localStorage    // persist locally
  ↓
pushEventData() → Firebase      // sync to remote
  ↓
render() / renderAll()          // update UI
```

Field edits (`renameCrew`, `updateStep`, `updateDay`) do NOT re-render the Settings sheet — only the Setup page — to avoid blurring the user's focused input.

Structural changes (`addCrew`, `deleteCrew`, `addRoom`, `deleteRoom`, `addStep`, `deleteStep`, `addDay`, `deleteDay`) DO re-render both via `renderAllIncludingSettings()`.

### Event ID Strategy

- Every event gets a **unique timestamp-based ID** (`ev_<timestamp>_<random>`).
- Legacy `ev_default` ID is migrated once on first load per device (tracked by `kc_evid_migrated`).
- Different devices never share an ID by accident, so they can't overwrite each other in Firebase.

### Delete Tracking

Simple delete had a race condition: device A deletes event X, device B (offline) still has X, comes online, pushes X back to Firebase, device A's listener sees X again.

Fix:
1. `addDeletedId()` writes to localStorage **and** `fbDb/deletedEvents/<id>`.
2. `pushEventData()` filters out any ID in the local deleted set before pushing.
3. `once('deletedEvents')` in init — merges remote tombstones into local before pushing anything.
4. `on('deletedEvents')` listener — catches new tombstones and removes matching local events.

### Render Strategy

- Full re-render on every state change (no virtual DOM).
- Setup page, Overview, Settings all have standalone `render*` functions.
- `renderAll()` — renders all non-settings pages.
- `renderAllIncludingSettings()` — also re-renders Settings sheet. Used after event lifecycle operations (create/delete/archive) but NOT after field edits.

### Empty State Handling

When `Object.keys(appData.events).length === 0`:

- `syncActiveEvent()` sets `config = { title:'', subtitle:'', crew:[], steps:[], days:[], schedSteps:[] }` and `state = {}`.
- `render()` shows a "No events yet" panel with a "Create your first event" button.
- `pushEventData()` skips the config/state push (avoids overwriting remote with empty data).
- No auto-event creation anywhere. Only explicit user action creates events.

### Files in the Repo

| File | Purpose |
|------|---------|
| `index.html` | The entire app. |
| `manifest.json` | PWA manifest (installable on mobile home screen). |
| `sw.js` | Service worker (basic caching). |
| `icon.svg` / `icon-192.png` / `icon-512.png` | App icons. |
| `README.md` | Brief repo intro. |
| `server.py` | Simple Python static server for local dev. |
| `ARCHITECTURE.md` | This file. |

### Deployment

- Hosted on **GitHub Pages** from the `main` branch of `iamdjem/kubecon-tracker`.
- URL: `https://iamdjem.github.io/kubecon-tracker/`
- Every `git push` auto-deploys (~30-60 seconds).
- No CI/build pipeline.

---

## 3. Firebase Configuration

- **Project**: `kubecon-tracker`
- **Database URL**: `https://kubecon-tracker-default-rtdb.europe-west1.firebasedatabase.app`
- **Web API Key**: embedded in `initFirebase()` (safe to commit — security is enforced by database rules)
- **Auth**: Anonymous sign-in required before any DB access.
- **Rules**: Reject unauthenticated reads/writes.

---

## 4. Known Limitations & Trade-offs

- **Single-file** — Hard to test, lint, or tree-shake. Acceptable for a ~3k-line tool.
- **Last-write-wins** — Two simultaneous editors can lose each other's changes within an event. No CRDT.
- **No undo** — Deletes are permanent (but tombstones could be replayed manually via Firebase console).
- **No offline queue** — Writes while offline only touch localStorage; they sync on next connect but may conflict with concurrent remote changes.
- **Per-device view state** — `currentEventId`, `currentDay`, `currentPage` are all per-device (by design, but means you can't "resume on another device").
- **iframe embeds** — Sites with `X-Frame-Options: DENY` (Linux Foundation, GitHub, Google, etc.) can't be embedded. A detection list + fallback "Open in new tab" button handles this.

---

## 5. Common Debugging Commands

Run in the browser console:

```javascript
// Inspect current state
JSON.stringify(Object.keys(appData.events));
JSON.stringify(currentEvent());

// Force a full resync from Firebase
fbCleanSync();

// Check the deleted events tombstones
[...getDeletedIds()];

// Nuke everything (use with caution)
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
