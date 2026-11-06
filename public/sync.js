(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ScorebugSync = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function deepMerge(base, patch) {
    if (!isPlainObject(base)) return patch !== undefined ? patch : base;
    const out = { ...base };
    if (!isPlainObject(patch)) return out;
    for (const key of Object.keys(patch)) {
      const bv = base[key];
      const pv = patch[key];
      if (Array.isArray(pv)) out[key] = pv;
      else if (isPlainObject(bv) && isPlainObject(pv)) out[key] = deepMerge(bv, pv);
      else if (pv !== undefined) out[key] = pv;
    }
    return out;
  }

  function stamp(state) {
    const meta = state && state.meta;
    return {
      at: meta && meta.updatedAt ? meta.updatedAt : 0,
      rev: meta && meta.rev ? meta.rev : 0
    };
  }

  // True when `incoming` should replace `current`.
  function isNewer(incoming, current) {
    if (!incoming) return false;
    if (!current) return true;
    const a = stamp(incoming);
    const b = stamp(current);
    if (a.at !== b.at) return a.at > b.at;
    return a.rev > b.rev;
  }

  function elapsedSeconds(anchor, now) {
    if (!anchor) return 0;
    const delta = Math.floor(((now || Date.now()) - anchor) / 1000);
    return delta > 0 ? delta : 0;
  }

  function clockShown(clock, now) {
    if (!clock) return 0;
    const base = Number(clock.seconds) || 0;
    if (!clock.running) return base;
    const elapsed = elapsedSeconds(clock.anchor, now);
    if (clock.mode === 'countup') return base + elapsed;
    return Math.max(0, base - elapsed);
  }

  function shotShown(ball, now) {
    if (!ball) return 0;
    const base = Number(ball.shotClock) || 0;
    if (!ball.shotClockRunning) return base;
    return Math.max(0, base - elapsedSeconds(ball.shotClockAnchor, now));
  }

  const FONT_CONTROLS = [
    { key: 'teamName', label: 'Team name', def: 16, min: 10, max: 40, css: '--font-team-name' },
    { key: 'rank', label: 'Rank', def: 12, min: 8, max: 28, css: '--font-rank' },
    { key: 'record', label: 'Record', def: 11, min: 8, max: 24, css: '--font-record' },
    { key: 'score', label: 'Score', def: 46, min: 24, max: 80, css: '--font-score' },
    { key: 'period', label: 'Period', def: 11, min: 8, max: 36, css: '--font-period' },
    { key: 'clock', label: 'Clock', def: 32, min: 16, max: 72, css: '--font-clock' },
    { key: 'downDistance', label: 'Down & distance', def: 13, min: 8, max: 28, css: '--font-down-distance' },
    { key: 'timeouts', label: 'Timeouts', def: 11, min: 8, max: 24, css: '--font-timeouts' },
    { key: 'fouls', label: 'Fouls', def: 13, min: 8, max: 28, css: '--font-fouls' },
    { key: 'shotClock', label: 'Shot clock', def: 13, min: 8, max: 36, css: '--font-shot-clock' },
    { key: 'bonus', label: 'Bonus', def: 13, min: 8, max: 28, css: '--font-bonus' },
    { key: 'sets', label: 'Sets', def: 13, min: 8, max: 28, css: '--font-sets' },
    { key: 'count', label: 'Count labels', def: 10, min: 8, max: 22, css: '--font-count' },
    { key: 'popupTitle', label: 'Popup title', def: 11, min: 8, max: 28, css: '--font-popup-title' },
    { key: 'popupSubject', label: 'Popup name', def: 18, min: 10, max: 40, css: '--font-popup-subject' },
    { key: 'popupLabel', label: 'Popup stat label', def: 11, min: 8, max: 24, css: '--font-popup-label' },
    { key: 'popupValue', label: 'Popup stat value', def: 13, min: 8, max: 32, css: '--font-popup-value' },
    { key: 'celebLabel', label: 'Score call', def: 12, min: 8, max: 28, css: '--font-celeb-label' },
    { key: 'celebPoints', label: 'Score call points', def: 26, min: 14, max: 56, css: '--font-celeb-points' },
    { key: 'possession', label: 'Possession arrow', def: 14, min: 8, max: 32, css: '--font-possession' }
  ];

  function defaultFonts() {
    const fonts = {};
    FONT_CONTROLS.forEach((item) => { fonts[item.key] = item.def; });
    return fonts;
  }

  function clampFont(item, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return item.def;
    return Math.min(item.max, Math.max(item.min, Math.round(n)));
  }

  return { deepMerge, isNewer, clockShown, shotShown, FONT_CONTROLS, defaultFonts, clampFont };
});
