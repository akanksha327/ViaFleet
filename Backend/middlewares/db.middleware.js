const db = require("../config/db");

const requireDbReady = (req, res, next) => {
  if (db.readyState === 1) {
    return next();
  }

  return res.status(503).json({
    message: "Database is not connected yet. Please try again shortly.",
    code: "DB_NOT_READY",
  });
};

module.exports = {
  requireDbReady,
};
