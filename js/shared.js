/* ============================================
   GeoGames — Shared Utilities
   ============================================ */

const GeoUtils = {
  /**
   * Load the master countries dataset
   * @returns {Promise<Array>} array of country objects
   */
  async loadCountries() {
    const res = await fetch('/data/countries.json');
    return res.json();
  },

  /**
   * Shuffle an array (Fisher-Yates)
   */
  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  /**
   * Pick n random items from an array
   */
  pickRandom(arr, n = 1) {
    return this.shuffle(arr).slice(0, n);
  },

  /**
   * Format a number with commas: 1234567 → "1,234,567"
   */
  formatNumber(num) {
    return num.toLocaleString('en-US');
  },

  /**
   * Calculate distance between two lat/lng points in km (Haversine)
   */
  distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  /**
   * Show a flash result on screen (CORRECT / WRONG)
   */
  showFlash(correct) {
    const el = document.createElement('div');
    el.className = `result-flash ${correct ? 'correct' : 'wrong'}`;
    el.textContent = correct ? '✓' : '✗';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  },

  /**
   * Get a flag emoji from a 2-letter country code
   * e.g. "nl" → "🇳🇱"
   */
  flagEmoji(code) {
    return code
      .toUpperCase()
      .split('')
      .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
      .join('');
  },

  /**
   * Get a flag <img> HTML string from a 2-letter country code
   * Uses flagcdn.com for reliable cross-platform rendering
   * e.g. flagImg("nl", "Netherlands") → '<img src="..." ...>'
   */
  flagImg(code, alt = '') {
    const c = code.toLowerCase();
    return `<img src="https://flagcdn.com/w80/${c}.webp" alt="${alt} flag" class="flag-img">`;
  },

  /**
   * Generate a shareable score text
   */
  shareText(gameName, score, extra = '') {
    const url = window.location.href;
    let text = `🌍 ${gameName}: ${score}`;
    if (extra) text += ` ${extra}`;
    text += `\n\nPlay at ${url}`;
    return text;
  },

  /**
   * Copy text to clipboard and optionally open Twitter/X share
   */
  async share(gameName, score, extra = '') {
    const text = this.shareText(gameName, score, extra);

    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) { /* user cancelled, fall through */ }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(text);
      alert('Score copied to clipboard!');
    } catch (e) {
      // Last resort
      prompt('Copy your score:', text);
    }
  },

  /**
   * Simple high score stored in localStorage
   */
  getHighScore(gameKey) {
    return parseInt(localStorage.getItem(`geo_hs_${gameKey}`) || '0', 10);
  },

  setHighScore(gameKey, score) {
    const current = this.getHighScore(gameKey);
    if (score > current) {
      localStorage.setItem(`geo_hs_${gameKey}`, score.toString());
      return true; // new high score
    }
    return false;
  },

  /**
   * Create a countdown timer element
   * @param {number} seconds - starting seconds
   * @param {function} onTick - called each second with remaining seconds
   * @param {function} onEnd - called when timer hits 0
   * @returns {{ stop: function }} control object
   */
  startTimer(seconds, onTick, onEnd) {
    let remaining = seconds;
    onTick(remaining);
    const interval = setInterval(() => {
      remaining--;
      onTick(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onEnd();
      }
    }, 1000);
    return {
      stop() { clearInterval(interval); },
      getRemaining() { return remaining; }
    };
  },

  // ---- Daily Challenge utilities ----

  // Mulberry32 seeded PRNG — deterministic, same seed → same sequence
  makeRNG(seed) {
    let s = seed >>> 0;
    return () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  // Fisher-Yates shuffle driven by a seeded RNG
  seededShuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  // Today's UTC date as "YYYY-MM-DD"
  getDailyDateKey() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  },

  // Numeric seed from today's UTC date, e.g. 2025-06-01 → 20250601
  getDailySeed() {
    const [y, m, day] = this.getDailyDateKey().split('-').map(Number);
    return y * 10000 + m * 100 + day;
  },

  // Days since 2025-01-01 UTC, starting at 1
  getDailyNumber() {
    const epoch = Date.UTC(2025, 0, 1);
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.floor((today - epoch) / 86400000) + 1;
  },

  // ---- Sound effects & mute toggle ----------------------------------------

  _audioCtx: null,

  // Returns the shared AudioContext, creating it lazily on first call.
  // Returns null if the browser doesn't support Web Audio.
  _getAudioCtx() {
    if (!this._audioCtx) {
      try {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) { return null; }
    }
    return this._audioCtx;
  },

  isMuted() {
    return localStorage.getItem('geogames_muted') === 'true';
  },

  setMuted(bool) {
    localStorage.setItem('geogames_muted', bool ? 'true' : 'false');
    // Sync every mounted toggle button on the page
    document.querySelectorAll('.geo-mute-btn').forEach(btn => {
      btn.textContent = bool ? '🔇' : '🔊';
      btn.title       = bool ? 'Unmute sounds' : 'Mute sounds';
    });
  },

  toggleMute() {
    this.setMuted(!this.isMuted());
  },

  // Short rising two-note blip — signals a correct answer.
  playCorrect() {
    if (this.isMuted()) return;
    try {
      const ctx = this._getAudioCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;

      // Two independent triangle-wave notes, ascending pitch
      [[520, 0, 0.15], [780, 0.075, 0.13]].forEach(([freq, delay, peak]) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, now + delay);
        gain.gain.linearRampToValueAtTime(peak, now + delay + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.085);
        osc.start(now + delay);
        osc.stop(now + delay + 0.09);
      });
    } catch (_) { /* never interrupt gameplay */ }
  },

  // Soft descending glide — signals a wrong answer.
  playWrong() {
    if (this.isMuted()) return;
    try {
      const ctx = this._getAudioCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;

      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      // Triangle wave is softer than square — gentle descending pitch
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(130, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.19);
    } catch (_) { /* never interrupt gameplay */ }
  },

  // Injects a small 🔊/🔇 toggle button into containerSelector.
  // Wraps it in <li> automatically when the container is a <ul> or <ol>.
  mountMuteButton(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    // Inject button styles once per page load
    if (!document.getElementById('geo-mute-style')) {
      const s = document.createElement('style');
      s.id = 'geo-mute-style';
      s.textContent =
        '.geo-mute-btn{background:transparent;border:1px solid var(--border);' +
        'border-radius:6px;color:var(--text-secondary);cursor:pointer;' +
        'font-size:.9rem;padding:3px 8px;line-height:1.5;' +
        'transition:color .2s,border-color .2s;font-family:inherit}' +
        '.geo-mute-btn:hover{color:var(--accent);border-color:var(--accent)}';
      document.head.appendChild(s);
    }

    const btn = document.createElement('button');
    btn.className = 'geo-mute-btn';
    btn.setAttribute('aria-label', 'Toggle sound');
    btn.title     = this.isMuted() ? 'Unmute sounds' : 'Mute sounds';
    btn.textContent = this.isMuted() ? '🔇' : '🔊';
    btn.addEventListener('click', () => this.toggleMute());

    if (container.tagName === 'UL' || container.tagName === 'OL') {
      const li = document.createElement('li');
      li.appendChild(btn);
      container.appendChild(li);
    } else {
      container.appendChild(btn);
    }
  }
};
