(function () {
  const bug = document.getElementById('bug');
  let state = null;
  let tickTimer = null;
  let lastCelebrationToken = null;
  let celebClearTimer = null;

  function fmtClock(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function ordinal(n) {
    const s = ['TH', 'ST', 'ND', 'RD'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function dots(container, used, total) {
    if (container._used === used && container._total === total) return;
    container._used = used;
    container._total = total;
    container.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const d = document.createElement('span');
      if (i < used) d.classList.add('used');
      container.appendChild(d);
    }
  }

  function pips(container, litCount, totalCount) {
    if (container._lit === litCount && container._total === totalCount) return;
    container._lit = litCount;
    container._total = totalCount;
    container.innerHTML = '';
    for (let i = 0; i < totalCount; i++) {
      const p = document.createElement('span');
      p.className = 'pip' + (i < litCount ? ' lit' : '');
      container.appendChild(p);
    }
  }

  function setLogo(imgEl, dataUrl) {
    const next = dataUrl || '';
    if (imgEl._logoUrl === next) {
      imgEl.style.visibility = next ? 'visible' : 'hidden';
      return;
    }
    imgEl._logoUrl = next;
    if (next) {
      imgEl.src = next;
      imgEl.style.visibility = 'visible';
    } else {
      imgEl.removeAttribute('src');
      imgEl.style.visibility = 'hidden';
    }
  }

  function hexToRgb(hex) {
    const h = (hex || '').replace('#', '');
    if (h.length !== 6) return { r: 15, g: 18, b: 24 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function applyAppearance(appearance) {
    const a = appearance || {};
    const { r, g, b } = hexToRgb(a.panelColor || '#0F1218');
    const opacity = typeof a.panelOpacity === 'number' ? a.panelOpacity : 0.94;
    const opacity2 = Math.min(1, opacity + 0.02);
    const root = document.documentElement;
    root.style.setProperty('--panel', `rgba(${r}, ${g}, ${b}, ${opacity})`);
    const r2 = Math.max(0, r - 5);
    const g2 = Math.max(0, g - 6);
    const b2 = Math.max(0, b - 8);
    root.style.setProperty('--panel-2', `rgba(${r2}, ${g2}, ${b2}, ${opacity2})`);

    const orientation = ['bottom', 'top', 'stack'].includes(a.orientation) ? a.orientation : 'bottom';
    bug.classList.remove('orient-bottom', 'orient-top', 'orient-stack');
    bug.classList.add('orient-' + orientation);

    const periodSize = Number(a.fonts && a.fonts.period != null ? a.fonts.period : a.periodFontSize);
    const periodPx = Number.isFinite(periodSize) ? Math.min(36, Math.max(8, Math.round(periodSize))) : 11;
    root.style.setProperty('--period-font-size', periodPx + 'px');
    window.ScorebugSync.FONT_CONTROLS.forEach((item) => {
      let value = a.fonts && a.fonts[item.key];
      if (value == null && item.key === 'period') value = a.periodFontSize;
      root.style.setProperty(item.css, window.ScorebugSync.clampFont(item, value) + 'px');
    });
  }

  function formatRecord(team, toggles) {
    if (!toggles.showRecords) return '';
    const overall = (team.recordOverall || '').trim();
    if (!overall) return '';
    const region = (team.recordRegion || '').trim();
    if (toggles.showRegionRecord && region) return `${overall} (${region})`;
    return overall;
  }

  function fitTeamName(nameEl, rowEl) {
    if (!nameEl || !rowEl) return;
    const chosen = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-team-name'));
    const maxPx = Number.isFinite(chosen) ? chosen : 16;
    const minPx = Math.min(maxPx, Math.max(8, Math.round(maxPx * 0.7)));
    nameEl.style.fontSize = maxPx + 'px';
    // Available width = row width minus rank (if shown)
    const rankEl = rowEl.querySelector('.team-rank');
    const rankW = rankEl && rankEl.classList.contains('show') ? rankEl.offsetWidth + 6 : 0;
    const avail = Math.max(20, rowEl.clientWidth - rankW);
    let size = maxPx;
    while (size > minPx && nameEl.scrollWidth > avail) {
      size -= 0.5;
      nameEl.style.fontSize = size + 'px';
    }
  }

  function paintTeamSide(side, team, toggles) {
    const nameEl = document.getElementById(side + 'Name');
    const rankEl = document.getElementById(side + 'Rank');
    const recordEl = document.getElementById(side + 'Record');
    const rowEl = nameEl.parentElement;

    nameEl.textContent = team.name || side.toUpperCase();

    const showRank = toggles.showRank && team.rank != null && team.rank !== '' && !isNaN(Number(team.rank));
    if (showRank) {
      rankEl.textContent = '#' + Number(team.rank);
      rankEl.classList.add('show');
    } else {
      rankEl.textContent = '';
      rankEl.classList.remove('show');
    }

    const recordText = formatRecord(team, toggles);
    if (recordText) {
      recordEl.textContent = recordText;
      recordEl.classList.add('show');
    } else {
      recordEl.textContent = '';
      recordEl.classList.remove('show');
    }

    const fonts = state && state.appearance && state.appearance.fonts;
    const nameSize = fonts && fonts.teamName != null ? fonts.teamName : 16;
    const fitKey = nameEl.textContent + '|' + rankEl.textContent + '|' + recordEl.textContent + '|' + nameSize;
    if (nameEl._fitKey !== fitKey) {
      nameEl._fitKey = fitKey;
      requestAnimationFrame(() => fitTeamName(nameEl, rowEl));
    }
  }

  function clearCelebrations() {
    ['celebAway', 'celebHome'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('play', 'kind-touchdown', 'kind-fieldgoal', 'kind-extrapoint', 'kind-points', 'kind-basket');
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.zIndex = '';
    });
    const lane = document.querySelector('.celeb-lane');
    if (lane) lane.setAttribute('aria-hidden', 'true');
  }

  function playCelebration(celebration) {
    if (!state || !celebration) return;
    const side = celebration.side;
    if (side !== 'home' && side !== 'away') return;

    const team = state.teams[side] || {};
    const color = team.color || '#D6483C';
    const name = team.name || side.toUpperCase();
    const type = celebration.type === 'basket' ? 'points' : celebration.type;
    const points = celebration.points != null
      ? celebration.points
      : (type === 'touchdown' ? 6 : (type === 'extrapoint' ? 1 : 0));

    const labels = {
      touchdown: 'TOUCHDOWN',
      fieldgoal: 'FIELD GOAL',
      extrapoint: 'EXTRA POINT',
      points: ''
    };
    const label = labels[type] != null ? labels[type] : '';
    const pointsOnly = type === 'points';
    const kindClass = pointsOnly
      ? 'kind-points'
      : (type === 'extrapoint' || type === 'fieldgoal' ? 'kind-' + type : 'kind-touchdown');

    clearCelebrations();

    const banner = document.getElementById(side === 'home' ? 'celebHome' : 'celebAway');
    if (!banner) return;

    banner.style.setProperty('--celeb-color', color);
    banner.classList.add(kindClass);

    const labelEl = banner.querySelector('.celeb-label');
    const pointsEl = banner.querySelector('.celeb-points');
    labelEl.textContent = label;
    pointsEl.textContent = points ? ('+' + points) : '';

    const logo = banner.querySelector('.celeb-logo');
    const fallback = banner.querySelector('.celeb-fallback');
    if (team.logo) {
      logo.src = team.logo;
      logo.classList.add('show');
      fallback.classList.remove('show');
    } else {
      logo.removeAttribute('src');
      logo.classList.remove('show');
      fallback.textContent = (name || '?').charAt(0).toUpperCase();
      fallback.classList.add('show');
    }

    const lane = document.querySelector('.celeb-lane');
    if (lane) lane.setAttribute('aria-hidden', 'false');

    banner.classList.remove('play');
    void banner.offsetWidth;
    banner.classList.add('play');

    clearTimeout(celebClearTimer);
    celebClearTimer = setTimeout(() => {
      clearCelebrations();
    }, 2700);
  }

  function maybePlayCelebration(celebration) {
    if (!celebration || !celebration.token || celebration.token === lastCelebrationToken) return;
    lastCelebrationToken = celebration.token;
    const okTypes = ['touchdown', 'fieldgoal', 'extrapoint', 'points', 'basket'];
    if (okTypes.includes(celebration.type) && (celebration.side === 'home' || celebration.side === 'away')) {
      playCelebration(celebration);
    }
  }

  let popupSig = '';
  function renderPopup(popup) {
    const el = document.getElementById('bugPopup');
    if (!popup || !popup.visible) {
      if (!el.classList.contains('hidden')) {
        el.classList.remove('visible');
        el.classList.add('hidden');
      }
      popupSig = '';
      return;
    }

    const title = (popup.title || '').trim();
    const subject = (popup.subject || '').trim();
    const stats = (popup.stats || []).filter((row) => (row.label || '').trim() || (row.value || '').trim());
    const sig = title + '\n' + subject + '\n' + stats.map((row) => (row.label || '') + '=' + (row.value || '')).join('|');
    const opening = !el.classList.contains('visible');
    if (sig === popupSig && !opening) return;
    popupSig = sig;

    document.getElementById('popupTitle').textContent = title;
    document.getElementById('popupTitle').style.display = title ? 'block' : 'none';
    document.getElementById('popupSubject').textContent = subject;
    document.getElementById('popupSubject').style.display = subject ? 'block' : 'none';

    const statsWrap = document.getElementById('popupStats');
    statsWrap.innerHTML = '';
    stats.forEach((row) => {
      const div = document.createElement('div');
      div.className = 'popup-stat-row';
      const label = document.createElement('span');
      label.className = 'popup-stat-label';
      label.textContent = row.label || '';
      const value = document.createElement('span');
      value.className = 'popup-stat-value';
      value.textContent = row.value || '';
      div.appendChild(label);
      div.appendChild(value);
      statsWrap.appendChild(div);
    });

    el.classList.remove('hidden');
    if (opening) {
      void el.offsetWidth;
      el.classList.add('visible');
    }
  }

  function render() {
    if (!state) return;
    const s = state;
    const t = s.toggles || {};
    const sport = s.meta.sport;

    bug.classList.toggle('hidden', !s.meta.visible);

    applyAppearance(s.appearance);

    // logos
    if (t.showTeamLogos) {
      setLogo(document.getElementById('homeLogo'), s.teams.home.logo);
      setLogo(document.getElementById('awayLogo'), s.teams.away.logo);
    } else {
      document.getElementById('homeLogo').style.visibility = 'hidden';
      document.getElementById('awayLogo').style.visibility = 'hidden';
    }
    const clockCutout = !!t.transparentClock;
    const eventWrap = document.getElementById('eventLogoWrap');
    eventWrap.classList.toggle('hidden-logo', !t.showEventLogo);
    if (t.showEventLogo) setLogo(document.getElementById('eventLogo'), s.event.logo);

    // names, ranks, records + score
    paintTeamSide('home', s.teams.home, t);
    paintTeamSide('away', s.teams.away, t);
    document.getElementById('homeScore').style.display = t.showScore ? 'block' : 'none';
    document.getElementById('awayScore').style.display = t.showScore ? 'block' : 'none';
    document.getElementById('homeScore').textContent = s.teams.home.score;
    document.getElementById('awayScore').textContent = s.teams.away.score;

    // color bars
    document.getElementById('homeBar').style.display = t.showColorBars ? 'block' : 'none';
    document.getElementById('awayBar').style.display = t.showColorBars ? 'block' : 'none';
    document.getElementById('homeBar').style.background = s.teams.home.color;
    document.getElementById('awayBar').style.background = s.teams.away.color;

    // possession
    const showPoss = t.showPossession && (sport === 'football' || sport === 'baseball');
    document.getElementById('possHome').classList.toggle('active', showPoss && s.possession === 'home');
    document.getElementById('possAway').classList.toggle('active', showPoss && s.possession === 'away');

    // period stays; transparentClock only clears the timer slot for a clock camera
    document.querySelector('.center-block').classList.toggle('clock-transparent', clockCutout);
    const periodEl = document.getElementById('periodLabel');
    periodEl.style.display = t.showPeriod ? 'block' : 'none';
    periodEl.textContent = s.period.label;
    periodEl.classList.toggle('pregame-label', s.meta.preset === 'pregame');
    const clockEl = document.getElementById('clockDisplay');
    // Keep slot sized when cutout is on so the camera window stays open
    const showDigitalClock = !clockCutout && t.showClock && s.clock.mode !== 'hidden';
    clockEl.style.display = (clockCutout || showDigitalClock) ? 'block' : 'none';
    clockEl.textContent = fmtClock(window.ScorebugSync.clockShown(s.clock));

    renderPopup(s.popup);
    maybePlayCelebration(s.celebration);

    // sub strip items
    const sub = {
      subDownDistance: t.showDownDistance && sport === 'football',
      subTimeouts: t.showTimeouts,
      subFouls: t.showFouls,
      subShotClock: t.showShotClock && sport === 'basketball',
      subBonus: t.showBonus && sport === 'basketball',
      subCount: t.showCount && sport === 'baseball',
      subRunners: t.showRunners && sport === 'baseball',
      subSets: t.showSets && sport === 'volleyball'
    };
    let anyVisible = false;
    Object.keys(sub).forEach((id) => {
      const el = document.getElementById(id);
      el.classList.toggle('show', !!sub[id]);
      if (sub[id]) anyVisible = true;
    });
    document.getElementById('subStrip').style.display = anyVisible ? 'flex' : 'none';

    if (sub.subDownDistance) {
      const f = s.sportData.football;
      const territory = f.ballSide === 'home' ? s.teams.home.name : s.teams.away.name;
      document.getElementById('subDownDistance').textContent =
        `${ordinal(f.down)} & ${f.distance} \u2022 BALL ON ${territory} ${f.yardLine}`;
    }
    if (sub.subTimeouts) {
      dots(document.getElementById('awayTimeoutDots'), s.teams.away.timeouts, 3);
      dots(document.getElementById('homeTimeoutDots'), s.teams.home.timeouts, 3);
    }
    if (sub.subFouls) {
      document.getElementById('subFouls').textContent =
        `FOULS ${s.teams.away.fouls} \u2013 ${s.teams.home.fouls}`;
    }
    if (sub.subShotClock) {
      document.getElementById('shotClockVal').textContent = Math.max(0, Math.round(window.ScorebugSync.shotShown(s.sportData.basketball)));
    }
    if (sub.subBonus) {
      const b = s.sportData.basketball.bonus;
      document.getElementById('subBonus').style.visibility = (b.home || b.away) ? 'visible' : 'hidden';
      document.getElementById('subBonus').textContent = b.home && b.away ? 'BONUS BOTH' : (b.home ? `BONUS: ${s.teams.home.name}` : (b.away ? `BONUS: ${s.teams.away.name}` : ''));
    }
    if (sub.subCount) {
      const bb = s.sportData.baseball;
      pips(document.getElementById('ballsCount'), bb.balls, 3);
      pips(document.getElementById('strikesCount'), bb.strikes, 2);
      pips(document.getElementById('outsCount'), bb.outs, 2);
    }
    if (sub.subRunners) {
      const r = s.sportData.baseball.runners;
      document.getElementById('baseFirst').classList.toggle('on', !!r.first);
      document.getElementById('baseSecond').classList.toggle('on', !!r.second);
      document.getElementById('baseThird').classList.toggle('on', !!r.third);
    }
    if (sub.subSets) {
      document.getElementById('awaySets').textContent = s.teams.away.setsWon;
      document.getElementById('homeSets').textContent = s.teams.home.setsWon;
    }
  }

  function paintClock() {
    if (!state) return;
    const clockEl = document.getElementById('clockDisplay');
    if (clockEl) clockEl.textContent = fmtClock(window.ScorebugSync.clockShown(state.clock));
    const shotEl = document.getElementById('shotClockVal');
    const ball = state.sportData && state.sportData.basketball;
    if (shotEl && ball) shotEl.textContent = String(Math.max(0, Math.round(window.ScorebugSync.shotShown(ball))));
  }

  function startLocalTick() {
    clearInterval(tickTimer);
    tickTimer = setInterval(paintClock, 200);
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (msg.type !== 'state' || !msg.state) return;
      if (!state) state = msg.state;
      else if (window.ScorebugSync.isNewer(msg.state, state)) state = window.ScorebugSync.deepMerge(state, msg.state);
      else return;
      render();
    };
    ws.onclose = () => setTimeout(connect, 1500);
    ws.onerror = () => ws.close();
  }

  window.addEventListener('resize', () => {
    if (state) {
      fitTeamName(document.getElementById('awayName'), document.getElementById('awayName').parentElement);
      fitTeamName(document.getElementById('homeName'), document.getElementById('homeName').parentElement);
    }
  });

  connect();
  startLocalTick();
})();
