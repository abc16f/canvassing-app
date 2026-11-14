// Map centered on Poncey-Highland, with the OpenStreetMap France street map underneath.
const map = L.map('map', { zoomControl: false }).setView([33.7725, -84.3575], 16);
L.control.zoom({ position: 'topright' }).addTo(map);

// Legend in the top-left corner. It folds up so it does not cover the map on a phone.
const legend = L.control({ position: 'topleft' });
legend.onAdd = () => {
  const d = L.DomUtil.create('div', 'legend');
  d.innerHTML = `<details open><summary>Legend</summary>
    <h4>Shape: what it is</h4>
    <div><span class="shp" style="width:8px;height:8px;border-radius:50%;background:#888780"></span>Home (house, condo, or townhome)</div>
    <div><span class="shp" style="width:11px;height:11px;background:#888780"></span>Apartment building</div>
    <div><span class="shp dia" style="width:10px;height:10px;background:#888780"></span>Business, church, or hotel</div>
    <div><span class="shp dia" style="width:12px;height:12px;background:#888780;color:#fff;font:700 8px system-ui;text-align:center;line-height:11px"><span style="display:inline-block;transform:rotate(-45deg)">2</span></span>Two places at one address</div>
    <h4>Color: visits in the chosen time</h4>
    <div><span class="shp" style="width:11px;height:11px;border-radius:50%;background:#888780"></span>Not visited</div>
    <div><span class="shp" style="width:11px;height:11px;border-radius:50%;background:#1D9E75"></span>Visited</div>
    <div><span class="shp" style="width:11px;height:11px;border-radius:50%;background:#BA7517"></span>Contacted, not yet visited</div>
    <div><span class="shp" style="width:11px;height:11px;border-radius:50%;background:#9FE1CB"></span>Visited or contacted before Nov 2026 (exact date unknown)</div>
    <h4>Route</h4>
    <div><span class="shp" style="width:11px;height:11px;border-radius:50%;background:#888780;border:none;box-shadow:0 0 0 3px #185FA5"></span>Blue ring: on the route</div>
    <div><span style="display:inline-block;width:14px;height:4px;background:#534AB7;margin-right:8px;vertical-align:3px"></span>Walking route</div>
    <div><span style="display:inline-block;width:14px;border-top:2px dashed #534AB7;margin-right:8px;vertical-align:3px"></span>Poncey-Highland boundary</div>
    <div class="muted" style="max-width:200px;line-height:1.3;margin-top:4px">Tap empty map to add a stop. Tap a symbol for details, then "Add a stop here."</div>
  </details>`;
  L.DomEvent.disableClickPropagation(d);
  return d;
};
legend.addTo(map);
if (window.innerWidth < 600) legend.getContainer().querySelector('details').removeAttribute('open');
L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', { maxZoom: 19, subdomains: 'abc', attribution: '&copy; OpenStreetMap contributors, OSM France' }).addTo(map);

// Official Poncey-Highland outline from the City of Atlanta. If the city's server blocks the request, the map still works without it.
fetch("https://gis.atlantaga.gov/dpcd/rest/services/AdministrativeArea/GeopoliticalArea/MapServer/1/query?where=NAME%3D'Poncey-Highland'&returnGeometry=true&outSR=4326&f=geojson")
  .then(r => r.json()).then(g => L.geoJSON(g, { style: { color: '#534AB7', weight: 2, fill: false, dashArray: '4 4' } }).addTo(map))
  .catch(() => {});

const STATUS_COLOR = { 'visited': '#1D9E75', 'contacted, not visited': '#BA7517' };
let windowDays = 30;

// One color rule for every home, apartment building, and place: the color shows its visit status in the chosen time window.
// Visits logged before the app existed have no exact date, so they get their own pale color in every window.
function statusColor(d) {
  if (!STATUS_COLOR[d.status]) return '#888780';
  if (d.last_visit === 'Before Nov 2026') return '#9FE1CB';
  const when = new Date(d.last_visit);
  if (isNaN(when)) return '#888780';
  return (Date.now() - when) / 86400000 <= windowDays ? STATUS_COLOR[d.status] : '#888780';
}

// Square symbol for apartment buildings and diamond symbol for businesses, churches, and hotels; a blue ring marks those on the route.
function shapeIcon(kind, color, on, text) {
  const size = kind === 'apt' ? 14 : 15;
  return L.divIcon({ className: '', iconSize: [size, size],
    html: `<div class="${kind === 'apt' ? 'mk-apt' : 'mk-place'}${on ? ' mk-on' : ''}" style="width:${size}px;height:${size}px;background:${color}"><span>${text || ''}</span></div>` });
}

// Restyle every symbol from its status color and whether it is on the route.
function styleAll() {
  homes.forEach(h => {
    const c = statusColor(h);
    if (h.apt) h.marker.setIcon(shapeIcon('apt', c, h.on));
    else { h.marker.setStyle({ fillColor: c, color: h.on ? '#185FA5' : '#555', weight: h.on ? 2.5 : 1 }); h.marker.setRadius(h.on ? 5 : 3.5); }
  });
  places.forEach(p => p.marker.setIcon(shapeIcon('place', statusColor(p), p.on, p.shared_address_with ? '2' : '')));
}
let homes = [], places = [], routeLine = null, bufferM = 50;

// Phones and tablets have no mouse to hover with, so a tap would open the hover box and the pop-up at once.
// On those screens, only the pop-up is used. On a computer, clicking a symbol hides its hover box while the pop-up is open.
const canHover = window.matchMedia('(hover: hover)').matches;
function addHover(m, html) {
  if (!canHover) return m;
  return m.bindTooltip(html).on('popupopen', () => m.closeTooltip());
}

// Every dot's pop-up gets a button that adds a route stop at that dot, since tapping a dot opens its details instead.
function addStopButton(d) { return `<br><button class="addstop" onclick="addStopAt(${+d.lat}, ${+d.lon})">Add a stop here</button>`; }
function addStopAt(lat, lon) {
  map.closePopup();
  control.setWaypoints([...realStops().map(w => w.latLng), L.latLng(lat, lon)]);
}

function loadCsv(path) {
  return new Promise((ok, fail) => Papa.parse(path, { download: true, header: true, skipEmptyLines: true, complete: r => ok(r.data), error: fail }));
}

const dataReady = Promise.all([loadCsv('data/home_doors.csv'), loadCsv('data/nonres_public.csv')]).then(([h, p]) => {
  homes = h.map(d => {
    const apt = d.building_type === 'apartment building';
    const label = `${d.building_address}${d.unit ? ', Unit ' + d.unit : ''}<br>${d.building_type} · ${d.home_doors} home door${d.home_doors === '1' ? '' : 's'}`;
    const m = addHover(apt ? L.marker([+d.lat, +d.lon], { icon: shapeIcon('apt', '#888780', false), bubblingMouseEvents: false })
                           : L.circleMarker([+d.lat, +d.lon], { radius: 3.5, color: '#555', weight: 1, fillColor: '#888780', fillOpacity: 1, bubblingMouseEvents: false }), label)
      .bindPopup(label + addStopButton(d)).addTo(map);
    return { ...d, ref: d.door_id, label, n: +d.home_doors, pt: turf.point([+d.lon, +d.lat]), marker: m, apt, on: false };
  });
  places = p.map(d => {
    const shared = d.shared_address_with ? '<br>Shares this address with ' + d.shared_address_with : '';
    const labelBase = `<b>${d.name}</b><br>${d.type} · ${d.address}${shared}`;   // used once a logged visit replaces the old status line
    const label = `<b>${d.name}</b><br>${d.type} · ${d.address}<br>Status: ${d.status}${d.last_visit ? ' (' + d.last_visit + ')' : ''}${shared}`;
    const m = addHover(L.marker([+d.lat, +d.lon], { icon: shapeIcon('place', '#888780', false), bubblingMouseEvents: false, zIndexOffset: 500 }), label)
      .bindPopup(label + addStopButton(d)).addTo(map);
    return { ...d, ref: d.id, label, labelBase, pt: turf.point([+d.lon, +d.lat]), marker: m, on: false };
  });
  styleAll();
}).catch(e => alert('Could not load the data files: ' + e));

// Walking routes come from the free FOSSGIS routing server, which asks for at most one request per second, so the route redraws only after a drag ends.
const router = L.Routing.osrmv1({ serviceUrl: 'https://routing.openstreetmap.de/routed-foot/route/v1', profile: 'driving' });
const control = L.Routing.control({
  router, waypoints: [], routeWhileDragging: false, addWaypoints: true, draggableWaypoints: true, fitSelectedRoutes: false, show: false,
  lineOptions: { styles: [{ color: '#534AB7', weight: 5, opacity: 0.85 }] },
  createMarker: (i, wp) => L.marker(wp.latLng, { draggable: true })
}).addTo(map);

function realStops() { return control.getWaypoints().filter(w => w.latLng); }

map.on('click', e => {
  const stops = realStops().map(w => w.latLng);
  stops.push(e.latlng);
  control.setWaypoints(stops);
});
document.getElementById('undo').onclick = () => control.setWaypoints(realStops().slice(0, -1).map(w => w.latLng));
document.getElementById('loop').onclick = () => { const s = realStops().map(w => w.latLng); if (s.length > 1) control.setWaypoints([...s, s[0]]); };
document.getElementById('clear').onclick = () => { control.setWaypoints([]); routeLine = null; recount(); };
document.getElementById('buffer').onchange = e => { bufferM = +e.target.value; recount(); };

control.on('routesfound', e => {
  const r = e.routes[0];
  routeLine = turf.lineString(r.coordinates.map(c => [c.lng, c.lat]));
  const miles = (r.summary.totalDistance / 1609.34).toFixed(2);
  document.getElementById('routeInfo').textContent = `${miles} mi · about ${Math.round(r.summary.totalTime / 60)} min walking`;
  recount();
});
control.on('waypointschanged', () => { if (realStops().length < 2) { routeLine = null; document.getElementById('routeInfo').textContent = 'Tap anywhere on the map to add a stop'; recount(); } });

// Count houses and condos, apartment buildings (and the homes inside them), and other places within the chosen distance of the route, and ring the ones that count.
function recount() {
  let homeTotal = 0, aptTotal = 0, aptHomes = 0, otherTotal = 0;
  const near = pt => !!routeLine && turf.pointToLineDistance(pt, routeLine, { units: 'meters' }) <= bufferM;
  homes.forEach(h => {
    h.on = near(h.pt);
    if (h.on && h.apt) { aptTotal += 1; aptHomes += h.n; }
    else if (h.on) homeTotal += h.n;
  });
  places.forEach(p => { p.on = near(p.pt); if (p.on) otherTotal += 1; });
  styleAll();
  document.getElementById('homeCount').textContent = homeTotal.toLocaleString();
  document.getElementById('aptCount').textContent = aptTotal;
  document.getElementById('aptHomes').textContent = `${aptHomes.toLocaleString()} home${aptHomes === 1 ? '' : 's'} inside`;
  document.getElementById('otherCount').textContent = otherTotal;
}

// Time filter: recolors every symbol by whether its last visit falls inside the chosen window.
document.querySelectorAll('.chips span[data-days]').forEach(c => c.onclick = () => {
  document.querySelectorAll('.chips span[data-days]').forEach(x => x.classList.remove('on'));
  c.classList.add('on');
  windowDays = +c.dataset.days;
  styleAll();
});

// Latest visit in each hover box. Runs after sign-in, because visit logs are only readable by signed-in team members.
// Contact info is requested only for organizers; the database refuses it for everyone else anyway.
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nice = k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function visitHtml(v) {
  const when = v.details.before_app ? 'Before Nov 2026'
    : new Date(v.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  // Old visits were imported under one account, so their canvasser comes from the "covered by" column instead.
  const who = v.details.before_app ? v.details.covered_by : v.members?.display_name;
  let h = `<div class="visit"><b>Last visit:</b> ${when} · ${esc(who || 'Canvasser Unknown')}`;
  if (v.unit) h += `<br><b>Unit:</b> ${esc(v.unit)}`;
  if (v.outcome) h += `<br><b>What happened:</b> ${esc(v.outcome)}`;
  Object.entries(v.details).forEach(([k, val]) => {
    if (k === 'before_app' || k === 'covered_by' || val === '' || val == null || (Array.isArray(val) && !val.length)) return;
    h += `<br><b>${esc(nice(k))}:</b> ${esc(Array.isArray(val) ? val.join(', ') : val)}`;
  });
  if (v.avoid_next_time) h += `<br><b style="color:#A32D2D">Avoid next time:</b> ${esc([...v.avoid_reasons, v.avoid_note].filter(Boolean).join(' — '))}`;
  if (v.notes) h += `<br><b>Notes:</b> ${esc(v.notes)}`;
  const c = Array.isArray(v.visit_contacts) ? v.visit_contacts[0] : v.visit_contacts;
  if (c) h += `<div class="contact"><b>Contact (organizers only):</b> ${esc([c.name, c.phone, c.email].filter(Boolean).join(' · '))}<br>OK to contact: ${c.ok_to_contact ? 'yes' : 'no'}</div>`;
  return h + '</div>';
}

async function loadVisits() {
  await dataReady;
  const cols = 'created_at, door_ref, unit, outcome, details, notes, avoid_next_time, avoid_reasons, avoid_note, members(display_name)'
             + (me?.is_organizer ? ', visit_contacts(name, phone, email, ok_to_contact)' : '');
  const { data, error } = await sb.from('visits').select(cols).order('created_at', { ascending: false });
  if (error || !data) { console.warn('Could not load visits:', error?.message); return; }
  const latest = {};
  data.forEach(v => { if (!latest[v.door_ref]) latest[v.door_ref] = v; });   // newest first, so the first one per door is the latest
  [...homes, ...places].forEach(d => {
    const v = latest[d.ref];
    d.lastVisit = v || null;
    const base = v && d.labelBase ? d.labelBase : d.label;
    const extra = v ? visitHtml(v) : '';
    d.marker.setTooltipContent(base + extra);
    d.marker.setPopupContent(base + extra + addStopButton(d));
  });
}