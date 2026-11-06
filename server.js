const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Sync = require('./public/sync.js');

const PORT = process.env.PORT || 4173;
const STATE_FILE = path.join(__dirname, 'state.json');

function defaultTeam(overrides) {
  return {
    name: 'HOME',
    logo: null,
    color: '#2E6DE0',
    score: 0,
    timeouts: 3,
    fouls: 0,
    setsWon: 0,
    recordOverall: '',
    recordRegion: '',
    rank: null,
    ...overrides
  };
}

function defaultState() {
  return {
    meta: { sport: 'football', visible: true, preset: 'live', rev: 0, updatedAt: 0 },
    pregameBackup: null,
    event: { logo: null, name: 'FRIDAY NIGHT' },
    teams: {
      home: defaultTeam({ name: 'HOME', color: '#2E6DE0' }),
      away: defaultTeam({ name: 'AWAY', color: '#D6483C' })
    },
    period: { label: '1ST', number: 1 },
    clock: { seconds: 720, running: false, mode: 'countdown', anchor: 0 },
    possession: null,
    sportData: {
      football: { down: 1, distance: 10, yardLine: 50, ballSide: 'home' },
      basketball: { shotClock: 24, shotClockRunning: false, shotClockAnchor: 0, bonus: { home: false, away: false } },
      baseball: { inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0, runners: { first: false, second: false, third: false } },
      soccer: { half: 1, stoppage: 0 },
      volleyball: { currentSet: 1 }
    },
    appearance: {
      panelColor: '#0F1218',
      panelOpacity: 0.94,
      orientation: 'bottom',
      periodFontSize: 11,
      fonts: Sync.defaultFonts()
    },
    popup: {
      visible: false,
      title: '',
      subject: '',
      stats: [
        { label: '', value: '' },
        { label: '', value: '' },
        { label: '', value: '' },
        { label: '', value: '' }
      ]
    },
    celebration: null,
    toggles: {
      showEventLogo: true,
      showTeamLogos: true,
      showColorBars: true,
      showScore: true,
      showClock: true,
      transparentClock: false,
      showPeriod: true,
      showPossession: true,
      showTimeouts: true,
      showFouls: false,
      showDownDistance: true,
      showShotClock: false,
      showBonus: false,
      showCount: false,
      showOuts: false,
      showRunners: false,
      showSets: false,
      showRecords: false,
      showRegionRecord: true,
      showRank: false
    }
  };
}

function normalizeState(raw) {
  const merged = Sync.deepMerge(defaultState(), raw || {});
  // Ensure popup always has 4 stat rows
  const stats = Array.isArray(merged.popup.stats) ? merged.popup.stats.slice(0, 4) : [];
  while (stats.length < 4) stats.push({ label: '', value: '' });
  merged.popup.stats = stats.map((row) => ({
    label: row && row.label != null ? String(row.label) : '',
    value: row && row.value != null ? String(row.value) : ''
  }));
  const savedFonts = raw && raw.appearance && raw.appearance.fonts;
  Sync.FONT_CONTROLS.forEach((item) => {
    let value = savedFonts && savedFonts[item.key];
    if (value == null && item.key === 'period' && raw && raw.appearance) value = raw.appearance.periodFontSize;
    merged.appearance.fonts[item.key] = Sync.clampFont(item, value);
  });
  merged.appearance.periodFontSize = merged.appearance.fonts.period;
  return merged;
}

function tryLoad(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.teams || !parsed.meta || !parsed.clock) return null;
    return normalizeState(parsed);
  } catch (e) {
    return null;
  }
}

function loadState() {
  const main = tryLoad(STATE_FILE);
  if (main) return main;
  const backup = tryLoad(STATE_FILE + '.bak');
  if (backup) {
    console.warn('state.json was unreadable. Restored the last good save.');
    return backup;
  }
  return defaultState();
}

let currentState = loadState();
let saveTimer = null;
let writeChain = Promise.resolve();

function writeAtomic(state) {
  return new Promise((resolve) => {
    let json;
    try {
      json = JSON.stringify(state);
    } catch (e) {
      console.error('Failed to save state:', e.message);
      return resolve(e);
    }
    const tmp = STATE_FILE + '.tmp';
    const bak = STATE_FILE + '.bak';
    fs.writeFile(tmp, json, (err) => {
      if (err) {
        console.error('Failed to save state:', err.message);
        return resolve(err);
      }
      fs.copyFile(STATE_FILE, bak, () => {
        fs.rename(tmp, STATE_FILE, (renameErr) => {
          if (!renameErr) return resolve(null);
          fs.copyFile(tmp, STATE_FILE, (copyErr) => {
            fs.unlink(tmp, () => {
              if (copyErr) console.error('Failed to save state:', copyErr.message);
              resolve(copyErr || null);
            });
          });
        });
      });
    });
  });
}

function enqueueWrite(cb) {
  const snapshot = currentState;
  writeChain = writeChain.then(() => writeAtomic(snapshot)).then((err) => {
    if (cb) cb(err);
  });
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => enqueueWrite(), 400);
}

function persistNow(cb) {
  clearTimeout(saveTimer);
  enqueueWrite(cb);
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function messageIncludesLogos(state) {
  if (!state) return false;
  return hasOwn(state.event, 'logo')
    || (state.teams && (hasOwn(state.teams.home, 'logo') || hasOwn(state.teams.away, 'logo')));
}

function applyIncoming(incoming) {
  if (!incoming || typeof incoming !== 'object') return null;
  if (!Sync.isNewer(incoming, currentState)) return null;
  const includeLogos = messageIncludesLogos(incoming);
  currentState = normalizeState(Sync.deepMerge(currentState, incoming));
  persist();
  return includeLogos;
}

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/control.html');
});

app.get('/api/state', (req, res) => res.json(currentState));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function pack(state, includeLogos) {
  return JSON.stringify({ type: 'state', state }, (key, value) => {
    if (!includeLogos && key === 'logo') return undefined;
    return value;
  });
}

function broadcast(payload, exclude) {
  wss.clients.forEach((client) => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  ws.send(pack(currentState, true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (msg.type === 'state' && msg.state) {
      const includeLogos = applyIncoming(msg.state);
      if (includeLogos === null) return;
      broadcast(pack(currentState, includeLogos), ws);
    } else if (msg.type === 'save') {
      let includeLogos = false;
      if (msg.state) {
        const applied = applyIncoming(msg.state);
        if (applied !== null) includeLogos = applied;
      }
      persistNow((err) => {
        ws.send(JSON.stringify({
          type: 'saved',
          ok: !err,
          error: err ? err.message : null
        }));
      });
      broadcast(pack(currentState, includeLogos), ws);
    }
  });
});

function localIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, () => {
  console.log('');
  console.log('  Scorebug Manager is running');
  console.log('  -----------------------------');
  console.log(`  Control panel : http://localhost:${PORT}/control.html`);
  console.log(`  OBS overlay   : http://localhost:${PORT}/overlay.html`);
  const ips = localIPs();
  if (ips.length) {
    console.log('');
    console.log('  On your local network (e.g. for a second laptop running OBS):');
    ips.forEach((ip) => console.log(`    http://${ip}:${PORT}/control.html`));
  }
  console.log('');
});
