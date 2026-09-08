/* Build data/cities.json from GeoNames dumps — Node built-ins only.
 *
 *   Inputs : scripts/cities15000.txt, scripts/countryInfo.txt
 *   Output : data/cities.json
 *
 * Run: node scripts/build-cities.js
 */

const fs   = require('fs');
const path = require('path');

const SRC_CITIES  = path.join(__dirname, 'cities15000.txt');
const SRC_COUNTRY = path.join(__dirname, 'countryInfo.txt');
const OUT_FILE    = path.join(__dirname, '..', 'data', 'cities.json');

const MAX_ALT        = 30;  // accepted alternate spellings kept per city
const ALT_DIVERSITY  = 0.9; // reject an alternate this similar to one already kept
const MAX_CITIES     = 60;  // top-N cities kept per country
const MIN_CITIES     = 8;   // countries below this are dropped entirely
const MAX_ALT_LENGTH = 40;  // longer alternates are romanization noise

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

// Strip combining diacritics so "Warīsān" and "Warisan" compare equal.
function deaccent(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function norm(s) {
  return deaccent(s).toLowerCase().trim();
}

// Latin-script test: after diacritics are removed only ASCII letters,
// digits and light punctuation may remain. Rejects Cyrillic, Greek,
// Arabic, CJK, Devanagari, etc.
function isLatin(s) {
  return /^[A-Za-z0-9 '’.,\-()]+$/.test(deaccent(s));
}

// Significant words, ignoring the connecting particles that appear in
// place names ("Andorra la Vella" -> ["andorra", "vella"]).
const PARTICLES = new Set([
  'a', 'al', 'an', 'and', 'da', 'de', 'del', 'della', 'der', 'di', 'do',
  'dos', 'du', 'el', 'em', 'en', 'la', 'las', 'le', 'les', 'lo', 'los',
  'na', 'of', 'on', 'the', 'upon', 'van', 'von', 'y',
]);

function significantWords(s) {
  return norm(s)
    .split(/[^a-z0-9]+/)
    .filter(w => w && !PARTICLES.has(w));
}

// ---------------------------------------------------------------------------
// Alternate-name selection
//
// GeoNames packs a lot into `alternatenames`: genuine local spellings,
// IATA codes, and long syllable-by-syllable romanizations. We keep the
// spellings a player might actually type, ranked by usefulness, capped
// at MAX_ALT.
// ---------------------------------------------------------------------------

// A 3-letter uppercase token is an airport/city code. Keep it only when it
// spells out the initials of one of the city's own names ("NYC" for
// "New York City"), which drops "JFK" and "ALV" but keeps real nicknames.
function isAirportCode(raw, acronyms) {
  if (!/^[A-Z]{3}$/.test(raw)) return false;
  return !acronyms.has(raw.toLowerCase());
}

// Latin transliterations of Arabic/Hebrew drop their vowels ("brwqlyn",
// "syqgw", "ptrs"). Nobody types those, so they lose to real spellings.
function isVowelPoor(s) {
  const letters = deaccent(s).toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length < 3) return false;
  const vowels = (letters.match(/[aeiou]/g) || []).length;
  return vowels / letters.length < 0.2;
}

// Levenshtein distance, iterative single-row.
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[b.length];
}

// 1 = identical, 0 = nothing in common.
function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - editDistance(a, b) / longest : 0;
}

// GeoNames sorts `alternatenames` alphabetically, so position carries no
// signal — the endonym a player is most likely to type ("Roma" for Rome,
// "München" for Munich) can sit anywhere in a list of eighty. Ranking by
// similarity to the primary name surfaces it, and pushes descriptive
// phrases ("Lungsod ng München", "Mji wa Roma") down where they belong.
function rankAlt(candidate, nameNorm, nameWords, isAscii, acronyms) {
  if (isAscii)                       return 0; // canonical transliteration
  if (norm(candidate) === nameNorm)  return 1; // same name, different accents
  if (acronyms.has(norm(candidate))) return 2; // "nyc" — vowel-poor on purpose

  const cand = norm(candidate);
  if (similarity(cand, nameNorm) >= 0.5) {
    return isVowelPoor(candidate) ? 8 : 3;     // likely the local spelling
  }

  const words = significantWords(candidate);
  const base  = words.some(w => nameWords.has(w)) ? 4 : 5;
  return isVowelPoor(candidate) ? base + 5 : base;
}

function buildAlt(name, asciiname, alternatenames) {
  const nameNorm  = norm(name);
  const nameWords = new Set(significantWords(name));

  const rawNames = [asciiname, ...alternatenames.split(',')]
    .map(s => s.trim())
    .filter(Boolean);

  // Initials of every name variant, used to rescue real acronyms.
  const acronyms = new Set(
    [name, ...rawNames]
      .map(n => significantWords(n).map(w => w[0]).join(''))
      .filter(a => a.length >= 2)
  );

  const scored = [];
  const seen   = new Set();

  for (const raw of rawNames) {
    if (raw.length > MAX_ALT_LENGTH)   continue; // romanization noise
    if (/[=\/]|https?:/i.test(raw))    continue; // URLs and "a=b" forms
    if (!isLatin(raw))                 continue; // non-Latin script
    if (isAirportCode(raw, acronyms))  continue;

    // Identity is the normalized form, because that is what the game
    // compares against at runtime: "múnich" and "Munich" are the same key,
    // so keeping both would spend a slot on a spelling that already matches.
    const key = norm(raw);
    if (!key)              continue;
    if (key === nameNorm)  continue; // already matches the primary name
    if (seen.has(key))     continue; // already matches an alternate we kept
    seen.add(key);

    const isAscii = raw === asciiname;
    scored.push({
      value: raw.toLowerCase(),
      key,
      rank:  rankAlt(raw, nameNorm, nameWords, isAscii, acronyms),
      sim:   similarity(key, nameNorm),
    });
  }

  scored.sort((a, b) =>
    a.rank - b.rank ||
    b.sim  - a.sim ||
    a.value.length - b.value.length ||
    a.value.localeCompare(b.value)
  );

  // Take the best entries, skipping any that are near-duplicates of one we
  // already kept. Five spellings of the same word crowd out the one distinct
  // endonym a player is actually likely to type ("wien" losing to "viena",
  // "vienne", "vjenna", "vien"), so diversity beats raw rank here.
  const kept = [];
  for (const entry of scored) {
    if (kept.length >= MAX_ALT) break;
    if (kept.some(k => similarity(k.key, entry.key) >= ALT_DIVERSITY)) continue;
    kept.push(entry);
  }
  return kept.map(e => e.value);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
}

// ISO -> { name, continent }
function parseCountryInfo() {
  const meta = {};
  for (const line of readLines(SRC_COUNTRY)) {
    if (line.startsWith('#')) continue;
    const f = line.split('\t');
    const iso = f[0] && f[0].trim();
    if (!iso) continue;
    meta[iso] = { name: (f[4] || iso).trim(), continent: (f[8] || '').trim() };
  }
  return meta;
}

// ISO -> [ { name, pop, alt } ]
function parseCities() {
  const byCountry = {};
  for (const line of readLines(SRC_CITIES)) {
    const f = line.split('\t');
    if (f.length < 15) continue;

    const name    = f[1].trim();
    const country = f[8].trim();
    if (!name || !country) continue;

    (byCountry[country] ||= []).push({
      name,
      pop: parseInt(f[14], 10) || 0,
      alt: buildAlt(name, f[2].trim(), f[3] || ''),
    });
  }
  return byCountry;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function build() {
  const meta      = parseCountryInfo();
  const byCountry = parseCities();

  const out      = {};
  const excluded = [];
  const unknown  = [];
  let totalCities = 0;

  for (const iso of Object.keys(byCountry).sort()) {
    const cities = byCountry[iso];
    const info   = meta[iso];

    if (cities.length < MIN_CITIES) {
      excluded.push({ iso, name: info ? info.name : iso, count: cities.length });
      continue;
    }
    if (!info) unknown.push(iso);

    cities.sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name));
    const kept = cities.slice(0, MAX_CITIES);
    totalCities += kept.length;

    out[iso] = {
      name:      info ? info.name : iso,
      continent: info ? info.continent : '',
      cities:    kept,
    };
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');

  report(out, excluded, unknown, totalCities);
}

function report(out, excluded, unknown, totalCities) {
  const included = Object.keys(out);

  console.log('\nExcluded countries (fewer than ' + MIN_CITIES + ' cities):');
  excluded
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .forEach(c => console.log(`  ${c.iso}  ${String(c.count).padStart(2)} city  ${c.name}`));

  if (unknown.length) {
    console.log('\nWarning — no countryInfo entry for: ' + unknown.join(', '));
  }

  const smallest = included
    .map(iso => ({ iso, name: out[iso].name, count: out[iso].cities.length }))
    .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name))
    .slice(0, 5);

  console.log('\nSmallest countries that made the cut:');
  smallest.forEach(c => console.log(`  ${c.iso}  ${String(c.count).padStart(2)} cities  ${c.name}`));

  const byContinent = {};
  included.forEach(iso => {
    const k = out[iso].continent || '??';
    byContinent[k] = (byContinent[k] || 0) + 1;
  });

  console.log('\nCountries by continent:');
  Object.keys(byContinent).sort().forEach(k =>
    console.log(`  ${k}  ${String(byContinent[k]).padStart(3)}`)
  );

  const bytes = fs.statSync(OUT_FILE).size;
  console.log('\nSummary');
  console.log(`  countries included : ${included.length}`);
  console.log(`  countries excluded : ${excluded.length}`);
  console.log(`  total cities       : ${totalCities}`);
  console.log(`  output             : ${path.relative(path.join(__dirname, '..'), OUT_FILE).replace(/\\/g, '/')} (${(bytes / 1024).toFixed(0)} KB)\n`);
}

build();
