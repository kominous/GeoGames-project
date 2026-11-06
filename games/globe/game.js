/* Globetrotter — Game Logic
 *
 * Spin the globe, fly Pip to a country, read a few facts, then pass a short
 * quiz to stamp your passport. Stamped countries unlock city stops.
 */

const STORE_KEY = 'geo_globe_progress';
const HOME_ISO  = 'IS';   // Pip starts in Iceland
const REGIONS   = ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'];
const REGION_HUE = {
  Europe: '#8fb8e8', Asia: '#f59e0b', Africa: '#fb923c',
  'North America': '#34d399', 'South America': '#c084fc', Oceania: '#22d3ee',
};

// Countries that straddle two continents get a special region question.
const SPANS = {
  RU: 'Europe and Asia', TR: 'Europe and Asia', KZ: 'Europe and Asia',
  GE: 'Europe and Asia', AZ: 'Europe and Asia', EG: 'Africa and Asia',
};
// Region is debatable (Europe vs Asia): no region question at all.
const AMBIGUOUS_REGION = new Set(['AM', 'CY']);

// ---------------------------------------------------------------------------
// Spherical maths (hand-rolled orthographic projection)
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;

function toVec(lon, lat) {
  const p = lat * RAD, l = lon * RAD, c = Math.cos(p);
  return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
}

function toLonLat(v) {
  return [Math.atan2(v[1], v[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD];
}

// Great-circle interpolation between two [lon, lat] points
function slerp(a, b, t) {
  const A = toVec(a[0], a[1]), B = toVec(b[0], b[1]);
  const d = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const o = Math.acos(d);
  if (o < 1e-6) return [a[0], a[1]];
  const s = Math.sin(o), k1 = Math.sin((1 - t) * o) / s, k2 = Math.sin(t * o) / s;
  return toLonLat([A[0] * k1 + B[0] * k2, A[1] * k1 + B[1] * k2, A[2] * k1 + B[2] * k2]);
}

// Angular distance in degrees
function arcDeg(a, b) {
  const A = toVec(a[0], a[1]), B = toVec(b[0], b[1]);
  const d = A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
  return Math.acos(Math.max(-1, Math.min(1, d))) / RAD;
}

function kmBetween(a, b) { return arcDeg(a, b) * 111.19; }

// Orthographic projection about a viewing centre [lon, lat].
// Hidden points are clamped onto the limb so land slides behind the edge.
function makeProj(center, R, cx, cy) {
  const l0 = center[0] * RAD, p0 = center[1] * RAD;
  const cp0 = Math.cos(p0), sp0 = Math.sin(p0);
  return function (lon, lat, out) {
    const l = lon * RAD - l0, p = lat * RAD;
    const cp = Math.cos(p), sp = Math.sin(p), cl = Math.cos(l), sl = Math.sin(l);
    const cosc = sp0 * sp + cp0 * cp * cl;
    let ux = cp * sl, uy = cp0 * sp - sp0 * cp * cl;
    if (cosc < 0) {
      const m = Math.hypot(ux, uy) || 1e-9;
      ux /= m; uy /= m;
    }
    const o = out || {};
    o.x = cx + R * ux; o.y = cy - R * uy; o.v = cosc >= 0; o.c = cosc;
    return o;
  };
}

// Densify a ring so long edges follow the sphere's curve
function densify(ring, stepDeg) {
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const n = Math.max(1, Math.ceil(arcDeg(a, b) / stepDeg));
    for (let j = 0; j < n; j++) out.push(slerp(a, b, j / n));
  }
  out.push(ring[ring.length - 1]);
  return out;
}

const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---------------------------------------------------------------------------
// Coastlines (stylised, low-fidelity by design) and graticule
// ---------------------------------------------------------------------------

const RAW_LAND = [
  [[10,37],[15,32],[20,32],[25,32],[31,31],[34,28],[37,22],[39,15],[43,12],[51,12],[48,5],[41,-2],[40,-10],[35,-19],[33,-26],[31,-30],[28,-33],[20,-35],[17,-29],[12,-17],[13,-8],[9,-1],[9,4],[3,6],[-3,5],[-8,4],[-13,8],[-17,15],[-16,21],[-13,28],[-9,30],[-6,35],[0,36],[10,37]],
  [[-6,36],[-9,39],[-9,43],[-2,43],[-4,48],[0,49],[4,52],[8,54],[10,57],[11,58],[5,59],[5,62],[11,64],[14,68],[20,70],[28,71],[33,70],[40,66],[44,68],[60,70],[70,73],[80,74],[90,76],[105,78],[113,73],[130,73],[140,72],[155,70],[170,68],[178,66],[172,61],[163,58],[160,54],[156,51],[140,54],[135,45],[130,43],[127,38],[122,40],[122,31],[110,21],[105,10],[100,13],[98,16],[94,16],[90,22],[88,22],[80,13],[77,8],[72,20],[68,24],[60,25],[57,26],[50,29],[48,29],[57,23],[55,17],[52,15],[45,13],[39,20],[35,28],[35,32],[36,36],[31,36],[28,37],[26,40],[23,40],[19,40],[16,43],[13,45],[16,42],[18,40],[16,38],[12,41],[10,44],[8,44],[4,43],[3,42],[0,39],[-1,37],[-6,36]],
  [[-5,50],[-3,51],[1,51],[0,53],[-1,54],[-3,56],[-2,58],[-5,58],[-6,56],[-5,54],[-3,53],[-5,52],[-5,50]],
  [[-10,52],[-6,52],[-6,54],[-8,55],[-10,54],[-10,52]],
  [[-24,65],[-18,66],[-14,65],[-16,64],[-22,64],[-24,65]],
  [[-45,60],[-42,63],[-38,66],[-32,68],[-25,70],[-22,73],[-20,76],[-25,78],[-35,82],[-45,83],[-55,82],[-62,80],[-68,77],[-70,74],[-66,70],[-60,66],[-52,63],[-45,60]],
  [[131,34],[135,34],[137,35],[140,35],[142,39],[141,41],[139,38],[136,36],[133,35],[131,34]],
  [[140,42],[145,43],[145,45],[141,45],[140,42]],
  [[43,-25],[47,-25],[50,-16],[49,-13],[46,-16],[44,-20],[43,-25]],
  [[80,6],[82,8],[80,10],[79,8],[80,6]],
  [[173,-35],[178,-38],[177,-40],[175,-41],[173,-39],[173,-35]],
  [[167,-46],[171,-44],[174,-41],[172,-40],[168,-44],[167,-46]],
  [[109,2],[117,4],[119,1],[117,-3],[110,-3],[109,2]],
  [[95,5],[100,3],[106,-6],[103,-5],[97,0],[95,5]],
  [[105,-6],[114,-8],[114,-9],[105,-7],[105,-6]],
  [[119,1],[123,1],[125,-2],[121,-5],[120,-2],[119,1]],
  [[131,-1],[141,-2],[147,-6],[150,-10],[144,-8],[138,-8],[132,-4],[131,-1]],
  [[120,18],[122,17],[124,13],[126,10],[126,6],[122,6],[120,10],[120,14],[120,18]],
  [[-84,22],[-79,22],[-75,20],[-77,20],[-82,21],[-84,22]],
  [[-74,18],[-69,19],[-68,18],[-72,17],[-74,18]],
  [[120,22],[122,25],[121,25],[120,23],[120,22]],
  [[145,-41],[148,-41],[147,-43],[145,-43],[145,-41]],
  [[11,77],[20,78],[22,80],[15,80],[11,79],[11,77]],
  [[12,38],[15,38],[15,37],[12,38]],
  [[-168,66],[-165,70],[-150,70],[-130,70],[-115,69],[-105,68],[-95,68],[-92,62],[-85,55],[-80,52],[-78,58],[-77,62],[-72,62],[-65,60],[-56,52],[-65,45],[-70,42],[-75,37],[-81,31],[-80,25],[-84,30],[-90,29],[-95,29],[-97,26],[-97,20],[-92,18],[-88,21],[-87,15],[-83,9],[-79,9],[-77,8],[-83,10],[-90,14],[-96,16],[-105,20],[-109,23],[-114,31],[-117,32],[-122,37],[-124,42],[-124,48],[-130,54],[-140,60],[-150,59],[-155,58],[-162,58],[-166,62],[-168,66]],
  [[-77,8],[-72,11],[-62,10],[-52,5],[-50,0],[-44,-2],[-38,-5],[-35,-8],[-39,-13],[-48,-25],[-53,-33],[-57,-38],[-62,-40],[-65,-45],[-68,-50],[-70,-54],[-75,-50],[-73,-42],[-71,-33],[-70,-18],[-76,-14],[-81,-6],[-80,0],[-77,4],[-77,8]],
  [[113,-22],[114,-26],[118,-35],[125,-32],[131,-32],[137,-35],[140,-38],[146,-39],[150,-37],[153,-28],[153,-25],[146,-19],[142,-11],[136,-12],[130,-12],[127,-14],[122,-17],[113,-22]],
  [[-180,-78],[-150,-77],[-120,-74],[-100,-73],[-80,-72],[-65,-66],[-58,-62],[-62,-70],[-45,-75],[-20,-72],[0,-70],[20,-70],[40,-68],[60,-67],[80,-66],[100,-66],[120,-66],[140,-67],[160,-78],[180,-78],[-180,-78]],
];
const LAND = RAW_LAND.map(r => densify(r, 2.5));

const GRAT = (() => {
  const lines = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    const r = [];
    for (let lon = -180; lon <= 180; lon += 5) r.push([lon, lat]);
    lines.push(r);
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const r = [];
    for (let lat = -80; lat <= 80; lat += 5) r.push([lon, lat]);
    lines.push(r);
  }
  return lines;
})();

// ---------------------------------------------------------------------------
// Palette: read from CSS custom properties so the canvas matches the site
// ---------------------------------------------------------------------------

const PAL = {};

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  PAL.accent   = v('--accent', '#38bdf8');
  PAL.warm     = v('--accent-warm', '#f59e0b');
  PAL.text     = v('--text-primary', '#e8edf2');
  PAL.ink      = v('--bg-primary', '#0f1923');
  PAL.land     = v('--globe-land', '#d9c9a3');
  PAL.landEdge = v('--globe-land-edge', '#a8956c');
  PAL.seaLight = v('--globe-sea-light', '#1f4a66');
  PAL.sea      = v('--globe-sea', '#15324a');
  PAL.seaDeep  = v('--globe-sea-deep', '#0a1824');
}

function rgba(hex, a) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------------------
// Pip, the mascot
// ---------------------------------------------------------------------------

function pipSVG(size) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" style="overflow:visible">
      <ellipse cx="32" cy="58" rx="13" ry="3.4" fill="rgba(0,0,0,.4)"/>
      <path d="M20 40 q-9 4-13 12 q7 1 11-3z" fill="#D2564B"/>
      <circle cx="32" cy="34" r="19" fill="#F4EBD9"/>
      <circle cx="32" cy="34" r="19" fill="none" stroke="#0B1E2B" stroke-width="2.5"/>
      <path d="M13 26 a19 19 0 0 1 38 0 z" fill="#9E362D"/>
      <path d="M13 26 a19 19 0 0 1 38 0 z" fill="none" stroke="#0B1E2B" stroke-width="2.5"/>
      <rect x="14" y="21" width="36" height="7" rx="3.5" fill="#0B1E2B" opacity=".85"/>
      <circle cx="23" cy="24.5" r="4.6" fill="#9FD8E8" stroke="#0B1E2B" stroke-width="1.6"/>
      <circle cx="41" cy="24.5" r="4.6" fill="#9FD8E8" stroke="#0B1E2B" stroke-width="1.6"/>
      <circle cx="25" cy="36" r="2.6" fill="#0B1E2B"/>
      <circle cx="39" cy="36" r="2.6" fill="#0B1E2B"/>
      <circle cx="26" cy="35.2" r=".9" fill="#fff"/>
      <circle cx="40" cy="35.2" r=".9" fill="#fff"/>
      <path d="M28 43 q4 3.6 8 0" stroke="#0B1E2B" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <circle cx="19" cy="41" r="2.8" fill="#E9A0A0" opacity=".75"/>
      <circle cx="45" cy="41" r="2.8" fill="#E9A0A0" opacity=".75"/>
      <path d="M18 47 q14 7 28 0" stroke="#D2564B" stroke-width="5" fill="none" stroke-linecap="round"/>
    </svg>`;
}

// ---------------------------------------------------------------------------
// Globe renderer
// ---------------------------------------------------------------------------

/**
 * Draws an interactive globe into `canvas`, sized to `wrap`.
 * Options: stateOf(iso) → 'done' | 'next' | 'plain', onSelect(iso),
 *          pinMode, showLabels, showPip, mascotIso.
 */
function createGlobe(wrap, canvas, pip, options = {}) {
  const opts = {
    stateOf: () => 'plain',
    onSelect: () => {},
    pinMode: false,
    showLabels: true,
    showPip: true,
    selectedIso: null,
    ...options,
  };

  const ctx   = canvas.getContext('2d');
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const home = BY_ISO[opts.mascotIso] || BY_ISO[HOME_ISO];
  let mascot = home ? home.pos.slice() : [-21.9, 64.1];
  let center = [mascot[0], mascot[1] * 0.8];
  let size   = { w: 320, h: 320, R: 140, cx: 160, cy: 160 };
  let target = null;   // camera move {from, to, t0, dur}
  let travel = null;   // mascot flight {from, to, t0, dur}
  let trail  = null;
  let drag   = null;
  let hover  = null;
  let proj   = null;
  let idle   = 0;
  let raf    = 0;
  let prev   = performance.now();

  if (pip) pip.innerHTML = pipSVG(46);

  function fit() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const R = Math.max(40, Math.min(w, h) / 2 - 14);
    size = { w, h, R, cx: w / 2, cy: h / 2 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(wrap);

  function flyTo(iso) {
    const c = BY_ISO[iso];
    if (!c) return;
    const from = mascot.slice();
    if (arcDeg(from, c.pos) < 0.5) return;
    const now = performance.now();
    const dur = 900 + Math.min(1600, arcDeg(from, c.pos) * 9);
    travel = { from, to: c.pos, t0: now, dur };
    trail  = { from, to: c.pos };
    target = { from: center.slice(), to: [c.pos[0], c.pos[1] * 0.8], t0: now, dur };
    idle   = now + dur + 2600;
  }

  // Path through projected points; returns true if any point is on the visible side
  function trace(pts, close) {
    let any = false;
    const p = {};
    for (let i = 0; i < pts.length; i++) {
      proj(pts[i][0], pts[i][1], p);
      if (p.v) any = true;
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    if (close) ctx.closePath();
    return any;
  }

  // Polyline that breaks where it goes behind the globe
  function strokeVisible(pts) {
    ctx.beginPath();
    let started = false;
    const p = {};
    for (const pt of pts) {
      proj(pt[0], pt[1], p);
      if (!p.v) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  function render(now) {
    const dt = Math.min(60, now - prev);
    prev = now;
    const { w, h, R, cx, cy } = size;

    // Camera
    if (target) {
      const t = Math.min(1, (now - target.t0) / target.dur);
      const e = easeIO(t);
      const a = target.from, b = target.to;
      const dl = ((b[0] - a[0] + 540) % 360) - 180;
      center = [a[0] + dl * e, a[1] + (b[1] - a[1]) * e];
      if (t >= 1) target = null;
    } else if (!still && !drag && now > idle && !opts.selectedIso) {
      center[0] += (dt / 1000) * 4.2;
    }
    if (center[0] > 180) center[0] -= 360;
    if (center[0] < -180) center[0] += 360;

    // Mascot
    let hop = 0;
    if (travel) {
      const t = Math.min(1, (now - travel.t0) / travel.dur);
      mascot = slerp(travel.from, travel.to, easeIO(t));
      hop = Math.sin(Math.PI * t) * 34;
      if (t >= 1) {
        travel = null;
        const done = trail;
        setTimeout(() => { if (trail === done) trail = null; }, 1400);
      }
    }

    proj = makeProj(center, R, cx, cy);
    ctx.clearRect(0, 0, w, h);

    // Halo
    const halo = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.16);
    halo.addColorStop(0, rgba(PAL.accent, 0.2));
    halo.addColorStop(1, rgba(PAL.accent, 0));
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.16, 0, 7); ctx.fillStyle = halo; ctx.fill();

    // Ocean
    const sea = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.08, cx, cy, R * 1.05);
    sea.addColorStop(0, PAL.seaLight);
    sea.addColorStop(0.5, PAL.sea);
    sea.addColorStop(1, PAL.seaDeep);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fillStyle = sea; ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();

    // Graticule
    ctx.strokeStyle = rgba(PAL.land, 0.13);
    ctx.lineWidth = 1;
    for (const line of GRAT) strokeVisible(line);

    // Land
    ctx.fillStyle = PAL.land;
    ctx.strokeStyle = PAL.landEdge;
    ctx.lineWidth = 1.1;
    for (const ring of LAND) {
      ctx.beginPath();
      if (!trace(ring, true)) continue;
      ctx.fill();
      ctx.stroke();
    }

    // Sphere shading
    const sh = ctx.createRadialGradient(cx - R * 0.42, cy - R * 0.46, R * 0.1, cx + R * 0.1, cy + R * 0.16, R * 1.28);
    sh.addColorStop(0, 'rgba(255,246,224,0.20)');
    sh.addColorStop(0.42, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(2,10,16,0.72)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fillStyle = sh; ctx.fill();

    // Flight trail
    if (trail) {
      ctx.setLineDash([2, 7]);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(PAL.warm, 0.85);
      const pts = [];
      for (let i = 0; i <= 48; i++) pts.push(slerp(trail.from, trail.to, i / 48));
      strokeVisible(pts);
      ctx.setLineDash([]);
    }

    // Country markers
    const p = {};
    let labelSel = null, labelHov = null;
    for (const c of countries) {
      proj(c.lon, c.lat, p);
      if (!p.v || p.c < 0.03) continue;
      const st  = opts.pinMode ? 'plain' : opts.stateOf(c.iso);
      const sel = c.iso === opts.selectedIso;
      const hov = c.iso === hover;
      const a   = Math.min(1, p.c * 3.4);
      const r   = sel ? 6.4 : hov ? 5.4 : st === 'done' ? 4 : 3.2;

      if (sel || hov) {
        ctx.globalAlpha = a * 0.32;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 7 + (sel ? Math.sin(now / 260) * 2.4 : 0), 0, 7);
        ctx.fillStyle = sel ? PAL.warm : PAL.text;
        ctx.fill();
      }
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
      if (st === 'done') {
        ctx.fillStyle = PAL.warm; ctx.fill();
      } else if (st === 'next') {
        ctx.fillStyle = PAL.accent; ctx.fill();
        ctx.strokeStyle = rgba(PAL.text, 0.9); ctx.lineWidth = 1.4; ctx.stroke();
      } else {
        ctx.fillStyle = rgba(PAL.ink, 0.85); ctx.fill();
        ctx.strokeStyle = sel ? PAL.warm : rgba(PAL.text, 0.75);
        ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (opts.showLabels && sel) labelSel = { c, x: p.x, y: p.y };
      if (opts.showLabels && hov) labelHov = { c, x: p.x, y: p.y };
    }

    // Exploring: hover wins. Quiz reveal: the answer's label must not be hidden.
    const labelFor = opts.pinMode ? (labelSel || labelHov) : (labelHov || labelSel);

    // Label
    if (labelFor) {
      const txt = labelFor.c.name;
      ctx.font = '700 13px "Space Mono", monospace';
      const tw = ctx.measureText(txt).width;
      const rw = tw + 20, rh = 28, rr = 9;
      const lx = Math.max(6, Math.min(w - rw - 6, labelFor.x - rw / 2));
      const ly = Math.max(6, labelFor.y - 40);
      ctx.fillStyle = rgba(PAL.ink, 0.92);
      ctx.beginPath();
      ctx.moveTo(lx + rr, ly); ctx.arcTo(lx + rw, ly, lx + rw, ly + rh, rr);
      ctx.arcTo(lx + rw, ly + rh, lx, ly + rh, rr); ctx.arcTo(lx, ly + rh, lx, ly, rr);
      ctx.arcTo(lx, ly, lx + rw, ly, rr); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(PAL.warm, 0.5); ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = PAL.text;
      ctx.fillText(txt, lx + 10, ly + 19);
    }

    ctx.restore();

    // Limb
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7);
    ctx.strokeStyle = rgba(PAL.land, 0.42); ctx.lineWidth = 1.4; ctx.stroke();

    // Mascot (a DOM element positioned over the canvas)
    if (pip) {
      proj(mascot[0], mascot[1], p);
      const bob = travel || still ? 0 : Math.sin(now / 620) * 3;
      const on  = opts.showPip && p.v;
      pip.style.transform = `translate(${p.x}px, ${p.y - hop + bob}px) translate(-50%,-88%) scale(${on ? 1 : 0})`;
      pip.style.opacity   = on ? Math.min(1, p.c * 4) : 0;
    }

    raf = requestAnimationFrame(render);
  }

  // ---- Hit testing & pointer input ----

  function pick(mx, my) {
    if (!proj) return null;
    let best = null, bd = 26 * 26;
    const p = {};
    for (const c of countries) {
      proj(c.lon, c.lat, p);
      if (!p.v || p.c < 0.05) continue;
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bd) { bd = d; best = c.iso; }
    }
    return best;
  }

  function onDown(e) {
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), c: center.slice() };
    target = null;
    idle = performance.now() + 4000;
  }

  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      const k = (240 / size.R) * 0.42;
      center = [drag.c[0] - dx * k, Math.max(-82, Math.min(82, drag.c[1] + dy * k))];
      idle = performance.now() + 4000;
    } else {
      hover = pick(e.clientX - r.left, e.clientY - r.top);
      canvas.style.cursor = hover ? 'pointer' : 'grab';
    }
  }

  function onUp(e) {
    const d = drag;
    drag = null;
    idle = performance.now() + 3200;
    if (!d) return;
    if (d.moved < 7 && performance.now() - d.t < 700) {
      const r = canvas.getBoundingClientRect();
      const hit = pick(e.clientX - r.left, e.clientY - r.top);
      if (hit) opts.onSelect(hit);
    }
  }

  function onLeave() {
    drag = null;
    hover = null;
    canvas.style.cursor = 'grab';
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onLeave);
  canvas.addEventListener('pointerleave', onLeave);

  raf = requestAnimationFrame(render);

  return {
    flyTo,
    setSelected(iso) { opts.selectedIso = iso; },
    set(o) { Object.assign(opts, o); },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onLeave);
      canvas.removeEventListener('pointerleave', onLeave);
    },
  };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

let countries  = [];
let BY_ISO     = {};
let NEIGHBOURS = {};   // iso → 12 nearest isos by capital distance
let CITY_STOPS = {};   // iso → [{ name, lat, lng }]

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function buildCountries(list, facts) {
  countries = list
    .map(c => {
      const iso = c.flag.toUpperCase();
      return {
        iso,
        code: c.flag,
        name: c.name,
        capital: c.capital,
        region: c.continent,
        population: c.population,
        lat: c.lat,
        lon: c.lng,
        pos: [c.lng, c.lat],
        fact: facts[iso] || '',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  BY_ISO = Object.fromEntries(countries.map(c => [c.iso, c]));

  for (const c of countries) {
    NEIGHBOURS[c.iso] = countries
      .filter(o => o.iso !== c.iso)
      .map(o => ({ iso: o.iso, d: arcDeg(c.pos, o.pos) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 12)
      .map(o => o.iso);
  }
}

function cityStops(c) {
  const list = CITY_STOPS[c.iso];
  return list && list.length ? list : [{ name: c.capital, lat: c.lat, lng: c.lon }];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const esc = s => String(s).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const deaccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function sample(arr, n, exclude = []) {
  return GeoUtils.pickRandom(arr.filter(x => !exclude.includes(x)), n);
}

function mcq(prompt, right, wrongs, why) {
  const options = GeoUtils.shuffle([right, ...wrongs]);
  return { kind: 'mcq', prompt, options, correct: options.indexOf(right), why };
}

function starsHTML(n) {
  return `<span class="gt-stars">${'★'.repeat(n)}<span class="gt-stars-off">${'★'.repeat(3 - n)}</span></span>`;
}

function popText(p) {
  if (p >= 1e7) return `${Math.round(p / 1e6)} million`;
  if (p >= 1e6) return `${(p / 1e6).toFixed(1)} million`;
  if (p >= 1e4) return GeoUtils.formatNumber(Math.round(p / 1000) * 1000);
  return GeoUtils.formatNumber(p);
}

function kmText(km) {
  return `${GeoUtils.formatNumber(Math.round(km))} km`;
}

function yesterdayKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function blankProgress() {
  return { xp: 0, streak: 0, lastDay: null, mascot: HOME_ISO, done: {} };
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return { ...blankProgress(), ...saved, done: saved.done || {} };
    }
  } catch (_) { /* corrupted or blocked storage: start fresh */ }
  return blankProgress();
}

function saveProgress() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(prog)); } catch (_) { /* storage blocked */ }
}

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

function countryFacts(c) {
  const facts = [];
  if (c.fact) facts.push(c.fact);
  facts.push(`The capital of ${c.name} is ${c.capital}. About ${popText(c.population)} people live in the country.`);
  return facts;
}

function countryQuestions(c) {
  const others = countries.filter(o => o.iso !== c.iso);
  const region = others.filter(o => o.region === c.region);
  const pool   = region.length >= 6 ? region : others;
  const qs = [];

  qs.push(mcq(
    `What is the capital of ${c.name}?`,
    c.capital,
    sample(pool.map(o => o.capital), 3, [c.capital]),
    `${c.capital} is the capital of ${c.name}.`
  ));

  if (SPANS[c.iso]) {
    const right = SPANS[c.iso];
    qs.push(mcq(
      `${c.name} spans two continents. Which pair?`,
      right,
      ['Europe and Asia', 'Africa and Asia', 'Europe and Africa', 'Asia and Oceania'].filter(x => x !== right).slice(0, 3),
      `${c.name} straddles the boundary between ${right}.`
    ));
  } else if (!AMBIGUOUS_REGION.has(c.iso)) {
    qs.push(mcq(
      `Which region is ${c.name} in?`,
      c.region,
      sample(REGIONS, 3, [c.region]),
      `${c.name} sits in ${c.region}.`
    ));
  }

  const flagOpts = GeoUtils.shuffle([c, ...sample(pool, 3, [c])]);
  qs.push({
    kind: 'flag',
    prompt: `Which flag belongs to ${c.name}?`,
    options: flagOpts,
    correct: flagOpts.indexOf(c),
    why: `That's the flag of ${c.name}.`,
  });

  const otherFacts = others.map(o => o.fact).filter(Boolean);
  if (c.fact && otherFacts.length >= 3) {
    qs.push(mcq(`Which of these is true about ${c.name}?`, c.fact, sample(otherFacts, 3, [c.fact]), c.fact));
  }

  const near = BY_ISO[NEIGHBOURS[c.iso][0]];
  const far  = sample(others.filter(o => arcDeg(c.pos, o.pos) > arcDeg(c.pos, near.pos) + 25), 3);
  if (far.length === 3) {
    qs.push(mcq(
      `Which of these countries lies closest to ${c.name}?`,
      near.name,
      far.map(o => o.name),
      `${near.name} is about ${kmText(kmBetween(c.pos, near.pos))} away, capital to capital.`
    ));
  }

  qs.push({
    kind: 'pin',
    prompt: `Spin the globe and tap ${c.name}.`,
    target: c.iso,
    why: `${c.name} is in ${c.region}, near ${near.name}.`,
  });

  return qs;
}

function isCapitalStop(city, c) {
  return deaccent(city.name) === deaccent(c.capital) || kmBetween([city.lng, city.lat], c.pos) < 15;
}

function cityFacts(city, c) {
  const facts = [];
  if (isCapitalStop(city, c)) {
    facts.push(`${city.name} is the capital of ${c.name}.`);
  } else {
    facts.push(`${city.name} is one of ${c.name}'s main cities, about ${kmText(kmBetween([city.lng, city.lat], c.pos))} from the capital, ${c.capital}.`);
  }
  const ns = city.lat >= 0 ? 'north' : 'south';
  const ew = city.lng >= 0 ? 'east' : 'west';
  facts.push(`${city.name} lies at about ${Math.abs(city.lat).toFixed(0)}° ${ns} and ${Math.abs(city.lng).toFixed(0)}° ${ew}.`);
  return facts;
}

function cityQuestions(city, c) {
  const others = countries.filter(o => o.iso !== c.iso);
  const pos = [city.lng, city.lat];
  const qs = [
    mcq(`${city.name} is a city in which country?`, c.name, sample(others, 3).map(o => o.name),
      `${city.name} is in ${c.name}.`),
  ];

  if (!SPANS[c.iso] && !AMBIGUOUS_REGION.has(c.iso)) {
    qs.push(mcq(`Which region would you fly to for ${city.name}?`, c.region,
      sample(REGIONS, 3, [c.region]), `${city.name} is in ${c.region}.`));
  }

  if (Math.abs(city.lat) >= 1) {
    const north = city.lat >= 0;
    qs.push(mcq(`Is ${city.name} north or south of the equator?`,
      north ? 'North of the equator' : 'South of the equator',
      [north ? 'South of the equator' : 'North of the equator', 'Exactly on the equator', 'It depends on the season'],
      `${city.name} sits at about ${Math.abs(city.lat).toFixed(0)}° ${north ? 'north' : 'south'}.`));
  }

  const rival = sample(others.filter(o => kmBetween(pos, o.pos) > 800), 1)[0];
  if (rival) {
    const d = kmBetween(pos, rival.pos);
    const round = km => `${GeoUtils.formatNumber(Math.max(100, Math.round(km / 100) * 100))} km`;
    const right = round(d);
    const wrongs = [...new Set([0.4, 1.9, 3.1].map(k => round(d * k)))].filter(x => x !== right);
    if (wrongs.length === 3) {
      qs.push(mcq(`Roughly how far is ${city.name} from ${rival.capital}, ${rival.name}?`, right, wrongs,
        `The great-circle distance is about ${kmText(d)}.`));
    }
  }

  return GeoUtils.shuffle(qs);
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

let prog       = loadProgress();
let sel        = null;     // selected country iso
let dailyIso   = null;     // today's destination
let mainGlobe  = null;
let lesson     = null;
let searchHits = [];
let searchIdx  = 0;

function stateOf(iso) {
  return prog.done[iso] ? 'done' : iso === dailyIso ? 'next' : 'plain';
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  readPalette();
  paintSky();

  try {
    const [list, facts, stops] = await Promise.all([
      GeoUtils.loadCountries(),
      fetchJSON('/data/globe-facts.json'),
      fetchJSON('/data/globe-cities.json'),
    ]);
    buildCountries(list, facts);
    CITY_STOPS = stops;
  } catch (err) {
    document.getElementById('screen-loading').textContent = 'Could not load the globe. Please refresh to try again.';
    return;
  }

  const rng = GeoUtils.makeRNG(GeoUtils.getDailySeed());
  dailyIso = countries[Math.floor(rng() * countries.length)].iso;
  if (!BY_ISO[prog.mascot]) prog.mascot = BY_ISO[HOME_ISO] ? HOME_ISO : countries[0].iso;

  document.getElementById('screen-loading').style.display = 'none';
  document.getElementById('screen-app').style.display = '';
  document.getElementById('brand-pip').innerHTML = pipSVG(30);

  mainGlobe = createGlobe(
    document.getElementById('main-stage'),
    document.getElementById('main-canvas'),
    document.getElementById('main-pip'),
    { stateOf, onSelect: goTo, mascotIso: prog.mascot }
  );

  bindSearch();
  renderStats();
  renderSheet();
}

function paintSky() {
  const sky = document.getElementById('gt-sky');
  let html = '';
  for (let i = 0; i < 46; i++) {
    const s = (Math.random() * 1.6 + 0.6).toFixed(1);
    html += `<span style="left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 100).toFixed(1)}%;` +
            `width:${s}px;height:${s}px;opacity:${(Math.random() * 0.5 + 0.12).toFixed(2)}"></span>`;
  }
  sky.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Top bar & search
// ---------------------------------------------------------------------------

function renderStats() {
  document.getElementById('stat-streak').textContent   = prog.streak;
  document.getElementById('stat-xp').textContent       = prog.xp;
  document.getElementById('stat-passport').textContent = Object.keys(prog.done).length;
  document.getElementById('search-input').placeholder  = `Search any of the ${countries.length} countries`;
}

function bindSearch() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', () => {
    const q = deaccent(input.value.trim());
    searchHits = q ? countries.filter(c => deaccent(c.name).includes(q)).slice(0, 6) : [];
    searchIdx = 0;
    renderSearch();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && searchHits.length) { e.preventDefault(); searchIdx = (searchIdx + 1) % searchHits.length; renderSearch(); }
    else if (e.key === 'ArrowUp' && searchHits.length) { e.preventDefault(); searchIdx = (searchIdx - 1 + searchHits.length) % searchHits.length; renderSearch(); }
    else if (e.key === 'Enter' && searchHits.length) { goTo(searchHits[searchIdx].iso); input.blur(); }
    else if (e.key === 'Escape') clearSearch();
  });
}

function renderSearch() {
  const box = document.getElementById('search-results');
  if (!searchHits.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  box.innerHTML = searchHits.map((c, i) => `
    <button class="gt-result${i === searchIdx ? ' active' : ''}" onclick="goTo('${c.iso}')">
      ${GeoUtils.flagImg(c.code, c.name)}
      <span class="gt-result-name">${esc(c.name)}</span>
      ${prog.done[c.iso] ? starsHTML(prog.done[c.iso].stars) : ''}
    </button>`).join('');
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  searchHits = [];
  renderSearch();
}

// ---------------------------------------------------------------------------
// Selection & bottom sheet
// ---------------------------------------------------------------------------

function goTo(iso) {
  if (!BY_ISO[iso]) return;
  sel = iso;
  mainGlobe.setSelected(iso);
  mainGlobe.flyTo(iso);
  clearSearch();
  renderSheet();
}

function closeSheet() {
  sel = null;
  mainGlobe.setSelected(null);
  renderSheet();
}

function renderSheet() {
  const sheet = document.getElementById('sheet');

  if (!sel) {
    const d = BY_ISO[dailyIso];
    sheet.innerHTML = `
      <div class="gt-sheet gt-sheet-in">
        <div class="gt-sheet-row">
          <div class="gt-sheet-flag">${GeoUtils.flagImg(d.code, d.name)}</div>
          <div class="gt-sheet-main">
            <div class="gt-sheet-label">Today's destination</div>
            <div class="gt-sheet-title">${esc(d.name)}</div>
            ${prog.done[d.iso] ? '<div class="gt-stamped">✓ Stamped</div>' : ''}
          </div>
          <button class="btn btn-primary gt-btn-sm" onclick="goTo('${d.iso}')">Fly there</button>
        </div>
      </div>`;
    return;
  }

  const c       = BY_ISO[sel];
  const done    = prog.done[c.iso];
  const locked  = !done;
  const stops   = cityStops(c);

  const cityRows = stops.map((ct, i) => {
    const cs = (done && done.cities && done.cities[ct.name]) || 0;
    const icon = locked ? '🔒' : cs ? '🏅' : '📍';
    const note = isCapitalStop(ct, c) ? '<span class="gt-city-note">Capital</span>' : '';
    return `
      <div class="gt-city">
        <span class="gt-city-icon">${icon}</span>
        <span class="gt-city-name">${esc(ct.name)}${note}</span>
        ${cs ? starsHTML(cs) : ''}
        <button class="btn btn-primary gt-btn-sm" ${locked ? 'disabled' : ''} onclick="startCity(${i})">${cs ? 'Replay' : 'Visit'}</button>
      </div>`;
  }).join('');

  sheet.innerHTML = `
    <div class="gt-sheet gt-sheet-scroll gt-sheet-in">
      <div class="gt-sheet-row">
        <div class="gt-sheet-flag">${GeoUtils.flagImg(c.code, c.name)}</div>
        <div class="gt-sheet-main">
          <div class="gt-sheet-title">${esc(c.name)}</div>
          <div class="gt-sheet-sub">${esc(c.capital)} · <span style="color:${REGION_HUE[c.region] || 'inherit'}">${esc(c.region)}</span></div>
        </div>
        <button class="gt-icon-btn" aria-label="Close" onclick="closeSheet()">×</button>
      </div>

      ${c.fact ? `<p class="gt-sheet-fact">${esc(c.fact)}</p>` : ''}

      <div class="gt-sheet-actions">
        <button class="btn ${done ? 'btn-outline' : 'btn-warm'}" onclick="startCountry()">
          ${done ? 'Practise again' : `Learn ${esc(c.name)}`}
        </button>
        ${done ? starsHTML(done.stars) : ''}
      </div>

      <div class="gt-cities">
        <div class="gt-cities-label">${locked ? `City stops unlock once you finish ${esc(c.name)}` : 'City stops'}</div>
        <div class="gt-city-list${locked ? ' locked' : ''}">${cityRows}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

function startCountry() {
  const c = BY_ISO[sel];
  if (!c) return;
  const base = countryQuestions(c);
  const pin  = base.filter(q => q.kind === 'pin');
  const rest = GeoUtils.shuffle(base.filter(q => q.kind !== 'pin')).slice(0, 4);
  openLesson({
    kind: 'country',
    iso: c.iso,
    title: c.name,
    sub: `${c.capital} · ${c.region}`,
    facts: countryFacts(c),
    questions: [...rest, ...pin],
  });
}

function startCity(i) {
  const c = BY_ISO[sel];
  if (!c || !prog.done[c.iso]) return;
  const city = cityStops(c)[i];
  if (!city) return;
  openLesson({
    kind: 'city',
    iso: c.iso,
    city,
    title: city.name,
    sub: c.name,
    facts: cityFacts(city, c),
    questions: cityQuestions(city, c),
  });
}

function openLesson(spec) {
  lesson = { ...spec, phase: 'brief', card: 0, qi: 0, picked: null, right: 0, hearts: 3, pinGlobe: null };
  document.getElementById('lesson').style.display = '';
  clearSearch();
  renderLesson();
}

function closeLesson() {
  destroyPinGlobe();
  lesson = null;
  document.getElementById('lesson').style.display = 'none';
  renderStats();
  renderSheet();
}

function destroyPinGlobe() {
  if (lesson && lesson.pinGlobe) {
    lesson.pinGlobe.destroy();
    lesson.pinGlobe = null;
  }
}

// Full redraw: used when the card, question or phase changes
function renderLesson() {
  destroyPinGlobe();
  renderLessonChrome();

  const body = document.getElementById('lesson-body');
  const L = lesson;

  if (L.phase === 'brief') {
    const head = L.kind === 'country'
      ? GeoUtils.flagImg(BY_ISO[L.iso].code, L.title)
      : '<div class="gt-brief-icon">📍</div>';
    body.innerHTML = `
      <div class="gt-fade-in">
        <div class="gt-brief-head">
          ${head}
          <h2 class="gt-brief-title">${esc(L.title)}</h2>
          <div class="gt-brief-sub">${esc(L.sub)}</div>
        </div>
        <div class="gt-fact-card"><p>${esc(L.facts[L.card])}</p></div>
        <div class="gt-dots">${L.facts.map((_, i) => `<span class="${i === L.card ? 'on' : ''}"></span>`).join('')}</div>
      </div>`;
  } else if (L.phase === 'quiz') {
    const q = L.questions[L.qi];
    let answers = '';
    if (q.kind === 'mcq') {
      answers = `<div class="gt-options">${q.options.map((o, i) =>
        `<button class="gt-opt" onclick="answerOption(${i})">${esc(o)}</button>`).join('')}</div>`;
    } else if (q.kind === 'flag') {
      answers = `<div class="gt-options flags">${q.options.map((o, i) =>
        `<button class="gt-opt gt-opt-flag" onclick="answerOption(${i})">
           <img src="https://flagcdn.com/w160/${o.code}.webp" alt="Flag option ${i + 1}">
         </button>`).join('')}</div>`;
    } else if (q.kind === 'pin') {
      answers = `
        <div class="gt-pin-stage" id="pin-stage">
          <canvas id="pin-canvas" aria-label="Globe. Drag to spin, tap a marker to answer."></canvas>
          <div class="gt-pip" id="pin-pip"></div>
        </div>`;
    }
    body.innerHTML = `
      <div class="gt-fade-in" id="question">
        <div class="gt-q-count">Question ${L.qi + 1} of ${L.questions.length}</div>
        <h3 class="gt-q-prompt">${esc(q.prompt)}</h3>
        ${answers}
      </div>`;

    if (q.kind === 'pin') {
      L.pinGlobe = createGlobe(
        document.getElementById('pin-stage'),
        document.getElementById('pin-canvas'),
        document.getElementById('pin-pip'),
        { pinMode: true, showPip: false, showLabels: false, mascotIso: prog.mascot, onSelect: answerPin }
      );
    }
  } else {
    body.innerHTML = resultHTML();
  }

  body.scrollTop = 0;
  renderLessonFoot();
}

function renderLessonChrome() {
  const L = lesson;
  const total = L.questions.length;
  const pct = L.phase === 'brief'
    ? ((L.card + 1) / L.facts.length) * 24
    : L.phase === 'quiz' ? 24 + (L.qi / total) * 76 : 100;
  document.getElementById('lesson-progress').style.width = `${pct}%`;
  const h = Math.max(0, L.hearts);
  document.getElementById('lesson-hearts').innerHTML =
    `${'♥'.repeat(h)}<span class="off">${'♥'.repeat(3 - h)}</span>`;
}

function renderLessonFoot() {
  const L = lesson;
  const foot = document.getElementById('lesson-foot');
  const wrap = document.getElementById('lesson-foot-wrap');
  wrap.className = 'gt-lesson-foot' + (L.picked ? (L.picked.ok ? ' ok' : ' bad') : '');

  if (L.phase === 'brief') {
    const last = L.card + 1 >= L.facts.length;
    foot.innerHTML = `
      <div class="gt-foot-note">${L.card + 1} of ${L.facts.length}</div>
      <button class="btn btn-outline" onclick="prevCard()" ${L.card === 0 ? 'disabled' : ''}>Back</button>
      <button class="btn btn-primary" id="lesson-primary" onclick="nextCard()">${last ? 'Start the quiz' : 'Next fact'}</button>`;
  } else if (L.phase === 'quiz') {
    const q = L.questions[L.qi];
    let note = '';
    if (L.picked) {
      note = `<div class="gt-fade-in">
        <div class="gt-foot-verdict ${L.picked.ok ? 'ok' : 'bad'}">${L.picked.ok ? 'Correct' : 'Not quite'}</div>
        <div class="gt-foot-why">${esc(q.why)}</div>
      </div>`;
    } else if (q.kind === 'pin') {
      note = 'Drag to spin, then tap a marker.';
    }
    const label = L.hearts <= 0 ? 'See results' : L.qi + 1 >= L.questions.length ? 'Finish' : 'Continue';
    const tone  = L.picked ? (L.picked.ok ? 'btn-green' : 'btn-red') : 'btn-outline';
    foot.innerHTML = `
      <div class="gt-foot-note">${note}</div>
      <button class="btn ${tone}" id="lesson-primary" onclick="nextQuestion()" ${L.picked ? '' : 'disabled'}>${label}</button>`;
  } else {
    foot.innerHTML = `
      <button class="btn btn-warm gt-foot-full" id="lesson-primary" onclick="closeLesson()">Back to the globe</button>
      ${L.phase === 'done' ? '<button class="btn share-btn" onclick="shareLesson()">Share</button>' : ''}`;
  }
}

function prevCard() {
  if (lesson.card > 0) { lesson.card--; renderLesson(); }
}

function nextCard() {
  if (lesson.card + 1 < lesson.facts.length) lesson.card++;
  else lesson.phase = 'quiz';
  renderLesson();
}

function recordAnswer(ok, value) {
  const L = lesson;
  if (!L || L.phase !== 'quiz' || L.picked) return false;
  L.picked = { ok, value };
  if (ok) {
    L.right++;
    GeoUtils.playCorrect();
  } else {
    L.hearts--;
    GeoUtils.playWrong();
    const qEl = document.getElementById('question');
    if (qEl) {
      qEl.classList.remove('gt-fade-in', 'gt-shake');
      void qEl.offsetWidth;   // restart the animation
      qEl.classList.add('gt-shake');
    }
  }
  renderLessonChrome();
  renderLessonFoot();
  return true;
}

function answerOption(i) {
  const q = lesson && lesson.questions[lesson.qi];
  if (!q || q.kind === 'pin') return;
  if (!recordAnswer(i === q.correct, i)) return;
  document.querySelectorAll('#question .gt-opt').forEach((btn, j) => {
    btn.disabled = true;
    if (j === q.correct) btn.classList.add('correct');
    else if (j === i) btn.classList.add('wrong');
  });
}

function answerPin(iso) {
  const q = lesson && lesson.questions[lesson.qi];
  if (!q || q.kind !== 'pin') return;
  const ok = iso === q.target;
  if (!recordAnswer(ok, iso)) return;
  GeoUtils.showFlash(ok);
  const g = lesson.pinGlobe;
  if (g) {
    g.set({ showPip: true, showLabels: true });
    g.setSelected(q.target);
    g.flyTo(q.target);
  }
}

function nextQuestion() {
  const L = lesson;
  if (!L || !L.picked) return;
  L.picked = null;
  if (L.hearts <= 0) { finishLesson(false); return; }
  if (L.qi + 1 >= L.questions.length) { finishLesson(true); return; }
  L.qi++;
  renderLesson();
}

function finishLesson(passed) {
  const L = lesson;
  const total = L.questions.length;
  const acc   = total ? L.right / total : 0;
  const stars = !passed ? 0 : acc === 1 ? 3 : acc >= 0.7 ? 2 : 1;
  const xp    = !passed ? 0 : L.right * 10 + (acc === 1 ? 25 : 0);

  const today = GeoUtils.getDailyDateKey();
  if (prog.lastDay !== today) {
    prog.streak = prog.lastDay === yesterdayKey() ? prog.streak + 1 : 1;
    prog.lastDay = today;
  }

  if (passed) {
    const prev = prog.done[L.iso] || { stars: 0, cities: {} };
    if (L.kind === 'country') {
      prog.done[L.iso] = { ...prev, stars: Math.max(prev.stars, stars) };
    } else {
      const cities = { ...(prev.cities || {}) };
      cities[L.city.name] = Math.max(cities[L.city.name] || 0, stars);
      prog.done[L.iso] = { ...prev, cities };
    }
  }

  prog.xp += xp;
  prog.mascot = L.iso;
  saveProgress();

  L.phase  = passed ? 'done' : 'out';
  L.stars  = stars;
  L.xpGain = xp;
  renderLesson();
}

function resultHTML() {
  const L = lesson;
  const out = L.phase === 'out';
  const head = out
    ? '<div class="gt-result-icon">🧭</div>'
    : L.kind === 'country'
      ? GeoUtils.flagImg(BY_ISO[L.iso].code, L.title)
      : '<div class="gt-result-icon">🏙️</div>';
  const colors = [PAL.warm, PAL.accent, PAL.text, '#f87171'];
  const confetti = L.stars >= 2
    ? Array.from({ length: 26 }, (_, i) =>
        `<span class="gt-confetti" style="left:${(Math.random() * 100).toFixed(1)}%;` +
        `background:${colors[i % 4]};animation-delay:${(Math.random() * 0.5).toFixed(2)}s"></span>`).join('')
    : '';
  return `
    <div class="gt-result-screen gt-pop">
      ${confetti}
      ${head}
      <h2 class="gt-result-title">${out ? 'Out of hearts' : L.stars === 3 ? 'Perfect run' : 'Stamped'}</h2>
      <div class="gt-result-sub">${out
        ? `Pip will wait for you in ${esc(L.title)}. Try again anytime.`
        : `${esc(L.title)} is in your passport.`}</div>
      <div class="gt-result-stars">${starsHTML(L.stars)}</div>
      <div class="gt-result-stats">
        <div class="gt-stat"><div class="gt-stat-value">${L.right}/${L.questions.length}</div><div class="gt-stat-label">correct</div></div>
        <div class="gt-stat"><div class="gt-stat-value">+${L.xpGain}</div><div class="gt-stat-label">XP</div></div>
      </div>
    </div>`;
}

function shareLesson() {
  if (!lesson) return;
  GeoUtils.share('Globetrotter', `${lesson.right}/${lesson.questions.length} in ${lesson.title}`, '⭐'.repeat(lesson.stars));
}

// ---------------------------------------------------------------------------
// Passport
// ---------------------------------------------------------------------------

function openPassport() {
  const done = countries.filter(c => prog.done[c.iso]);

  const regions = REGIONS.map(r => {
    const all = countries.filter(c => c.region === r);
    const n = all.filter(c => prog.done[c.iso]).length;
    return `
      <div class="gt-region">
        <div class="gt-region-name">${r}</div>
        <div class="gt-region-bar"><div style="width:${all.length ? (n / all.length) * 100 : 0}%;background:${REGION_HUE[r]}"></div></div>
        <div class="gt-region-count">${n}/${all.length}</div>
      </div>`;
  }).join('');

  const stamps = done.length === 0
    ? '<p class="gt-passport-empty">No stamps yet. Tap any marker on the globe and Pip will fly there.</p>'
    : `<div class="gt-stamps">${done.map(c => {
        const nCities = Object.keys(prog.done[c.iso].cities || {}).length;
        return `
          <button class="gt-opt gt-stamp" onclick="closePassport(); goTo('${c.iso}')">
            ${GeoUtils.flagImg(c.code, c.name)}
            <span class="gt-stamp-name">${esc(c.name)}</span>
            <span class="gt-stamp-cities">${nCities} ${nCities === 1 ? 'city' : 'cities'}</span>
            ${starsHTML(prog.done[c.iso].stars)}
          </button>`;
      }).join('')}</div>`;

  document.getElementById('passport-body').innerHTML = `
    <div class="gt-passport-head">
      <h2>Passport</h2>
      <div class="gt-passport-count">${done.length} of ${countries.length} stamped</div>
      <button class="gt-icon-btn" aria-label="Close passport" onclick="closePassport()">×</button>
    </div>
    <div class="gt-regions">${regions}</div>
    ${stamps}`;
  document.getElementById('passport').style.display = '';
}

function closePassport() {
  document.getElementById('passport').style.display = 'none';
}

// ---------------------------------------------------------------------------
// Keyboard: Enter advances a lesson, Escape closes the passport
// ---------------------------------------------------------------------------

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('passport').style.display !== 'none') closePassport();
    return;
  }
  if (e.key === 'Enter' && lesson && !(e.target instanceof HTMLButtonElement)) {
    const btn = document.getElementById('lesson-primary');
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  }
});

// ---------------------------------------------------------------------------
GeoUtils.mountMuteButton('.site-nav');
init();
