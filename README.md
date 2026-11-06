# Scorebug Manager

A locally-hosted scorebug for high school broadcasts. It runs a small server on
your machine; you control the game from one browser tab, and OBS displays a
live-updating overlay via a Browser Source. It works for football, basketball,
baseball/softball, soccer, and volleyball, with individual elements you can
toggle on or off (down & distance, shot clock, fouls, base runners, sets, etc).

## 1. Install (one-time)

You need [Node.js](https://nodejs.org) installed (v16 or newer).

Open a terminal in this folder and run:

```
npm install
```

## 2. Start it

```
npm start
```

You'll see something like:

```
Control panel : http://localhost:4173/control.html
OBS overlay   : http://localhost:4173/overlay.html
```

Leave this terminal window running during the broadcast — it's the local server
that keeps your control panel and OBS overlay in sync.

## 3. Open the control panel

Go to `http://localhost:4173/control.html` in your browser. This is where you:
- Pick the sport (this shows the right control panel and score buttons)
- Set team names, colors, and upload team + event logos
- Run the score, clock, period, possession, and sport-specific stats
- Turn individual scorebug elements on/off in "Scorebug elements"
- Hit "Bug: ON AIR" / "Bug: HIDDEN" to show or hide the whole graphic instantly

## 4. Add it to OBS

1. In OBS, click the **+** under Sources → **Browser Source**.
2. Paste in the overlay URL shown at the bottom of the control panel
   (`http://localhost:4173/overlay.html`).
3. Set width/height to roughly **1000 x 140** (it's a lower-third style bug —
   resize/reposition it in OBS however you like).
4. Leave "Shutdown source when not visible" **unchecked**, so it keeps
   receiving updates even when you're not on that scene.

Any change you make in the control panel appears in OBS within a fraction of
a second — no refreshing needed. The clock runs on each screen from the moment
you hit Start, so it stays smooth without a network update every second.

## Running it from a second computer (e.g. control panel on a laptop in the
booth, OBS on a machine in the truck)

Both machines need to be on the same local network (same WiFi/router). When
you run `npm start`, the terminal also prints a network address like
`http://192.168.1.23:4173/control.html` — use that address instead of
`localhost` on the other machine. Use the matching `overlay.html` address as
the OBS Browser Source URL in that case too.

## Notes

- The control panel keeps the game on this computer first, then syncs it to
  the overlay. Scores, names, and logos are written to `state.json` in this
  folder, and the browser also keeps a local copy. Closing the tab or
  restarting the server does not wipe the game. If a save file is ever
  damaged, the app restores the previous good copy instead of starting over.
- Hit Save to force a write immediately. Other changes save on their own.
- "Reset game" clears scores, clock, and in-game stats but keeps your team
  names, colors, and logos so you don't have to re-enter them between games.
- Team logos are stored as part of the game state — keep them reasonably
  sized (a few hundred KB) for the smoothest updates.
