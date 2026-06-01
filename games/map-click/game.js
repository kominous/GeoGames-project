/* Map Click — Game Logic */

const TOTAL_ROUNDS = 10;
const MAX_POINTS = 1000;

let countries = [];
let rounds = [];
let currentRound = 0;
let totalScore = 0;
let map = null;
let clickMarker = null;
let answerMarker = null;
let guideLine = null;
let waitingForClick = false;

async function init() {
  countries = await GeoUtils.loadCountries();
  document.getElementById('best').textContent = GeoUtils.getHighScore('map-click');
  initMap();
  await loadWorldBorders();
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

  // CARTO Dark Matter — no labels, no country names
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(map);

  map.on('click', onMapClick);
}

async function loadWorldBorders() {
  try {
    const res = await fetch('https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson');
    const data = await res.json();

    // National borders only — no fill, no interaction
    L.geoJSON(data, {
      style: {
        color: '#3a5a74',
        weight: 0.8,
        fillOpacity: 0,
        opacity: 0.9,
      },
      interactive: false,
    }).addTo(map);
  } catch (e) {
    console.warn('Could not load world borders:', e);
  }

}

function startGame() {
  totalScore = 0;
  currentRound = 0;
  rounds = GeoUtils.pickRandom(countries, TOTAL_ROUNDS);

  document.getElementById('total-score').textContent = '0';
  document.getElementById('game-area').style.display = '';
  document.getElementById('game-over').style.display = 'none';

  const newBest = document.getElementById('new-best-msg');
  if (newBest) newBest.remove();

  showRound();
}

function showRound() {
  const country = rounds[currentRound];

  document.getElementById('round-num').textContent = `${currentRound + 1} / ${TOTAL_ROUNDS}`;
  document.getElementById('prompt-country').textContent = country.name;
  document.getElementById('prompt-capital').textContent = country.capital;
  document.getElementById('prompt-flag').innerHTML = GeoUtils.flagImg(country.flag, country.name);

  document.getElementById('round-result').style.display = 'none';
  document.getElementById('click-hint').style.display = '';

  clearMapOverlays();
  map.setView([20, 0], 2);

  waitingForClick = true;
  map.getContainer().style.cursor = 'crosshair';
}

function clearMapOverlays() {
  if (clickMarker)  { map.removeLayer(clickMarker);  clickMarker  = null; }
  if (answerMarker) { map.removeLayer(answerMarker); answerMarker = null; }
  if (guideLine)    { map.removeLayer(guideLine);    guideLine    = null; }
}

function onMapClick(e) {
  if (!waitingForClick) return;
  waitingForClick = false;
  map.getContainer().style.cursor = '';

  const { lat, lng } = e.latlng;
  const country = rounds[currentRound];
  const actualLat = country.lat;
  const actualLng = country.lng;

  // Player's guess marker
  clickMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: '',
      html: '<div class="map-pin guess-pin">📍</div>',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    }),
  }).addTo(map);

  // Actual capital marker
  answerMarker = L.marker([actualLat, actualLng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="map-pin answer-pin">⭐</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    }),
  }).addTo(map);

  // Dashed line between guess and answer
  guideLine = L.polyline([[lat, lng], [actualLat, actualLng]], {
    color: '#38bdf8',
    weight: 2,
    dashArray: '6, 9',
    opacity: 0.75,
  }).addTo(map);

  // Score calculation
  const distKm = GeoUtils.distanceKm(lat, lng, actualLat, actualLng);
  const points = calcPoints(distKm);
  totalScore += points;

  document.getElementById('total-score').textContent = totalScore;
  document.getElementById('result-distance').textContent = formatDistance(distKm);

  const pointsEl = document.getElementById('result-points');
  pointsEl.textContent = `+${points}`;
  pointsEl.className = 'result-value ' + (points >= 700 ? 'excellent' : points >= 350 ? 'good' : 'poor');

  document.getElementById('click-hint').style.display = 'none';
  document.getElementById('round-result').style.display = '';

  currentRound++;
}

function calcPoints(distKm) {
  // Smooth exponential decay: 1000 at 0 km, ~513 at ~1000 km, ~50 at ~4500 km
  return Math.max(0, Math.round(MAX_POINTS * Math.exp(-distKm / 1500)));
}

function formatDistance(km) {
  if (km < 1)    return '< 1 km';
  if (km < 1000) return `${Math.round(km)} km`;
  return `${(km / 1000).toFixed(1)}k km`;
}

function nextRound() {
  if (currentRound >= TOTAL_ROUNDS) {
    endGame();
  } else {
    showRound();
  }
}

function endGame() {
  clearMapOverlays();
  document.getElementById('game-area').style.display = 'none';
  document.getElementById('game-over').style.display = '';
  document.getElementById('final-score').textContent = totalScore;

  const isNew = GeoUtils.setHighScore('map-click', totalScore);
  document.getElementById('best').textContent = GeoUtils.getHighScore('map-click');

  if (isNew && totalScore > 0) {
    document.getElementById('final-score').insertAdjacentHTML(
      'afterend',
      '<div id="new-best-msg" style="color: var(--accent-warm); font-family: var(--font-mono); margin-top: 0.5rem;">🏆 New best!</div>'
    );
  }
}

function shareScore() {
  GeoUtils.share('Map Click', totalScore, `/ ${TOTAL_ROUNDS * MAX_POINTS} pts`);
}

// Boot
init();
