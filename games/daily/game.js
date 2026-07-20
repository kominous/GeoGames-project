/* Daily Challenge — Game Logic */

const SITE_URL = 'https://meridly.net';

const Q_META = [
  { label: '🏁 Flag Recognition' },
  { label: '📊 Population'       },
  { label: '🏙️ Capital Cities'   },
  { label: '🗺️ Land Area'        },
  { label: '🏙️ Capital Cities'   },
];

let countries  = [];
let questions  = [];
let currentQ   = 0;
let results    = [];   // array of booleans, built as player answers
let locked     = false;
let liveStreak = 0;    // streak value displayed during play (pre-finish)

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  countries = await GeoUtils.loadCountries();

  const today     = GeoUtils.getDailyDateKey();
  const savedDate = localStorage.getItem('geo_daily_date');

  liveStreak = parseInt(localStorage.getItem('geo_daily_streak') || '0', 10);

  if (savedDate === today) {
    const saved = JSON.parse(localStorage.getItem('geo_daily_result') || '[]');
    showAlreadyPlayed(saved);
  } else {
    questions = buildQuestions(countries);
    showGameScreen();
  }
}

// ---------------------------------------------------------------------------
// Question construction — deterministic from today's seed
// ---------------------------------------------------------------------------

function buildQuestions(all) {
  const rng  = GeoUtils.makeRNG(GeoUtils.getDailySeed());
  const pool = GeoUtils.seededShuffle(all, rng);
  let i = 0;

  // Q1 — flag → country (MC, 4 options)
  const q1ans  = pool[i++];
  const q1opts = GeoUtils.seededShuffle([q1ans, pool[i++], pool[i++], pool[i++]], rng);

  // Q2 — population higher/lower
  const q2a = pool[i++], q2b = pool[i++];

  // Q3 — capital name → country (MC, 4 options)
  const q3ans  = pool[i++];
  const q3opts = GeoUtils.seededShuffle([q3ans, pool[i++], pool[i++], pool[i++]], rng);

  // Q4 — area higher/lower
  const q4a = pool[i++], q4b = pool[i++];

  // Q5 — capital name → country (MC, 4 options, different countries than Q3)
  const q5ans  = pool[i++];
  const q5opts = GeoUtils.seededShuffle([q5ans, pool[i++], pool[i++], pool[i++]], rng);

  return [
    { type: 'flag-mc',     answer: q1ans, options: q1opts },
    { type: 'hl', stat: 'population', countries: [q2a, q2b], correct: q2a.population >= q2b.population ? 0 : 1 },
    { type: 'capital-mc',  answer: q3ans, options: q3opts },
    { type: 'hl', stat: 'area',       countries: [q4a, q4b], correct: q4a.area >= q4b.area ? 0 : 1 },
    { type: 'capital-mc',  answer: q5ans, options: q5opts },
  ];
}

// ---------------------------------------------------------------------------
// Screen management
// ---------------------------------------------------------------------------

function showScreen(id) {
  ['loading', 'played', 'game', 'results'].forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.style.display = (s === id) ? '' : 'none';
  });
}

function dailyLabel() {
  return `Meridly Daily #${GeoUtils.getDailyNumber()}`;
}

function streakText(n) {
  return n > 0 ? `🔥 ${n} day streak` : '';
}

// ---------------------------------------------------------------------------
// Game screen
// ---------------------------------------------------------------------------

function showGameScreen() {
  showScreen('game');
  document.getElementById('game-number').textContent = dailyLabel();
  document.getElementById('game-streak').textContent = streakText(liveStreak);
  renderProgress();
  renderQuestion(questions[currentQ]);
}

function renderProgress() {
  const dots  = document.getElementById('progress-dots');
  const label = document.getElementById('progress-label');

  dots.innerHTML = Array.from({ length: 5 }, (_, i) => {
    if (i < results.length) {
      return `<span class="dot ${results[i] ? 'dot-correct' : 'dot-wrong'}"></span>`;
    }
    return `<span class="dot ${i === currentQ ? 'dot-current' : 'dot-upcoming'}"></span>`;
  }).join('');

  label.textContent = `Question ${currentQ + 1} / 5`;
}

function renderQuestion(q) {
  const area = document.getElementById('question-area');
  area.innerHTML = '';
  locked = false;

  const card = document.createElement('div');
  card.className = 'question-card';

  if (q.type === 'flag-mc') {
    card.innerHTML = `
      <div class="q-type-label">🏁 Flag Recognition</div>
      <div class="daily-flag-wrap">
        <img src="https://flagcdn.com/w320/${q.answer.flag}.webp"
             alt="Mystery flag" class="daily-flag-img">
      </div>
      <p class="q-prompt">Which country does this flag belong to?</p>
      <div class="mc-options">
        ${q.options.map((c, i) =>
          `<button class="mc-btn" onclick="answerMC(${i})">${c.name}</button>`
        ).join('')}
      </div>`;

  } else if (q.type === 'capital-mc') {
    card.innerHTML = `
      <div class="q-type-label">🏙️ Capital Cities</div>
      <div class="capital-display">${q.answer.capital}</div>
      <p class="q-prompt">Which country has <strong>${q.answer.capital}</strong> as its capital?</p>
      <div class="mc-options">
        ${q.options.map((c, i) =>
          `<button class="mc-btn" onclick="answerMC(${i})">${c.name}</button>`
        ).join('')}
      </div>`;

  } else if (q.type === 'hl') {
    const isPop = q.stat === 'population';
    card.innerHTML = `
      <div class="q-type-label">${isPop ? '📊 Population' : '🗺️ Land Area'}</div>
      <p class="q-prompt">Which country has a <strong>larger ${isPop ? 'population' : 'land area'}</strong>?</p>
      <div class="hl-pair">
        <button class="hl-btn" id="hl-btn-0" onclick="answerHL(0)">
          <span class="hl-flag">${GeoUtils.flagImg(q.countries[0].flag, q.countries[0].name)}</span>
          <span class="hl-name">${q.countries[0].name}</span>
        </button>
        <div class="hl-vs">VS</div>
        <button class="hl-btn" id="hl-btn-1" onclick="answerHL(1)">
          <span class="hl-flag">${GeoUtils.flagImg(q.countries[1].flag, q.countries[1].name)}</span>
          <span class="hl-name">${q.countries[1].name}</span>
        </button>
      </div>`;
  }

  area.appendChild(card);
}

// ---------------------------------------------------------------------------
// Answer handlers
// ---------------------------------------------------------------------------

function answerMC(selectedIdx) {
  if (locked) return;
  locked = true;

  const q       = questions[currentQ];
  const correct = q.options[selectedIdx] === q.answer;
  results.push(correct);
  GeoUtils.showFlash(correct);
  if (correct) GeoUtils.playCorrect(); else GeoUtils.playWrong();

  document.querySelectorAll('.mc-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (q.options[i] === q.answer) btn.classList.add('mc-correct');
    else if (i === selectedIdx)    btn.classList.add('mc-wrong');
  });

  renderProgress();
  setTimeout(advanceQuestion, 1400);
}

function answerHL(selectedIdx) {
  if (locked) return;
  locked = true;

  const q       = questions[currentQ];
  const correct = selectedIdx === q.correct;
  results.push(correct);
  GeoUtils.showFlash(correct);
  if (correct) GeoUtils.playCorrect(); else GeoUtils.playWrong();

  const btn0 = document.getElementById('hl-btn-0');
  const btn1 = document.getElementById('hl-btn-1');
  btn0.disabled = true;
  btn1.disabled = true;

  const fmt = q.stat === 'population'
    ? v => GeoUtils.formatNumber(v)
    : v => v.toLocaleString('en-US') + ' km²';

  [btn0, btn1].forEach((btn, i) => {
    const val = q.stat === 'population'
      ? q.countries[i].population
      : q.countries[i].area;
    btn.querySelector('.hl-name').insertAdjacentHTML(
      'afterend',
      `<span class="hl-value">${fmt(val)}</span>`
    );
    btn.classList.add(i === q.correct ? 'hl-correct' : 'hl-wrong');
  });

  renderProgress();
  setTimeout(advanceQuestion, 1600);
}

function advanceQuestion() {
  currentQ++;
  if (currentQ < 5) {
    renderProgress();
    renderQuestion(questions[currentQ]);
  } else {
    saveAndFinish();
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function saveAndFinish() {
  const today = GeoUtils.getDailyDateKey();
  localStorage.setItem('geo_daily_result', JSON.stringify(results));
  localStorage.setItem('geo_daily_date',   today);

  liveStreak = computeAndSaveStreak(today);
  showResults();
}

function computeAndSaveStreak(today) {
  const lastPlayed  = localStorage.getItem('geo_daily_lastplayed') || '';
  const streak      = parseInt(localStorage.getItem('geo_daily_streak')    || '0', 10);
  const maxStreak   = parseInt(localStorage.getItem('geo_daily_maxstreak') || '0', 10);

  // Build yesterday's key
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const pad       = n => String(n).padStart(2, '0');
  const yesterday = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  const newStreak = lastPlayed === yesterday ? streak + 1 : 1;
  const newMax    = Math.max(maxStreak, newStreak);

  localStorage.setItem('geo_daily_streak',     String(newStreak));
  localStorage.setItem('geo_daily_maxstreak',  String(newMax));
  localStorage.setItem('geo_daily_lastplayed', today);

  return newStreak;
}

// ---------------------------------------------------------------------------
// Result display helpers
// ---------------------------------------------------------------------------

function buildResultCardHTML(res) {
  const score     = res.filter(Boolean).length;
  const grid      = res.map(r => r ? '🟩' : '🟥').join('');
  const breakdown = Q_META.map((q, i) => `
    <div class="result-row">
      <span class="result-type">${q.label}</span>
      <span class="result-tick ${res[i] ? 'correct' : 'wrong'}">${res[i] ? '✓' : '✗'}</span>
    </div>`).join('');

  return `
    <div class="result-score">${score}<span class="result-of"> / 5</span></div>
    <div class="result-grid">${grid}</div>
    <div class="result-breakdown">${breakdown}</div>`;
}

function nextChallengeText() {
  const now      = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1
  ));
  const diff = tomorrow - now;
  const h    = Math.floor(diff / 3_600_000);
  const m    = Math.floor((diff % 3_600_000) / 60_000);
  return `Next challenge in ${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Show screens
// ---------------------------------------------------------------------------

function showResults() {
  showScreen('results');
  document.getElementById('results-number').textContent = dailyLabel();
  document.getElementById('results-streak').textContent = streakText(liveStreak);
  document.getElementById('results-card').innerHTML     = buildResultCardHTML(results);
  document.getElementById('results-next').textContent   = nextChallengeText();
}

function showAlreadyPlayed(savedResult) {
  showScreen('played');
  document.getElementById('played-number').textContent      = dailyLabel();
  document.getElementById('played-streak').textContent      = streakText(liveStreak);
  document.getElementById('played-result-card').innerHTML   = buildResultCardHTML(savedResult);
  document.getElementById('played-next').textContent        = nextChallengeText();
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

async function shareResult() {
  const res   = JSON.parse(localStorage.getItem('geo_daily_result') || '[]');
  const n     = GeoUtils.getDailyNumber();
  const score = res.filter(Boolean).length;
  const grid  = res.map(r => r ? '🟩' : '🟥').join('');
  const text  = `Meridly Daily #${n}\n🌍 ${score}/5\n${grid}\n${SITE_URL}/games/daily/`;

  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (_) { /* cancelled */ }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  } catch (_) {
    prompt('Copy your result:', text);
  }
}

function showToast(msg) {
  let toast = document.getElementById('daily-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id        = 'daily-toast';
    toast.className = 'daily-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ---------------------------------------------------------------------------
GeoUtils.mountMuteButton('.site-nav');
init();
