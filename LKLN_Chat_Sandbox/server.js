const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

// Statické soubory (frontend)
app.use(express.static(path.join(__dirname, "public")));

// In-memory registry připojených uživatelů
// key: socket.id, value: { name, callsign, lat, lon, airport }
const clients = new Map();

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Klient se identifikuje (jméno, callsign, letiště)
  socket.on("join", ({ name, callsign, airport }) => {
    if (!airport) airport = "LKLN";

    clients.set(socket.id, {
      name,
      callsign,
      lat: null,
      lon: null,
      airport
    });

    socket.join(`airport:${airport}`);

    console.log(`JOIN ${socket.id}: ${name} / ${callsign} @ ${airport}`);

    // pošleme mu aktuální seznam ostatních
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

    // ostatním oznámíme nového uživatele
    socket.to(`airport:${airport}`).emit("airport:user-joined", {
      id: socket.id,
      name,
      callsign
    });
  });

  // Aktualizace polohy
  socket.on("position:update", ({ lat, lon }) => {
    const client = clients.get(socket.id);
    if (!client) return;

    client.lat = lat;
    client.lon = lon;

    // broadcast ostatním v rámci stejného letiště
    io.to(`airport:${client.airport}`).emit("position:update", {
      id: socket.id,
      name: client.name,
      callsign: client.callsign,
      lat,
      lon
    });
  });

  // Zpráva do letištního chatu
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
      console.log("Client disconnected:", socket.id);
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