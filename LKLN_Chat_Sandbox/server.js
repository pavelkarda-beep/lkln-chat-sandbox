const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const clients = new Map();
const airports = new Map();

const ACTIONS = {
  OPS_UPDATE: "ops:update",
  AIRCRAFT_CREATE: "aircraft:create",
  AIRCRAFT_UPDATE: "aircraft:update",
  USER_ASSIGN: "user:assign",
  REGIONAL_GROUP_UPSERT: "regional:group:upsert"
};

function hasPermission(role, action) {
  if (role === "admin") return true;
  if (role === "ops") {
    return [ACTIONS.OPS_UPDATE, ACTIONS.AIRCRAFT_CREATE, ACTIONS.AIRCRAFT_UPDATE].includes(action);
  }
  if (role === "pilot") {
    return [ACTIONS.AIRCRAFT_CREATE].includes(action);
  }
  return false;
}

function getAirportState(airport) {
  if (!airports.has(airport)) {
    airports.set(airport, {
      runwayStatus: "RWY OPEN",
      atis: "INFO ALFA · QNH 1015",
      requests: [],
      aircraft: [],
      arrivals: [],
      departures: [],
      movements: [],
      alerts: [],
      historicalDensity: [],
      regionalGroups: [],
      auditLog: []
    });
  }
  return airports.get(airport);
}

function addAudit(airport, actor, action, detail) {
  const state = getAirportState(airport);
  state.auditLog.unshift({
    id: crypto.randomUUID(),
    ts: Date.now(),
    actor: actor.callsign || actor.name || "system",
    role: actor.role || "system",
    action,
    detail
  });
  state.auditLog = state.auditLog.slice(0, 200);
}

function currentUsersByAirport(airport) {
  const result = [];
  for (const [id, user] of clients.entries()) {
    if (user.airport !== airport) continue;
    result.push({
      id,
      name: user.name,
      callsign: user.callsign,
      role: user.role,
      sector: user.sector,
      airport: user.airport
    });
  }
  return result;
}

function trafficPrediction(state) {
  const now = Date.now();
  const lastHour = state.movements.filter((m) => now - m.ts < 60 * 60 * 1000).length;
  const activeAircraft = state.aircraft.length;
  const score = lastHour + activeAircraft;
  if (score > 20) return "vysoká";
  if (score > 8) return "střední";
  return "nízká";
}

function makeAlert(airport, type, message, aircraftCallsign = null) {
  const state = getAirportState(airport);
  const alert = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    type,
    message,
    aircraftCallsign
  };
  state.alerts.unshift(alert);
  state.alerts = state.alerts.slice(0, 100);
  io.to(`airport:${airport}`).emit("traffic:alert", alert);

  for (const group of state.regionalGroups) {
    if (!group.shareApproachAlerts) continue;
    for (const a of group.airports) {
      if (a === airport) continue;
      io.to(`airport:${a}`).emit("traffic:shared-alert", {
        ...alert,
        message: `[SDÍLENO ${airport}] ${alert.message}`
      });
    }
  }
}

function broadcastAirportSnapshot(airport) {
  const state = getAirportState(airport);
  io.to(`airport:${airport}`).emit("airport:snapshot", {
    runwayStatus: state.runwayStatus,
    atis: state.atis,
    requests: state.requests,
    aircraft: state.aircraft,
    arrivals: state.arrivals,
    departures: state.departures,
    movements: state.movements,
    alerts: state.alerts,
    users: currentUsersByAirport(airport),
    auditLog: state.auditLog,
    regionalGroups: state.regionalGroups,
    densityPrediction: trafficPrediction(state)
  });
}

io.on("connection", (socket) => {
  socket.on("join", ({ name, callsign, airport, role, sector }) => {
    const normalizedAirport = (airport || "LKLN").toUpperCase();
    const user = {
      name,
      callsign,
      lat: null,
      lon: null,
      airport: normalizedAirport,
      role: role || "pilot",
      sector: sector || "TWR"
    };

    clients.set(socket.id, user);
    socket.join(`airport:${normalizedAirport}`);

    const others = [];
    for (const [id, info] of clients.entries()) {
      if (id !== socket.id && info.airport === normalizedAirport) {
        others.push({ id, name: info.name, callsign: info.callsign, lat: info.lat, lon: info.lon });
      }
    }

    socket.emit("airport:state", { airport: normalizedAirport, others });
    socket.to(`airport:${normalizedAirport}`).emit("airport:user-joined", {
      id: socket.id,
      name,
      callsign
    });

    addAudit(normalizedAirport, user, "join", `${callsign} joined as ${user.role}/${user.sector}`);
    broadcastAirportSnapshot(normalizedAirport);
  });

  socket.on("position:update", ({ lat, lon, heading = 0, speed = 0 }) => {
    const client = clients.get(socket.id);
    if (!client) return;

    client.lat = lat;
    client.lon = lon;

    io.to(`airport:${client.airport}`).emit("position:update", {
      id: socket.id,
      name: client.name,
      callsign: client.callsign,
      lat,
      lon,
      heading,
      speed,
      ts: Date.now()
    });

    const inDangerZone = lat > 49.71 && lat < 49.74 && lon > 13.22 && lon < 13.26;
    if (inDangerZone) {
      makeAlert(client.airport, "danger-zone", `Letadlo ${client.callsign} vstoupilo do nebezpečné zóny.`, client.callsign);
    }
  });

  socket.on("ops:update", ({ runwayStatus, atis }) => {
    const client = clients.get(socket.id);
    if (!client || !hasPermission(client.role, ACTIONS.OPS_UPDATE)) return;

    const state = getAirportState(client.airport);
    state.runwayStatus = runwayStatus || state.runwayStatus;
    state.atis = atis || state.atis;
    addAudit(client.airport, client, "ops:update", `RWY=${state.runwayStatus}; ATIS=${state.atis}`);
    broadcastAirportSnapshot(client.airport);
  });

  socket.on("aircraft:create-or-upsert", (payload) => {
    const client = clients.get(socket.id);
    if (!client || !hasPermission(client.role, ACTIONS.AIRCRAFT_CREATE)) return;

    const state = getAirportState(client.airport);
    const callsign = (payload.callsign || "").trim().toUpperCase();
    if (!callsign) return;

    let aircraft = state.aircraft.find((a) => a.callsign === callsign);
    if (!aircraft) {
      aircraft = {
        id: crypto.randomUUID(),
        callsign,
        registration: payload.registration || "",
        type: payload.type || "",
        pilot: payload.pilot || "",
        source: payload.source || "manual",
        lkln_coordination_agreement: payload.lkln_coordination_agreement || "",
        assignedAirport: payload.assignedAirport || client.airport,
        sector: payload.sector || client.sector,
        transponder: payload.transponder !== false,
        route: payload.route || [],
        notes: payload.notes || "",
        db_details: payload.db_details || {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      state.aircraft.push(aircraft);
      addAudit(client.airport, client, "aircraft:create", `Created aircraft ${callsign}`);
    } else {
      Object.assign(aircraft, {
        ...payload,
        callsign,
        updatedAt: Date.now()
      });
      addAudit(client.airport, client, "aircraft:update", `Updated aircraft ${callsign}`);
    }

    broadcastAirportSnapshot(client.airport);
  });

  socket.on("movement:manual", ({ callsign, movementType }) => {
    const client = clients.get(socket.id);
    if (!client) return;

    const state = getAirportState(client.airport);
    const normalizedCallsign = (callsign || "").toUpperCase();
    const aircraft = state.aircraft.find((a) => a.callsign === normalizedCallsign);
    if (!aircraft) return;

    const movement = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      airport: client.airport,
      callsign: aircraft.callsign,
      type: aircraft.type,
      pilot: aircraft.pilot,
      movementType: movementType === "departure" ? "departure" : "arrival"
    };

    state.movements.unshift(movement);
    state.movements = state.movements.slice(0, 1000);

    if (movement.movementType === "arrival") {
      state.arrivals.unshift(movement);
      state.arrivals = state.arrivals.slice(0, 100);
    } else {
      state.departures.unshift(movement);
      state.departures = state.departures.slice(0, 100);
    }

    if (!aircraft.transponder && movement.movementType === "arrival") {
      makeAlert(client.airport, "no-transponder", `ATZ: ${aircraft.callsign} přílet bez odpovídače.`, aircraft.callsign);
    }

    addAudit(client.airport, client, "movement:manual", `${movement.movementType} ${movement.callsign}`);
    broadcastAirportSnapshot(client.airport);
  });

  socket.on("pilot:request", ({ text }) => {
    const client = clients.get(socket.id);
    if (!client || !text || !text.trim()) return;

    const state = getAirportState(client.airport);
    const request = {
      id: crypto.randomUUID(),
      callsign: client.callsign,
      name: client.name,
      text: text.trim(),
      status: "new",
      ts: Date.now()
    };

    state.requests.push(request);
    addAudit(client.airport, client, "pilot:request", request.text);
    io.to(`airport:${client.airport}`).emit("pilot:request:created", request);
  });

  socket.on("pilot:request:update", ({ requestId, status }) => {
    const client = clients.get(socket.id);
    if (!client || !["approved", "rejected"].includes(status) || !hasPermission(client.role, ACTIONS.OPS_UPDATE)) return;

    const state = getAirportState(client.airport);
    const request = state.requests.find((item) => item.id === requestId);
    if (!request) return;

    request.status = status;
    addAudit(client.airport, client, "pilot:request:update", `${request.callsign} => ${status}`);
    io.to(`airport:${client.airport}`).emit("pilot:request:updated", { requestId, status });
  });

  socket.on("user:assign", ({ userId, role, airport, sector }) => {
    const client = clients.get(socket.id);
    if (!client || !hasPermission(client.role, ACTIONS.USER_ASSIGN)) return;

    const target = clients.get(userId);
    if (!target) return;

    if (role) target.role = role;
    if (airport) target.airport = airport.toUpperCase();
    if (sector) target.sector = sector;

    addAudit(client.airport, client, "user:assign", `Updated ${target.callsign} role=${target.role} airport=${target.airport} sector=${target.sector}`);
    broadcastAirportSnapshot(client.airport);
    broadcastAirportSnapshot(target.airport);
  });

  socket.on("regional:group:upsert", ({ name, airports: groupAirports, shareApproachAlerts, shareFullTrack }) => {
    const client = clients.get(socket.id);
    if (!client || !hasPermission(client.role, ACTIONS.REGIONAL_GROUP_UPSERT)) return;

    const state = getAirportState(client.airport);
    const group = {
      id: crypto.randomUUID(),
      name: name || "Regional group",
      airports: (groupAirports || []).map((a) => a.toUpperCase()),
      shareApproachAlerts: !!shareApproachAlerts,
      shareFullTrack: !!shareFullTrack
    };
    state.regionalGroups.push(group);
    addAudit(client.airport, client, "regional:group:upsert", `Created group ${group.name}`);
    broadcastAirportSnapshot(client.airport);
  });

  socket.on("chat:airport-message", ({ text }) => {
    const client = clients.get(socket.id);
    if (!client || !text || !text.trim()) return;

    const msg = {
      id: socket.id,
      name: client.name,
      callsign: client.callsign,
      airport: client.airport,
      text: text.trim(),
      ts: Date.now()
    };

    io.to(`airport:${client.airport}`).emit("chat:airport-message", msg);
  });

  socket.on("disconnect", () => {
    const client = clients.get(socket.id);
    if (client) {
      io.to(`airport:${client.airport}`).emit("airport:user-left", { id: socket.id, callsign: client.callsign });
      addAudit(client.airport, client, "disconnect", `${client.callsign} disconnected`);
      clients.delete(socket.id);
      broadcastAirportSnapshot(client.airport);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
