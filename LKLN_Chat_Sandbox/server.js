const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.static(path.join(__dirname, "public")));

const clients = new Map();

const airports = new Map();

function getAirportState(airport) {
  if (!airports.has(airport)) {
    airports.set(airport, {
      runwayStatus: "RWY OPEN",
      atis: "INFO ALFA · QNH 1015",
      requests: []
    });
  }
  return airports.get(airport);
}

io.on("connection", (socket) => {
  socket.on("join", ({ name, callsign, airport, role }) => {
    if (!airport) airport = "LKLN";

    clients.set(socket.id, {
      name,
      callsign,
      lat: null,
      lon: null,
      airport,
      role: role || "pilot"
    });

    socket.join(`airport:${airport}`);

    const others = [];
    for (const [id, info] of clients.entries()) {
      if (id !== socket.id && info.airport === airport) {
        others.push({
          id,
          name: info.name,
          callsign: info.callsign,
          lat: info.lat,
          lon: info.lon
        });
      }
    }

    socket.emit("airport:state", { airport, others });
    socket.to(`airport:${airport}`).emit("airport:user-joined", {
      id: socket.id,
      name,
      callsign
    });

    const airportState = getAirportState(airport);
    socket.emit("ops:state", airportState);
  });

  socket.on("position:update", ({ lat, lon }) => {
    const client = clients.get(socket.id);
    if (!client) return;

    client.lat = lat;
    client.lon = lon;

    io.to(`airport:${client.airport}`).emit("position:update", {
      id: socket.id,
      name: client.name,
      callsign: client.callsign,
      lat,
      lon
    });
  });

  socket.on("ops:update", ({ runwayStatus, atis }) => {
    const client = clients.get(socket.id);
    if (!client || client.role !== "ops") return;

    const airportState = getAirportState(client.airport);

    if (runwayStatus) {
      airportState.runwayStatus = runwayStatus;
    }
    if (atis) {
      airportState.atis = atis;
    }

    io.to(`airport:${client.airport}`).emit("ops:state", airportState);
  });

  socket.on("pilot:request", ({ text }) => {
    const client = clients.get(socket.id);
    if (!client || !text || !text.trim()) return;

    const airportState = getAirportState(client.airport);
    const request = {
      id: crypto.randomUUID(),
      callsign: client.callsign,
      name: client.name,
      text: text.trim(),
      status: "new",
      ts: Date.now()
    };

    airportState.requests.push(request);
    io.to(`airport:${client.airport}`).emit("pilot:request:created", request);
  });

  socket.on("pilot:request:update", ({ requestId, status }) => {
    const client = clients.get(socket.id);
    if (!client || client.role !== "ops") return;
    if (!["approved", "rejected"].includes(status)) return;

    const airportState = getAirportState(client.airport);
    const request = airportState.requests.find((item) => item.id === requestId);
    if (!request) return;

    request.status = status;
    io.to(`airport:${client.airport}`).emit("pilot:request:updated", {
      requestId,
      status
    });
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
      io.to(`airport:${client.airport}`).emit("airport:user-left", {
        id: socket.id,
        callsign: client.callsign
      });
      clients.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
