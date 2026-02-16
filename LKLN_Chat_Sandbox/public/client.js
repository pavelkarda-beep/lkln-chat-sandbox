const byId = (id) => document.getElementById(id);

const loginSection = byId("login-section");
const mainSection = byId("main-section");
const loginBtn = byId("login-btn");
const loginError = byId("login-error");
const userInfoEl = byId("user-info");

const nameInput = byId("name-input");
const callsignInput = byId("callsign-input");
const airportInput = byId("airport-input");
const roleInput = byId("role-input");
const sectorInput = byId("sector-input");

const runwayStatusEl = byId("runway-status");
const atisTextEl = byId("atis-text");
const opsEditEl = byId("ops-edit");
const runwayInput = byId("runway-input");
const atisInput = byId("atis-input");
const opsSaveBtn = byId("ops-save-btn");

const quickCallsign = byId("quick-callsign");
const quickType = byId("quick-type");
const quickPilot = byId("quick-pilot");
const quickMovement = byId("quick-movement");
const quickLkln = byId("quick-lkln");
const quickAddBtn = byId("quick-add-btn");

const agreementFilterEl = byId("agreement-filter");
const aircraftExportBtn = byId("aircraft-export-btn");
const aircraftListEl = byId("aircraft-list");
const aircraftDetailPanel = byId("aircraft-detail-panel");
const aircraftDetailEl = byId("aircraft-detail");
const aircraftBackBtn = byId("aircraft-back-btn");
const aircraftSaveBtn = byId("aircraft-save-btn");

const arrivalsListEl = byId("arrivals-list");
const departuresListEl = byId("departures-list");

const alertsListEl = byId("alerts-list");
const densityPredictionEl = byId("density-prediction");

const statsTypeEl = byId("stats-type");
const statsPilotEl = byId("stats-pilot");
const statsFromEl = byId("stats-from");
const statsToEl = byId("stats-to");
const statsApplyBtn = byId("stats-apply-btn");
const statsExportCsvBtn = byId("stats-export-csv-btn");
const statsExportPdfBtn = byId("stats-export-pdf-btn");
const statsListEl = byId("stats-list");

const userManagementEl = byId("user-management");
const assignUserIdEl = byId("assign-user-id");
const assignRoleEl = byId("assign-role");
const assignAirportEl = byId("assign-airport");
const assignSectorEl = byId("assign-sector");
const assignUserBtn = byId("assign-user-btn");
const usersListEl = byId("users-list");
const auditLogEl = byId("audit-log");

const regionalSharingPanel = byId("regional-sharing-panel");
const groupNameEl = byId("group-name");
const groupAirportsEl = byId("group-airports");
const groupShareAlertsEl = byId("group-share-alerts");
const groupShareTrackEl = byId("group-share-track");
const groupSaveBtn = byId("group-save-btn");
const groupsListEl = byId("groups-list");

const messagesEl = byId("messages");
const chatInput = byId("chat-input");
const chatSendBtn = byId("chat-send-btn");

let socket = null;
let map = null;
let userMarker = null;
const otherMarkers = new Map();
const tracks = new Map();
const predictedTracks = new Map();

let selectedAircraftId = null;
let agreementFilter = "all";
let statsFiltered = [];

const state = {
  runwayStatus: "",
  atis: "",
  requests: [],
  aircraft: [],
  arrivals: [],
  departures: [],
  movements: [],
  alerts: [],
  users: [],
  auditLog: [],
  regionalGroups: [],
  densityPrediction: "—"
};

const currentUser = {
  name: null,
  callsign: null,
  airport: "LKLN",
  role: "pilot",
  sector: "TWR"
};

const AIRPORT_CENTER = [49.675, 13.276];

function canEditAircraft() {
  return ["ops", "admin"].includes(currentUser.role);
}

function canManageUsers() {
  return currentUser.role === "admin";
}

function downloadText(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportAircraftCsv() {
  const rows = filteredAircraft();
  const columns = [
    "id",
    "callsign",
    "registration",
    "type",
    "pilot",
    "source",
    "lkln_coordination_agreement",
    "assignedAirport",
    "sector",
    "transponder",
    "route",
    "notes",
    "db_details",
    "createdAt",
    "updatedAt"
  ];

  const csv = [columns.join(",")]
    .concat(
      rows.map((a) =>
        columns
          .map((c) => {
            if (c === "route") return csvValue((a.route || []).join("|"));
            if (c === "db_details") return csvValue(JSON.stringify(a.db_details || {}));
            return csvValue(a[c]);
          })
          .join(",")
      )
    )
    .join("\n");

  downloadText(`aircraft_${currentUser.airport}.csv`, csv, "text/csv");
}

function appendMessage(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = "message";
  const time = new Date(msg.ts || Date.now());
  wrapper.innerHTML = `<div class="message-meta">[${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}] ${msg.callsign || "??"}</div><div class="message-text"></div>`;
  wrapper.querySelector(".message-text").textContent = msg.text;
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function initMap() {
  map = L.map("map").setView(AIRPORT_CENTER, 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap"
  }).addTo(map);
}

function upsertOtherMarker({ id, callsign, lat, lon, heading = 0, speed = 0 }) {
  if (!lat || !lon) return;
  let marker = otherMarkers.get(id);
  if (!marker) {
    marker = L.marker([lat, lon], { title: callsign || id, opacity: 0.85 }).addTo(map);
    otherMarkers.set(id, marker);
  } else {
    marker.setLatLng([lat, lon]);
  }

  let track = tracks.get(id);
  if (!track) {
    track = L.polyline([], { color: "#60a5fa" }).addTo(map);
    tracks.set(id, track);
  }
  const points = track.getLatLngs();
  points.push([lat, lon]);
  if (points.length > 25) points.shift();
  track.setLatLngs(points);

  const predLat = lat + ((speed || 0) * Math.cos((heading * Math.PI) / 180)) / 5000;
  const predLon = lon + ((speed || 0) * Math.sin((heading * Math.PI) / 180)) / 5000;
  let predicted = predictedTracks.get(id);
  if (!predicted) {
    predicted = L.polyline([], { color: "#f59e0b", dashArray: "4,6" }).addTo(map);
    predictedTracks.set(id, predicted);
  }
  predicted.setLatLngs([
    [lat, lon],
    [predLat, predLon]
  ]);
}

function startGeolocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      if (!userMarker) {
        userMarker = L.marker([lat, lon], { title: currentUser.callsign }).addTo(map);
      } else {
        userMarker.setLatLng([lat, lon]);
      }
      socket?.emit("position:update", {
        lat,
        lon,
        heading: pos.coords.heading || 0,
        speed: pos.coords.speed || 0
      });
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function filteredAircraft() {
  return state.aircraft.filter((a) => {
    const hasAgreement = !!(a.lkln_coordination_agreement || "").trim();
    if (agreementFilter === "with") return hasAgreement;
    if (agreementFilter === "without") return !hasAgreement;
    return true;
  });
}

function renderAircraftList() {
  const rows = filteredAircraft();
  if (!rows.length) {
    aircraftListEl.innerHTML = '<p class="muted">Bez letadel.</p>';
    return;
  }
  aircraftListEl.innerHTML = "";

  rows.forEach((a) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `<strong>${a.callsign}</strong> · ${a.type || "?"} · dohoda: ${a.lkln_coordination_agreement || "-"}`;
    div.addEventListener("click", () => openAircraftDetail(a.id));
    aircraftListEl.appendChild(div);
  });
}

function openAircraftDetail(id) {
  selectedAircraftId = id;
  const a = state.aircraft.find((item) => item.id === id);
  if (!a) return;
  aircraftDetailPanel.classList.remove("hidden");

  aircraftDetailEl.innerHTML = `
    <label>Callsign<input id="detail-callsign" value="${a.callsign || ""}" ${!canEditAircraft() ? "disabled" : ""} /></label>
    <label>Registrace<input id="detail-registration" value="${a.registration || ""}" ${!canEditAircraft() ? "disabled" : ""} /></label>
    <label>Typ<input id="detail-type" value="${a.type || ""}" ${!canEditAircraft() ? "disabled" : ""} /></label>
    <label>Pilot<input id="detail-pilot" value="${a.pilot || ""}" ${!canEditAircraft() ? "disabled" : ""} /></label>
    <label>Koordinační dohoda (LKLN)<input id="detail-lkln" value="${a.lkln_coordination_agreement || ""}" ${!canEditAircraft() ? "disabled" : ""} /></label>
    <label>Přiřazené letiště<input id="detail-airport" value="${a.assignedAirport || ""}" ${!canEditAircraft() ? "disabled" : ""} /></label>
    <label>Sektor<input id="detail-sector" value="${a.sector || ""}" ${!canEditAircraft() ? "disabled" : ""} /></label>
    <label>Odpovídač
      <select id="detail-transponder" ${!canEditAircraft() ? "disabled" : ""}>
        <option value="true" ${a.transponder ? "selected" : ""}>ANO</option>
        <option value="false" ${!a.transponder ? "selected" : ""}>NE</option>
      </select>
    </label>
    <label>Poznámky<input id="detail-notes" value="${a.notes || ""}" ${!canEditAircraft() ? "disabled" : ""} /></label>
    <label>Data z importované DB (JSON)<textarea id="detail-db" ${!canEditAircraft() ? "disabled" : ""}>${JSON.stringify(a.db_details || {}, null, 2)}</textarea></label>
  `;
}

function saveAircraftDetail() {
  if (!selectedAircraftId || !canEditAircraft()) return;
  const existing = state.aircraft.find((a) => a.id === selectedAircraftId);
  if (!existing) return;

  let dbDetails = {};
  try {
    dbDetails = JSON.parse(byId("detail-db").value || "{}");
  } catch (e) {
    alert("Neplatný JSON v detailech DB.");
    return;
  }

  socket.emit("aircraft:create-or-upsert", {
    id: existing.id,
    callsign: byId("detail-callsign").value.trim().toUpperCase(),
    registration: byId("detail-registration").value.trim(),
    type: byId("detail-type").value.trim(),
    pilot: byId("detail-pilot").value.trim(),
    lkln_coordination_agreement: byId("detail-lkln").value.trim(),
    assignedAirport: byId("detail-airport").value.trim().toUpperCase(),
    sector: byId("detail-sector").value.trim(),
    transponder: byId("detail-transponder").value === "true",
    notes: byId("detail-notes").value.trim(),
    db_details: dbDetails
  });
}

function renderArrivalsDepartures() {
  arrivalsListEl.innerHTML = state.arrivals
    .slice(0, 20)
    .map((m) => `<div class="list-item">${m.callsign} · ${m.type || "?"} · ${new Date(m.ts).toLocaleTimeString("cs-CZ")}</div>`)
    .join("") || '<p class="muted">Bez příletů.</p>';

  departuresListEl.innerHTML = state.departures
    .slice(0, 20)
    .map((m) => `<div class="list-item">${m.callsign} · ${m.type || "?"} · ${new Date(m.ts).toLocaleTimeString("cs-CZ")}</div>`)
    .join("") || '<p class="muted">Bez odletů.</p>';
}

function renderAlerts() {
  densityPredictionEl.textContent = state.densityPrediction || "—";
  alertsListEl.innerHTML = state.alerts
    .slice(0, 20)
    .map((a) => `<div class="list-item"><strong>${a.type}</strong>: ${a.message}</div>`)
    .join("") || '<p class="muted">Bez alertů.</p>';
}

function applyStatsFilter() {
  const type = statsTypeEl.value.trim().toLowerCase();
  const pilot = statsPilotEl.value.trim().toLowerCase();
  const from = statsFromEl.value ? new Date(statsFromEl.value).getTime() : 0;
  const to = statsToEl.value ? new Date(`${statsToEl.value}T23:59:59`).getTime() : Number.MAX_SAFE_INTEGER;

  statsFiltered = state.movements.filter((m) => {
    if (type && !(m.type || "").toLowerCase().includes(type)) return false;
    if (pilot && !(m.pilot || "").toLowerCase().includes(pilot)) return false;
    if (m.ts < from || m.ts > to) return false;
    return true;
  });

  statsListEl.innerHTML = statsFiltered
    .slice(0, 200)
    .map((m) => `<div class="list-item">${new Date(m.ts).toLocaleString("cs-CZ")} · ${m.airport} · ${m.movementType} · ${m.callsign} · ${m.type || "?"} · ${m.pilot || "?"}</div>`)
    .join("") || '<p class="muted">Bez záznamů.</p>';
}

function exportStatsCsv() {
  const header = "ts,airport,movementType,callsign,type,pilot";
  const lines = statsFiltered.map((m) => [m.ts, m.airport, m.movementType, m.callsign, m.type, m.pilot].map(csvValue).join(","));
  downloadText(`stats_${currentUser.airport}.csv`, [header, ...lines].join("\n"), "text/csv");
}

function exportStatsPdfLike() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Statistiky</title></head><body><h1>Statistiky vzletů/přistání</h1><table border="1" cellspacing="0" cellpadding="4"><tr><th>Čas</th><th>Letiště</th><th>Pohyb</th><th>Callsign</th><th>Typ</th><th>Pilot</th></tr>${statsFiltered
    .map(
      (m) =>
        `<tr><td>${new Date(m.ts).toLocaleString("cs-CZ")}</td><td>${m.airport}</td><td>${m.movementType}</td><td>${m.callsign}</td><td>${m.type || ""}</td><td>${m.pilot || ""}</td></tr>`
    )
    .join("")}</table><script>window.print();</script></body></html>`;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

function renderUsers() {
  usersListEl.innerHTML = state.users
    .map((u) => `<div class="list-item">${u.id} · ${u.callsign} · ${u.role} · ${u.airport}/${u.sector}</div>`)
    .join("") || '<p class="muted">Bez uživatelů.</p>';
}

function renderAudit() {
  auditLogEl.innerHTML = state.auditLog
    .slice(0, 40)
    .map((a) => `<div class="list-item">${new Date(a.ts).toLocaleString("cs-CZ")} · ${a.actor} (${a.role}) · ${a.action} · ${a.detail}</div>`)
    .join("") || '<p class="muted">Audit prázdný.</p>';
}

function renderGroups() {
  groupsListEl.innerHTML = state.regionalGroups
    .map((g) => `<div class="list-item">${g.name}: ${g.airports.join(", ")} | alerty=${g.shareApproachAlerts ? "ano" : "ne"}, trasy=${g.shareFullTrack ? "ano" : "ne"}</div>`)
    .join("") || '<p class="muted">Bez skupin.</p>';
}

function applySnapshot(snapshot) {
  Object.assign(state, snapshot);
  runwayStatusEl.textContent = state.runwayStatus || "—";
  atisTextEl.textContent = state.atis || "—";
  runwayInput.value = state.runwayStatus || "";
  atisInput.value = state.atis || "";
  renderAircraftList();
  renderArrivalsDepartures();
  renderAlerts();
  applyStatsFilter();
  renderUsers();
  renderAudit();
  renderGroups();

  if (selectedAircraftId) {
    const stillExists = state.aircraft.find((a) => a.id === selectedAircraftId);
    if (stillExists) {
      openAircraftDetail(selectedAircraftId);
    }
  }
}

function connectSocket() {
  socket = io();

  socket.on("connect", () => {
    socket.emit("join", {
      name: currentUser.name,
      callsign: currentUser.callsign,
      airport: currentUser.airport,
      role: currentUser.role,
      sector: currentUser.sector
    });
  });

  socket.on("airport:state", ({ others }) => {
    others.forEach((u) => upsertOtherMarker(u));
  });

  socket.on("airport:snapshot", applySnapshot);
  socket.on("pilot:request:created", (request) => state.requests.push(request));
  socket.on("pilot:request:updated", ({ requestId, status }) => {
    state.requests = state.requests.map((r) => (r.id === requestId ? { ...r, status } : r));
  });

  socket.on("position:update", (payload) => {
    if (payload.id === socket.id) return;
    upsertOtherMarker(payload);
  });

  socket.on("traffic:alert", (alert) => {
    state.alerts.unshift(alert);
    renderAlerts();
  });

  socket.on("traffic:shared-alert", (alert) => {
    state.alerts.unshift(alert);
    renderAlerts();
  });

  socket.on("chat:airport-message", appendMessage);
}

loginBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const callsign = callsignInput.value.trim().toUpperCase();
  const airport = airportInput.value.trim().toUpperCase();
  const role = roleInput.value;
  const sector = sectorInput.value.trim() || "TWR";

  if (!name || !callsign || !airport) {
    loginError.textContent = "Vyplň jméno, callsign a ICAO letiště.";
    return;
  }

  currentUser.name = name;
  currentUser.callsign = callsign;
  currentUser.airport = airport;
  currentUser.role = role;
  currentUser.sector = sector;

  userInfoEl.textContent = `${name} (${callsign}) @ ${airport} · ${role}/${sector}`;
  loginSection.classList.add("hidden");
  mainSection.classList.remove("hidden");

  if (["ops", "admin"].includes(role)) opsEditEl.classList.remove("hidden");
  if (role === "admin") {
    userManagementEl.classList.remove("hidden");
    regionalSharingPanel.classList.remove("hidden");
  }

  if (!map) {
    initMap();
    userMarker = L.marker(AIRPORT_CENTER, { title: callsign }).addTo(map);
  }

  connectSocket();
  startGeolocation();
});

opsSaveBtn.addEventListener("click", () => {
  socket?.emit("ops:update", {
    runwayStatus: runwayInput.value.trim(),
    atis: atisInput.value.trim()
  });
});

quickAddBtn.addEventListener("click", () => {
  const callsign = quickCallsign.value.trim().toUpperCase();
  if (!callsign) return;
  socket?.emit("aircraft:create-or-upsert", {
    callsign,
    type: quickType.value.trim(),
    pilot: quickPilot.value.trim(),
    source: "manual-non-adsb",
    lkln_coordination_agreement: quickLkln.value.trim(),
    assignedAirport: currentUser.airport,
    sector: currentUser.sector,
    transponder: false,
    db_details: { manualEntry: true, importedDatabase: "none" }
  });
  socket?.emit("movement:manual", {
    callsign,
    movementType: quickMovement.value
  });
});

agreementFilterEl.addEventListener("change", () => {
  agreementFilter = agreementFilterEl.value;
  renderAircraftList();
});

aircraftExportBtn.addEventListener("click", exportAircraftCsv);
aircraftBackBtn.addEventListener("click", () => aircraftDetailPanel.classList.add("hidden"));
aircraftSaveBtn.addEventListener("click", saveAircraftDetail);

statsApplyBtn.addEventListener("click", applyStatsFilter);
statsExportCsvBtn.addEventListener("click", exportStatsCsv);
statsExportPdfBtn.addEventListener("click", exportStatsPdfLike);

assignUserBtn.addEventListener("click", () => {
  if (!canManageUsers()) return;
  socket?.emit("user:assign", {
    userId: assignUserIdEl.value.trim(),
    role: assignRoleEl.value,
    airport: assignAirportEl.value.trim().toUpperCase(),
    sector: assignSectorEl.value.trim()
  });
});

groupSaveBtn.addEventListener("click", () => {
  socket?.emit("regional:group:upsert", {
    name: groupNameEl.value.trim(),
    airports: groupAirportsEl.value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    shareApproachAlerts: groupShareAlertsEl.checked,
    shareFullTrack: groupShareTrackEl.checked
  });
});

chatSendBtn.addEventListener("click", () => {
  const text = chatInput.value.trim();
  if (!text) return;
  socket?.emit("chat:airport-message", { text });
  chatInput.value = "";
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") chatSendBtn.click();
});
