BOX CRICKET 3D - WAVEDASH UPLOAD PACKAGE

Upload
1. Open your Wavedash Developer Portal and select your game.
2. Open Builds -> Upload new build.
3. Upload this ZIP as-is. Do not wrap it inside another folder.
4. Wait for processing, then click Publish on the new build.
5. Open the published game in a fresh tab and test the menu and a match.

What was prepared
- Added the Wavedash load-progress and init handshake so the platform loading screen can dismiss after the game starts.
- Changed Three.js import-map URLs to a pinned Three.js 0.170.0 CDN path because the original ZIP did not include node_modules.
- Updated optional Draco/Basis decoder paths to the same pinned CDN.
- Prevented endless attempts to connect to this project's custom /ws server when running on Wavedash's static host.
- Added a visible startup error panel so a fatal startup exception is easier to diagnose.

Middled-style redesign (visual only, gameplay untouched)
- src/middled_look.js: dusk sky dome with stars, bold mowing-stripe outfield, tiered stadium bowl with ~10k animated fans,
  camera-flash twinkles, glowing roof lights, warm broadcast lighting and bloom grade. Applies to all 3 stadiums, day and night.
- src/middled_menu.js + middled_menu.css: new main menu (Quick Match, T20, Match Setup, Venue picker, Controls). Press Enter to play.
  The old Pre-Match Scenario Hub is still there under "Match Setup" and "T20 Match".
- fonts/: Barlow Condensed is bundled locally, so the menu looks right even if Google Fonts is blocked.
- Crowd density follows the graphics preset (Low 35%, Medium 70%, High 100%).

Important limitations
- This package loads Three.js modules from cdn.jsdelivr.net, so the player browser needs access to that CDN.
- Wavedash static hosting does not run this project's server.ts/server.py WebSocket relay. Therefore remote phone-controller pairing and online multiplayer are not enabled in this upload. Use the on-screen controls. To enable phone controllers, deploy the custom WebSocket relay separately and configure the game to connect to that backend.
- Google Fonts are optional; if the host blocks them, system fallback fonts will be used.
- This package was statically inspected and syntax-checked. It was not live-tested inside your Wavedash account, because that requires your account and a published build.

If it still hangs
- Open browser DevTools -> Console.
- Share the first red error, not just later follow-up errors.
