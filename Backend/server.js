const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const socket = require("./socket");
const express = require("express");
const { createServer } = require("http");
const db = require("./config/db");
const { buildAllowedOrigins, isOriginAllowed, isProduction } = require("./config/origins");
const app = express();
const server = createServer(app);

socket.initializeSocket(server);

const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");

const userRoutes = require("./routes/user.routes");
const captainRoutes = require("./routes/captain.routes");
const mapsRoutes = require("./routes/maps.routes");
const rideRoutes = require("./routes/ride.routes");
const mailRoutes = require("./routes/mail.routes");
const supportRoutes = require("./routes/support.routes");
const keepServerRunning = require("./services/active.service");
const dbStream = require("./services/logging.service");
const PORT = process.env.PORT || 3000;
const allowedOrigins = buildAllowedOrigins();

if (isProduction()) {
  app.use(
    morgan(":method :url :status :response-time ms - :res[content-length]", {
      stream: dbStream,
    })
  );
} else {
  app.use(morgan("dev"));
}
app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin, allowedOrigins)) {
        return callback(null, true);
      }
      const error = new Error("Origin not allowed by CORS");
      error.status = 403;
      error.code = "CORS_ORIGIN_DENIED";
      return callback(error);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "token", "authorization"],
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (isProduction()) {
  keepServerRunning();
}

app.get("/", (req, res) => {
  res.json("Hello, World!");
});

app.get("/healthz", (req, res) => {
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/ping", (req, res) => {
  return res.status(200).send("Server is alive");
});

app.get("/cron/ping", (req, res) => {
  return res.status(200).json({
    status: "ok",
    message: "Cron ping received",
    timestamp: new Date().toISOString(),
  });
});

app.get("/readyz", (req, res) => {
  if (db.readyState === 1) {
    return res.status(200).json({ status: "ready" });
  }

  return res.status(503).json({
    status: "not_ready",
    code: "DB_NOT_READY",
  });
});

app.get("/reload", (req, res) => {
  res.json("Server Reloaded");
});

app.use("/user", userRoutes);
app.use("/captain", captainRoutes);
app.use("/map", mapsRoutes);
app.use("/ride", rideRoutes);
app.use("/mail", mailRoutes);
app.use("/support", supportRoutes);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
    code: "ROUTE_NOT_FOUND",
  });
});

app.use((error, req, res, next) => {
  const status = Number(error?.status || error?.statusCode || 500);
  const code = error?.code || (status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED");
  const message =
    status >= 500 ? "Internal server error" : error?.message || "Request failed";

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({ message, code });
});

server.listen(PORT, () => {
  if (!isProduction()) {
    console.log("Server is listening on port", PORT);
  }
});
