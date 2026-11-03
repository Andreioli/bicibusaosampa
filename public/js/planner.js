// Trip planner panel: origin and destination on the map, mode, pace and departure time,
// and the journeys from planner-worker.js, listed in the panel and drawn on the map.

import { badgeInk } from './color.js';
import { placeName, searchPlaces } from './geocode.js';
import { ACCESS } from './parking.js';
import { balance, DEFAULT_TIME_WEIGHT, flatSpeed, POWER_LEVELS, TIME_WEIGHTS } from './raptor.js';
import { spParts } from './time.js';
import { icon } from './icons.js';
import { tokens } from './tokens.js';
import { activeTab, selectTab, toast } from './ui.js';

const PACES = [
  ['suave', 'Suave'],
  ['endorfinado', 'Endorfinado'],
  ['intenso', 'Intenso'],
  ['competicao', 'Competição'],
];
const PLAN = tokens.map.plan;
const COLORS = { walk: PLAN.walk, bike: PLAN.bike, busBike: PLAN.busBike, bus: PLAN.bus, emtu: PLAN.emtu };
// Each kind of leg and its icon (design/icons/vocabulary.json).
const MODE_ICON = Object.fromEntries(['walk', 'bike', 'bus', 'metro', 'train', 'station'].map((m) => [m, icon(m)]));
MODE_ICON.park = icon('parking');

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hhmm = (s) => `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
const minutes = (s) => `${Math.max(1, Math.round(s / 60))} min`;
const kcal = (k) => `${Math.round(k)} kcal`;
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * map: the Leaflet map; locate: locate.js handle (position()); sheetInsets(): screen
 * covered by the menu sheets; railLines: Map ref → rail-lines.json line;
 * getBuses(): live /api/buses vehicles, or null when they couldn't be loaded.
 */
export function initPlanner({ map, rotatingPane, locate, sheetInsets, railLines, getBuses, focusLines }) {
  const details = $('#plan-details');
  const od = $('#plan-od');
  const status = $('#plan-status');
  const results = $('#plan-results');
  const stopsList = $('#plan-stops');

  const power = $('#plan-power');
  power.innerHTML = PACES.map(([key, name]) =>
    `<option value="${key}">${name} · ${POWER_LEVELS[key]} W · ~${Math.round(flatSpeed(POWER_LEVELS[key]) * 3.6)} km/h</option>`).join('');
  power.value = recall('planPower') ?? 'endorfinado';
  // "planMode" replaced "planProfile" when Todos became the default; the old key is ignored.
  const savedProfile = recall('planMode');
  if (savedProfile) for (const r of document.querySelectorAll('input[name="plan-profile"]')) r.checked = r.value === savedProfile;
  const savedOptimize = recall('planOptimize');
  if (savedOptimize) for (const r of document.querySelectorAll('input[name="plan-optimize"]')) r.checked = r.value === savedOptimize;

  // Stacking: the route line turns with the map (rotating pane, above the bus and rail
  // lines); its icons sit above every marker (600); the A/B/stop pins above everything
  // but the labels (655, over tooltips at 650); the labels on top (660), under popups
  // (700). SVG, not canvas: a canvas this high would swallow clicks meant for the buses
  // and stations underneath.
  rotatingPane('plan').style.zIndex = 640;
  const iconPane = map.createPane('planIcons');
  iconPane.style.zIndex = 642;
  iconPane.style.pointerEvents = 'none';
  map.createPane('planPins').style.zIndex = 655;
  const labelPane = map.createPane('planLabels');
  labelPane.style.zIndex = 660;
  labelPane.style.pointerEvents = 'none';
  const renderer = L.svg({ pane: 'plan' });
  const routeLayer = L.layerGroup().addTo(map);
  const iconLayer = L.layerGroup().addTo(map);
  let iconLegs = []; // { path, glyph, color } of the selected journey
  let journeys = [];
  let cache = null; // the four profiles' answers to the current search; the mode and the weight only re-rank them
  let selected = 0;
  let expanded = false; // the selected card shows its step-by-step timeline
  const SHOWN = 6;

  // ---------------------------------------------------------------- worker

  let worker = null;
  let lastId = 0;
  const pending = new Map();
  function ask(message) {
    if (!worker) {
      worker = new Worker(new URL('./planner-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data.kind === 'progress') return showProgress(data);
        pending.get(data.id)?.(data);
        pending.delete(data.id);
      };
      worker.onerror = (e) => {
        for (const resolve of pending.values()) resolve({ kind: 'error', message: e.message || 'falha no planejador' });
        pending.clear();
        worker = null;
      };
    }
    const id = ++lastId;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      worker.postMessage({ ...message, id });
    });
  }

  // The network (~18 MB, cached by the service worker afterwards) is only downloaded
  // once someone starts planning, not merely because the section is open.
  let loaded = false;
  let loading = null;
  const MB = (b) => `${Math.round(b / 1e6)} MB`;

  function showProgress({ loaded: got, total }) {
    if (loaded) return;
    status.innerHTML = `Baixando dados do planejador: ${MB(got)} de ${MB(total)}
      <progress max="${total}" value="${got}" aria-hidden="true"></progress>`;
  }

  // On mobile data or with data saver on, ask before the first (~18 MB) download,
  // unless it's already cached or the user said yes before.
  async function mayDownload() {
    if (recall('plannerDataOk')) return;
    try { if (await caches.match('/data/routing/streets.bin')) return; } catch {}
    const c = navigator.connection;
    const metered = c && (c.saveData || c.type === 'cellular' || /(^|-)2g$/.test(c.effectiveType ?? ''));
    if (!metered) return;
    await new Promise((resolve) => {
      status.innerHTML = 'O planejador precisa baixar ~18 MB uma vez (melhor no Wi‑Fi). <button type="button" class="plan-download">Baixar agora</button>';
      status.querySelector('button').addEventListener('click', () => { remember('plannerDataOk', '1'); resolve(); }, { once: true });
    });
  }

  function ensureLoaded() {
    loading ??= mayDownload()
      .then(() => ask({ kind: 'load' }))
      .then((r) => { loaded = r.kind === 'loaded'; if (!loaded) loading = null; });
    return loading;
  }

  // ---------------------------------------------------------------- points

  // Origin, stops in between, destination: [{ lat, lon, label } | null], at least two.
  // A tap on the map fills the first empty slot; with all filled it becomes the new
  // destination and the previous destination turns into a stop.
  let stops = [null, null];
  let markers = [];
  const ROLE = { from: 'Origem', via: 'Parada', to: 'Destino' };
  const role = (i) => (i === 0 ? 'from' : i === stops.length - 1 ? 'to' : 'via');
  const pinText = (i) => ({ from: 'A', to: 'B' }[role(i)] ?? String(i));

  const pinIcon = (i) => L.divIcon({
    className: 'plan-pin',
    html: `<span class="pin ${role(i)}">${pinText(i)}</span>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -14],
  });

  let quietUntil = 0; // swallow the ghost map click after a search pick, drag or popup close
  const quiet = (ms) => { quietUntil = Date.now() + ms; };

  function syncMarkers() {
    for (const m of markers) m?.remove();
    markers = stops.map((p, i) => {
      if (!p) return null;
      const marker = L.marker([p.lat, p.lon], { pane: 'planPins', icon: pinIcon(i), draggable: true, keyboard: false, autoPan: true })
        .on('dragend', (e) => { quiet(400); const ll = e.target.getLatLng(); setStop(i, { lat: ll.lat, lon: ll.lng }); })
        .addTo(map);
      const box = document.createElement('div');
      box.className = 'plan-menu';
      box.innerHTML = `<b>${esc(ROLE[role(i)])}</b><button type="button" data-a="remove">Remover</button>
        <button type="button" data-a="Casa">${icon('home', 'icon-sm')} Casa</button><button type="button" data-a="Trabalho">${icon('work', 'icon-sm')} Trabalho</button>`;
      box.addEventListener('click', (e) => {
        const a = e.target.closest('button')?.dataset.a;
        if (!a) return;
        map.closePopup();
        quiet(400);
        if (a === 'remove') return removeStop(i);
        savePlace(a, stops[i]);
        toast(`Salvo como ${a}`);
      });
      marker.bindPopup(box, { closeButton: false });
      return marker;
    });
  }

  function renderStops() {
    stopsList.innerHTML = stops.map((p, i) => `
      <li class="plan-stop" data-i="${i}">
        <span class="pin ${role(i)}" aria-hidden="true">${pinText(i)}</span>
        <div class="plan-search">
          <input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false"
            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="plan-suggest-${i}"
            aria-label="${ROLE[role(i)]}" placeholder="Buscar ${ROLE[role(i)].toLowerCase()}…" value="${esc(p?.label ?? '')}">
          <ul class="plan-suggest" id="plan-suggest-${i}" role="listbox" aria-label="Sugestões" hidden></ul>
        </div>
        ${i === 0 ? `<button type="button" class="plan-icon-btn plan-gps" aria-label="Sair da minha localização" title="Minha localização">${icon('locate')}</button>` : ''}
        ${role(i) === 'via' ? `<button type="button" class="plan-icon-btn plan-remove" aria-label="Remover parada" title="Remover parada">${icon('remove')}</button>` : ''}
      </li>`).join('');
  }

  const coords = (p) => `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;

  function setStop(i, point, { label, auto = false } = {}) {
    const p = { lat: point.lat, lon: point.lon, label: label ?? point.label ?? null };
    stops[i] = p;
    if (!p.label) {
      p.label = coords(p);
      placeName(p.lat, p.lon).then((name) => {
        if (name && stops[i] === p) { p.label = name; renderStops(); renderSummary(); }
      });
    }
    syncMarkers();
    renderStops();
    if (!auto) ensureLoaded();
    update();
  }

  function removeStop(i) {
    if (stops.length > 2) stops.splice(i, 1);
    else stops[i] = null;
    syncMarkers();
    renderStops();
    update();
  }

  function addTap(latlng) {
    const point = { lat: latlng.lat, lon: latlng.lng };
    const before = stops.map((p) => p && { ...p });
    const empty = stops.indexOf(null);
    const i = empty >= 0 ? empty : stops.length;
    if (empty < 0) stops.push(null);
    setStop(i, point);
    navigator.vibrate?.(12);
    // A stray tap while exploring the map shouldn't cost anything: offer to undo it.
    toast(`${ROLE[role(i)]} ${role(i) === 'to' ? 'marcado' : 'marcada'} no mapa`, {
      action: { label: 'Desfazer', run: () => { stops = before; syncMarkers(); renderStops(); update(); } },
    });
  }

  // Taps on the map (not on a bus, station or pin, which keep their popups) add points
  // while the planner is open.
  map.on('popupclose', () => quiet(350));
  map.on('click', (e) => {
    if (activeTab() !== 'tab-plan' || Date.now() < quietUntil) return;
    addTap(e.latlng);
  });

  stopsList.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const i = Number(li.dataset.i);
    if (e.target.closest('.plan-remove')) return removeStop(i);
    if (e.target.closest('.plan-gps')) {
      status.textContent = 'Localizando…';
      locate.position()
        .then((ll) => setStop(0, { lat: ll.lat, lon: ll.lng }, { label: 'Minha localização' }))
        .catch(() => { status.textContent = 'Sem localização.'; });
    }
  });

  $('#plan-add-stop').addEventListener('click', () => {
    stops.splice(stops.length - 1, 0, null);
    syncMarkers();
    renderStops();
    stopsList.querySelector(`li[data-i="${stops.length - 2}"] input`)?.focus();
  });

  function swapStops() {
    stops.reverse();
    syncMarkers();
    renderStops();
    renderSummary();
    update();
  }
  $('#plan-swap').addEventListener('click', swapStops);
  $('#plan-od-swap').addEventListener('click', swapStops);

  $('#plan-clear').addEventListener('click', () => {
    stops = [null, null];
    syncMarkers();
    renderStops();
    journeys = [];
    cache = null;
    showDurations();
    routeLayer.clearLayers();
    iconLegs = [];
    iconLayer.clearLayers();
    labelLegs = [];
    tripLabel = null;
    clearLabels();
    focusLines(null);
    results.innerHTML = '';
    results.removeAttribute('aria-busy');
    status.textContent = '';
    map.getContainer().classList.remove('route-shown');
    setPlanned(false);
    writeLink();
  });

  // ---------------------------------------------------------------- place search

  let searchTimer = null;
  let searchAbort = null;
  let found = []; // results shown under the focused input
  let active = -1;

  function suggestions(li) { return li.querySelector('.plan-suggest'); }

  function showResults(li, items, message) {
    const ul = suggestions(li);
    const input = li.querySelector('input');
    found = items;
    active = -1;
    ul.innerHTML = message
      ? `<li class="plan-suggest-note">${esc(message)}</li>`
      : items.map((r, k) => `<li role="option" id="plan-opt-${li.dataset.i}-${k}" data-k="${k}"><b>${r.icon ? `${r.icon} ` : ''}${esc(r.label)}</b>${r.detail ? `<small>${esc(r.detail)}</small>` : ''}</li>`).join('');
    ul.hidden = !message && !items.length;
    input.setAttribute('aria-expanded', String(!ul.hidden));
    input.removeAttribute('aria-activedescendant');
  }

  // Saved places (Casa, Trabalho) and the last few picks, offered before typing.
  const places = () => { try { return JSON.parse(recall('planPlaces') ?? '{}'); } catch { return {}; } };
  const recents = () => { try { return JSON.parse(recall('planRecent') ?? '[]'); } catch { return []; } };
  function savePlace(name, p) {
    if (!p) return;
    remember('planPlaces', JSON.stringify({ ...places(), [name]: { lat: p.lat, lon: p.lon, label: p.label } }));
  }
  function rememberRecent(r) {
    const list = [r, ...recents().filter((x) => x.label !== r.label)].slice(0, 5);
    remember('planRecent', JSON.stringify(list.map(({ label, detail, lat, lon }) => ({ label, detail, lat, lon }))));
  }
  function quickPicks(i) {
    const saved = Object.entries(places()).map(([name, p]) => ({ ...p, icon: icon(name === 'Casa' ? 'home' : 'work', 'icon-sm'), detail: p.label, label: name, saved: true }));
    const mine = i === 0 && locate ? [{ label: 'Minha localização', icon: icon('locate', 'icon-sm'), gps: true }] : [];
    return [...mine, ...saved, ...recents().map((r) => ({ ...r, icon: icon('recent', 'icon-sm') }))];
  }

  function pick(li, k) {
    const r = found[k];
    if (!r) return;
    quiet(700);
    const i = Number(li.dataset.i);
    suggestions(li).hidden = true;
    li.querySelector('input').setAttribute('aria-expanded', 'false');
    if (r.gps) {
      status.textContent = 'Localizando…';
      locate.position()
        .then((ll) => setStop(i, { lat: ll.lat, lon: ll.lng }, { label: 'Minha localização' }))
        .catch(() => { status.textContent = 'Sem localização.'; });
      return;
    }
    if (!r.saved) rememberRecent(r);
    setStop(i, { lat: r.lat, lon: r.lon }, { label: r.label });
    if (!journeys.length) map.setView([r.lat, r.lon], Math.max(map.getZoom(), 15));
  }

  stopsList.addEventListener('focusin', (e) => {
    const input = e.target.closest('input');
    if (!input) return;
    ensureLoaded();
    // Empty field: offer my location, saved places and recent picks right away.
    if (!input.value.trim()) {
      const li = input.closest('li[data-i]');
      const picks = quickPicks(Number(li.dataset.i));
      if (picks.length) showResults(li, picks);
    } else {
      input.select();
    }
  });
  stopsList.addEventListener('input', (e) => {
    const input = e.target.closest('input');
    if (!input) return;
    const li = input.closest('li[data-i]');
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) return showResults(li, quickPicks(Number(li.dataset.i)));
    if (q.length < 3) return showResults(li, []);
    searchTimer = setTimeout(async () => {
      searchAbort?.abort();
      searchAbort = new AbortController();
      showResults(li, [], 'Buscando…');
      try {
        const items = await searchPlaces(q, map.getCenter(), searchAbort.signal);
        if (input.value.trim() === q) showResults(li, items, items.length ? null : 'Nada encontrado');
      } catch (err) {
        if (err.name !== 'AbortError') showResults(li, [], 'Busca indisponível');
      }
    }, 350);
  });
  // pointerdown, not click: picking must happen before the input's blur hides the list.
  stopsList.addEventListener('pointerdown', (e) => {
    const opt = e.target.closest('.plan-suggest li[data-k]');
    if (!opt) return;
    e.preventDefault();
    pick(opt.closest('li[data-i]'), Number(opt.dataset.k));
  });
  stopsList.addEventListener('keydown', (e) => {
    const input = e.target.closest('input');
    if (!input) return;
    const li = input.closest('li[data-i]');
    const ul = suggestions(li);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!found.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      ul.querySelectorAll('li[data-k]').forEach((o, k) => {
        o.classList.toggle('active', k === active);
        o.setAttribute('aria-selected', String(k === active));
      });
      input.setAttribute('aria-activedescendant', `plan-opt-${li.dataset.i}-${active}`);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (found.length) pick(li, Math.max(0, active));
      else input.blur(); // closes the phone keyboard
    } else if (e.key === 'Escape') {
      if (!ul.hidden) e.stopPropagation(); // closes the list, not the sheet
      ul.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
  });
  stopsList.addEventListener('focusout', (e) => {
    const li = e.target.closest?.('li[data-i]');
    if (li) setTimeout(() => {
      suggestions(li).hidden = true;
      li.querySelector('input')?.setAttribute('aria-expanded', 'false');
    }, 150);
  });

  renderStops();

  // ---------------------------------------------------------------- planned view

  // With a route found, the form folds into an origin/destination header and the
  // options come first; tapping the header opens the form again.
  const summaryEl = $('#plan-summary');
  function renderSummary() {
    const pts = stops.filter(Boolean);
    const first = pts[0], last = pts.at(-1), between = pts.length - 2;
    const row = (p) => `<span class="plan-od-row"><span class="pin ${role(stops.indexOf(p))}" aria-hidden="true">${pinText(stops.indexOf(p))}</span><span class="plan-od-label">${esc(p.label)}</span></span>`;
    summaryEl.innerHTML = `<span class="sr-only">Editar trajeto: </span>${row(first)}${between > 0
      ? `<span class="plan-od-row via"><span class="pin via" aria-hidden="true">${between}</span><span class="plan-od-label">${between} ${between === 1 ? 'parada' : 'paradas'}</span></span>`
      : ''}${row(last)}`;
  }
  function setPlanned(on) {
    details.classList.toggle('planned', on);
    od.hidden = !on;
    if (on) renderSummary();
  }
  summaryEl.addEventListener('click', () => {
    setPlanned(false);
    stopsList.querySelector('li:last-child input')?.focus();
  });

  // Share: the points and the mode in the address (#p=lat,lon;lat,lon&m=bike).
  function writeLink() {
    const pts = stops.filter(Boolean);
    const hash = pts.length >= 2 ? `#p=${pts.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';')}&m=${profile()}` : '';
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }
  $('#plan-share').addEventListener('click', async () => {
    writeLink();
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: 'Rota no Bici Busão Sampa', url });
      else { await navigator.clipboard.writeText(url); toast('Link copiado'); }
    } catch {}
  });

  // ---------------------------------------------------------------- options

  const profile = () => document.querySelector('input[name="plan-profile"]:checked').value;
  const optimize = () => document.querySelector('input[name="plan-optimize"]:checked').value;
  const weight = $('#plan-weight');
  const weightLabel = $('#plan-weight-label');
  const WEIGHT_TEXT = TIME_WEIGHTS.map((k) => `1 min vale ${k} kcal`);
  const savedWeight = TIME_WEIGHTS.indexOf(Number(recall('planTimeWeightK')));
  weight.value = String(savedWeight >= 0 ? savedWeight : TIME_WEIGHTS.indexOf(DEFAULT_TIME_WEIGHT));
  const timeWeight = () => TIME_WEIGHTS[Number(weight.value)];
  function syncWeight() {
    $('#plan-weight-field').hidden = optimize() !== 'balanced';
    weightLabel.textContent = WEIGHT_TEXT[Number(weight.value)];
  }
  syncWeight();
  for (const r of document.querySelectorAll('input[name="plan-optimize"]')) {
    r.addEventListener('change', () => { remember('planOptimize', optimize()); syncWeight(); update(); });
  }
  // Only re-ranks: the candidates don't depend on the weight.
  weight.addEventListener('input', () => {
    remember('planTimeWeightK', String(timeWeight()));
    syncWeight();
    present();
  });
  const at = $('#plan-at');
  const arterials = $('#plan-arterials');
  arterials.checked = recall('planAvoidArterials') !== '0';
  arterials.addEventListener('change', () => { remember('planAvoidArterials', arterials.checked ? '1' : '0'); syncMoreValue(); update(); });
  // One plain sentence under the mode buttons says what the selected mode does.
  const MODE_CAPTION = {
    all: 'Todos os modos: a melhor rota de cada um, comparadas',
    bike: 'Bici + ônibus e trilhos; dá para deixar a bici num bicicletário',
    carry: 'Bici + ônibus e trilhos, sempre levando a bici',
    walk: 'Ônibus e trilhos, a pé',
    cycle: 'Só de bicicleta, sem transporte público',
  };
  // "Mais opções" shows the current pace and departure, so they don't hide in the fold.
  function syncMoreValue() {
    const parts = [];
    if (profile() !== 'walk') parts.push(PACES.find(([k]) => k === power.value)?.[1]);
    const m = /^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d)/.exec(at.value);
    parts.push(m ? `saída ${m[2]}/${m[1]} ${m[3]}` : 'saída agora');
    $('#plan-more-value').textContent = `· ${parts.filter(Boolean).join(' · ')}`;
  }
  function syncPower() {
    $('#plan-power-field').hidden = profile() === 'walk';
    $('#plan-arterials-field').hidden = profile() === 'walk';
    $('#plan-mode-caption').textContent = MODE_CAPTION[profile()] ?? '';
    syncMoreValue();
  }
  syncPower();
  for (const r of document.querySelectorAll('input[name="plan-profile"]')) {
    r.addEventListener('change', () => {
      remember('planMode', profile());
      syncPower();
      r.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (cache) present(); else update(); // the answers of all four profiles are already here
    });
  }
  power.addEventListener('change', () => { remember('planPower', power.value); syncMoreValue(); update(); });
  at.addEventListener('change', () => { syncMoreValue(); update(); });
  $('#plan-now').addEventListener('click', () => { at.value = ''; syncMoreValue(); update(); });

  // ---------------------------------------------------------------- search

  let searchId = 0;

  /** Epoch ms of midnight (São Paulo) of the day `ms` falls in; journey times count from it. */
  const midnight = (ms) => Date.parse(`${spParts(new Date(ms)).iso}T00:00:00-03:00`);

  const PROFILES = ['bike', 'carry', 'walk', 'cycle'];

  /** One profile's search: its journeys (a single chained one with stops) or why there are none. */
  async function searchProfile(id, points, start0, base, options, profileKey) {
    // With stops in between, each leg leaves when the previous one arrives, and the
    // trip is the best option of every leg, one after the other.
    let start = start0;
    let reply = null;
    const parts = [];
    for (let k = 0; k + 1 < points.length; k++) {
      // Named points, so legs read "até Rua X" instead of "até Destino".
      const named = (p) => ({ ...p, name: p.label });
      reply = await ask({ kind: 'plan', from: named(points[k]), to: named(points[k + 1]), at: start, ...options, profile: profileKey });
      if (id !== searchId) return null;
      if (reply.kind === 'error') return { error: reply.message, journeys: [] };
      if (!reply.journeys.length) return { journeys: [], live: false, failedAt: k };
      for (const j of reply.journeys) j.profile ??= profileKey;
      if (points.length === 2) return { journeys: reply.journeys, live: reply.live };
      const best = options.optimize === 'balanced' ? balance(reply.journeys, options.timeWeight)[0] : reply.journeys[0];
      const shift = (midnight(start) - base) / 1000; // legs after midnight keep counting from day one
      parts.push(shiftJourney(best, shift));
      start = midnight(start) + best.arrive * 1000;
    }
    return {
      live: reply.live,
      journeys: [{
        profile: profileKey,
        depart: parts[0].depart,
        arrive: parts.at(-1).arrive,
        kcal: parts.reduce((n, j) => n + j.kcal, 0),
        rides: parts.reduce((n, j) => n + j.rides, 0),
        legs: parts.flatMap((j) => j.legs),
      }],
    };
  }

  async function update() {
    const from = stops[0], to = stops[stops.length - 1];
    if (!from || !to) {
      cache = null;
      status.textContent = !from ? 'Toque no mapa ou busque a origem.' : 'Agora o destino.';
      return;
    }
    const id = ++searchId;
    cache = null;
    // The departure field is São Paulo time, which is UTC-3 all year.
    const later = at.value ? new Date(`${at.value}-03:00`) : null;
    const vehicles = later ? null : getBuses();
    const options = { optimize: optimize(), timeWeight: timeWeight(), avoidArterials: arterials.checked, power: POWER_LEVELS[power.value], vehicles };
    if (!loaded) {
      status.textContent = 'Preparando o planejador…';
      await ensureLoaded();
      if (id !== searchId) return;
    }
    if (results.children.length) results.setAttribute('aria-busy', 'true'); // dims the old list while it re-runs
    status.textContent = 'Calculando…';

    // Every mode is searched, whichever is selected, so switching is instant and each
    // button can show its duration.
    const points = stops.filter(Boolean);
    const start = (later ?? new Date()).getTime();
    const base = midnight(start);
    const answers = await Promise.all(PROFILES.map((p) => searchProfile(id, points, start, base, options, p)));
    if (id !== searchId || answers.includes(null)) return;
    if (answers.every((a) => a.error)) { results.removeAttribute('aria-busy'); status.textContent = `Não deu para calcular: ${answers[0].error}`; return; }
    cache = { later, points: points.length, byProfile: Object.fromEntries(PROFILES.map((p, i) => [p, answers[i]])) };
    loaded = true;
    selected = 0;
    present();
  }

  const BY_TIME = (a, b) => a.arrive - b.arrive || a.kcal - b.kcal;
  const BY_ENERGY = (a, b) => a.kcal - b.kcal || a.arrive - b.arrive;
  /** The journeys sorted by the selected priority (balanced re-ranks with the slider's weight). */
  function rank(list) {
    const mode = optimize();
    return mode === 'balanced' ? balance([...list], timeWeight()) : [...list].sort(mode === 'energy' ? BY_ENERGY : BY_TIME);
  }
  /** Same sequence of legs and the same times: one journey, whichever profile found it. */
  const sameTrip = (j) => `${j.depart}|${j.arrive}|${j.legs.map((l) => `${l.kind}:${l.mode ?? ''}:${l.route ?? l.rail ?? ''}`).join(',')}`;

  /** The list for the selected mode, from the cached answers: no new search. */
  function present() {
    if (!cache) return;
    const mode = profile();
    const { byProfile, later } = cache;
    const stopsTrip = cache.points > 2;
    if (mode === 'all') {
      const all = PROFILES.flatMap((p) => byProfile[p].journeys);
      const unique = new Map();
      for (const j of all) if (!unique.has(sameTrip(j))) unique.set(sameTrip(j), j);
      const merged = rank([...unique.values()]);
      if (stopsTrip) journeys = merged;
      else {
        // The best of each profile always makes the list, the rest of it the next best overall.
        const picked = new Set(PROFILES.map((p) => unique.get(sameTrip(rank(byProfile[p].journeys)[0]))).filter(Boolean));
        for (const j of merged) if (picked.size < SHOWN) picked.add(j);
        journeys = merged.filter((j) => picked.has(j));
      }
    } else {
      const list = byProfile[mode].journeys;
      journeys = stopsTrip ? list : (optimize() === 'balanced' ? balance([...list], timeWeight()) : list).slice(0, SHOWN);
    }
    showDurations();
    if (!journeys.length) {
      const failedAt = mode === 'all' ? null : byProfile[mode].failedAt;
      status.textContent = stopsTrip && failedAt != null ? `Sem opção até a parada ${failedAt + 1}.` : 'Nenhuma opção encontrada.';
      render();
      return;
    }
    selected = 0;
    expanded = journeys.length === 1; // a trip with stops has one option per mode: open it when alone
    const liveOf = (p) => p !== 'cycle' && byProfile[p].live;
    const live = !later && (mode === 'all' ? PROFILES.some(liveOf) : liveOf(mode)) ? ' · ônibus ao vivo' : '';
    status.textContent = stopsTrip
      ? `Com ${cache.points - 2} ${cache.points === 3 ? 'parada' : 'paradas'}${live}`
      : `${journeys.length} ${journeys.length === 1 ? 'opção' : 'opções'}${live}`;
    render();
  }

  // Under each mode button: the duration of its fastest journey, whatever the priority.
  const MODE_NAME = { all: 'Todos os modos', bike: 'Intermodal, bicicleta e estacionar', carry: 'Intermodal com bicicleta', walk: 'Intermodal, a pé', cycle: 'Só bicicleta' };
  function showDurations() {
    const fastest = (list) => (list.length ? Math.min(...list.map((j) => j.arrive - j.depart)) : null);
    const secs = {};
    for (const p of PROFILES) secs[p] = cache ? fastest(cache.byProfile[p].journeys) : null;
    const known = PROFILES.map((p) => secs[p]).filter((s) => s != null);
    secs.all = cache ? (known.length ? Math.min(...known) : null) : null;
    for (const r of document.querySelectorAll('input[name="plan-profile"]')) {
      const time = r.nextElementSibling.querySelector('.plan-mode-time');
      const s = secs[r.value];
      time.textContent = !cache ? '' : s == null ? '—' : minutes(s);
      time.classList.toggle('plan-mode-time-none', !!cache && s == null);
      if (cache && s == null) r.setAttribute('aria-disabled', 'true'); else r.removeAttribute('aria-disabled');
      r.setAttribute('aria-label', cache && s != null ? `${MODE_NAME[r.value]}, ${minutes(s)}` : cache ? `${MODE_NAME[r.value]}, sem opção` : MODE_NAME[r.value]);
    }
  }

  function shiftJourney(j, s) {
    if (!s) return j;
    const legs = j.legs.map((leg) => ({ ...leg, depart: leg.depart + s, arrive: leg.arrive + s }));
    return { ...j, depart: j.depart + s, arrive: j.arrive + s, legs };
  }

  // ---------------------------------------------------------------- results

  function lineName(leg) {
    if (leg.mode === 'bus') return leg.route;
    return railLines.get(leg.rail)?.name ?? `Linha ${leg.rail}`;
  }

  function legColor(leg) {
    if (leg.kind === 'ride') {
      if (leg.mode !== 'bus') return railLines.get(leg.rail)?.color ?? COLORS.bus;
      if (leg.hold) return COLORS.emtu;
      return leg.withBike ? COLORS.busBike : COLORS.bus;
    }
    return COLORS[leg.kind] ?? COLORS.walk;
  }

  function rideBadge(leg) {
    const label = leg.mode === 'bus' ? leg.route : leg.rail;
    const bg = legColor(leg);
    return `<span class="badge ${badgeInk(bg)}" style="background:${bg}">${esc(label)}</span>`;
  }

  function summary(j) {
    return j.legs.map((leg) => {
      if (leg.kind === 'ride') return `${MODE_ICON[leg.mode]}${rideBadge(leg)}`;
      if (leg.kind === 'station') return null; // inside the ride's time in the summary
      if (leg.kind === 'park') return MODE_ICON.park;
      return `${MODE_ICON[leg.kind]}<small>${minutes(leg.arrive - leg.depart)}</small>`;
    }).filter(Boolean).join('<span class="sep" aria-hidden="true">›</span>');
  }

  // Where each ride starts: "Ônibus 11:03 em Jose Maria Lisboa B/C · horário estimado".
  const NOUN = { metro: 'Metrô', train: 'Trem' };
  function meta(j) {
    const r = j.legs.find((l) => l.kind === 'ride');
    let text;
    if (r) {
      const noun = r.mode === 'bus' ? (r.hold ? 'Seletivo' : 'Ônibus') : NOUN[r.mode] ?? 'Trem';
      text = `${noun} ${hhmm(r.depart)} em ${esc(r.from.name)}${r.live ? ' · ao vivo' : r.estimated ? ' · horário estimado' : ''}`;
    } else {
      const bikeOnly = j.profile === 'cycle' || j.legs.every((l) => l.kind === 'bike');
      text = `${bikeOnly ? 'Só de bici' : 'A pé'} · ${km(tripMeters(j))}`;
    }
    if (j.legs.some((l) => l.kind === 'park')) text += ' · deixa a bici no bicicletário';
    return text;
  }

  /** Metres of the whole trip: every leg but the station and parking steps. */
  function tripMeters(j) {
    return j.legs.reduce((m, leg) => (leg.kind === 'station' || leg.kind === 'park' ? m
      : m + (leg.meters || pathLength(leg.path ?? [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]]))), 0);
  }

  // The step-by-step timeline: a node where each thing starts, a line down to the next
  // one for the leg that starts there. Station steps become lines in the ride's row.
  function timeline(j) {
    const rows = [];
    let pendingIn = null;
    const row = (variant, time, place, what, metaLine, { line = '', node = '', extra = '' } = {}) => ({ variant, time, place, what, metaLine, line, node, extra });
    const html = (r) => `
      <li class="tl tl-${r.variant}">
        <span class="tl-time">${hhmm(r.time)}</span>
        <span class="tl-track" aria-hidden="true">${r.node || '<span class="tl-node"></span>'}<span class="tl-line"${r.line ? ` style="background:${r.line}"` : ''}></span></span>
        <div class="tl-body">
          <p class="tl-place">${esc(r.place)}</p>
          ${r.what ? `<p class="tl-what">${r.what}</p>` : ''}
          ${r.metaLine ? `<p class="tl-meta">${r.metaLine}</p>` : ''}${r.extra}
        </div>
      </li>`;
    const climbText = (leg) => (leg.up ? `sobe ${leg.up} m` : leg.down ? `desce ${leg.down} m` : '');
    const stationLine = (leg, verb) => `<p class="tl-meta">${MODE_ICON.station} ${verb} estação ${esc(leg.at.name)} · ${minutes(leg.arrive - leg.depart)}${climbText(leg) ? ` · ${climbText(leg)}` : ''} · ${kcal(leg.kcal)}</p>`;
    for (const leg of j.legs) {
      if (leg.kind === 'station') {
        if (leg.dir === 'in') pendingIn = leg;
        else if (rows.length) rows[rows.length - 1].extra += stationLine(leg, 'Sair da');
      } else if (leg.kind === 'park') {
        rows.push(row('park', leg.depart, leg.at.name, 'Deixe a bici aqui', esc(ACCESS[leg.at.access]?.label ?? ''),
          { node: `<span class="tl-node tl-node-park">${icon('parking', 'icon-sm', 'filled')}</span>` }));
      } else if (leg.kind === 'ride') {
        const notes = [];
        if (pendingIn) notes.push(stationLine(pendingIn, 'Entrar na'));
        pendingIn = null;
        const how = leg.withBike ? (leg.hold ? 'Com a bici: no bagageiro, se houver espaço' : leg.mode === 'bus' ? 'Com a bici: porta traseira' : 'Com a bici: último carro') : '';
        if (how) notes.push(`<p class="tl-note">${icon('bike', 'icon-sm')} ${how}</p>`);
        if (leg.live) notes.push(`<p class="tl-live"><span class="dot inline ok"></span> Ao vivo: ônibus ${esc(leg.live)}</p>`);
        else if (leg.estimated) notes.push('<p class="tl-live">Horário estimado</p>');
        rows.push(row('ride', leg.depart, leg.from.name,
          `${MODE_ICON[leg.mode]} ${rideBadge(leg)}${leg.mode === 'bus' ? '' : ` ${esc(lineName(leg))}`} <span>sentido ${esc(leg.headsign.trim())}</span>`,
          `${minutes(leg.arrive - leg.depart)} · ${leg.stops} ${leg.stops === 1 ? 'parada' : 'paradas'} · desça em ${esc(leg.to.name)}`,
          { line: legColor(leg), extra: notes.join('') }));
      } else if (leg.interchange) {
        rows.push(row('walk', leg.depart, leg.from.name, `${MODE_ICON.walk} Baldeação até ${esc(leg.to.name)}`,
          `${minutes(leg.arrive - leg.depart)} a pé${leg.withBike ? ', empurrando a bici' : ''} · ${kcal(leg.kcal)}`));
      } else {
        const what = leg.kind === 'bike' ? 'De bici' : leg.withBike ? 'A pé, empurrando a bici' : 'A pé';
        rows.push(row(leg.kind, leg.depart, leg.from.name, `${MODE_ICON[leg.kind]} ${what}`,
          `${minutes(leg.arrive - leg.depart)} · ${km(leg.meters)} · ${kcal(leg.kcal)}`));
      }
    }
    rows.push(row('end', j.arrive, stops.filter(Boolean).at(-1).label, '',
      `Total: ${minutes(j.arrive - j.depart)} · ${kcal(j.kcal)} · ${km(tripMeters(j))}`));
    return rows.map(html).join('');
  }

  function render() {
    results.removeAttribute('aria-busy');
    setPlanned(journeys.length > 0);
    $('#plan-share').hidden = !journeys.length;
    if (journeys.length) {
      window.dispatchEvent(new Event('plan-results'));
      if (activeTab() !== 'tab-plan') selectTab('tab-plan');
    }
    writeLink();
    renderList();
    draw();
  }

  function renderList() {
    // Tags only when there is a choice: the fastest option, and the one using least energy.
    const fastest = journeys.reduce((b, j, i) => (j.arrive < journeys[b].arrive ? i : b), 0);
    const leanest = journeys.reduce((b, j, i) => (Math.round(j.kcal) < Math.round(journeys[b].kcal) ? i : b), 0);
    results.innerHTML = journeys.map((j, i) => {
      const open = i === selected && expanded;
      const tags = journeys.length > 1 && (i === fastest || i === leanest) ? `<span class="plan-j-tags">${
        i === fastest ? `<span class="plan-tag">${icon('fastest', 'icon-sm', 'filled')} Mais rápida</span>` : ''}${
        i === leanest ? `<span class="plan-tag">${icon('least-effort', 'icon-sm', 'filled')} Menos esforço</span>` : ''}</span>` : '';
      return `
      <li class="plan-option${i === selected ? ' selected' : ''}" data-i="${i}"${i === selected ? ' aria-current="true"' : ''}>
        <button type="button" class="plan-journey" aria-expanded="${open}" aria-controls="plan-legs-${i}">
          ${tags}
          <span class="plan-j-top">
            <span class="plan-j-dur">${minutes(j.arrive - j.depart)}</span>
            <span class="plan-j-kcal">${icon('least-effort', 'icon-sm')} ${kcal(j.kcal)}</span>
            <span class="plan-j-times">${hhmm(j.depart)}–${hhmm(j.arrive)}</span>
          </span>
          <span class="legs">${summary(j)}</span>
          <span class="plan-j-meta">${meta(j)}</span>
        </button>
        ${open ? `<ol class="plan-legs" id="plan-legs-${i}">${timeline(j)}</ol>` : ''}
      </li>`;
    }).join('');
  }

  results.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li || !e.target.closest('.plan-journey')) return;
    const i = Number(li.dataset.i);
    if (i !== selected) { selected = i; expanded = true; renderList(); draw(); }
    else { expanded = !expanded; renderList(); }
    const card = results.querySelector(`li[data-i="${i}"]`);
    card?.querySelector('.plan-journey')?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: 'nearest' });
  });

  function draw() {
    routeLayer.clearLayers();
    iconLegs = [];
    const j = journeys[selected];
    // With a route on the map, everything else fades so the route stands out, except
    // the bus and rail lines the trip rides on.
    map.getContainer().classList.toggle('route-shown', !!j);
    labelLegs = [];
    tripLabel = null;
    focusLines(j ? {
      buses: new Set(j.legs.filter((l) => l.kind === 'ride' && l.mode === 'bus').map((l) => l.route)),
      rails: new Set(j.legs.filter((l) => l.kind === 'ride' && l.mode !== 'bus').map((l) => String(l.rail))),
    } : null);
    clearLabels();
    if (!j) return;
    const bounds = L.latLngBounds([]);
    // With two or more rides of a kind (bus, rail), their icons carry 1, 2, … in order.
    const glyphOf = (leg) => (leg.kind === 'bike' ? 'bike' : leg.kind === 'ride' ? (leg.mode === 'bus' ? 'wheel' : 'rail') : null);
    const rideCount = {};
    for (const leg of j.legs) if (leg.kind === 'ride') rideCount[glyphOf(leg)] = (rideCount[glyphOf(leg)] ?? 0) + 1;
    const rideSeen = {};
    let prev = null; // previous leg drawn, for the change-of-mode icons
    for (const leg of j.legs) {
      if (leg.kind === 'station') continue;
      // A change of mode (get on or off, change lines) is marked where the next leg
      // starts; the bicicletário marker already marks its own.
      if (prev && prev.kind !== 'park' && leg.kind !== 'park' && (prev.kind !== leg.kind || leg.kind === 'ride')) {
        const at = legStart(leg);
        L.marker(at, { pane: 'planPins', icon: transferIcon, interactive: false, keyboard: false }).addTo(routeLayer);
      }
      prev = leg;
      if (leg.kind === 'park') {
        L.marker([leg.at.lat, leg.at.lon], {
          pane: 'planPins',
          icon: L.divIcon({ className: 'plan-park', html: `<span>${icon('parking', 'icon-sm', 'filled')}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
          keyboard: false,
        }).bindTooltip(`Deixe a bici: ${esc(leg.at.name)}`).addTo(routeLayer);
        continue;
      }
      const path = leg.path ?? [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]];
      const color = legColor(leg);
      // Riding legs are a trail of icons (bike, bus wheel, rail track) over a thin line
      // that keeps the shape on curves; walking stays a dotted line.
      const glyph = glyphOf(leg);
      // Taps on the route open its tooltip; they must not reach the map, which would
      // add a trip point there.
      if (glyph) {
        const line = L.polyline(path, { renderer, color, weight: 3, opacity: 0.55, bubblingMouseEvents: false }).addTo(routeLayer);
        if (leg.kind === 'ride') line.bindTooltip(`${lineName(leg)} · sentido ${esc(leg.headsign.trim())}`);
        const n = leg.kind === 'ride' && rideCount[glyph] > 1 ? (rideSeen[glyph] = (rideSeen[glyph] ?? 0) + 1) : null;
        iconLegs.push({ path, glyph, color, n });
      } else {
        L.polyline(path, { renderer, color: PLAN.casing, weight: 7, opacity: 0.8, interactive: false }).addTo(routeLayer);
        L.polyline(path, { renderer, color, weight: 4, dashArray: '1 7', lineCap: 'round', bubblingMouseEvents: false }).addTo(routeLayer);
      }
      for (const p of path) bounds.extend(p);
      if (leg.interchange) continue;
      const meters = leg.meters || pathLength(path);
      labelLegs.push({
        path,
        info: `${minutes(leg.arrive - leg.depart)} · ${kcal(leg.kcal)} · ${km(meters)}`,
        line: leg.kind === 'ride' ? String(leg.mode === 'bus' ? leg.route : `Linha ${leg.rail}`) : null,
        color,
        meters,
      });
    }
    // The whole trip, for the label over it: every drawn leg end to end.
    const tripPath = [];
    for (const leg of j.legs) if (leg.kind !== 'station' && leg.kind !== 'park') tripPath.push(...(leg.path ?? [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]]));
    tripLabel = tripPath.length > 1 && labelLegs.length > 1
      ? { path: tripPath, info: `Total: ${minutes(j.arrive - j.depart)} · ${kcal(j.kcal)} · ${km(tripMeters(j))}` }
      : null;
    if (!bounds.isValid()) return;
    for (const p of stops) if (p) bounds.extend([p.lat, p.lon]);
    // Keep the route clear of the menu sheet and the map buttons.
    const inset = sheetInsets();
    map.fitBounds(bounds, {
      paddingTopLeft: [inset.left + 30, 30],
      paddingBottomRight: [70, inset.bottom + 30],
      maxZoom: 16,
    });
    placeIcons();
    placeLabels();
  }

  // ---------------------------------------------------------------- icon trail

  // Icon size and spacing along the route (px) at full size, from zoom 15; they shrink
  // when zoomed out, down to about half at zoom 11.
  const ICON_GAP = 26;
  const ICON_SIZE = 18;
  const iconScale = () => Math.min(1, Math.max(0.5, (map.getZoom() - 9.5) / 5.5));
  // White glyphs on a disc in the leg colour (24×24 view box, drawn facing east/up).
  const GLYPHS = {
    bike: '<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M6 15l4-7h6l2 7M10 8l3 7M8 5h4M15 6h3"/>',
    wheel: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v6M12 14v6M4 12h6M14 12h6M6.3 6.3l4.3 4.3M13.4 13.4l4.3 4.3M17.7 6.3l-4.3 4.3M10.6 13.4l-4.3 4.3"/>',
    rail: '<path d="M8.5 3v18M15.5 3v18M5.5 6.5h13M5.5 12h13M5.5 17.5h13"/>',
  };

  const legStart = (leg) => (leg.path?.[0] ?? [leg.from.lat, leg.from.lon]);

  // Where the trip changes mode: two arrows swapping, on a dark disc.
  const transferIcon = L.divIcon({
    className: 'plan-transfer',
    html: '<span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/></svg></span>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

  function trailIcon(glyph, color, angle, n, size) {
    // Rails turn with the track; the bike faces where it's going; the wheel doesn't care.
    const turn = glyph === 'rail' ? `rotate(${angle + 90}deg)` : glyph === 'bike' && Math.cos((angle * Math.PI) / 180) < 0 ? 'scaleX(-1)' : '';
    return L.divIcon({
      className: 'plan-trail',
      html: `<span style="background:${color};width:${size}px;height:${size}px"><svg viewBox="0 0 24 24" style="transform:${turn};width:${Math.round(size * 0.72)}px;height:${Math.round(size * 0.72)}px">${GLYPHS[glyph]}</svg>${n ? `<sub style="background:${color}">${n}</sub>` : ''}</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  // Icons every ICON_GAP px along each leg, only where the map shows them.
  function placeIcons() {
    iconLayer.clearLayers();
    if (!iconLegs.length) return;
    const screen = map.getSize();
    const onScreen = (p) => {
      const c = map.latLngToContainerPoint(map.unproject(p));
      return c.x > -40 && c.y > -40 && c.x < screen.x + 40 && c.y < screen.y + 40;
    };
    const bearing = map.getBearing();
    const scale = iconScale(), size = Math.round(ICON_SIZE * scale), gap = ICON_GAP * scale;
    for (const { path, glyph, color, n } of iconLegs) {
      const pts = path.map((p) => map.project(p));
      let next = gap / 2;
      let walked = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const len = a.distanceTo(b);
        if (!len) continue;
        // Direction on screen: the map's rotation turns everything clockwise by `bearing`.
        const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + bearing;
        while (next <= walked + len) {
          const f = (next - walked) / len;
          const p = L.point(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
          if (onScreen(p)) {
            L.marker(map.unproject(p), { pane: 'planIcons', icon: trailIcon(glyph, color, angle, n, size), interactive: false, keyboard: false }).addTo(iconLayer);
          }
          next += gap;
        }
        walked += len;
      }
    }
  }
  let iconTimer = null;
  map.on('zoomend moveend', placeIcons);
  map.on('rotate', () => { clearTimeout(iconTimer); iconTimer = setTimeout(placeIcons, 120); });

  // ---------------------------------------------------------------- leg labels

  // Each leg is labelled with text that follows the line itself (SVG textPath): time,
  // energy and distance on one side, the bus or rail line on the other (rides only),
  // and the whole trip's total further out. The labels live in their own SVG, in a
  // pane that doesn't turn with the map, and their guides are redrawn in screen
  // coordinates whenever the view changes, so text always reads left to right and
  // stays above everything at any rotation.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let labelLegs = []; // { path, info, line, color, meters } of the selected journey
  let tripLabel = null; // { path, info }: the whole selected journey
  let labelTexts = []; // [{ latlngs, shift, guide: SVGPathElement, texts: [SVGTextElement] }]
  const labelSvg = document.createElementNS(SVG_NS, 'svg');
  labelSvg.setAttribute('class', 'plan-label-layer');
  labelPane.append(labelSvg);

  function pathLength(path) {
    let m = 0;
    for (let i = 1; i < path.length; i++) m += map.distance(path[i - 1], path[i]);
    return m;
  }

  function clearLabels() {
    labelSvg.replaceChildren();
    labelTexts = [];
  }

  function textOn(guide, content, className, outline) {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', className);
    text.setAttribute('dy', '0.35em');
    text.style.stroke = outline; // white letters outlined in the leg's colour
    const tp = document.createElementNS(SVG_NS, 'textPath');
    tp.setAttribute('href', `#${guide.id}`);
    // Older iOS Safari only follows the SVG 1.1 attribute.
    tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${guide.id}`);
    tp.setAttribute('startOffset', '50%'); // moved to the visible middle by fitLabels()
    tp.setAttribute('text-anchor', 'middle');
    tp.textContent = content;
    text.append(tp);
    labelSvg.append(text);
    return text;
  }

  // A guide is the leg on screen, turned to run left to right, simplified by a little
  // more than a letter's height (street-grid zigzags don't fold the text), rounded with
  // three Chaikin passes, and moved sideways by `shift` px as a parallel curve
  // (positive = above). Text sits centred on that curve, which keeps letters evenly
  // spaced on bends.
  const chaikin = (pts) => {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push(a.multiplyBy(0.75).add(b.multiplyBy(0.25)), a.multiplyBy(0.25).add(b.multiplyBy(0.75)));
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  function parallel(pts, shift) {
    if (!shift || pts.length < 2) return pts;
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      return L.point(p.x + (dy / len) * shift, p.y - (dx / len) * shift);
    });
  }

  // The pane sits inside Leaflet's map pane, which moves while dragging: guides are
  // drawn in that pane's coordinates (screen point minus the pane's offset).
  const paneOffset = () => L.DomUtil.getPosition(map.getPane('mapPane')) ?? L.point(0, 0);

  function guideD(latlngs, shift) {
    let pts = latlngs.map((ll) => map.latLngToContainerPoint(ll));
    if (pts[pts.length - 1].x < pts[0].x) pts.reverse();
    pts = parallel(chaikin(chaikin(chaikin(L.LineUtil.simplify(pts, 10)))), shift);
    const o = paneOffset();
    return pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x - o.x).toFixed(1)} ${(p.y - o.y).toFixed(1)}`).join('');
  }

  let guideId = 0;
  // Distances of each label's centre line from the route, in px (positive = above).
  const SHIFT = { info: 15, line: -18, total: 34 };

  function placeLabels() {
    clearLabels();
    const add = (path, shift, content, className, color) => {
      const guide = document.createElementNS(SVG_NS, 'path');
      guide.id = `plan-guide-${++guideId}`;
      guide.setAttribute('fill', 'none');
      labelSvg.append(guide);
      const latlngs = path.map((p) => L.latLng(p));
      labelTexts.push({ latlngs, shift, guide, texts: [textOn(guide, content, className, color)] });
    };
    // Furthest out, the whole trip in one label.
    if (tripLabel) add(tripLabel.path, SHIFT.total, tripLabel.info, 'plan-leg-label total', PLAN.total);
    // Each leg: time · kcal · distance on one side, the line it rides on the other.
    for (const { path, info, line, color } of labelLegs) {
      add(path, SHIFT.info, info, 'plan-leg-label', color);
      if (line) add(path, SHIFT.line, line, 'plan-leg-label line', color);
    }
    refreshLabels();
  }

  // The SVG covers the screen (plus a margin), placed in the pane's coordinates with a
  // matching viewBox: Safari clips SVG content that overflows a tiny element.
  const SVG_MARGIN = 200;
  function sizeLabelSvg() {
    const o = paneOffset(), size = map.getSize();
    const x = -o.x - SVG_MARGIN, y = -o.y - SVG_MARGIN, w = size.x + 2 * SVG_MARGIN, h = size.y + 2 * SVG_MARGIN;
    Object.assign(labelSvg.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    labelSvg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }

  function refreshLabels() {
    sizeLabelSvg();
    for (const l of labelTexts) l.guide.setAttribute('d', guideD(l.latlngs, l.shift));
    labelPane.style.visibility = '';
    fitLabels();
  }

  // Each label sits on the straightest stretch of the part of its leg that's on screen
  // (not under the sheet or the map buttons; letters on the outside of a sharp bend
  // would spread apart), shrinking to fit that part down to MIN_LABEL_PX; below that it
  // fades out. When the view changes, labels glide along the line to their new spot
  // and size instead of jumping. Tight corners may squeeze the letters.
  const MIN_LABEL_PX = 7;
  // Full sizes of the labels (map.label.size.* tokens; style.css uses the same ones).
  const LABEL_PX = Object.fromEntries(Object.entries(tokens.map.label.size).map(([k, v]) => [k, parseFloat(v)]));
  const GLIDE_MS = 300;
  const SAMPLE_PX = 6;
  const MARGIN_PX = 24; // kept free at each end of a label, so no letter runs off its guide
  const state = new WeakMap(); // text -> { frac, size, raf }

  /** The screen area labels may use, in the guides' coordinates. */
  function visibleRect() {
    const size = map.getSize(), inset = sheetInsets(), o = paneOffset();
    return L.bounds(L.point(inset.left + 12, 12).subtract(o), L.point(size.x - 64, size.y - inset.bottom - 12).subtract(o));
  }

  /**
   * Where along the guide (px) to centre a label `width` px long inside `stretch`: the
   * spot where the line turns least under the label, ties going to the middle.
   */
  function straightestCentre(guide, stretch, width) {
    const from = stretch.from + width / 2, to = stretch.to - width / 2;
    const middle = (stretch.from + stretch.to) / 2;
    if (to <= from) return middle;
    const angles = [];
    for (let d = stretch.from; d <= stretch.to; d += SAMPLE_PX) {
      const a = guide.getPointAtLength(d), b = guide.getPointAtLength(Math.min(stretch.to, d + SAMPLE_PX));
      angles.push(Math.atan2(b.y - a.y, b.x - a.x));
    }
    const turnAt = (i) => {
      let t = Math.abs(angles[i] - angles[i - 1]);
      return t > Math.PI ? 2 * Math.PI - t : t;
    };
    let best = middle, bestScore = Infinity;
    const half = Math.round(width / 2 / SAMPLE_PX);
    for (let c = from; c <= to; c += SAMPLE_PX) {
      const ci = Math.round((c - stretch.from) / SAMPLE_PX);
      let turn = 0;
      for (let i = Math.max(1, ci - half); i <= Math.min(angles.length - 1, ci + half); i++) turn += turnAt(i);
      const score = turn + Math.abs(c - middle) / 2000; // radians, plus a nudge to the middle
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /** Longest on-screen stretch of the guide: { from, to } in px along it, or null. */
  function visibleStretch(guide, total, rect) {
    let best = null, runStart = null, last = 0;
    for (let d = 0; d <= total; d += SAMPLE_PX) {
      const p = guide.getPointAtLength(d);
      if (rect.contains([p.x, p.y])) {
        runStart ??= d;
        last = d;
      } else if (runStart != null) {
        if (!best || last - runStart > best.to - best.from) best = { from: runStart, to: last };
        runStart = null;
      }
    }
    if (runStart != null && (!best || last - runStart > best.to - best.from)) best = { from: runStart, to: last };
    return best;
  }

  function glide(t, target, total) {
    const st = state.get(t) ?? { frac: target.frac, size: target.size };
    cancelAnimationFrame(st.raf);
    const from = { frac: st.frac, size: st.size }, t0 = performance.now();
    const apply = (frac, size) => {
      st.frac = frac; st.size = size;
      t.firstChild.setAttribute('startOffset', String(frac * total));
      t.style.fontSize = `${size.toFixed(2)}px`;
      t.style.strokeWidth = `${Math.max(2, (4 * size) / target.base).toFixed(2)}px`;
    };
    const step = (now) => {
      const k = Math.min(1, (now - t0) / GLIDE_MS), e = 1 - (1 - k) ** 3;
      apply(from.frac + (target.frac - from.frac) * e, from.size + (target.size - from.size) * e);
      if (k < 1) st.raf = requestAnimationFrame(step);
    };
    state.set(t, st);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) apply(target.frac, target.size);
    else st.raf = requestAnimationFrame(step);
  }

  function fitLabels() {
    const rect = visibleRect();
    for (const { guide, texts } of labelTexts) {
      const total = guide.getTotalLength?.() ?? 0;
      const stretch = total ? visibleStretch(guide, total, rect) : null;
      for (const t of texts) {
        const base = LABEL_PX[t.classList.contains('total') ? 'total' : t.classList.contains('line') ? 'line' : 'leg'];
        if (!stretch) { t.style.opacity = '0'; continue; }
        // Text length at the base size (getComputedTextLength scales with the font).
        const now = parseFloat(t.style.fontSize) || base;
        const length = (t.getComputedTextLength() * base) / now;
        const room = stretch.to - stretch.from - 2 * MARGIN_PX;
        const size = Math.min(base, (base * room) / length);
        if (size < MIN_LABEL_PX) { t.style.opacity = '0'; continue; }
        t.style.opacity = '1';
        const width = (length * size) / base;
        // Keep the whole label on its guide: its centre stays half a label (plus a
        // margin) away from both ends of the visible stretch.
        const lo = stretch.from + width / 2 + MARGIN_PX, hi = stretch.to - width / 2 - MARGIN_PX;
        const centre = Math.min(hi, Math.max(lo, straightestCentre(guide, stretch, width + 2 * MARGIN_PX)));
        glide(t, { frac: centre / total, size, base }, total);
      }
    }
  }

  // Guides are redrawn when the view settles, and while the map turns (once a frame);
  // during a zoom animation the labels hide instead of drifting.
  let rotateFrame = 0;
  map.on('zoomstart', () => { if (labelTexts.length) labelPane.style.visibility = 'hidden'; });
  map.on('moveend zoomend', () => requestAnimationFrame(refreshLabels));
  map.on('rotate', () => {
    cancelAnimationFrame(rotateFrame);
    rotateFrame = requestAnimationFrame(refreshLabels);
  });

  // ---------------------------------------------------------------- start

  // A shared link (#p=lat,lon;lat,lon&m=mode) opens with its trip planned.
  const shared = new URLSearchParams(location.hash.slice(1));
  const sharedPts = (shared.get('p') ?? '').split(';').map((x) => x.split(',').map(Number)).filter((x) => x.length === 2 && x.every(Number.isFinite));
  if (sharedPts.length >= 2) {
    const mode = shared.get('m') ?? 'all';
    for (const r of document.querySelectorAll('input[name="plan-profile"]')) if (r.value === mode) r.checked = true;
    syncPower();
    stops = sharedPts.map(([lat, lon]) => ({ lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` }));
    stops.forEach((p) => placeName(p.lat, p.lon).then((name) => { if (name) { p.label = name; renderStops(); renderSummary(); } }));
    syncMarkers();
    renderStops();
    update();
  } else {
    // Most trips start where you are: with location already allowed, the origin is
    // filled in, and only the destination is left to choose.
    locate?.whenLocated((ll) => {
      if (!stops[0]) setStop(0, { lat: ll.lat, lon: ll.lng }, { label: 'Minha localização', auto: true });
    });
  }
}
