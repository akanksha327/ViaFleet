const moment = require("moment-timezone");
const mongoose = require("mongoose");
const BackendLog = require("../models/backend-log.model");

const dbStream = {
  write: async (message) => {
    if (message.startsWith("OPTIONS")) return; // remove preflight logs with OPTIONS method

    console.log(message.replace("\n", "")); // Server logs

    // Example: "GET /user/login 200 68.474 ms - 6351"
    const regex = /^(\w+)\s(.+?)\s(\d{3})\s([\d.]+)\sms\s-\s(.*)$/;
    const match = message.trim().match(regex);

    if (match) {
      const [, method, path, status, responseTime, contentLength] = match;
      const log = {
        method,
        url: message.replace("\n", ""),
        path,
        status: parseInt(status),
        responseTime: parseFloat(responseTime),
        contentLength,
        formattedTimestamp: moment().tz("Asia/Kolkata").format("MMM DD hh:mm:ss A"),
      };
      try {
        if (mongoose.connection.readyState !== 1) {
          return;
        }
        await BackendLog.create(log);
      } catch {
        // Avoid noisy log spam in production if the logging collection is unavailable.
      }
    }
  },
};

module.exports = dbStream;
