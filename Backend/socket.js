const moment = require("moment-timezone");
const { Server } = require("socket.io");
const db = require("./config/db");
const userModel = require("./models/user.model");
const rideModel = require("./models/ride.model");
const captainModel = require("./models/captain.model");
const frontendLogModel = require("./models/frontend-log.model");
const { buildAllowedOrigins, isOriginAllowed, isProduction } = require("./config/origins");

let io;

function initializeSocket(server) {
  const allowedOrigins = buildAllowedOrigins();

  io = new Server(server, {
    cors: {
      origin(origin, callback) {
        if (isOriginAllowed(origin, allowedOrigins)) {
          return callback(null, true);
        }

        return callback(new Error("Origin not allowed"), false);
      },
      methods: ["GET", "POST"],
    },
  });

  const debugLog = (...values) => {
    if (!isProduction()) {
      console.log(...values);
    }
  };

  const debugError = (...values) => {
    if (!isProduction()) {
      console.error(...values);
    }
  };

  io.on("connection", (socket) => {
    debugLog(`Client connected: ${socket.id}`);

    if (isProduction()) {
      socket.on("log", async (log) => {
        log.formattedTimestamp = moment().tz("Asia/Kolkata").format("MMM DD hh:mm:ss A");
        try {
          await frontendLogModel.create(log);
        } catch (error) {
          debugError("Error sending logs...");
        }
      });
    }

    socket.on("join", async (data) => {
      try {
        const { userId, userType } = data || {};
        if (!userId || !userType) {
          return;
        }

        debugLog(`${userType} connected: ${userId}`);
        if (db.readyState !== 1) {
          return;
        }

        if (userType === "user") {
          await userModel.findByIdAndUpdate(userId, { socketId: socket.id });
        } else if (userType === "captain") {
          await captainModel.findByIdAndUpdate(userId, {
            socketId: socket.id,
            status: "active",
          });
        }
      } catch (error) {
        debugError("join handler error:", error.message);
      }
    });

    socket.on("update-location-captain", async (data) => {
      try {
        const { userId, location } = data || {};
        const latitude = Number(location?.ltd ?? location?.lat);
        const longitude = Number(location?.lng ?? location?.lon);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return socket.emit("error", { message: "Invalid location data" });
        }

        if (db.readyState !== 1) {
          return;
        }

        await captainModel.findByIdAndUpdate(userId, {
          location: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
        });
      } catch (error) {
        debugError("update-location-captain handler error:", error.message);
      }
    });

    socket.on("join-room", (roomId) => {
      socket.join(roomId);
      debugLog(`${socket.id} joined room: ${roomId}`);
    });

    socket.on("message", async ({ rideId, msg, userType, time }) => {
      try {
        const date = moment().tz("Asia/Kolkata").format("MMM DD");
        socket.to(rideId).emit("receiveMessage", { msg, by: userType, time });

        if (db.readyState !== 1) {
          return;
        }

        const ride = await rideModel.findOne({ _id: rideId });
        if (!ride) {
          return;
        }
        ride.messages.push({
          msg: msg,
          by: userType,
          time: time,
          date: date,
          timestamp: new Date(),
        });
        await ride.save();
      } catch (error) {
        debugError("Error saving message: ", error);
      }
    });

    socket.on("disconnect", async () => {
      try {
        if (db.readyState !== 1) {
          return;
        }

        await Promise.all([
          userModel.updateOne({ socketId: socket.id }, { $unset: { socketId: "" } }),
          captainModel.updateOne(
            { socketId: socket.id },
            {
              $unset: { socketId: "" },
              $set: { status: "inactive" },
            }
          ),
        ]);
      } catch (error) {
        debugError("disconnect handler error:", error.message);
      }

      debugLog(`Client disconnected: ${socket.id}`);
    });
  });
}

const sendMessageToSocketId = (socketId, messageObject) => {
  if (io) {
    io.to(socketId).emit(messageObject.event, messageObject.data);
  }
};

module.exports = { initializeSocket, sendMessageToSocketId };
