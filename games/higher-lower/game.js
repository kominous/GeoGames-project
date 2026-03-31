/* Higher or Lower — Game Logic */

let countries = [];
let knownCountry = null;
let unknownCountry = null;
let score = 0;
let usedIndices = new Set();

async function init() {
  countries = await GeoUtils.loadCountries();
  document.getElementById('best').textContent = GeoUtils.getHighScore('higher-lower');
  startGame();
}

function startGame() {
  score = 0;
  usedIndices = new Set();
  document.getElementById('score').textContent = '0';
  document.getElementById('game-area').style.display = '';
  document.getElementById('game-over').style.display = 'none';
  nextRound(true);
}

function pickUnusedCountry() {
  // If we've used most countries, reset
  if (usedIndices.size >= countries.length - 2) {
    usedIndices = new Set();
  }

  let idx;
  do {
    idx = Math.floor(Math.random() * countries.length);
  } while (usedIndices.has(idx));
  usedIndices.add(idx);
  return countries[idx];
}

function nextRound(fresh = false) {
  // The unknown becomes the known (unless first round)
  if (fresh) {
    knownCountry = pickUnusedCountry();
  } else {
    knownCountry = unknownCountry;
  }
  unknownCountry = pickUnusedCountry();

  // Make sure they're different
  while (unknownCountry.name === knownCountry.name) {
    unknownCountry = pickUnusedCountry();
  }

  renderRound();
}

function renderRound() {
  // Known side
  document.getElementById('flag-known').innerHTML = GeoUtils.flagImg(knownCountry.flag, knownCountry.name);
  document.getElementById('name-known').textContent = knownCountry.name;
  document.getElementById('pop-known').textContent = GeoUtils.formatNumber(knownCountry.population);

  // Unknown side
  const unknownCard = document.getElementById('country-unknown');
  unknownCard.className = 'country-display mystery';
  document.getElementById('flag-unknown').innerHTML = GeoUtils.flagImg(unknownCountry.flag, unknownCountry.name);
  document.getElementById('name-unknown').textContent = unknownCountry.name;
  document.getElementById('pop-unknown').textContent = '???';

  // Re-enable buttons
  document.getElementById('btn-row').style.display = '';
}

function guess(direction) {
  // Disable buttons immediately
  document.getElementById('btn-row').style.display = 'none';

  const isHigher = unknownCountry.population >= knownCountry.population;
  const correct = (direction === 'higher' && isHigher) || (direction === 'lower' && !isHigher);

  // Reveal the number
  document.getElementById('pop-unknown').textContent = GeoUtils.formatNumber(unknownCountry.population);
  const unknownCard = document.getElementById('country-unknown');
  unknownCard.classList.remove('mystery');
  unknownCard.classList.add('reveal', correct ? 'correct-reveal' : 'wrong-reveal');

  // Flash
  GeoUtils.showFlash(correct);

  if (correct) {
    score++;
    document.getElementById('score').textContent = score;

    // Continue after a short delay
    setTimeout(() => nextRound(), 1200);
  } else {
    // Game over
    setTimeout(() => endGame(), 1200);
  }
}

function endGame() {
  document.getElementById('game-area').style.display = 'none';
  document.getElementById('game-over').style.display = '';
  document.getElementById('final-score').textContent = score;

  const isNew = GeoUtils.setHighScore('higher-lower', score);
  document.getElementById('best').textContent = GeoUtils.getHighScore('higher-lower');

  if (isNew && score > 0) {
    document.getElementById('final-score').insertAdjacentHTML(
      'afterend',
      '<div style="color: var(--accent-warm); font-family: var(--font-mono); margin-top: 0.5rem;">🏆 New best!</div>'
    );
  }
}

function shareScore() {
  GeoUtils.share('Higher or Lower', score, `point streak!`);
}

// Boot
init();
