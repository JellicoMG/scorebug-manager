const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
    meta: { sport: 'football', visible: true, preset: 'live' },
    pregameBackup: null,
    event: { logo: null, name: 'FRIDAY NIGHT' },
    teams: {
      home: defaultTeam({ name: 'HOME', color: '#2E6DE0' }),
      away: defaultTeam({ name: 'AWAY', color: '#D6483C' })
    },
    period: { label: '1ST', number: 1 },
    clock: { seconds: 720, running: false, mode: 'countdown' },
    possession: null,
    sportData: {
      football: { down: 1, distance: 10, yardLine: 50, ballSide: 'home' },
      basketball: { shotClock: 24, shotClockRunning: false, bonus: { home: false, away: false } },
      baseball: { inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0, runners: { first: false, second: false, third: false } },
      soccer: { half: 1, stoppage: 0 },
      volleyball: { currentSet: 1 }
    },
    appearance: {
      panelColor: '#0F1218',
      panelOpacity: 0.94,
      orientation: 'bottom',
      periodFontSize: 11
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
    if (Array.isArray(pv)) {
      out[key] = pv;
    } else if (isPlainObject(bv) && isPlainObject(pv)) {
      out[key] = deepMerge(bv, pv);
    } else if (pv !== undefined) {
      out[key] = pv;
    }
  }
  return out;
}

function normalizeState(raw) {
  const merged = deepMerge(defaultState(), raw || {});
  // Ensure popup always has 4 stat rows
  const stats = Array.isArray(merged.popup.stats) ? merged.popup.stats.slice(0, 4) : [];
  while (stats.length < 4) stats.push({ label: '', value: '' });
  merged.popup.stats = stats.map((row) => ({
    label: row && row.label != null ? String(row.label) : '',
    value: row && row.value != null ? String(row.value) : ''
  }));
  return merged;
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch (e) {
    return defaultState();
  }
}

let currentState = loadState();
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeStateFile(currentState);
  }, 150);
}

function writeStateFile(state, cb) {
  fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), (err) => {
    if (err) console.error('Failed to save state:', err.message);
    if (cb) cb(err);
  });
}

function persistNow(cb) {
  clearTimeout(saveTimer);
  writeStateFile(currentState, cb);
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

function broadcast(data, exclude) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', state: currentState }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (msg.type === 'state' && msg.state) {
      currentState = normalizeState(msg.state);
      persist();
      broadcast({ type: 'state', state: currentState }, ws);
    } else if (msg.type === 'save') {
      if (msg.state) currentState = normalizeState(msg.state);
      persistNow((err) => {
        ws.send(JSON.stringify({
          type: 'saved',
          ok: !err,
          error: err ? err.message : null
        }));
      });
      broadcast({ type: 'state', state: currentState }, ws);
    } else if (msg.type === 'reset') {
      currentState = defaultState();
      persist();
      broadcast({ type: 'state', state: currentState });
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
