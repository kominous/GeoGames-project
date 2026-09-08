/* City Chain — Game Logic */

const MODES = {
  world:  { label: 'World',  key: 'city-chain-world',  match: () => true },
  europe: { label: 'Europe', key: 'city-chain-europe', match: c => c.continent === 'EU' },
};

let allCountries = [];    // [{ iso, name, continent, cities }]
let pool         = [];    // countries eligible for the chosen mode
let mode         = 'world';
let round        = 0;     // round currently being played
let country      = null;  // country for this round
let lookup       = null;  // Map: normalized string → city index
let namedIdx     = null;  // Set of city indices already named this round
let usedIsos     = null;  // Set of ISO codes used this run
let totalCities  = 0;     // cities named across the whole run
let advancing    = false; // true during the round-change animation

// ---------------------------------------------------------------------------
// Normalization
//
// Player input and every candidate spelling pass through this before they are
// compared, so "Zurich", "zürich" and "ZURICH" all collapse to "zurich".
// ---------------------------------------------------------------------------

// Latin letters that NFD does not decompose — they need an explicit mapping
// or they would be stripped entirely ("Tromsø" → "troms").
const CHAR_MAP = {
  'ø': 'o', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ß': 'ss',
  'æ': 'ae', 'œ': 'oe', 'ł': 'l', 'ı': 'i', 'ħ': 'h',
};

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[øđðþßæœłıħ]/g, ch => CHAR_MAP[ch])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip combining marks
    .replace(/['’`´\-]/g, ' ')         // apostrophes / hyphens → space
    .replace(/[^a-z0-9 ]/g, '')        // drop remaining punctuation
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim();
}

// "St Petersburg" and "Saint Petersburg" should both land on the same city.
function saintVariants(key) {
  if (key.startsWith('saint ')) return ['st ' + key.slice(6)];
  if (key.startsWith('st '))    return ['saint ' + key.slice(3)];
  return [];
}

// Map every accepted spelling of a country's cities onto its city index.
//
// Priority matters: a city's own name has to outrank another city's alternate
// spelling. Budapest lists "Józsefváros" among its alternates, but Józsefváros
// is also a city in its own right — typing it must credit Józsefváros, not
// Budapest. Names are therefore claimed first, and alternates only fill gaps.
function buildLookup(c) {
  const map = new Map();

  c.cities.forEach((city, i) => {
    const k = normalize(city.name);
    if (k && !map.has(k)) map.set(k, i);
  });

  c.cities.forEach((city, i) => {
    city.alt.forEach(a => {
      const k = normalize(a);
      if (k && !map.has(k)) map.set(k, i);
    });
  });

  // "St Petersburg" ⇄ "Saint Petersburg", lowest priority of all.
  [...map].forEach(([k, i]) => {
    saintVariants(k).forEach(v => { if (!map.has(v)) map.set(v, i); });
  });

  return map;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  const res  = await fetch('/data/cities.json');
  const data = await res.json();

  // `reachable` is how many cities a player can actually name: a handful of
  // countries list two distinct places whose names normalize identically
  // (Honduras has two "La Ceiba"s), and only one of them is typeable. Rounds
  // are offered against this count so a round is never unwinnable.
  allCountries = Object.keys(data).map(iso => {
    const c = { iso, ...data[iso] };
    c.reachable = new Set(c.cities.map(city => normalize(city.name))).size;
    return c;
  });

  document.getElementById('answer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitGuess();
  });

  showStart();
}

function showScreen(id) {
  ['loading', 'start', 'game', 'end'].forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.style.display = (s === id) ? '' : 'none';
  });
}

function showStart() {
  showScreen('start');
  Object.keys(MODES).forEach(m => {
    const best = GeoUtils.getHighScore(MODES[m].key);
    document.getElementById(`best-${m}`).textContent = best ? `Best: Round ${best}` : '';
  });
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startRun(chosenMode) {
  mode        = chosenMode;
  pool        = allCountries.filter(MODES[mode].match);
  round       = 0;
  totalCities = 0;
  usedIsos    = new Set();
  advancing   = false;

  document.getElementById('stat-best').textContent = GeoUtils.getHighScore(MODES[mode].key);
  showScreen('game');
  nextRound();
}

function nextRound() {
  round++;

  // Only countries with enough nameable cities to actually finish the round.
  const eligible = pool.filter(c => !usedIsos.has(c.iso) && c.reachable >= round);
  if (!eligible.length) {
    endGame(true);
    return;
  }

  country = GeoUtils.pickRandom(eligible, 1)[0];
  usedIsos.add(country.iso);
  lookup    = buildLookup(country);
  namedIdx  = new Set();
  advancing = false;

  renderRound();
}

function renderRound() {
  document.getElementById('stat-round').textContent  = round;
  document.getElementById('stat-cities').textContent = totalCities;

  document.getElementById('target-flag').innerHTML = GeoUtils.flagImg(country.iso, country.name);
  document.getElementById('target-country').textContent = country.name;

  document.getElementById('chip-tray').innerHTML = '';
  setFeedback('', '');
  renderProgress();

  const input = document.getElementById('answer-input');
  input.value    = '';
  input.disabled = false;
  input.className = 'answer-input';
  document.getElementById('submit-btn').disabled = false;
  input.focus();
}

function renderProgress() {
  const named = namedIdx.size;

  document.getElementById('target-ask').innerHTML =
    `Name <strong>${round}</strong> ${round === 1 ? 'city' : 'cities'} · ${named}/${round}`;

  document.getElementById('progress-track').innerHTML =
    Array.from({ length: round }, (_, i) =>
      `<span class="progress-slot ${i < named ? 'filled' : ''}"></span>`
    ).join('');
}

// ---------------------------------------------------------------------------
// Guessing
// ---------------------------------------------------------------------------

function setFeedback(msg, cls) {
  const el = document.getElementById('feedback');
  el.textContent = msg;
  el.className   = `chain-feedback ${cls}`;
}

function rejectInput(msg, cls) {
  const input = document.getElementById('answer-input');
  setFeedback(msg, cls);
  input.classList.remove('shake');
  void input.offsetWidth;          // restart the animation
  input.classList.add('shake');
  input.select();
}

function submitGuess() {
  if (advancing) return;

  const input = document.getElementById('answer-input');
  const raw   = input.value.trim();
  if (!raw) return;

  const key = normalize(raw);
  if (!key) {
    rejectInput('Type a city name', 'miss');
    return;
  }

  const idx = lookup.get(key);

  if (idx === undefined) {
    GeoUtils.playWrong();
    rejectInput(`Not on our list for ${country.name}`, 'miss');
    return;
  }

  if (namedIdx.has(idx)) {
    rejectInput(`You already named ${country.cities[idx].name}`, 'dup');
    return;
  }

  acceptCity(idx);
}

function acceptCity(idx) {
  const city = country.cities[idx];
  namedIdx.add(idx);
  totalCities++;

  GeoUtils.playCorrect();

  document.getElementById('chip-tray').insertAdjacentHTML('beforeend',
    `<span class="city-chip">${city.name}` +
    `<span class="chip-pop">${GeoUtils.formatNumber(city.pop)}</span></span>`
  );

  const input = document.getElementById('answer-input');
  input.value = '';
  input.focus();

  document.getElementById('stat-cities').textContent = totalCities;
  renderProgress();

  if (namedIdx.size >= round) {
    completeRound();
  } else {
    setFeedback(`✓ ${city.name}`, 'ok');
  }
}

function completeRound() {
  advancing = true;

  const input = document.getElementById('answer-input');
  input.disabled = true;
  document.getElementById('submit-btn').disabled = true;

  GeoUtils.showFlash(true);
  setFeedback(`Round ${round} complete!`, 'ok');

  setTimeout(nextRound, 1200);
}

function giveUp() {
  if (advancing) return;
  endGame(false);
}

// ---------------------------------------------------------------------------
// End screen
// ---------------------------------------------------------------------------

// `exhausted` is true when the dataset ran out of countries big enough for the
// next round — the player beat the mode rather than getting stuck.
function endGame(exhausted) {
  advancing = true;
  const completed = round - 1;

  showScreen('end');
  document.getElementById('end-label').textContent =
    exhausted ? 'YOU CLEARED EVERY ROUND' : 'YOU REACHED';
  document.getElementById('end-round').textContent = `Round ${completed}`;

  document.getElementById('end-detail').innerHTML =
    `<strong>${completed}</strong> ${completed === 1 ? 'round' : 'rounds'} completed · ` +
    `<strong>${totalCities}</strong> ${totalCities === 1 ? 'city' : 'cities'} named · ` +
    `${MODES[mode].label} mode`;

  const isNew = GeoUtils.setHighScore(MODES[mode].key, completed);
  document.getElementById('end-best').innerHTML =
    isNew && completed > 0
      ? '<div class="end-best">🏆 New best!</div>'
      : `<div class="end-best">Best: Round ${GeoUtils.getHighScore(MODES[mode].key)}</div>`;
}

function shareScore() {
  const completed = round - 1;
  GeoUtils.share(
    `Meridly City Chain (${MODES[mode].label})`,
    `Round ${completed}`,
    `— ${totalCities} cities named`
  );
}

// ---------------------------------------------------------------------------
GeoUtils.mountMuteButton('.site-nav');
init();
