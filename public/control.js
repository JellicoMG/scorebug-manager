(function () {
  const Sync = window.ScorebugSync;
  const LOCAL_STATE_KEY = 'scorebug-state-v2';
  const LOGO_EVENT_KEY = 'scorebug-logo-event';
  const LOGO_HOME_KEY = 'scorebug-logo-home';
  const LOGO_AWAY_KEY = 'scorebug-logo-away';
  const LOGO_FLAG_KEY = 'scorebug-logos-stored';

  let state = null;
  let ws = null;
  let tickTimer = null;
  let suppressSend = false;
  let synced = false;
  let logosPending = false;
  let netTimer = null;
  let localTimer = null;

  const DEFAULT_CLOCK = {
    football: 720, basketball: 480, soccer: 0, baseball: 0, volleyball: 0, generic: 600
  };
  const DEFAULT_PERIOD_LABEL = {
    football: '1ST', basketball: '1ST', soccer: '1ST HALF', baseball: 'TOP 1ST', volleyball: 'SET 1', generic: '1'
  };
  const SCORE_BUTTONS = {
    football: [{ d: 1, l: '+1' }, { d: 2, l: '+2' }, { d: 3, l: '+3' }, { d: 6, l: '+6' }, { d: -1, l: '-1' }],
    basketball: [{ d: 1, l: '+1' }, { d: 2, l: '+2' }, { d: 3, l: '+3' }, { d: -1, l: '-1' }],
    baseball: [{ d: 1, l: '+1' }, { d: -1, l: '-1' }],
    soccer: [{ d: 1, l: '+1' }, { d: -1, l: '-1' }],
    volleyball: [{ d: 1, l: '+1' }, { d: -1, l: '-1' }],
    generic: [{ d: 1, l: '+1' }, { d: -1, l: '-1' }]
  };
  const SPORT_TOGGLE_DEFAULTS = {
    football: { showDownDistance: true, showTimeouts: true, showFouls: false, showShotClock: false, showBonus: false, showCount: false, showOuts: false, showRunners: false, showSets: false, showPossession: true },
    basketball: { showDownDistance: false, showTimeouts: true, showFouls: true, showShotClock: true, showBonus: true, showCount: false, showRunners: false, showSets: false, showPossession: false },
    baseball: { showDownDistance: false, showTimeouts: false, showFouls: false, showShotClock: false, showBonus: false, showCount: true, showRunners: true, showSets: false, showPossession: true },
    soccer: { showDownDistance: false, showTimeouts: false, showFouls: false, showShotClock: false, showBonus: false, showCount: false, showRunners: false, showSets: false, showPossession: false },
    volleyball: { showDownDistance: false, showTimeouts: true, showFouls: false, showShotClock: false, showBonus: false, showCount: false, showRunners: false, showSets: true, showPossession: false },
    generic: { showDownDistance: false, showTimeouts: false, showFouls: false, showShotClock: false, showBonus: false, showCount: false, showRunners: false, showSets: false, showPossession: false }
  };
  const TOGGLE_LABELS = [
    ['showEventLogo', 'Event / school logo'],
    ['showTeamLogos', 'Team logos'],
    ['showColorBars', 'Team color bars'],
    ['showScore', 'Score'],
    ['showClock', 'Clock'],
    ['transparentClock', 'Transparent clock (camera cutout)'],
    ['showPeriod', 'Period label'],
    ['showPossession', 'Possession arrow'],
    ['showRecords', 'Team records'],
    ['showRegionRecord', 'Region record (in parentheses)'],
    ['showRank', 'Team rankings'],
    ['showTimeouts', 'Timeouts'],
    ['showFouls', 'Fouls'],
    ['showDownDistance', 'Down & distance (football)'],
    ['showShotClock', 'Shot clock (basketball)'],
    ['showBonus', 'Bonus indicator (basketball)'],
    ['showCount', 'Balls / strikes / outs (baseball)'],
    ['showRunners', 'Base runners (baseball)'],
    ['showSets', 'Sets won (volleyball)']
  ];
  const PREGAME_TOGGLES = {
    showEventLogo: true,
    showTeamLogos: true,
    showColorBars: true,
    showScore: false,
    showClock: true,
    transparentClock: false,
    showPeriod: true,
    showPossession: false,
    showTimeouts: false,
    showFouls: false,
    showDownDistance: false,
    showShotClock: false,
    showBonus: false,
    showCount: false,
    showOuts: false,
    showRunners: false,
    showSets: false,
    showRecords: true,
    showRegionRecord: true
  };

  function $(id) { return document.getElementById(id); }

  function fmtClock(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
  function parseClock(text) {
    const parts = text.split(':').map((p) => parseInt(p, 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return parts[0] * 60 + parts[1];
    const n = parseInt(text, 10);
    return isNaN(n) ? 0 : n;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function compressLogo(dataUrl) {
    if (!dataUrl) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxSize = 360;
        const tooBig = Math.max(img.width, img.height) > maxSize || dataUrl.length > 180000;
        if (!tooBig) { resolve(dataUrl); return; }
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const jpeg = dataUrl.indexOf('data:image/jpeg') === 0 || dataUrl.indexOf('data:image/jpg') === 0;
        resolve(canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  let shrinkStarted = false;
  function maybeShrinkLogos() {
    if (shrinkStarted || !state) return;
    const logos = [state.event && state.event.logo, state.teams.home.logo, state.teams.away.logo];
    if (!logos.some((logo) => logo && logo.length > 180000)) return;
    shrinkStarted = true;
    Promise.all(logos.map((logo) => compressLogo(logo))).then(([eventLogo, homeLogo, awayLogo]) => {
      if (!state) return;
      let changed = false;
      if (eventLogo !== state.event.logo) { state.event.logo = eventLogo; changed = true; }
      if (homeLogo !== state.teams.home.logo) { state.teams.home.logo = homeLogo; changed = true; }
      if (awayLogo !== state.teams.away.logo) { state.teams.away.logo = awayLogo; changed = true; }
      if (!changed) return;
      logosPending = true;
      rememberLogos();
      setPreview('eventLogoPreview', state.event.logo);
      setPreview('awayLogoPreview', state.teams.away.logo);
      setPreview('homeLogoPreview', state.teams.home.logo);
      send();
    });
  }

  async function readLogo(file) {
    const raw = await fileToDataUrl(file);
    return compressLogo(raw);
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_STATE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !saved.meta || !saved.teams || !saved.teams.home || !saved.teams.away || !saved.clock || !saved.sportData) {
        return null;
      }
      if (!saved.event) saved.event = { name: '', logo: null };
      const eventLogo = localStorage.getItem(LOGO_EVENT_KEY);
      const homeLogo = localStorage.getItem(LOGO_HOME_KEY);
      const awayLogo = localStorage.getItem(LOGO_AWAY_KEY);
      saved.event.logo = eventLogo || null;
      saved.teams.home.logo = homeLogo || null;
      saved.teams.away.logo = awayLogo || null;
      return saved;
    } catch (e) {
      return null;
    }
  }

  function rememberLogos() {
    try {
      localStorage.setItem(LOGO_EVENT_KEY, (state.event && state.event.logo) || '');
      localStorage.setItem(LOGO_HOME_KEY, (state.teams.home && state.teams.home.logo) || '');
      localStorage.setItem(LOGO_AWAY_KEY, (state.teams.away && state.teams.away.logo) || '');
      localStorage.setItem(LOGO_FLAG_KEY, '1');
    } catch (e) { /* quota or private mode */ }
  }

  function flushLocal() {
    if (!state) return;
    try {
      localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state, (key, value) => (key === 'logo' ? undefined : value)));
      const haveLogos = !!(state.event && state.event.logo)
        || !!(state.teams.home && state.teams.home.logo)
        || !!(state.teams.away && state.teams.away.logo);
      if (logosPending || (haveLogos && localStorage.getItem(LOGO_FLAG_KEY) !== '1')) rememberLogos();
    } catch (e) { /* keep going; the server copy still updates */ }
  }

  function scheduleLocal() {
    clearTimeout(localTimer);
    localTimer = setTimeout(flushLocal, 60);
  }

  function wirePayload(includeLogos) {
    return JSON.stringify({ type: 'state', state }, (key, value) => {
      if (!includeLogos && key === 'logo') return undefined;
      return value;
    });
  }

  function flushNet() {
    if (suppressSend || !state || !synced || !ws || ws.readyState !== WebSocket.OPEN) return;
    const includeLogos = logosPending;
    ws.send(wirePayload(includeLogos));
    if (includeLogos) logosPending = false;
  }

  function send() {
    if (suppressSend || !state) return;
    if (!state.meta) state.meta = {};
    state.meta.rev = (state.meta.rev || 0) + 1;
    state.meta.updatedAt = Date.now();
    scheduleLocal();
    clearTimeout(netTimer);
    netTimer = setTimeout(flushNet, 40);
  }

  function adopt(incoming, merge) {
    if (merge && state) state = Sync.deepMerge(state, incoming);
    else state = incoming;
    if (state.clock && state.clock.running && !state.clock.anchor) {
      state.clock.anchor = Date.now();
      state.meta.rev = (state.meta.rev || 0) + 1;
      state.meta.updatedAt = Date.now();
      scheduleLocal();
      clearTimeout(netTimer);
      netTimer = setTimeout(flushNet, 40);
    }
    suppressSend = true;
    renderAll();
    suppressSend = false;
    startTick();
    flushLocal();
    maybeShrinkLogos();
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    synced = false;
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => {
      $('connStatus').textContent = 'connected';
      $('connStatus').className = 'conn-status live';
    };
    ws.onclose = () => {
      synced = false;
      $('connStatus').textContent = 'reconnecting\u2026';
      $('connStatus').className = 'conn-status down';
      setTimeout(connect, 1500);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (msg.type === 'saved') {
        const btn = $('saveBtn');
        if (!btn) return;
        btn.textContent = msg.ok ? 'Saved!' : 'Save failed';
        btn.classList.toggle('on', !!msg.ok);
        clearTimeout(btn._saveTimer);
        btn._saveTimer = setTimeout(() => {
          btn.textContent = 'Save';
          btn.classList.remove('on');
        }, 1400);
        return;
      }
      if (msg.type !== 'state' || !msg.state) return;
      if (!synced) {
        synced = true;
        if (!state || Sync.isNewer(msg.state, state)) adopt(msg.state, false);
        else if (Sync.isNewer(state, msg.state)) {
          const serverLogos = msg.state.event && msg.state.event.logo
            || msg.state.teams && msg.state.teams.home && msg.state.teams.home.logo
            || msg.state.teams && msg.state.teams.away && msg.state.teams.away.logo;
          const localLogos = state.event && state.event.logo
            || state.teams.home && state.teams.home.logo
            || state.teams.away && state.teams.away.logo;
          if (!serverLogos && localLogos) logosPending = true;
          flushNet();
        }
        return;
      }
      if (Sync.isNewer(msg.state, state)) adopt(msg.state, true);
    };
  }

  // ---------- rendering ----------

  function renderAll() {
    if (!state) return;
    $('sportSelect').value = state.meta.sport;
    document.querySelectorAll('.sport-panel').forEach((el) => {
      el.classList.toggle('active', el.dataset.sport === state.meta.sport);
    });

    const vis = $('visibilityToggle');
    vis.textContent = state.meta.visible ? 'Bug: ON AIR' : 'Bug: HIDDEN';
    vis.className = 'btn btn-toggle ' + (state.meta.visible ? 'on' : 'off');

    const pregameOn = state.meta.preset === 'pregame';
    const pgBtn = $('pregameBtn');
    pgBtn.textContent = pregameOn ? 'Pre-game: ON' : 'Pre-game';
    pgBtn.classList.toggle('on', pregameOn);
    const pgHint = $('pregameHint');
    if (pgHint) pgHint.hidden = !pregameOn;

    setPreview('eventLogoPreview', state.event.logo);
    setPreview('awayLogoPreview', state.teams.away.logo);
    setPreview('homeLogoPreview', state.teams.home.logo);
    $('awayName').value = state.teams.away.name;
    $('homeName').value = state.teams.home.name;
    $('awayColor').value = state.teams.away.color;
    $('homeColor').value = state.teams.home.color;

    renderTeamMeta();
    renderLogoFit();
    renderAppearance();
    renderPopup();
    renderToggles();
    renderScore();
    renderClockPeriod();
    renderPossession();
    renderTimeouts();
    renderFouls();
    renderFootball();
    renderBasketball();
    renderBaseball();
    renderSoccer();
    renderVolleyball();

    const url = `${location.protocol}//${location.host}/overlay.html`;
    $('overlayUrl').textContent = url;
    $('previewLink').href = url;
  }

  function setPreview(id, dataUrl) {
    const img = $(id);
    if (dataUrl) { img.src = dataUrl; img.style.opacity = 1; }
    else { img.removeAttribute('src'); img.style.opacity = 0.3; }
  }

  const LOGO_TARGETS = [
    { key: 'event', get: () => state.event, preview: 'eventLogoPreview' },
    { key: 'away', get: () => state.teams.away, preview: 'awayLogoPreview' },
    { key: 'home', get: () => state.teams.home, preview: 'homeLogoPreview' }
  ];

  function clampLogoScale(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 100;
    return Math.min(200, Math.max(50, Math.round(n)));
  }

  function clampLogoNudge(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.min(24, Math.max(-24, Math.round(n)));
  }

  function formatNudge(n, negativeLabel, positiveLabel) {
    if (!n) return 'centered';
    if (n < 0) return Math.abs(n) + ' px ' + negativeLabel;
    return n + ' px ' + positiveLabel;
  }

  function ensureLogoFit(obj) {
    if (!obj) return;
    obj.logoScale = clampLogoScale(obj.logoScale);
    obj.logoX = clampLogoNudge(obj.logoX);
    obj.logoY = clampLogoNudge(obj.logoY);
  }

  function renderLogoFit() {
    LOGO_TARGETS.forEach(({ key, get, preview }) => {
      const src = get();
      ensureLogoFit(src);
      const scaleEl = $(key + 'LogoScale');
      const xEl = $(key + 'LogoX');
      const yEl = $(key + 'LogoY');
      if (!scaleEl || !xEl || !yEl) return;
      if (document.activeElement !== scaleEl) scaleEl.value = String(src.logoScale);
      if (document.activeElement !== xEl) xEl.value = String(src.logoX);
      if (document.activeElement !== yEl) yEl.value = String(src.logoY);
      const base = key === 'event' ? 36 : 48;
      const px = Math.round(base * src.logoScale / 100);
      $(key + 'LogoScaleVal').textContent = src.logoScale + '% · ' + px + 'px';
      $(key + 'LogoXVal').textContent = formatNudge(src.logoX, 'left', 'right');
      $(key + 'LogoYVal').textContent = formatNudge(src.logoY, 'up', 'down');
      const img = $(preview);
      img.style.width = px + 'px';
      img.style.height = px + 'px';
      img.style.transform = 'translate(' + src.logoX + 'px, ' + src.logoY + 'px)';
    });
  }

  function ensurePopupShape() {
    if (!state.popup) {
      state.popup = { visible: false, title: '', subject: '', stats: [] };
    }
    if (!Array.isArray(state.popup.stats)) state.popup.stats = [];
    while (state.popup.stats.length < 4) state.popup.stats.push({ label: '', value: '' });
  }

  function clampPeriodFontSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 11;
    return Math.min(28, Math.max(8, Math.round(n)));
  }

  function ensureAppearance() {
    if (!state.appearance) state.appearance = { panelColor: '#0F1218', panelOpacity: 0.94, orientation: 'bottom', periodFontSize: 11, fonts: Sync.defaultFonts() };
    if (state.appearance.panelColor == null) state.appearance.panelColor = '#0F1218';
    if (typeof state.appearance.panelOpacity !== 'number') state.appearance.panelOpacity = 0.94;
    if (!['bottom', 'top', 'stack'].includes(state.appearance.orientation)) {
      state.appearance.orientation = 'bottom';
    }
    if (!state.appearance.fonts) state.appearance.fonts = {};
    Sync.FONT_CONTROLS.forEach((item) => {
      let value = state.appearance.fonts[item.key];
      if (value == null && item.key === 'period') value = state.appearance.periodFontSize;
      state.appearance.fonts[item.key] = Sync.clampFont(item, value);
    });
    state.appearance.periodFontSize = state.appearance.fonts.period;
  }

  function initFontSliders() {
    const wrap = $('fontSizes');
    if (!wrap || wrap.dataset.ready === '1') return;
    wrap.dataset.ready = '1';
    Sync.FONT_CONTROLS.forEach((item) => {
      const field = document.createElement('label');
      field.className = 'field';
      const name = document.createElement('span');
      name.textContent = item.label;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.id = 'fontSize_' + item.key;
      slider.min = String(item.min);
      slider.max = String(item.max);
      slider.step = '1';
      slider.value = String(item.def);
      const val = document.createElement('span');
      val.className = 'range-val';
      val.id = 'fontSizeVal_' + item.key;
      val.textContent = item.def + 'px';
      field.appendChild(name);
      field.appendChild(slider);
      field.appendChild(val);
      wrap.appendChild(field);
      slider.oninput = () => {
        ensureAppearance();
        const size = Sync.clampFont(item, slider.value);
        state.appearance.fonts[item.key] = size;
        if (item.key === 'period') state.appearance.periodFontSize = size;
        val.textContent = size + 'px';
        send();
      };
    });
  }

  function renderTeamMeta() {
    ['away', 'home'].forEach((side) => {
      const team = state.teams[side];
      if (team.recordOverall == null) team.recordOverall = '';
      if (team.recordRegion == null) team.recordRegion = '';
      const overallEl = $(side + 'RecordOverall');
      const regionEl = $(side + 'RecordRegion');
      const rankedEl = $(side + 'Ranked');
      const rankEl = $(side + 'Rank');
      if (document.activeElement !== overallEl) overallEl.value = team.recordOverall || '';
      if (document.activeElement !== regionEl) regionEl.value = team.recordRegion || '';
      const ranked = team.rank != null && team.rank !== '';
      rankedEl.checked = ranked;
      rankEl.disabled = !ranked;
      if (document.activeElement !== rankEl) rankEl.value = ranked ? team.rank : '';
    });
  }

  function renderAppearance() {
    ensureAppearance();
    const colorEl = $('panelColor');
    const opacityEl = $('panelOpacity');
    const orientEl = $('orientationSelect');
    const sizeEl = $('periodFontSize');
    if (document.activeElement !== colorEl) colorEl.value = state.appearance.panelColor || '#0F1218';
    if (document.activeElement !== opacityEl) opacityEl.value = String(state.appearance.panelOpacity);
    if (document.activeElement !== orientEl) orientEl.value = state.appearance.orientation || 'bottom';
    Sync.FONT_CONTROLS.forEach((item) => {
      const slider = $('fontSize_' + item.key);
      const val = $('fontSizeVal_' + item.key);
      if (!slider) return;
      const size = state.appearance.fonts[item.key];
      if (document.activeElement !== slider) slider.value = String(size);
      if (val) val.textContent = size + 'px';
    });
    $('panelOpacityVal').textContent = Math.round(state.appearance.panelOpacity * 100) + '%';
    $('periodFontSizeVal').textContent = state.appearance.periodFontSize + 'px';
  }

  function renderPopup() {
    ensurePopupShape();
    const titleEl = $('popupTitle');
    const subjectEl = $('popupSubject');
    if (document.activeElement !== titleEl) titleEl.value = state.popup.title || '';
    if (document.activeElement !== subjectEl) subjectEl.value = state.popup.subject || '';
    for (let i = 0; i < 4; i++) {
      const labelEl = $('popupStat' + i + 'Label');
      const valueEl = $('popupStat' + i + 'Value');
      const row = state.popup.stats[i] || { label: '', value: '' };
      if (document.activeElement !== labelEl) labelEl.value = row.label || '';
      if (document.activeElement !== valueEl) valueEl.value = row.value || '';
    }
    const deploy = $('popupDeployBtn');
    deploy.textContent = state.popup.visible ? 'On air' : 'Deploy';
    deploy.classList.toggle('on', !!state.popup.visible);
  }

  function renderToggles() {
    if (!state.toggles) state.toggles = {};
    const wrap = $('elementToggles');
    wrap.innerHTML = '';
    TOGGLE_LABELS.forEach(([key, label]) => {
      if (state.toggles[key] === undefined) {
        state.toggles[key] = key === 'showRegionRecord';
      }
      const row = document.createElement('div');
      row.className = 'toggle-row';
      const span = document.createElement('span');
      span.textContent = label;
      const sw = document.createElement('div');
      sw.className = 'switch' + (state.toggles[key] ? ' on' : '');
      sw.onclick = () => { state.toggles[key] = !state.toggles[key]; sw.classList.toggle('on'); send(); };
      row.appendChild(span);
      row.appendChild(sw);
      wrap.appendChild(row);
    });
  }

  function renderScore() {
    $('scoreLabelAway').textContent = state.teams.away.name || 'AWAY';
    $('scoreLabelHome').textContent = state.teams.home.name || 'HOME';
    $('scoreDisplayAway').textContent = state.teams.away.score;
    $('scoreDisplayHome').textContent = state.teams.home.score;

    const buttons = SCORE_BUTTONS[state.meta.sport] || SCORE_BUTTONS.generic;
    fillScoreButtons('scoreBtnsAway', buttons, 'away');
    fillScoreButtons('scoreBtnsHome', buttons, 'home');
  }

  function fillScoreButtons(containerId, buttons, side) {
    const c = $(containerId);
    c.innerHTML = '';
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-small';
      btn.textContent = b.l;
      btn.onclick = () => {
        state.teams[side].score = Math.max(0, state.teams[side].score + b.d);
        if (state.meta.sport === 'football') {
          if (b.d === 6) {
            state.celebration = { type: 'touchdown', side, points: 6, token: Date.now() };
          } else if (b.d === 3) {
            state.celebration = { type: 'fieldgoal', side, points: 3, token: Date.now() };
          } else if (b.d === 1) {
            state.celebration = { type: 'extrapoint', side, points: 1, token: Date.now() };
          } else if (b.d === 2) {
            state.celebration = { type: 'points', side, points: 2, token: Date.now() };
          }
        } else if ((b.d === 2 || b.d === 3) && state.meta.sport === 'basketball') {
          state.celebration = {
            type: 'points',
            side,
            points: b.d,
            token: Date.now()
          };
        }
        renderScore(); send();
      };
      c.appendChild(btn);
    });
  }

  function renderClockPeriod() {
    if (!document.activeElement || document.activeElement.id !== 'clockInput') {
      $('clockInput').value = fmtClock(Sync.clockShown(state.clock));
    }
    $('clockStartStop').textContent = state.clock.running ? 'Pause' : 'Start';
    $('clockStartStop').classList.toggle('btn-toggle', true);
    $('clockStartStop').classList.toggle('on', state.clock.running);
    $('clockMode').value = state.clock.mode;
    if (!document.activeElement || document.activeElement.id !== 'periodInput') {
      $('periodInput').value = state.period.label;
    }
  }

  function renderPossession() {
    $('possAwayBtn').classList.toggle('on', state.possession === 'away');
    $('possHomeBtn').classList.toggle('on', state.possession === 'home');
  }

  function renderTimeouts() {
    $('awayToVal').textContent = state.teams.away.timeouts;
    $('homeToVal').textContent = state.teams.home.timeouts;
  }
  function renderFouls() {
    $('awayFoulVal').textContent = state.teams.away.fouls;
    $('homeFoulVal').textContent = state.teams.home.fouls;
  }

  function renderFootball() {
    const f = state.sportData.football;
    document.querySelectorAll('.down-btn').forEach((b) => b.classList.toggle('active', parseInt(b.dataset.down, 10) === f.down));
    $('distVal').textContent = f.distance;
    $('ballSide').value = f.ballSide;
    $('yardVal').textContent = f.yardLine;
  }

  function renderBasketball() {
    const b = state.sportData.basketball;
    $('shotStartStop').textContent = b.shotClockRunning ? 'Pause' : 'Start';
    $('bonusAwayBtn').classList.toggle('on', b.bonus.away);
    $('bonusHomeBtn').classList.toggle('on', b.bonus.home);
  }

  function renderBaseball() {
    const b = state.sportData.baseball;
    $('inningVal').textContent = b.inning;
    $('halfToggle').textContent = b.half === 'top' ? 'Top' : 'Bottom';
    $('runner1').classList.toggle('on', b.runners.first);
    $('runner2').classList.toggle('on', b.runners.second);
    $('runner3').classList.toggle('on', b.runners.third);
  }

  function renderSoccer() {
    $('halfVal').textContent = state.sportData.soccer.half;
  }

  function renderVolleyball() {
    $('awaySetVal').textContent = state.teams.away.setsWon;
    $('homeSetVal').textContent = state.teams.home.setsWon;
  }

  // ---------- ticking ----------
  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (!state) return;
      const shown = Sync.clockShown(state.clock);
      const input = $('clockInput');
      if (input && document.activeElement !== input) input.value = fmtClock(shown);
      if (state.clock.running && state.clock.mode === 'countdown' && shown <= 0) {
        state.clock.seconds = 0;
        state.clock.running = false;
        state.clock.anchor = 0;
        renderClockPeriod();
        send();
      }
      const ball = state.sportData && state.sportData.basketball;
      if (ball && ball.shotClockRunning && Sync.shotShown(ball) <= 0) {
        ball.shotClock = 0;
        ball.shotClockRunning = false;
        ball.shotClockAnchor = 0;
        renderBasketball();
        send();
      }
    }, 200);
  }

  // ---------- collapsible cards ----------
  function cardStorageKey(card, index) {
    const title = (card.querySelector('.card-title') || card.querySelector('h2'));
    const label = title ? title.textContent.trim().toLowerCase().replace(/\s+/g, '-') : 'card';
    return 'scorebug-card-min:' + (card.id || label || index);
  }

  function setCardMinimized(card, minimized) {
    card.classList.toggle('minimized', minimized);
    const key = card.dataset.minKey;
    if (key) {
      try { localStorage.setItem(key, minimized ? '1' : '0'); } catch (e) { /* ignore */ }
    }
  }

  function initCollapsibleCards() {
    document.querySelectorAll('.card').forEach((card, index) => {
      if (card.dataset.collapsible === '1') return;
      const h2 = card.querySelector(':scope > h2');
      if (!h2) return;

      const titleText = h2.innerHTML;
      h2.classList.add('card-head');
      h2.innerHTML = '';
      const title = document.createElement('span');
      title.className = 'card-title';
      title.innerHTML = titleText;
      const chevron = document.createElement('span');
      chevron.className = 'card-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '\u25BE';
      h2.appendChild(title);
      h2.appendChild(chevron);
      h2.setAttribute('role', 'button');
      h2.setAttribute('tabindex', '0');
      h2.setAttribute('aria-expanded', 'true');

      const body = document.createElement('div');
      body.className = 'card-body';
      while (h2.nextSibling) body.appendChild(h2.nextSibling);
      card.appendChild(body);

      const key = cardStorageKey(card, index);
      card.dataset.minKey = key;
      card.dataset.collapsible = '1';

      let saved = null;
      try { saved = localStorage.getItem(key); } catch (e) { saved = null; }
      if (saved === '1') {
        card.classList.add('minimized');
        h2.setAttribute('aria-expanded', 'false');
      }

      const toggle = () => {
        const next = !card.classList.contains('minimized');
        setCardMinimized(card, next);
        h2.setAttribute('aria-expanded', next ? 'false' : 'true');
      };
      h2.addEventListener('click', toggle);
      h2.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  // ---------- wiring ----------
  function wire() {
    initCollapsibleCards();

    $('collapseAllBtn').onclick = () => {
      document.querySelectorAll('.card[data-collapsible="1"]').forEach((card) => {
        setCardMinimized(card, true);
        const h2 = card.querySelector('.card-head');
        if (h2) h2.setAttribute('aria-expanded', 'false');
      });
    };
    $('expandAllBtn').onclick = () => {
      document.querySelectorAll('.card[data-collapsible="1"]').forEach((card) => {
        setCardMinimized(card, false);
        const h2 = card.querySelector('.card-head');
        if (h2) h2.setAttribute('aria-expanded', 'true');
      });
    };
    function enterPregame() {
      state.pregameBackup = {
        toggles: Object.assign({}, state.toggles),
        periodLabel: state.period.label,
        periodNumber: state.period.number,
        clockMode: state.clock.mode,
        clockSeconds: Sync.clockShown(state.clock),
        clockRunning: state.clock.running
      };
      state.meta.preset = 'pregame';
      const keepRank = !!state.toggles.showRank;
      Object.assign(state.toggles, PREGAME_TOGGLES);
      state.toggles.showRank = keepRank;
      state.period.label = 'TIME TILL START';
      state.clock.mode = 'countdown';
      state.clock.running = false;
      state.clock.seconds = 900;
      state.clock.anchor = 0;
      if (state.popup) state.popup.visible = false;
    }

    function exitPregame() {
      const backup = state.pregameBackup;
      state.meta.preset = 'live';
      if (backup && backup.toggles) {
        state.toggles = Object.assign({}, state.toggles, backup.toggles);
        state.period.label = backup.periodLabel || DEFAULT_PERIOD_LABEL[state.meta.sport];
        state.period.number = backup.periodNumber != null ? backup.periodNumber : state.period.number;
        state.clock.mode = backup.clockMode || 'countdown';
        state.clock.seconds = backup.clockSeconds != null ? backup.clockSeconds : DEFAULT_CLOCK[state.meta.sport];
        state.clock.anchor = 0;
      } else {
        Object.assign(state.toggles, {
          showScore: true,
          showClock: true,
          showPeriod: true,
          showRecords: false
        }, SPORT_TOGGLE_DEFAULTS[state.meta.sport] || {});
        state.period.label = DEFAULT_PERIOD_LABEL[state.meta.sport];
        state.clock.seconds = DEFAULT_CLOCK[state.meta.sport];
        state.clock.mode = 'countdown';
        state.clock.anchor = 0;
      }
      state.clock.running = false;
      state.clock.anchor = 0;
      state.pregameBackup = null;
    }

    $('sportSelect').onchange = () => {
      state.meta.sport = $('sportSelect').value;
      if (state.meta.preset === 'pregame') {
        const keepRank = !!state.toggles.showRank;
        Object.assign(state.toggles, PREGAME_TOGGLES);
        state.toggles.showRank = keepRank;
        state.period.label = 'TIME TILL START';
        state.clock.mode = 'countdown';
        state.clock.anchor = 0;
      } else {
        Object.assign(state.toggles, SPORT_TOGGLE_DEFAULTS[state.meta.sport]);
        if (!state.clock.running) {
          state.clock.seconds = DEFAULT_CLOCK[state.meta.sport];
          state.clock.anchor = 0;
        }
        state.period.label = DEFAULT_PERIOD_LABEL[state.meta.sport];
      }
      renderAll(); send();
    };

    $('visibilityToggle').onclick = () => { state.meta.visible = !state.meta.visible; renderAll(); send(); };

    $('pregameBtn').onclick = () => {
      if (state.meta.preset === 'pregame') exitPregame();
      else enterPregame();
      renderAll();
      send();
    };

    $('saveBtn').onclick = () => {
      if (!state) return;
      clearTimeout(netTimer);
      flushLocal();
      const btn = $('saveBtn');
      if (!ws || ws.readyState !== WebSocket.OPEN || !synced) {
        btn.textContent = 'Saved on this device';
        btn.classList.add('on');
        clearTimeout(btn._saveTimer);
        btn._saveTimer = setTimeout(() => {
          btn.textContent = 'Save';
          btn.classList.remove('on');
        }, 1400);
        return;
      }
      btn.textContent = 'Saving…';
      const includeLogos = logosPending;
      ws.send(JSON.stringify({ type: 'save', state }, (key, value) => {
        if (!includeLogos && key === 'logo') return undefined;
        return value;
      }));
      if (includeLogos) logosPending = false;
    };

    $('resetBtn').onclick = () => {
      if (!confirm('Reset scores, clock and game state? Team names, logos and colors are kept.')) return;
      state.teams.home.score = 0; state.teams.away.score = 0;
      state.teams.home.timeouts = 3; state.teams.away.timeouts = 3;
      state.teams.home.fouls = 0; state.teams.away.fouls = 0;
      state.teams.home.setsWon = 0; state.teams.away.setsWon = 0;
      state.possession = null;
      state.clock = { seconds: DEFAULT_CLOCK[state.meta.sport], running: false, mode: state.clock.mode, anchor: 0 };
      state.period.label = DEFAULT_PERIOD_LABEL[state.meta.sport];
      state.period.number = 1;
      state.sportData = {
        football: { down: 1, distance: 10, yardLine: 50, ballSide: 'home' },
        basketball: { shotClock: 24, shotClockRunning: false, shotClockAnchor: 0, bonus: { home: false, away: false } },
        baseball: { inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0, runners: { first: false, second: false, third: false } },
        soccer: { half: 1, stoppage: 0 },
        volleyball: { currentSet: 1 }
      };
      renderAll(); send();
    };

    // logos
    $('eventLogoInput').onchange = async (e) => {
      if (!e.target.files[0]) return;
      state.event.logo = await readLogo(e.target.files[0]);
      logosPending = true;
      rememberLogos();
      renderAll();
      send();
    };
    $('eventLogoClear').onclick = () => { state.event.logo = null; logosPending = true; rememberLogos(); renderAll(); send(); };
    $('awayLogoInput').onchange = async (e) => {
      if (!e.target.files[0]) return;
      state.teams.away.logo = await readLogo(e.target.files[0]);
      logosPending = true;
      rememberLogos();
      renderAll();
      send();
    };
    $('awayLogoClear').onclick = () => { state.teams.away.logo = null; logosPending = true; rememberLogos(); renderAll(); send(); };
    $('homeLogoInput').onchange = async (e) => {
      if (!e.target.files[0]) return;
      state.teams.home.logo = await readLogo(e.target.files[0]);
      logosPending = true;
      rememberLogos();
      renderAll();
      send();
    };
    $('homeLogoClear').onclick = () => { state.teams.home.logo = null; logosPending = true; rememberLogos(); renderAll(); send(); };

    LOGO_TARGETS.forEach(({ key, get }) => {
      $(key + 'LogoScale').oninput = () => {
        const src = get();
        src.logoScale = clampLogoScale($(key + 'LogoScale').value);
        renderLogoFit();
        send();
      };
      $(key + 'LogoX').oninput = () => {
        const src = get();
        src.logoX = clampLogoNudge($(key + 'LogoX').value);
        renderLogoFit();
        send();
      };
      $(key + 'LogoY').oninput = () => {
        const src = get();
        src.logoY = clampLogoNudge($(key + 'LogoY').value);
        renderLogoFit();
        send();
      };
      $(key + 'LogoReset').onclick = () => {
        const src = get();
        src.logoScale = 100;
        src.logoX = 0;
        src.logoY = 0;
        renderLogoFit();
        send();
      };
    });

    // team names / colors / records / ranks
    $('awayName').oninput = () => { state.teams.away.name = $('awayName').value || 'AWAY'; renderScore(); send(); };
    $('homeName').oninput = () => { state.teams.home.name = $('homeName').value || 'HOME'; renderScore(); send(); };
    $('awayColor').oninput = () => { state.teams.away.color = $('awayColor').value; send(); };
    $('homeColor').oninput = () => { state.teams.home.color = $('homeColor').value; send(); };

    ['away', 'home'].forEach((side) => {
      $(side + 'RecordOverall').oninput = () => {
        state.teams[side].recordOverall = $(side + 'RecordOverall').value;
        send();
      };
      $(side + 'RecordRegion').oninput = () => {
        state.teams[side].recordRegion = $(side + 'RecordRegion').value;
        send();
      };
      $(side + 'Ranked').onchange = () => {
        const on = $(side + 'Ranked').checked;
        $(side + 'Rank').disabled = !on;
        if (on) {
          if (!$(side + 'Rank').value) $(side + 'Rank').value = '1';
          state.teams[side].rank = parseInt($(side + 'Rank').value, 10) || 1;
        } else {
          state.teams[side].rank = null;
          $(side + 'Rank').value = '';
        }
        send();
      };
      $(side + 'Rank').oninput = () => {
        if (!$(side + 'Ranked').checked) return;
        const n = parseInt($(side + 'Rank').value, 10);
        state.teams[side].rank = isNaN(n) ? null : n;
        send();
      };
    });

    // appearance
    $('orientationSelect').onchange = () => {
      ensureAppearance();
      state.appearance.orientation = $('orientationSelect').value;
      send();
    };
    $('panelColor').oninput = () => {
      ensureAppearance();
      state.appearance.panelColor = $('panelColor').value;
      send();
    };
    $('panelOpacity').oninput = () => {
      ensureAppearance();
      state.appearance.panelOpacity = parseFloat($('panelOpacity').value);
      $('panelOpacityVal').textContent = Math.round(state.appearance.panelOpacity * 100) + '%';
      send();
    };
    $('periodFontSize').oninput = () => {
      ensureAppearance();
      state.appearance.periodFontSize = clampPeriodFontSize($('periodFontSize').value);
      $('periodFontSizeVal').textContent = state.appearance.periodFontSize + 'px';
      send();
    };

    initFontSliders();

    // special stats popup
    $('popupTitle').oninput = () => { ensurePopupShape(); state.popup.title = $('popupTitle').value; send(); };
    $('popupSubject').oninput = () => { ensurePopupShape(); state.popup.subject = $('popupSubject').value; send(); };
    for (let i = 0; i < 4; i++) {
      const idx = i;
      $('popupStat' + idx + 'Label').oninput = () => {
        ensurePopupShape();
        state.popup.stats[idx].label = $('popupStat' + idx + 'Label').value;
        send();
      };
      $('popupStat' + idx + 'Value').oninput = () => {
        ensurePopupShape();
        state.popup.stats[idx].value = $('popupStat' + idx + 'Value').value;
        send();
      };
    }
    $('popupDeployBtn').onclick = () => {
      ensurePopupShape();
      state.popup.visible = true;
      renderPopup();
      send();
    };
    $('popupHideBtn').onclick = () => {
      ensurePopupShape();
      state.popup.visible = false;
      renderPopup();
      send();
    };

    // clock
    $('clockStartStop').onclick = () => {
      state.clock.seconds = Sync.clockShown(state.clock);
      state.clock.running = !state.clock.running;
      state.clock.anchor = state.clock.running ? Date.now() : 0;
      renderClockPeriod();
      send();
    };
    $('clockReset').onclick = () => {
      state.clock.seconds = DEFAULT_CLOCK[state.meta.sport];
      state.clock.running = false;
      state.clock.anchor = 0;
      renderClockPeriod();
      send();
    };
    $('clockInput').onchange = () => {
      state.clock.seconds = parseClock($('clockInput').value);
      state.clock.anchor = state.clock.running ? Date.now() : 0;
      send();
    };
    $('clockMode').onchange = () => {
      state.clock.seconds = Sync.clockShown(state.clock);
      state.clock.mode = $('clockMode').value;
      state.clock.anchor = state.clock.running ? Date.now() : 0;
      send();
    };
    $('periodInput').onchange = () => { state.period.label = $('periodInput').value; send(); };
    $('periodPrev').onclick = () => { state.period.number = Math.max(1, state.period.number - 1); send(); };
    $('periodNext').onclick = () => { state.period.number = state.period.number + 1; send(); };

    // possession
    $('possAwayBtn').onclick = () => { state.possession = state.possession === 'away' ? null : 'away'; renderPossession(); send(); };
    $('possHomeBtn').onclick = () => { state.possession = state.possession === 'home' ? null : 'home'; renderPossession(); send(); };
    $('possNoneBtn').onclick = () => { state.possession = null; renderPossession(); send(); };

    // timeouts
    $('awayToMinus').onclick = () => { state.teams.away.timeouts = Math.max(0, state.teams.away.timeouts - 1); renderTimeouts(); send(); };
    $('awayToPlus').onclick = () => { state.teams.away.timeouts = Math.min(9, state.teams.away.timeouts + 1); renderTimeouts(); send(); };
    $('homeToMinus').onclick = () => { state.teams.home.timeouts = Math.max(0, state.teams.home.timeouts - 1); renderTimeouts(); send(); };
    $('homeToPlus').onclick = () => { state.teams.home.timeouts = Math.min(9, state.teams.home.timeouts + 1); renderTimeouts(); send(); };

    // fouls
    $('awayFoulMinus').onclick = () => { state.teams.away.fouls = Math.max(0, state.teams.away.fouls - 1); renderFouls(); send(); };
    $('awayFoulPlus').onclick = () => { state.teams.away.fouls += 1; renderFouls(); send(); };
    $('homeFoulMinus').onclick = () => { state.teams.home.fouls = Math.max(0, state.teams.home.fouls - 1); renderFouls(); send(); };
    $('homeFoulPlus').onclick = () => { state.teams.home.fouls += 1; renderFouls(); send(); };

    // football
    document.querySelectorAll('.down-btn').forEach((b) => {
      b.onclick = () => { state.sportData.football.down = parseInt(b.dataset.down, 10); renderFootball(); send(); };
    });
    $('distMinus').onclick = () => { state.sportData.football.distance = Math.max(0, state.sportData.football.distance - 1); renderFootball(); send(); };
    $('distPlus').onclick = () => { state.sportData.football.distance += 1; renderFootball(); send(); };
    $('ballSide').onchange = () => { state.sportData.football.ballSide = $('ballSide').value; send(); };
    $('yardMinus').onclick = () => { state.sportData.football.yardLine = Math.max(0, state.sportData.football.yardLine - 1); renderFootball(); send(); };
    $('yardPlus').onclick = () => { state.sportData.football.yardLine = Math.min(50, state.sportData.football.yardLine + 1); renderFootball(); send(); };

    // basketball
    $('shotStartStop').onclick = () => {
      const ball = state.sportData.basketball;
      ball.shotClock = Sync.shotShown(ball);
      ball.shotClockRunning = !ball.shotClockRunning;
      ball.shotClockAnchor = ball.shotClockRunning ? Date.now() : 0;
      renderBasketball();
      send();
    };
    $('shot24').onclick = () => {
      const ball = state.sportData.basketball;
      ball.shotClock = 24;
      ball.shotClockAnchor = ball.shotClockRunning ? Date.now() : 0;
      send();
    };
    $('shot14').onclick = () => {
      const ball = state.sportData.basketball;
      ball.shotClock = 14;
      ball.shotClockAnchor = ball.shotClockRunning ? Date.now() : 0;
      send();
    };
    $('bonusAwayBtn').onclick = () => { state.sportData.basketball.bonus.away = !state.sportData.basketball.bonus.away; renderBasketball(); send(); };
    $('bonusHomeBtn').onclick = () => { state.sportData.basketball.bonus.home = !state.sportData.basketball.bonus.home; renderBasketball(); send(); };

    // baseball
    $('inningMinus').onclick = () => { state.sportData.baseball.inning = Math.max(1, state.sportData.baseball.inning - 1); renderBaseball(); send(); };
    $('inningPlus').onclick = () => { state.sportData.baseball.inning += 1; renderBaseball(); send(); };
    $('halfToggle').onclick = () => { state.sportData.baseball.half = state.sportData.baseball.half === 'top' ? 'bottom' : 'top'; renderBaseball(); send(); };
    $('ballPlus').onclick = () => {
      const b = state.sportData.baseball;
      b.balls += 1; if (b.balls > 3) { b.balls = 0; }
      renderBaseball(); send();
    };
    $('strikePlus').onclick = () => {
      const b = state.sportData.baseball;
      b.strikes += 1; if (b.strikes > 2) { b.strikes = 0; b.balls = 0; }
      renderBaseball(); send();
    };
    $('outPlus').onclick = () => {
      const b = state.sportData.baseball;
      b.outs += 1;
      if (b.outs > 2) { b.outs = 0; b.balls = 0; b.strikes = 0; b.runners = { first: false, second: false, third: false }; }
      renderBaseball(); send();
    };
    $('countReset').onclick = () => { const b = state.sportData.baseball; b.balls = 0; b.strikes = 0; renderBaseball(); send(); };
    $('runner1').onclick = () => { state.sportData.baseball.runners.first = !state.sportData.baseball.runners.first; renderBaseball(); send(); };
    $('runner2').onclick = () => { state.sportData.baseball.runners.second = !state.sportData.baseball.runners.second; renderBaseball(); send(); };
    $('runner3').onclick = () => { state.sportData.baseball.runners.third = !state.sportData.baseball.runners.third; renderBaseball(); send(); };

    // soccer
    $('halfMinus').onclick = () => { state.sportData.soccer.half = Math.max(1, state.sportData.soccer.half - 1); renderSoccer(); send(); };
    $('halfPlus').onclick = () => { state.sportData.soccer.half += 1; renderSoccer(); send(); };

    // volleyball
    $('awaySetMinus').onclick = () => { state.teams.away.setsWon = Math.max(0, state.teams.away.setsWon - 1); renderVolleyball(); send(); };
    $('awaySetPlus').onclick = () => { state.teams.away.setsWon += 1; renderVolleyball(); send(); };
    $('homeSetMinus').onclick = () => { state.teams.home.setsWon = Math.max(0, state.teams.home.setsWon - 1); renderVolleyball(); send(); };
    $('homeSetPlus').onclick = () => { state.teams.home.setsWon += 1; renderVolleyball(); send(); };

    $('copyUrlBtn').onclick = () => {
      navigator.clipboard.writeText($('overlayUrl').textContent).then(() => {
        $('copyUrlBtn').textContent = 'Copied!';
        setTimeout(() => { $('copyUrlBtn').textContent = 'Copy'; }, 1200);
      });
    };
  }

  wire();
  state = loadLocal();
  if (state) {
    suppressSend = true;
    renderAll();
    suppressSend = false;
    startTick();
    maybeShrinkLogos();
  }
  window.addEventListener('pagehide', flushLocal);
  connect();
})();
