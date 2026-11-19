# Box Cricket 3D — Hosted Android TV Wrapper APK

Ye folder ek complete **Android TV Native WebView Wrapper APK** project hai jo aapke hosted Box Cricket 3D game ko **bina mouse cursor ke**, true fullscreen Android TV app ki tarah chalata hai.

### Features Included
- **Android TV Home Screen Icon & Banner (`LEANBACK_LAUNCHER`)** — TV ke main Apps row me directly dikhega.
- **Zero Virtual Mouse Cursor** — TV remote ke `▲ ▼ ◀ ▶`, `OK / Enter`, aur `Back` buttons natively game me forward hote hain.
- **Double-Back to Exit** — Match ke dauran `Back` dabane par Pause Menu khulega, Setup me pichli screen aayegi, aur Main Menu par 2 baar `Back` dabane par app close hoga.
- **Auto-Updates** — Hosted URL par game update hote hi TV app automatically latest version load karega.
- **Phone QR Controller + Online 1v1 + Cloud Commentary** sab 100% kaam karenge.

---

## APK Kaise Banayein? (3 Aasaan Tareeke)

### Tareeka 1: GitHub Actions (⭐ Zero PC Software / Free Cloud Build)
1. Google AI Studio se **GitHub Sync** karke repo push karein (commit message zaroor likhein).
2. Apni GitHub repository me **Actions** tab kholein → **New workflow** → **set up a workflow yourself** click karein.
3. File ka naam `.github/workflows/build-android-tv-apk.yml` rakhein aur `android-tv-apk/github-workflow-build-apk.yml` ka code paste karke **Commit changes** kar dein.
4. Ab **Actions** → **Build Android TV APK** → **Run workflow** dabayein (chahein toh apna custom hosted URL daal sakte hain).
5. ~2 minute baad **Artifacts** section se **`BoxCricket3D-AndroidTV-APK`** download karein — uske andar `BoxCricket3D-AndroidTV.apk` hoga!

### Tareeka 2: PWABuilder.com (2 Minute Online TWA APK)
1. Apna app live deploy karein (Manifest `/manifest.webmanifest`, Service Worker `/sw.js`, aur PNG icons already ready hain).
2. [https://www.pwabuilder.com](https://www.pwabuilder.com) par apna live URL paste karein → **Package For Stores → Android → Download**.

### Tareeka 3: Android Studio (Local PC Build)
1. Android Studio me `android-tv-apk/` folder open karein.
2. **Build → Build Bundle(s) / APK(s) → Build APK(s)** click karein (ya terminal me `gradle assembleRelease`).
3. Output file: `android-tv-apk/app/build/outputs/apk/release/app-release.apk`.

---

## Android TV par `.apk` Kaise Install Karein?
1. Android TV par Play Store se **Send Files to TV** (ya pen drive + File Manager) install karein.
2. Phone se `BoxCricket3D-AndroidTV.apk` TV par bhejein.
3. TV Settings → **Apps → Security / Install unknown apps** me file manager ko Allow karein.
4. `BoxCricket3D-AndroidTV.apk` par `OK` dabakar **Install** kar lein — aur Android TV Home Screen se launch karein!
