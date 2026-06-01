/* Border Path — Game Logic
 *
 * Rendering: pure button-card UI (no tile map, no GeoJSON).
 * Same-component guarantee: connected components are computed once at boot
 * via BFS over the neighbours arrays. pickPair() draws start and target
 * exclusively from within a single randomly-chosen component, then verifies
 * BFS distance ≥ 3 before accepting the pair.
 */

// ─── State ────────────────────────────────────────────────────────────────────

let allCountries   = [];
let countryMap     = {};      // name → country object
let components     = [];      // array of arrays of country names (one per component)

let startCountry   = null;
let targetCountry  = null;
let currentCountry = null;
let playerPath     = [];      // names of visited countries in order
let par            = 0;       // BFS shortest-path distance for this puzzle
let gameActive     = false;

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
  allCountries = await GeoUtils.loadCountries();
  countryMap   = Object.fromEntries(allCountries.map(c => [c.name, c]));
  components   = buildComponents();
  updateBestDisplay();

  // Event delegation — one listener handles all neighbour button clicks
  document.getElementById('neighbors-grid').addEventListener('click', e => {
    const btn = e.target.closest('.neighbor-btn');
    if (btn) moveToCountry(btn.dataset.name);
  });

  startGame();
}

// ─── Graph helpers ────────────────────────────────────────────────────────────

/**
 * BFS over the neighbour graph. Returns the shortest path as an array of names,
 * or null if no path exists (different components).
 */
function bfs(fromName, toName) {
  if (fromName === toName) return [fromName];
  const visited = new Set([fromName]);
  const queue   = [[fromName]];

  while (queue.length) {
    const p    = queue.shift();
    const curr = p[p.length - 1];
    for (const nb of (countryMap[curr]?.neighbors ?? [])) {
      if (!countryMap[nb] || visited.has(nb)) continue;
      const np = [...p, nb];
      if (nb === toName) return np;
      visited.add(nb);
      queue.push(np);
    }
  }
  return null;
}

/**
 * Find all connected components via BFS.
 * Countries with no neighbours (islands) are skipped — they form trivial
 * size-1 "components" that are useless as puzzle endpoints.
 */
function buildComponents() {
  const visited = new Set();
  const result  = [];

  for (const c of allCountries) {
    if (!c.neighbors.length || visited.has(c.name)) continue;

    const comp = [];
    const q    = [c.name];
    visited.add(c.name);

    while (q.length) {
      const name = q.shift();
      comp.push(name);
      for (const nb of (countryMap[name]?.neighbors ?? [])) {
        if (countryMap[nb] && !visited.has(nb)) {
          visited.add(nb);
          q.push(nb);
        }
      }
    }

    result.push(comp);
  }

  return result;
}

/**
 * Pick a valid (start, target) pair that:
 *   1. Both belong to the same connected component (guaranteed by drawing from
 *      within one component — never picking across components).
 *   2. BFS distance ≥ 3 (interesting path length).
 *   3. The component has ≥ 8 members (large enough to have such pairs).
 *
 * Components are weighted by size so the large Afro-Eurasia landmass is more
 * likely than the smaller Americas component, proportionally to their country
 * counts.
 */
function pickPair() {
  const large = components.filter(c => c.length >= 8);
  if (!large.length) return null;

  // Weighted random selection — larger component = more likely
  const total = large.reduce((s, c) => s + c.length, 0);
  let r       = Math.random() * total;
  let chosen  = large[0];
  for (const comp of large) {
    r -= comp.length;
    if (r <= 0) { chosen = comp; break; }
  }

  // Within the chosen component, find a pair with distance ≥ 3
  for (let attempt = 0; attempt < 400; attempt++) {
    const fromName = chosen[Math.floor(Math.random() * chosen.length)];
    const toName   = chosen[Math.floor(Math.random() * chosen.length)];
    if (fromName === toName) continue;

    const optPath = bfs(fromName, toName);
    // optPath is guaranteed non-null — both are in the same component
    if (optPath && optPath.length - 1 >= 3) {
      return {
        from: countryMap[fromName],
        to:   countryMap[toName],
        par:  optPath.length - 1,
      };
    }
  }

  return null; // unreachable for any component of ≥ 8 well-connected countries
}

// ─── Game lifecycle ───────────────────────────────────────────────────────────

function startGame() {
  const pair = pickPair();
  if (!pair) {
    console.error('Border Path: could not find a valid puzzle pair.');
    return;
  }

  startCountry   = pair.from;
  targetCountry  = pair.to;
  currentCountry = pair.from;
  playerPath     = [pair.from.name];
  par            = pair.par;
  gameActive     = true;

  document.getElementById('game-over').style.display  = 'none';
  document.getElementById('game-area').style.display  = '';
  document.getElementById('current-panel').classList.remove('arrived');

  renderGameState();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderGameState() {
  document.getElementById('steps-count').textContent = playerPath.length - 1;
  document.getElementById('par-count').textContent   = par;

  // Target banner
  document.getElementById('target-flag').innerHTML = GeoUtils.flagImg(targetCountry.flag, targetCountry.name);
  document.getElementById('target-name').textContent = targetCountry.name;

  // Current country card
  document.getElementById('current-flag').innerHTML = GeoUtils.flagImg(currentCountry.flag, currentCountry.name);
  document.getElementById('current-name').textContent = currentCountry.name;

  renderNeighbours();
  renderRouteChain();
}

function renderNeighbours() {
  const grid      = document.getElementById('neighbors-grid');
  const neighbours = currentCountry.neighbors.filter(n => countryMap[n]);

  grid.innerHTML = neighbours.map(name => {
    const c         = countryMap[name];
    const isTarget  = name === targetCountry.name;
    const isVisited = playerPath.includes(name) && name !== currentCountry.name;

    let cls = 'neighbor-btn';
    if (isTarget)       cls += ' nb-target';
    else if (isVisited) cls += ' nb-visited';

    return `
      <button class="${cls}" data-name="${name}" title="${name}">
        <span class="nb-flag">${GeoUtils.flagImg(c.flag, c.name)}</span>
        <span class="nb-name">${name}</span>
      </button>`;
  }).join('');
}

function renderRouteChain() {
  const bar = document.getElementById('route-chain');

  bar.innerHTML = playerPath.map((name, i) => {
    const c      = countryMap[name];
    const isLast = i === playerPath.length - 1;
    const step   = `<span class="chain-step ${isLast ? 'chain-current' : ''}">${GeoUtils.flagEmoji(c.flag)} ${name}</span>`;
    return i > 0 ? `<span class="chain-arrow">→</span>${step}` : step;
  }).join('');

  // Keep the most recent entry visible
  bar.scrollLeft = bar.scrollWidth;
}

// ─── Move logic ───────────────────────────────────────────────────────────────

function moveToCountry(name) {
  if (!gameActive) return;

  // Hard-validate against the adjacency graph (belt-and-suspenders)
  if (!currentCountry.neighbors.includes(name)) return;

  currentCountry = countryMap[name];
  playerPath.push(name);

  if (name === targetCountry.name) {
    gameActive = false;
    document.getElementById('current-panel').classList.add('arrived');
    renderGameState();
    endGame();
  } else {
    renderGameState();
  }
}

// ─── End game ─────────────────────────────────────────────────────────────────

function endGame() {
  const steps = playerPath.length - 1;
  const diff  = steps - par;

  document.getElementById('game-area').style.display  = 'none';
  document.getElementById('game-over').style.display  = '';

  // Headline
  let label = 'PATH COMPLETE!';
  if (diff === 0) label = '🎯 PERFECT ROUTE!';
  document.getElementById('result-label').textContent = label;

  // Score
  document.getElementById('final-steps').textContent = `${steps} step${steps !== 1 ? 's' : ''}`;
  document.getElementById('final-par').textContent   = par;

  // Verdict
  const verdictEl = document.getElementById('final-verdict');
  if (diff === 0)      verdictEl.textContent = 'Optimal path — well done!';
  else if (diff === 1) verdictEl.textContent = '+1 step over par';
  else                 verdictEl.textContent = `+${diff} steps over par`;

  // Route replay
  document.getElementById('final-route').innerHTML = playerPath.map((name, i) => {
    const c = countryMap[name];
    return (i > 0 ? '<span class="final-arrow">→</span>' : '') +
           `<span class="final-step">${GeoUtils.flagEmoji(c.flag)} ${name}</span>`;
  }).join('');

  // Persist best (lower diff = better)
  const isNew = saveBest(diff);
  updateBestDisplay();

  if (isNew && diff === 0) {
    document.getElementById('result-label').textContent = '🎯 PERFECT ROUTE!';
  } else if (isNew) {
    document.getElementById('result-label').textContent = '🏆 NEW BEST!';
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function saveBest(diff) {
  const key  = 'geo_bp_best';
  const prev = localStorage.getItem(key);
  if (prev === null || diff < parseInt(prev, 10)) {
    localStorage.setItem(key, String(diff));
    return true;
  }
  return false;
}

function updateBestDisplay() {
  const raw = localStorage.getItem('geo_bp_best');
  const el  = document.getElementById('best-score');
  if (raw === null)   el.textContent = '—';
  else if (raw === '0') el.textContent = '🎯';
  else               el.textContent = `+${raw}`;
}

// ─── Share ────────────────────────────────────────────────────────────────────

function shareScore() {
  const steps  = playerPath.length - 1;
  const diff   = steps - par;
  const emoji  = playerPath.map(n => GeoUtils.flagEmoji(countryMap[n].flag)).join('→');
  const rating = diff === 0 ? `${steps}/${par} 🎯` : `${steps}/${par} (+${diff})`;
  GeoUtils.share('Border Path', rating, `\n${emoji}`);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
