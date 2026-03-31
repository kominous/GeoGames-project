/* Travel — Game Logic */

let allCountries = [];     // full dataset
let countryMap = {};       // name → country object
let startCountry = null;
let destCountry  = null;
let currentCountry = null;
let route = [];            // names visited so far (includes start)
let optimalLength = 0;     // number of steps in the shortest path (not counting start)
let gameOver = false;

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  allCountries = await GeoUtils.loadCountries();
  countryMap = Object.fromEntries(allCountries.map(c => [c.name, c]));
  updateBestDisplay();
  startGame();
}

// ─── BFS shortest path ───────────────────────────────────────────────────────

function bfs(fromName, toName) {
  if (fromName === toName) return [fromName];
  const visited = new Set([fromName]);
  const queue = [[fromName]];
  while (queue.length) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const country = countryMap[current];
    if (!country) continue;
    for (const neighbor of country.neighbors) {
      if (!countryMap[neighbor]) continue;   // skip if not in dataset
      if (visited.has(neighbor)) continue;
      const newPath = [...path, neighbor];
      if (neighbor === toName) return newPath;
      visited.add(neighbor);
      queue.push(newPath);
    }
  }
  return null; // unreachable
}

// ─── Pick a valid random pair ────────────────────────────────────────────────

function pickPair() {
  // Only countries that have at least one neighbor (connected to graph)
  const connected = allCountries.filter(c => c.neighbors.length > 0);

  let from, to, path;
  let tries = 0;
  do {
    from = GeoUtils.pickRandom(connected, 1)[0];
    to   = GeoUtils.pickRandom(connected, 1)[0];
    if (from.name === to.name) continue;
    path = bfs(from.name, to.name);
    tries++;
  } while ((!path || path.length < 3) && tries < 200);
  // Ensure at least 2 steps between them (path length ≥ 3 incl. start)

  return { from, to, path };
}

// ─── Start / restart ─────────────────────────────────────────────────────────

function startGame() {
  gameOver = false;
  const { from, to, path } = pickPair();

  startCountry   = from;
  destCountry    = to;
  currentCountry = from;
  route          = [from.name];
  optimalLength  = path.length - 1;  // steps = nodes - 1

  // UI
  document.getElementById('game-area').style.display = '';
  document.getElementById('game-over').style.display = 'none';
  document.getElementById('steps-taken').textContent = '0';
  document.getElementById('optimal-steps').textContent = optimalLength;

  // Endpoints
  document.getElementById('start-flag').innerHTML = GeoUtils.flagImg(from.flag, from.name);
  document.getElementById('start-name').textContent = from.name;
  document.getElementById('dest-flag').innerHTML   = GeoUtils.flagImg(to.flag, to.name);
  document.getElementById('dest-name').textContent = to.name;

  renderRoute();
  renderCurrent();
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderRoute() {
  const bar = document.getElementById('route-bar');
  bar.innerHTML = route.map((name, i) => {
    const c = countryMap[name];
    const isLast = i === route.length - 1;
    return `
      <span class="route-step ${isLast ? 'route-current' : ''}">
        ${GeoUtils.flagEmoji(c.flag)} ${name}
      </span>
      ${isLast ? '' : '<span class="route-arrow">→</span>'}
    `;
  }).join('');
}

function renderCurrent() {
  const c = currentCountry;
  document.getElementById('current-name').textContent = c.name;
  document.getElementById('current-flag').innerHTML   = GeoUtils.flagImg(c.flag, c.name);

  const grid = document.getElementById('neighbors-grid');
  grid.innerHTML = '';

  if (c.neighbors.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted)">No land neighbors — island nation.</p>';
    return;
  }

  for (const neighborName of c.neighbors) {
    const neighbor = countryMap[neighborName];
    if (!neighbor) continue;

    const btn = document.createElement('button');
    btn.className = 'neighbor-btn';
    if (neighborName === destCountry.name) btn.classList.add('neighbor-dest');
    if (route.includes(neighborName))      btn.classList.add('neighbor-visited');

    btn.innerHTML = `
      <span class="neighbor-flag">${GeoUtils.flagEmoji(neighbor.flag)}</span>
      <span class="neighbor-name">${neighborName}</span>
    `;
    btn.onclick = () => selectNeighbor(neighborName);
    grid.appendChild(btn);
  }
}

// ─── Player action ───────────────────────────────────────────────────────────

function selectNeighbor(name) {
  if (gameOver) return;

  currentCountry = countryMap[name];
  route.push(name);

  const stepsTaken = route.length - 1;
  document.getElementById('steps-taken').textContent = stepsTaken;

  renderRoute();

  if (name === destCountry.name) {
    endGame(true);
  } else {
    renderCurrent();
  }
}

// ─── End game ────────────────────────────────────────────────────────────────

function endGame(success) {
  gameOver = true;
  const stepsTaken  = route.length - 1;
  const extra       = stepsTaken - optimalLength;

  document.getElementById('game-area').style.display = 'none';
  document.getElementById('game-over').style.display = '';

  document.getElementById('result-steps').textContent =
    `${stepsTaken} step${stepsTaken !== 1 ? 's' : ''}`;

  let detail = `Optimal was ${optimalLength}.`;
  if (extra === 0) {
    detail += ' 🎯 Perfect route!';
  } else {
    detail += ` You took ${extra} extra step${extra !== 1 ? 's' : ''}.`;
  }
  document.getElementById('result-detail').textContent = detail;

  // Final route display
  document.getElementById('final-route').innerHTML = route.map((name, i) => {
    const c = countryMap[name];
    return `
      ${i > 0 ? '<span class="final-arrow">→</span>' : ''}
      <span class="final-step">${GeoUtils.flagEmoji(c.flag)} ${name}</span>
    `;
  }).join('');

  // High score: store the fewest extra steps ever (lower = better)
  // Encode as 999 - extra so getHighScore (higher = better) works correctly
  const scoreKey = 'travel';
  const encoded  = Math.max(0, 999 - extra);
  const isNew    = GeoUtils.setHighScore(scoreKey, encoded);
  updateBestDisplay();

  if (isNew && extra === 0) {
    document.getElementById('result-label').textContent = '🎯 PERFECT!';
  } else if (isNew) {
    document.getElementById('result-label').textContent = '🏆 NEW BEST!';
  } else {
    document.getElementById('result-label').textContent = 'ARRIVED!';
  }
}

function updateBestDisplay() {
  const encoded = GeoUtils.getHighScore('travel');
  if (encoded === 0) {
    document.getElementById('best').textContent = '—';
  } else {
    const bestExtra = 999 - encoded;
    document.getElementById('best').textContent =
      bestExtra === 0 ? 'Perfect' : `+${bestExtra}`;
  }
}

// ─── Share ───────────────────────────────────────────────────────────────────

function shareScore() {
  const stepsTaken = route.length - 1;
  const extra      = stepsTaken - optimalLength;
  const emoji      = route.map(n => GeoUtils.flagEmoji(countryMap[n].flag)).join('→');
  GeoUtils.share(
    'Travel',
    `${stepsTaken}/${optimalLength} steps`,
    `\n${emoji}`
  );
}

// Boot
init();
