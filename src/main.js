import { App } from './control/app.js';
import Papa from 'papaparse';

const app = new App();
await app.init();

/* -----------------------
   HUD
----------------------- */
const hudPanel = document.getElementById('hudPanel');
const toggleBtn = document.getElementById('toggleHud');

let hudOpen = false;

toggleBtn.onclick = () => {
  hudOpen = !hudOpen;
  hudPanel.classList.toggle('collapsed', !hudOpen);
};

/* -----------------------
   DATA
----------------------- */
let days = [];
let pvData = [];

let engine = null;
let currentDay = 0;

/* -----------------------
   METRICS (RESTORED + JUSTIFICATION)
----------------------- */
const METRICS = [
  { key: 'bess_soc_end_percentage', label: 'SOC', fmt: v => fmt(v) },
  { key: 'net_bess_revenue_usd', label: 'Revenue', fmt: v => fmt(v) },
  { key: 'rule_engine_decision', label: 'Decision', fmt: v => v ?? '--' },
  { key: 'decision_justification', label: 'Justification', fmt: v => v ?? '--' }
];

const fmt = v => (typeof v === 'number' ? v.toFixed(2) : '--');

/* -----------------------
   ENGINE
----------------------- */
class SimulationEngine {
  constructor(rows) {
    this.rows = rows;
    this.times = rows.map(r => new Date(r.timestamp).getTime());

    this.startTime = this.times[0];
    this.endTime = this.times.at(-1);

    this.simTime = this.startTime;
    this.speed = 1000;

    this.playing = true;
    this.last = performance.now();
  }

  play() { this.playing = true; this.last = performance.now(); }
  pause() { this.playing = false; }

  setSpeed(s) { this.speed = s; }

  seek(t) {
    this.simTime = t;
    this.render();
  }

  tick(now) {
    if (!this.playing) return;

    const dt = (now - this.last) * this.speed;
    this.last = now;

    this.simTime += dt;

    if (this.simTime > this.endTime) {
      this.simTime = this.endTime;
      this.pause();
    }

    this.render();
  }

  sample(t) {
    for (let i = 0; i < this.times.length - 1; i++) {
      if (t >= this.times[i] && t <= this.times[i + 1]) {
        return this.rows[i];
      }
    }
    return this.rows.at(-1);
  }

  render() {
    const row = this.sample(this.simTime);

    updateBESS(this.simTime, row);
    updatePV(this.simTime);
    syncSlider();
  }
}

/* -----------------------
   BESS PANEL
----------------------- */
function updateBESS(simTime, row) {
  document.getElementById('simTime').textContent =
    new Date(simTime).toLocaleTimeString();

  const tbody = document.querySelector('#dayTable tbody');

  tbody.innerHTML = METRICS.map(m => {
    const value = m.fmt(row[m.key]);

    return `
      <tr>
        <td class="label-cell">${m.label}</td>
        <td class="value-cell" data-full="${row[m.key] ?? ''}">
          ${value}
        </td>
      </tr>
    `;
  }).join('');

  const MS = 86400000;
  app.timeOfDay = (simTime % MS) / MS;
}

/* -----------------------
   PV PANEL
----------------------- */
function getPV(simTime) {
  const t = new Date(simTime);

  let best = pvData[0];

  for (const r of pvData) {
    if (new Date(r.datetime) <= t) best = r;
    else break;
  }

  return best;
}

function updatePV(simTime) {
  const row = getPV(simTime);
  if (!row) return;

  document.querySelector('#pvTable tbody').innerHTML = `
    <tr>
      <td>${row.irradiance_poa_wm2}</td>
      <td>${row.temp_pv_c}</td>
      <td>${Number(row.pv_power_calc).toFixed(2)}</td>
    </tr>
  `;
}

/* -----------------------
   SLIDER
----------------------- */
const slider = document.getElementById('timeSlider');

function syncSlider() {
  if (!engine) return;

  const v =
    (engine.simTime - engine.startTime) /
    (engine.endTime - engine.startTime);

  slider.value = v;
}

slider.addEventListener('input', e => {
  const v = parseFloat(e.target.value);

  const t =
    engine.startTime +
    v * (engine.endTime - engine.startTime);

  engine.seek(t);
});

/* -----------------------
   RAF LOOP
----------------------- */
function loop(now) {
  engine?.tick(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* -----------------------
   LOAD BESS DATA
----------------------- */
Papa.parse('/demo_bess_dispatch_output.csv', {
  download: true,
  header: true,
  dynamicTyping: true,
  complete: ({ data }) => {
    const clean = data.filter(r => r.timestamp);
    days = groupByDay(clean);
    loadDay(0);
  }
});

/* -----------------------
   LOAD PV DATA
----------------------- */
Papa.parse('/pv_power_table.csv', {
  download: true,
  header: true,
  dynamicTyping: true,
  complete: ({ data }) => {
    pvData = data.filter(r => r.datetime);
  }
});

/* -----------------------
   GROUP DAYS
----------------------- */
function groupByDay(data) {
  const m = new Map();

  for (const r of data) {
    const d = r.timestamp.slice(0, 10);
    if (!m.has(d)) m.set(d, []);
    m.get(d).push(r);
  }

  return [...m.entries()];
}

/* -----------------------
   LOAD DAY
----------------------- */
function loadDay(i) {
  currentDay = i;

  const [date, rows] = days[i];
  document.getElementById('currentDay').textContent = date;

  engine = new SimulationEngine(rows);
}

/* -----------------------
   CONTROLS
----------------------- */
document.getElementById('play').onclick = () => engine.play();
document.getElementById('pause').onclick = () => engine.pause();
document.getElementById('reset').onclick = () => engine.seek(engine.startTime);

document.getElementById('prevDay').onclick = () =>
  loadDay(Math.max(0, currentDay - 1));

document.getElementById('nextDay').onclick = () =>
  loadDay(Math.min(days.length - 1, currentDay + 1));