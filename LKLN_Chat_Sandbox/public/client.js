const loginSection = document.getElementById("login-section");
const mainSection = document.getElementById("main-section");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const nameInput = document.getElementById("name-input");
const callsignInput = document.getElementById("callsign-input");
const airportInput = document.getElementById("airport-input");
const roleInput = document.getElementById("role-input");
const userInfoEl = document.getElementById("user-info");

const runwayStatusEl = document.getElementById("runway-status");
const atisTextEl = document.getElementById("atis-text");
const opsEditEl = document.getElementById("ops-edit");
const runwayInput = document.getElementById("runway-input");
const atisInput = document.getElementById("atis-input");
const opsSaveBtn = document.getElementById("ops-save-btn");

const requestInput = document.getElementById("request-input");
const requestSendBtn = document.getElementById("request-send-btn");
const requestsListEl = document.getElementById("requests-list");

const messagesEl = document.getElementById("messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");

let socket = null;
let map = null;
let userMarker = null;
const otherMarkers = new Map();
let requests = [];

let currentUser = {
  name: null,
  callsign: null,
  airport: "LKLN",
  role: "pilot"
};

const AIRPORT_CENTER = [49.675, 13.276];

function appendMessage(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = "message";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const time = new Date(msg.ts || Date.now());
  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");

  meta.textContent = `[${hh}:${mm}] ${msg.callsign || "??"} – ${msg.name || ""}`;

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = msg.text;

  wrapper.appendChild(meta);
  wrapper.appendChild(text);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderRequests() {
  requestsListEl.innerHTML = "";

  if (!requests.length) {
    requestsListEl.innerHTML = '<p class="muted">Zatím bez požadavků.</p>';
    return;
  }

  requests
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .forEach((req) => {
      const item = document.createElement("div");
      item.className = `request-item state-${req.status}`;

      const top = document.createElement("div");
      top.className = "request-top";
      top.textContent = `${req.callsign} · ${req.text}`;

      const meta = document.createElement("div");
      meta.className = "request-meta";
      meta.textContent = `Stav: ${req.status.toUpperCase()}`;

      item.appendChild(top);
      item.appendChild(meta);

      if (currentUser.role === "ops" && req.status === "new") {
        const actions = document.createElement("div");
        actions.className = "request-actions";

        const approveBtn = document.createElement("button");
        approveBtn.className = "btn-small";
        approveBtn.textContent = "Schválit";
        approveBtn.addEventListener("click", () => {
          socket.emit("pilot:request:update", { requestId: req.id, status: "approved" });
        });

        const rejectBtn = document.createElement("button");
        rejectBtn.className = "btn-small danger";
        rejectBtn.textContent = "Zamítnout";
        rejectBtn.addEventListener("click", () => {
          socket.emit("pilot:request:update", { requestId: req.id, status: "rejected" });
        });

        actions.appendChild(approveBtn);
        actions.appendChild(rejectBtn);
        item.appendChild(actions);
      }

      requestsListEl.appendChild(item);
    });
}

function initMap() {
  map = L.map("map").setView(AIRPORT_CENTER, 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap"
  }).addTo(map);
}

function updateUserMarker(lat, lon) {
  if (!map) return;
  if (!userMarker) {
    userMarker = L.marker([lat, lon], {
      title: `${currentUser.callsign}`
    }).addTo(map);
  } else {
    userMarker.setLatLng([lat, lon]);
  }
}

function upsertOtherMarker({ id, name, callsign, lat, lon }) {
  if (!lat || !lon) return;
  let marker = otherMarkers.get(id);
  if (!marker) {
    marker = L.marker([lat, lon], {
      title: `${callsign || ""} – ${name || ""}`,
      opacity: 0.85
    }).addTo(map);
    otherMarkers.set(id, marker);
  } else {
    marker.setLatLng([lat, lon]);
  }
}

function removeOtherMarker(id) {
  const marker = otherMarkers.get(id);
  if (marker) {
    map.removeLayer(marker);
    otherMarkers.delete(id);
  }
}

function startGeolocation() {
  if (!navigator.geolocation) {
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      updateUserMarker(lat, lon);

      if (socket) {
        socket.emit("position:update", { lat, lon });
      }
    },
    () => {},
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000
    }
  );
}

function applyOpsState({ runwayStatus, atis, requests: incomingRequests }) {
  runwayStatusEl.textContent = runwayStatus || "—";
  atisTextEl.textContent = atis || "—";
  runwayInput.value = runwayStatus || "";
  atisInput.value = atis || "";
  requests = incomingRequests || [];
  renderRequests();
}

function connectSocket() {
  socket = io();

  socket.on("connect", () => {
    socket.emit("join", {
      name: currentUser.name,
      callsign: currentUser.callsign,
      airport: currentUser.airport,
      role: currentUser.role
    });
  });

  socket.on("airport:state", ({ others }) => {
    others.forEach((u) => upsertOtherMarker(u));
  });

  socket.on("airport:user-left", ({ id }) => {
    removeOtherMarker(id);
  });

  socket.on("position:update", (payload) => {
    if (payload.id === socket.id) return;
    upsertOtherMarker(payload);
  });

  socket.on("chat:airport-message", (msg) => {
    appendMessage(msg);
  });

  socket.on("ops:state", (state) => {
    applyOpsState(state);
  });

  socket.on("pilot:request:created", (request) => {
    requests.push(request);
    renderRequests();
  });

  socket.on("pilot:request:updated", ({ requestId, status }) => {
    requests = requests.map((item) => {
      if (item.id !== requestId) return item;
      return { ...item, status };
    });
    renderRequests();
  });
}

loginBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const callsign = callsignInput.value.trim();
  const airport = airportInput.value.trim().toUpperCase();
  const role = roleInput.value;

  if (!name || !callsign || !airport) {
    loginError.textContent = "Vyplň prosím jméno, callsign i ICAO letiště.";
    return;
  }

  loginError.textContent = "";
  currentUser.name = name;
  currentUser.callsign = callsign.toUpperCase();
  currentUser.airport = airport;
  currentUser.role = role;

  userInfoEl.textContent = `${currentUser.name} (${currentUser.callsign}) @ ${currentUser.airport} · ${currentUser.role}`;

  if (currentUser.role === "ops") {
    opsEditEl.classList.remove("hidden");
  }

  loginSection.classList.add("hidden");
  mainSection.classList.remove("hidden");

  if (!map) {
    initMap();
    updateUserMarker(AIRPORT_CENTER[0], AIRPORT_CENTER[1]);
  }

  connectSocket();
  startGeolocation();
});

opsSaveBtn.addEventListener("click", () => {
  if (!socket || currentUser.role !== "ops") return;
  socket.emit("ops:update", {
    runwayStatus: runwayInput.value.trim(),
    atis: atisInput.value.trim()
  });
});

requestSendBtn.addEventListener("click", () => {
  const text = requestInput.value.trim();
  if (!socket || !text) return;
  socket.emit("pilot:request", { text });
  requestInput.value = "";
});

chatSendBtn.addEventListener("click", () => {
  const text = chatInput.value.trim();
  if (!text || !socket) return;

  socket.emit("chat:airport-message", { text });
  chatInput.value = "";
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    chatSendBtn.click();
  }
});
