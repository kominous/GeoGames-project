/* Flag Quiz — Game Logic */

const TOTAL_ROUNDS = 10;

// Maps normalized user input → normalized canonical country name
const ALIASES = {
  // United States
  'usa':                                    'united states',
  'us':                                     'united states',
  'america':                                'united states',
  'united states of america':               'united states',
  // United Kingdom
  'uk':                                     'united kingdom',
  'britain':                                'united kingdom',
  'great britain':                          'united kingdom',
  'england':                                'united kingdom',
  // UAE
  'uae':                                    'united arab emirates',
  // DR Congo
  'drc':                                    'dr congo',
  'congo dr':                               'dr congo',
  'democratic republic of congo':           'dr congo',
  'democratic republic of the congo':       'dr congo',
  'congo kinshasa':                         'dr congo',
  // Republic of Congo
  'republic of the congo':                  'congo',
  'congo brazzaville':                      'congo',
  // Czech Republic / Czechia
  'czechia':                                'czech republic',
  // Ivory Coast
  "cote d ivoire":                          'ivory coast',
  "cote divoire":                           'ivory coast',
  "cote d'ivoire":                          'ivory coast',
  // Cabo Verde / Cape Verde
  'cape verde':                             'cabo verde',
  // Eswatini / Swaziland
  'swaziland':                              'eswatini',
  // Myanmar / Burma
  'burma':                                  'myanmar',
  // Timor-Leste / East Timor
  'east timor':                             'timor-leste',
  'timor leste':                            'timor-leste',
  // North Macedonia / Macedonia
  'fyrom':                                  'north macedonia',
  'republic of north macedonia':            'north macedonia',
  // Bosnia
  'bosnia':                                 'bosnia and herzegovina',
  'bosnia herzegovina':                     'bosnia and herzegovina',
  'bih':                                    'bosnia and herzegovina',
  // São Tomé and Príncipe
  'sao tome and principe':                  'sao tome and principe',
  'sao tome':                               'sao tome and principe',
  // Saint abbreviations
  'st kitts':                               'saint kitts and nevis',
  'st kitts and nevis':                     'saint kitts and nevis',
  'saint kitts':                            'saint kitts and nevis',
  'st lucia':                               'saint lucia',
  'st vincent':                             'saint vincent and the grenadines',
  'st vincent and the grenadines':          'saint vincent and the grenadines',
  'saint vincent':                          'saint vincent and the grenadines',
  // Trinidad
  'trinidad':                               'trinidad and tobago',
  // Papua New Guinea
  'png':                                    'papua new guinea',
  'papua':                                  'papua new guinea',
  // Micronesia
  'federated states of micronesia':         'micronesia',
  'fsm':                                    'micronesia',
  // Solomon Islands
  'solomons':                               'solomon islands',
  // Marshall Islands
  'marshalls':                              'marshall islands',
  // Palestine
  'palestinian territories':                'palestine',
  'west bank':                              'palestine',
  // Antigua
  'antigua':                                'antigua and barbuda',
  // Republic of Ireland
  'republic of ireland':                    'ireland',
  // Central African Republic
  'car':                                    'central african republic',
  // Taiwan / ROC
  'republic of china':                      'taiwan',
  'roc':                                    'taiwan',
  // South Korea / North Korea
  'korea':                                  'south korea',
  'rok':                                    'south korea',
  'dprk':                                   'north korea',
  // Vatican
  'holy see':                               'vatican city',
  'the vatican':                            'vatican city',
  'vatican':                                'vatican city',
};

let countries = [];
let rounds = [];
let currentRound = 0;
let score = 0;

async function init() {
  countries = await GeoUtils.loadCountries();
  document.getElementById('best').textContent = GeoUtils.getHighScore('flag-quiz');
  document.getElementById('answer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitGuess();
  });
  startGame();
}

function startGame() {
  score = 0;
  currentRound = 0;
  rounds = GeoUtils.pickRandom(countries, TOTAL_ROUNDS);

  document.getElementById('score').textContent = '0';
  document.getElementById('game-area').style.display = '';
  document.getElementById('game-over').style.display = 'none';

  // Clear any leftover new-best message
  const extra = document.getElementById('new-best-msg');
  if (extra) extra.remove();

  showRound();
}

function showRound() {
  const country = rounds[currentRound];

  document.getElementById('round').textContent = `${currentRound + 1} / ${TOTAL_ROUNDS}`;
  document.getElementById('flag-img').src = `https://flagcdn.com/w320/${country.flag}.webp`;
  document.getElementById('flag-img').alt = 'Flag of ?';
  document.getElementById('flag-img').className = '';

  const input = document.getElementById('answer-input');
  input.value = '';
  input.className = 'answer-input';
  input.disabled = false;
  input.focus();

  document.getElementById('feedback').textContent = '';
  document.getElementById('feedback').className = 'feedback';
  document.getElementById('submit-btn').disabled = false;
}

function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[''`\-]/g, ' ')          // apostrophes/hyphens → space
    .replace(/[^a-z0-9 ]/g, '')        // remove remaining punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function isCorrect(input, country) {
  const norm = normalize(input);
  const name = normalize(country.name);

  if (norm === name) return true;

  // Check alias table
  const resolved = ALIASES[norm];
  if (resolved && normalize(resolved) === name) return true;

  return false;
}

function submitGuess() {
  const input = document.getElementById('answer-input');
  const submitBtn = document.getElementById('submit-btn');
  if (input.disabled) return;

  const raw = input.value.trim();
  if (!raw) return;

  // Lock input while showing feedback
  input.disabled = true;
  submitBtn.disabled = true;

  const country = rounds[currentRound];
  const correct = isCorrect(raw, country);
  const feedback = document.getElementById('feedback');
  const flagImg = document.getElementById('flag-img');

  GeoUtils.showFlash(correct);

  if (correct) {
    score++;
    document.getElementById('score').textContent = score;
    input.className = 'answer-input correct';
    feedback.textContent = '✓ Correct!';
    feedback.className = 'feedback correct';
    flagImg.className = 'correct-pulse';
    // Update the alt now that they got it right
    flagImg.alt = `Flag of ${country.name}`;
  } else {
    input.className = 'answer-input wrong shake';
    feedback.textContent = `✗ It was ${country.name}`;
    feedback.className = 'feedback wrong';
    flagImg.alt = `Flag of ${country.name}`;
  }

  currentRound++;

  setTimeout(() => {
    if (currentRound < TOTAL_ROUNDS) {
      showRound();
    } else {
      endGame();
    }
  }, 1400);
}

function endGame() {
  document.getElementById('game-area').style.display = 'none';
  document.getElementById('game-over').style.display = '';
  document.getElementById('final-score').textContent = `${score} / ${TOTAL_ROUNDS}`;

  const isNew = GeoUtils.setHighScore('flag-quiz', score);
  document.getElementById('best').textContent = GeoUtils.getHighScore('flag-quiz');

  if (isNew && score > 0) {
    document.getElementById('final-score').insertAdjacentHTML(
      'afterend',
      '<div id="new-best-msg" style="color: var(--accent-warm); font-family: var(--font-mono); margin-top: 0.5rem;">🏆 New best!</div>'
    );
  }
}

function shareScore() {
  GeoUtils.share('Flag Quiz', `${score}/${TOTAL_ROUNDS}`, 'flags identified!');
}

// Boot
init();
