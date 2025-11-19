const loginSection = document.getElementById("login-section");
const mainSection = document.getElementById("main-section");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const nameInput = document.getElementById("name-input");
const callsignInput = document.getElementById("callsign-input");
const userInfoEl = document.getElementById("user-info");

const messagesEl = document.getElementById("messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");

let socket = null;
let map = null;
let userMarker = null;
const otherMarkers = new Map();

let currentUser = {
  name: null,
  callsign: null,
  airport: "LKLN"
};

// Líně – přibližné souřadnice
const LKLN_CENTER = [49.675, 13.276];

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

function initMap() {
  map = L.map("map").setView(LKLN_CENTER, 13);

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
  let m = otherMarkers.get(id);
  if (!m) {
    m = L.marker([lat, lon], {
      title: `${callsign || ""} – ${name || ""}`,
      opacity: 0.85
    }).addTo(map);
    otherMarkers.set(id, m);
  } else {
    m.setLatLng([lat, lon]);
  }
}

function removeOtherMarker(id) {
  const m = otherMarkers.get(id);
  if (m) {
    map.removeLayer(m);
    otherMarkers.delete(id);
  }
}

function startGeolocation() {
  if (!navigator.geolocation) {
    console.warn("Geolocation not supported.");
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
    (err) => {
      console.warn("Geolocation error:", err.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000
    }
  );
}

// Připojení k Socket.IO a handlery
function connectSocket() {
  socket = io();

  socket.on("connect", () => {
    console.log("Connected:", socket.id);
    socket.emit("join", {
      name: currentUser.name,
      callsign: currentUser.callsign,
      airport: currentUser.airport
    });
  });

  socket.on("airport:state", ({ airport, others }) => {
    console.log("Airport state", airport, others);
    others.forEach((u) => upsertOtherMarker(u));
  });

  socket.on("airport:user-joined", ({ id, name, callsign }) => {
    console.log("User joined", id, name, callsign);
    // marker se vytvoří až s pozicí
  });

  socket.on("airport:user-left", ({ id, callsign }) => {
    console.log("User left", id, callsign);
    removeOtherMarker(id);
  });

  socket.on("position:update", (payload) => {
    if (payload.id === socket.id) return; // vlastního řešíme zvlášť
    upsertOtherMarker(payload);
  });

  socket.on("chat:airport-message", (msg) => {
    appendMessage(msg);
  });
}

loginBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const callsign = callsignInput.value.trim();

  if (!name || !callsign) {
    loginError.textContent = "Vyplň prosím jméno i callsign.";
    return;
  }

  loginError.textContent = "";
  currentUser.name = name;
  currentUser.callsign = callsign.toUpperCase();

  userInfoEl.textContent = `${currentUser.name} (${currentUser.callsign}) @ LKLN`;

  loginSection.classList.add("hidden");
  mainSection.classList.remove("hidden");

  if (!map) {
    initMap();
    // defaultně marker na LKLN, než přijde geolokace
    updateUserMarker(LKLN_CENTER[0], LKLN_CENTER[1]);
  }

  connectSocket();
  startGeolocation();
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