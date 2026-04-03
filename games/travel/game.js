/* Travel — Game Logic */

// ─── Map state ───────────────────────────────────────────────────────────────

let map         = null;
let geoLayer    = null;
let routeLine   = null;
let layerByName = {};   // ourName → Leaflet feature layer

// Natural Earth short name → our countryMap key (where they differ)
const NE_NAME_MAP = {
  'United States of America':             'United States',
  'Dem. Rep. Congo':                      'DR Congo',
  'Democratic Republic of the Congo':     'DR Congo',
  "Côte d'Ivoire":                        'Ivory Coast',
  'Czech Rep.':                           'Czech Republic',
  'Czechia':                              'Czech Republic',
  'Bosnia and Herz.':                     'Bosnia and Herzegovina',
  'Eq. Guinea':                           'Equatorial Guinea',
  'Central African Rep.':                 'Central African Republic',
  'S. Sudan':                             'South Sudan',
  'Dem. Rep. Korea':                      'North Korea',
  'Republic of Korea':                    'South Korea',
  'Vatican':                              'Vatican City',
  'Holy See':                             'Vatican City',
  'Holy See (Vatican City State)':        'Vatican City',
  'Swaziland':                            'Eswatini',
  'Macedonia':                            'North Macedonia',
  'FYROM':                                'North Macedonia',
  'N. Macedonia':                         'North Macedonia',
  'FYR Macedonia':                        'North Macedonia',
  'Guinea Bissau':                        'Guinea-Bissau',
  'Sao Tome and Principe':                'São Tomé and Príncipe',
  'United Republic of Tanzania':          'Tanzania',
  'Brunei Darussalam':                    'Brunei',
  'Lao PDR':                              'Laos',
  "Lao People's Democratic Republic":     'Laos',
  'Syrian Arab Republic':                 'Syria',
  'Iran (Islamic Republic of)':           'Iran',
  'Russian Federation':                   'Russia',
  'Congo':                                'Congo',
  'Republic of the Congo':                'Congo',
  'Republic of Congo':                    'Congo',
  'State of Palestine':                   'Palestine',
  'Palestine, State of':                  'Palestine',
  'West Bank':                            'Palestine',
  'Micronesia (Federated States of)':     'Micronesia',
  'Federated States of Micronesia':       'Micronesia',
  'Bolivia (Plurinational State of)':     'Bolivia',
  'Venezuela (Bolivarian Republic of)':   'Venezuela',
  'Tanzania':                             'Tanzania',
  'Timor-Leste':                          'Timor-Leste',
};

// Map styles — unvisited countries are fully hidden
const STYLES = {
  current:  { fillColor: '#38bdf8', fillOpacity: 0.55, color: '#38bdf8', weight: 2.5, stroke: true },
  dest:     { fillColor: '#f59e0b', fillOpacity: 0.55, color: '#f59e0b', weight: 2.5, stroke: true },
  visited:  { fillColor: '#34d399', fillOpacity: 0.22, color: '#34d399', weight: 1,   stroke: true },
  hidden:   { fillOpacity: 0, color: 'transparent',   weight: 0,   stroke: false },
};

// ─── Input aliases ────────────────────────────────────────────────────────────

// Normalized player input → canonical country name in our dataset
const ALIASES = {
  'usa':                                  'United States',
  'us':                                   'United States',
  'america':                              'United States',
  'united states of america':             'United States',
  'uk':                                   'United Kingdom',
  'britain':                              'United Kingdom',
  'great britain':                        'United Kingdom',
  'england':                              'United Kingdom',
  'uae':                                  'United Arab Emirates',
  'drc':                                  'DR Congo',
  'congo dr':                             'DR Congo',
  'democratic republic of congo':         'DR Congo',
  'democratic republic of the congo':     'DR Congo',
  'congo kinshasa':                       'DR Congo',
  'republic of the congo':                'Congo',
  'republic of congo':                    'Congo',
  'congo brazzaville':                    'Congo',
  'czechia':                              'Czech Republic',
  'czech':                                'Czech Republic',
  'bosnia':                               'Bosnia and Herzegovina',
  'bosnia herzegovina':                   'Bosnia and Herzegovina',
  'bih':                                  'Bosnia and Herzegovina',
  "cote d ivoire":                        'Ivory Coast',
  "cote divoire":                         'Ivory Coast',
  "cote d'ivoire":                        'Ivory Coast',
  'north macedonia':                      'North Macedonia',
  'macedonia':                            'North Macedonia',
  'fyrom':                                'North Macedonia',
  'swaziland':                            'Eswatini',
  'burma':                                'Myanmar',
  'east timor':                           'Timor-Leste',
  'timor leste':                          'Timor-Leste',
  'vatican':                              'Vatican City',
  'holy see':                             'Vatican City',
  'cape verde':                           'Cabo Verde',
  'sao tome and principe':                'São Tomé and Príncipe',
  'sao tome':                             'São Tomé and Príncipe',
  'st kitts':                             'Saint Kitts and Nevis',
  'st kitts and nevis':                   'Saint Kitts and Nevis',
  'saint kitts':                          'Saint Kitts and Nevis',
  'st lucia':                             'Saint Lucia',
  'st vincent':                           'Saint Vincent and the Grenadines',
  'st vincent and the grenadines':        'Saint Vincent and the Grenadines',
  'saint vincent':                        'Saint Vincent and the Grenadines',
  'trinidad':                             'Trinidad and Tobago',
  'north korea':                          'North Korea',
  'south korea':                          'South Korea',
  'dprk':                                 'North Korea',
  'rok':                                  'South Korea',
  'republic of korea':                    'South Korea',
  'russian federation':                   'Russia',
  'car':                                  'Central African Republic',
  'papua':                                'Papua New Guinea',
  'png':                                  'Papua New Guinea',
  'antigua':                              'Antigua and Barbuda',
  'republic of ireland':                  'Ireland',
};

// ─── Game state ──────────────────────────────────────────────────────────────

let allCountries   = [];
let countryMap     = {};
let startCountry   = null;
let destCountry    = null;
let currentCountry = null;
let route          = [];
let optimalLength  = 0;
let gameOver       = false;

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  allCountries = await GeoUtils.loadCountries();
  countryMap   = Object.fromEntries(allCountries.map(c => [c.name, c]));
  updateBestDisplay();
  initMap();
  await loadGeoData();
  document.getElementById('answer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitGuess();
  });
  startGame();
}

function initMap() {
  map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    minZoom: 1,
    maxZoom: 8,
    worldCopyJump: true,
    zoomControl: true,
  });

  // Physical base — no borders, no labels at any zoom level
  L.tileLayer('https://server.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © <a href="https://www.esri.com/">Esri</a>',
    maxZoom: 16,
  }).addTo(map);
  // No reference overlay — country names must not be visible
}

async function loadGeoData() {
  try {
    const res  = await fetch('https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson');
    const data = await res.json();

    geoLayer = L.geoJSON(data, {
      style:         feature => getFeatureStyle(resolveNEName(feature)),
      interactive:   false,   // clicking countries does nothing — input only
      onEachFeature: (feature, layer) => {
        const ourName = resolveNEName(feature);
        if (ourName && countryMap[ourName]) layerByName[ourName] = layer;
      },
    }).addTo(map);
  } catch (e) {
    console.warn('Could not load country polygons:', e);
  }
}

function resolveNEName(feature) {
  const props = feature.properties || {};
  for (const raw of [props.name, props.admin, props.sovereignt]) {
    if (!raw) continue;
    if (NE_NAME_MAP[raw])  return NE_NAME_MAP[raw];
    if (countryMap[raw])   return raw;
  }
  return null;
}

// ─── Input normalisation ──────────────────────────────────────────────────────

function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')    // strip accents
    .replace(/[''`\-]/g, ' ')           // apostrophes/hyphens → space
    .replace(/[^a-z0-9 ]/g, '')         // remove remaining punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveInput(raw) {
  if (!raw.trim()) return null;
  const norm     = normalize(raw);
  const aliased  = ALIASES[norm];
  if (aliased !== undefined) return aliased;            // null means known-ambiguous
  // Direct match (case-insensitive, accent-folded)
  for (const name of Object.keys(countryMap)) {
    if (normalize(name) === norm) return name;
  }
  return undefined;   // undefined = completely unknown
}

// ─── BFS ─────────────────────────────────────────────────────────────────────

function bfs(fromName, toName) {
  if (fromName === toName) return [fromName];
  const visited = new Set([fromName]);
  const queue   = [[fromName]];
  while (queue.length) {
    const path    = queue.shift();
    const current = path[path.length - 1];
    for (const neighbor of (countryMap[current]?.neighbors || [])) {
      if (!countryMap[neighbor] || visited.has(neighbor)) continue;
      const newPath = [...path, neighbor];
      if (neighbor === toName) return newPath;
      visited.add(neighbor);
      queue.push(newPath);
    }
  }
  return null;
}

// ─── Pick pair ───────────────────────────────────────────────────────────────

function pickPair() {
  const connected = allCountries.filter(c => c.neighbors.length > 0);
  let from, to, path, tries = 0;
  do {
    from = GeoUtils.pickRandom(connected, 1)[0];
    to   = GeoUtils.pickRandom(connected, 1)[0];
    if (from.name === to.name) continue;
    path = bfs(from.name, to.name);
    tries++;
  } while ((!path || path.length < 3) && tries < 200);
  return { from, to, path };
}

// ─── Start game ──────────────────────────────────────────────────────────────

function startGame() {
  gameOver = false;
  const { from, to, path } = pickPair();

  startCountry   = from;
  destCountry    = to;
  currentCountry = from;
  route          = [from.name];
  optimalLength  = path.length - 1;

  document.getElementById('game-over').style.display   = 'none';
  document.getElementById('input-area').style.display  = '';
  document.getElementById('steps-taken').textContent   = '0';
  document.getElementById('optimal-steps').textContent = optimalLength;
  clearFeedback();
  resetInput();

  document.getElementById('start-flag').innerHTML    = GeoUtils.flagImg(from.flag, from.name);
  document.getElementById('start-name').textContent  = from.name;
  document.getElementById('dest-flag').innerHTML     = GeoUtils.flagImg(to.flag, to.name);
  document.getElementById('dest-name').textContent   = to.name;

  renderRoute();
  updateMapStyles();
  updateRouteLine();

  // Zoom to show both start and destination
  const sl = layerByName[from.name];
  const dl = layerByName[to.name];
  if (sl && dl) {
    map.fitBounds(sl.getBounds().extend(dl.getBounds()), { padding: [50, 50], maxZoom: 5 });
  } else if (sl) {
    map.fitBounds(sl.getBounds(), { padding: [60, 60], maxZoom: 4 });
  }
}

// ─── Map style helpers ───────────────────────────────────────────────────────

function getFeatureStyle(ourName) {
  if (!ourName || !countryMap[ourName])              return STYLES.hidden;
  if (ourName === currentCountry?.name)              return STYLES.current;
  if (ourName === destCountry?.name)                 return STYLES.dest;
  if (route.includes(ourName))                       return STYLES.visited;
  return STYLES.hidden;   // unrevealed — invisible
}

function updateMapStyles() {
  if (!geoLayer) return;
  for (const [name, layer] of Object.entries(layerByName)) {
    layer.setStyle(getFeatureStyle(name));
  }
}

function updateRouteLine() {
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  if (route.length < 2) return;
  const coords = route.map(name => {
    const c = countryMap[name];
    return [c.lat, c.lng];
  });
  routeLine = L.polyline(coords, { color: '#38bdf8', weight: 3, opacity: 0.9 }).addTo(map);
}

// ─── Input / submit ───────────────────────────────────────────────────────────

function submitGuess() {
  if (gameOver) return;
  const input = document.getElementById('answer-input');
  const raw   = input.value.trim();
  if (!raw) return;

  const resolved = resolveInput(raw);

  if (resolved === undefined) {
    // Completely unknown string
    showFeedback(`"${raw}" isn't a country we know.`, true);
    shakeInput();
    return;
  }
  if (resolved === null) {
    // Ambiguous (e.g. "Korea")
    showFeedback(`Be more specific — did you mean North Korea or South Korea?`, true);
    shakeInput();
    return;
  }
  if (!currentCountry.neighbors.includes(resolved)) {
    showFeedback(`${resolved} doesn't border ${currentCountry.name}.`, true);
    shakeInput();
    return;
  }

  // Valid move
  clearFeedback();
  input.value = '';
  selectNeighbor(resolved);
}

function selectNeighbor(name) {
  if (gameOver) return;
  currentCountry = countryMap[name];
  route.push(name);

  document.getElementById('steps-taken').textContent = route.length - 1;
  renderRoute();
  updateMapStyles();
  updateRouteLine();

  if (name === destCountry.name) {
    endGame();
  } else {
    focusInput();
  }
}

// ─── Input helpers ────────────────────────────────────────────────────────────

function resetInput() {
  const input = document.getElementById('answer-input');
  input.value     = '';
  input.className = 'answer-input';
  input.disabled  = false;
  focusInput();
}

function focusInput() {
  setTimeout(() => document.getElementById('answer-input').focus(), 50);
}

function shakeInput() {
  const input = document.getElementById('answer-input');
  input.classList.remove('shake');
  void input.offsetWidth;   // reflow to restart animation
  input.classList.add('shake');
}

// ─── Feedback ────────────────────────────────────────────────────────────────

let feedbackTimer = null;

function showFeedback(msg, isError) {
  const el   = document.getElementById('map-feedback');
  el.textContent = msg;
  el.className   = 'map-feedback' + (isError ? ' error' : '');
  clearTimeout(feedbackTimer);
  feedbackTimer  = setTimeout(clearFeedback, 2200);
}

function clearFeedback() {
  const el = document.getElementById('map-feedback');
  el.textContent = '';
  el.className   = 'map-feedback';
}

// ─── Route bar ───────────────────────────────────────────────────────────────

function renderRoute() {
  document.getElementById('route-bar').innerHTML = route.map((name, i) => {
    const c      = countryMap[name];
    const isLast = i === route.length - 1;
    return `
      <span class="route-step ${isLast ? 'route-current' : ''}">
        ${GeoUtils.flagEmoji(c.flag)} ${name}
      </span>
      ${isLast ? '' : '<span class="route-arrow">→</span>'}
    `;
  }).join('');
}

// ─── End game ────────────────────────────────────────────────────────────────

function endGame() {
  gameOver = true;
  clearFeedback();

  document.getElementById('input-area').style.display = 'none';

  const stepsTaken = route.length - 1;
  const extra      = stepsTaken - optimalLength;

  document.getElementById('game-over').style.display   = '';
  document.getElementById('result-steps').textContent  =
    `${stepsTaken} step${stepsTaken !== 1 ? 's' : ''}`;

  let detail = `Optimal was ${optimalLength}.`;
  detail += extra === 0
    ? ' 🎯 Perfect route!'
    : ` You took ${extra} extra step${extra !== 1 ? 's' : ''}.`;
  document.getElementById('result-detail').textContent = detail;

  document.getElementById('final-route').innerHTML = route.map((name, i) => {
    const c = countryMap[name];
    return `
      ${i > 0 ? '<span class="final-arrow">→</span>' : ''}
      <span class="final-step">${GeoUtils.flagEmoji(c.flag)} ${name}</span>
    `;
  }).join('');

  const encoded = Math.max(0, 999 - extra);
  const isNew   = GeoUtils.setHighScore('travel', encoded);
  updateBestDisplay();

  if (isNew && extra === 0)  document.getElementById('result-label').textContent = '🎯 PERFECT!';
  else if (isNew)            document.getElementById('result-label').textContent = '🏆 NEW BEST!';
  else                       document.getElementById('result-label').textContent = 'ARRIVED!';
}

function updateBestDisplay() {
  const encoded = GeoUtils.getHighScore('travel');
  document.getElementById('best').textContent = encoded === 0 ? '—'
    : (999 - encoded) === 0 ? 'Perfect'
    : `+${999 - encoded}`;
}

// ─── Share ────────────────────────────────────────────────────────────────────

function shareScore() {
  const stepsTaken = route.length - 1;
  const emoji      = route.map(n => GeoUtils.flagEmoji(countryMap[n].flag)).join('→');
  GeoUtils.share('Travel', `${stepsTaken}/${optimalLength} steps`, `\n${emoji}`);
}

// Boot
init();
