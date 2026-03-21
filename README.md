# Setup Tracker

A real-time shared checklist for AV/video production crews at live events.  
Built for e3webcasting · KubeCon EU 2026 · RAI Amsterdam

**Live app:** https://iamdjem.github.io/kubecon-tracker/  
**Firebase DB:** https://kubecon-tracker-default-rtdb.europe-west1.firebasedatabase.app

---

## How it works

Everyone on the crew opens the same URL on their phone. All checkbox taps sync instantly to every other device via Firebase Realtime Database — no refresh, no login, no app install needed.

---

## Crew — Daily Use

1. Open https://iamdjem.github.io/kubecon-tracker/ on your phone
2. Tap your name in the **Filter** bar to show only your rooms
3. Tap each step icon on a room row to mark it done
4. Tap your name again (or "Show all") to go back to the full list

That's it. Your changes appear on everyone else's screen within ~1 second.

---

## Admin — Setting Up for a New Event

Open the app → tap the **⚙️ gear icon** (top right of the header).

### Conference
- Change the event name and location/date shown in the header

### Steps
- Rename any step (e.g. "PTZ" → "Camera Check")
- Change the emoji icon for any step
- Add new steps with **Add step**
- Remove steps with the trash icon
- **Drag the ⠿ handle** to reorder steps

### Crew & Rooms
- Tap a crew member row to **expand** their rooms
- Edit crew names and room names inline — just tap and type
- **Add room** button at the bottom of each crew's list
- **Trash icon** to delete a crew member or room
- **Drag the ⠿ handle** to reorder crew members or rooms within a crew

### Save & Apply
Tap **Save & Apply** at the bottom of Settings. This:
- Saves config to the device
- Pushes the new config to Firebase — everyone's app updates immediately

### Reset all progress
On the main screen, tap **Reset all** (top right, below the filter bar). Requires confirmation. Use this at the start of a new event day or new venue.

---

## Firebase — Live Sync

The app uses [Firebase Realtime Database](https://firebase.google.com) (free tier) for live sync.

### Free tier limits
- 1 GB storage, 10 GB/month transfer
- This app uses ~1 KB total — well within free tier forever

### Test mode expiry
The database was created in **test mode** which expires **April 20, 2026**.  
To extend or make permanent:
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Select the `kubecon-tracker` project
3. Build → Realtime Database → **Rules** tab
4. Change the rules to:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
5. Click **Publish**

### Setting up a new database (new event/organisation)
1. Create a new Firebase project at console.firebase.google.com
2. Build → Realtime Database → Create Database → Start in test mode
3. Copy the database URL (e.g. `https://your-project-default-rtdb.region.firebasedatabase.app`)
4. In the app: ⚙️ Settings → Live Sync → paste the new URL → Save & Apply

---

## Tech Stack

- Pure HTML/CSS/JS — no framework, no build step
- [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) font
- [SortableJS](https://sortablejs.github.io/Sortable/) for drag-and-drop
- [Firebase Realtime Database](https://firebase.google.com/docs/database) for live sync
- Hosted on [GitHub Pages](https://pages.github.com) — free, no server

## Repository

https://github.com/iamdjem/kubecon-tracker

To update the app, edit `index.html` and push to the `main` branch.  
GitHub Pages deploys automatically within ~60 seconds.

---

*Built by Neo · March 2026*
