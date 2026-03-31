# GeoGames — Geography Quiz Site

A collection of quick-play geography quiz games built with vanilla HTML/CSS/JS.

## Project Structure

```
geo-games/
├── index.html              ← Hub page (game selection grid)
├── css/global.css           ← Shared styles, colors, typography
├── js/shared.js             ← Shared utilities (GeoUtils object)
├── data/countries.json      ← Master dataset (60+ countries)
├── games/
│   ├── higher-lower/        ← Population higher/lower (working example)
│   │   ├── index.html
│   │   ├── style.css
│   │   └── game.js
│   ├── flag-quiz/           ← (placeholder — build next)
│   │   └── ...
│   └── map-click/           ← (placeholder — build next)
│       └── ...
└── assets/
    └── images/
```

## How to Run Locally

Any local dev server works. For example:

```bash
cd geo-games
npx serve .
# or
python3 -m http.server 8000
```

Then open `http://localhost:3000` (or `:8000`).

## How to Deploy

1. Create a GitHub repo and push this folder
2. Connect it to **Vercel** or **Netlify** (free tier)
3. Every push auto-deploys

## Adding a New Game

1. Create a folder: `games/my-new-game/`
2. Add three files:
   - `index.html` — game page (copy the header/structure from higher-lower)
   - `style.css` — game-specific styles
   - `game.js` — game logic (use `GeoUtils` from shared.js)
3. Add a game card to `index.html` (the hub page)

## Shared Utilities (GeoUtils)

Available in every game page via `shared.js`:

- `GeoUtils.loadCountries()` — loads the master dataset
- `GeoUtils.shuffle(arr)` — Fisher-Yates shuffle
- `GeoUtils.pickRandom(arr, n)` — pick n random items
- `GeoUtils.formatNumber(num)` — "1,234,567" formatting
- `GeoUtils.distanceKm(lat1, lng1, lat2, lng2)` — Haversine distance
- `GeoUtils.flagEmoji(code)` — "nl" → 🇳🇱
- `GeoUtils.showFlash(correct)` — screen flash for correct/wrong
- `GeoUtils.share(gameName, score)` — share score via Web Share API
- `GeoUtils.getHighScore(key)` / `setHighScore(key, score)` — localStorage
- `GeoUtils.startTimer(seconds, onTick, onEnd)` — countdown timer

## Master Dataset (countries.json)

Each country has: name, capital, population, area, continent, flag (2-letter code),
lat/lng (of capital), and gdp_per_capita. All games pull from this single file.

To expand: add more countries to `data/countries.json`. All games automatically
pick up the new data.

## Tips for Working with Claude Code in VS Code

When asking Claude to build a new game, give it context like:

> "Create a new flag quiz game in games/flag-quiz/. Look at
> games/higher-lower/ for the structure. Use GeoUtils from js/shared.js
> for loading data and shared functions. Follow the styling from css/global.css."

This way Claude knows the project conventions and won't reinvent the wheel.
