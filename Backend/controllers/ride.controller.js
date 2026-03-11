const { validationResult } = require("express-validator");
const rideModel = require("../models/ride.model");
const sosAlertModel = require("../models/sosAlert.model");
const userModel = require("../models/user.model");
const captainModel = require("../models/captain.model");
const rideService = require("../services/ride.service");
const mapService = require("../services/map.service");
const { sendMessageToSocketId } = require("../socket");

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
};

const parseStops = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    // keep fallback parser
  }

  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
};

module.exports.chatDetails = async (req, res) => {
  const { id } = req.params;

  try {
    const ride = await rideModel
      .findOne({ _id: id })
      .populate("user", "socketId fullname phone")
      .populate("captain", "socketId fullname phone");

    if (!ride) {
      return res.status(400).json({ message: "Ride not found", code: "RIDE_NOT_FOUND" });
    }

    const response = {
      user: {
        socketId: ride.user?.socketId,
        fullname: ride.user?.fullname,
        phone: ride.user?.phone,
        _id: ride.user?._id,
      },
      captain: {
        socketId: ride.captain?.socketId,
        fullname: ride.captain?.fullname,
        phone: ride.captain?.phone,
        _id: ride.captain?._id,
      },
      messages: ride.messages,
    };

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({ message: "Server error", code: "SERVER_ERROR" });
  }
};

module.exports.createRide = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { pickup, destination, vehicleType, promoCode } = req.body;
  const stops = parseStops(req.body.stops);
  const pickupCoordinates = req.body.pickupCoordinates;
  const destinationCoordinates = req.body.destinationCoordinates;

  try {
    const ride = await rideService.createRide({
      user: req.user._id,
      pickup,
      destination,
      vehicleType,
      stops,
      promoCode,
      pickupCoordinates,
      destinationCoordinates,
    });

    const user = await userModel.findOne({ _id: req.user._id });
    if (user) {
      user.rides.push(ride._id);
      await user.save();
    }

    res.status(201).json(ride);

    Promise.resolve().then(async () => {
      try {
        const pickupCoordinatesFromRide = ride?.pickupLocation?.coordinates || [];
        const pickupCoordinates =
          pickupCoordinatesFromRide.length === 2
            ? { lng: pickupCoordinatesFromRide[0], ltd: pickupCoordinatesFromRide[1] }
            : await mapService.getAddressCoordinate(pickup);

        const captainsInRadius = await mapService.getCaptainsInTheRadius(
          pickupCoordinates.ltd,
          pickupCoordinates.lng,
          4,
          vehicleType
        );

        ride.otp = "";

        const rideWithUser = await rideModel.findOne({ _id: ride._id }).populate("user");

        captainsInRadius.forEach((captain) => {
          if (!captain?.socketId) {
            return;
          }
          sendMessageToSocketId(captain.socketId, {
            event: "new-ride",
            data: rideWithUser,
          });
        });
      } catch (error) {
        if (process.env.ENVIRONMENT !== "production") {
          console.error("Background task failed:", error.message);
        }
      }
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Unable to create ride",
      code: "RIDE_CREATE_FAILED",
    });
  }
};

module.exports.getFare = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { pickup, destination } = req.query;
  const stops = parseStops(req.query.stops);

  try {
    const { fare, distanceTime } = await rideService.getFare(pickup, destination, stops);
    return res.status(200).json({ fare, distanceTime, stops });
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Unable to estimate fare",
      code: "FARE_ESTIMATE_FAILED",
    });
  }
};

module.exports.applyPromo = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { pickup, destination, vehicleType, promoCode } = req.body;
  const stops = parseStops(req.body.stops);

  try {
    const quote = await rideService.previewFareWithPromo({
      pickup,
      destination,
      vehicleType,
      promoCode,
      stops,
    });

    return res.status(200).json(quote);
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Unable to apply promo code",
      code: "PROMO_APPLY_FAILED",
    });
  }
};

module.exports.confirmRide = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId } = req.body;

  try {
    const rideDetails = await rideModel.findOne({ _id: rideId });

    if (!rideDetails) {
      return res.status(404).json({ message: "Ride not found.", code: "RIDE_NOT_FOUND" });
    }

    if (rideService.isRideSearchExpired(rideDetails)) {
      await rideService.expireRideSearch(rideId);
      return res.status(410).json({
        message: "No driver available nearby. This request expired after 5 minutes.",
        code: "RIDE_SEARCH_EXPIRED",
      });
    }

    if (
      Array.isArray(rideDetails.declinedByCaptains) &&
      rideDetails.declinedByCaptains.some(
        (captainId) => String(captainId) === String(req.captain._id)
      )
    ) {
      return res.status(400).json({
        message: "You already declined this ride request.",
        code: "RIDE_ALREADY_DECLINED",
      });
    }

    switch (rideDetails.status) {
      case "accepted":
        return res.status(400).json({
          message:
            "The ride is accepted by another captain before you. Better luck next time.",
          code: "RIDE_ALREADY_ACCEPTED",
        });
      case "ongoing":
        return res.status(400).json({
          message: "The ride is currently ongoing with another captain.",
          code: "RIDE_ALREADY_ONGOING",
        });
      case "completed":
        return res.status(400).json({
          message: "The ride has already been completed.",
          code: "RIDE_ALREADY_COMPLETED",
        });
      case "cancelled":
        return res.status(400).json({
          message: "The ride has been cancelled.",
          code: "RIDE_CANCELLED",
        });
      default:
        break;
    }

    const ride = await rideService.confirmRide({
      rideId,
      captain: req.captain,
    });

    sendMessageToSocketId(ride.user.socketId, {
      event: "ride-confirmed",
      data: ride,
    });

    return res.status(200).json(ride);
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Unable to confirm ride",
      code: "RIDE_CONFIRM_FAILED",
    });
  }
};

module.exports.declineRide = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId } = req.body;

  try {
    const rideDetails = await rideModel.findOne({ _id: rideId });

    if (!rideDetails) {
      return res.status(404).json({ message: "Ride not found.", code: "RIDE_NOT_FOUND" });
    }

    if (rideService.isRideSearchExpired(rideDetails)) {
      await rideService.expireRideSearch(rideId);
      return res.status(410).json({
        message: "No driver available nearby. This request expired after 5 minutes.",
        code: "RIDE_SEARCH_EXPIRED",
      });
    }

    if (rideDetails.status !== "pending") {
      return res.status(400).json({
        message: "Only pending rides can be declined.",
        code: "RIDE_CANNOT_BE_DECLINED",
      });
    }

    const ride = await rideService.declineRide({
      rideId,
      captainId: req.captain._id,
    });

    return res.status(200).json({
      _id: ride._id,
      status: ride.status,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Unable to decline ride",
      code: "RIDE_DECLINE_FAILED",
    });
  }
};

module.exports.startRide = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId, otp } = req.query;

  try {
    const ride = await rideService.startRide({
      rideId,
      otp,
      captain: req.captain,
    });

    sendMessageToSocketId(ride.user.socketId, {
      event: "ride-started",
      data: ride,
    });

    return res.status(200).json(ride);
  } catch (err) {
    const statusCode = ["OTP is required to start ride", "Invalid OTP", "Ride not found", "Ride not accepted"].includes(
      err.message
    )
      ? 400
      : 500;

    return res.status(statusCode).json({
      message: err.message || "Unable to start ride",
      code: "RIDE_START_FAILED",
    });
  }
};

module.exports.getRideOtp = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId } = req.params;

  try {
    const otpDetails = await rideService.getRideOtpForUser({
      rideId,
      userId: req.user._id,
    });

    return res.status(200).json(otpDetails);
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Unable to fetch ride OTP",
      code: "RIDE_OTP_FETCH_FAILED",
    });
  }
};

module.exports.endRide = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId } = req.body;

  try {
    const ride = await rideService.endRide({ rideId, captain: req.captain });

    sendMessageToSocketId(ride.user.socketId, {
      event: "ride-ended",
      data: ride,
    });

    return res.status(200).json(ride);
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Unable to end ride",
      code: "RIDE_END_FAILED",
    });
  }
};

module.exports.cancelRide = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId } = req.query;

  try {
    const ride = await rideModel
      .findOne({ _id: rideId })
      .populate("user", "socketId")
      .populate("captain", "socketId");

    if (!ride) {
      return res.status(404).json({ message: "Ride not found", code: "RIDE_NOT_FOUND" });
    }

    if (ride.status === "ongoing" || ride.status === "completed") {
      return res.status(400).json({
        message: "Only pending or accepted rides can be cancelled",
        code: "RIDE_CANNOT_BE_CANCELLED",
      });
    }

    if (ride.status === "cancelled") {
      return res.status(200).json(ride);
    }

    ride.status = "cancelled";
    await ride.save();

    const pickupCoordinates = Array.isArray(ride.pickupLocation?.coordinates) &&
      ride.pickupLocation.coordinates.length === 2
      ? {
          lng: Number(ride.pickupLocation.coordinates[0]),
          ltd: Number(ride.pickupLocation.coordinates[1]),
        }
      : null;

    const captainsInRadius =
      pickupCoordinates &&
      Number.isFinite(pickupCoordinates.ltd) &&
      Number.isFinite(pickupCoordinates.lng)
        ? await mapService.getCaptainsInTheRadius(
            pickupCoordinates.ltd,
            pickupCoordinates.lng,
            4,
            ride.vehicle
          )
        : [];

    if (ride.user?.socketId) {
      sendMessageToSocketId(ride.user.socketId, {
        event: "ride-cancelled",
        data: ride,
      });
    }

    if (ride.captain?.socketId) {
      sendMessageToSocketId(ride.captain.socketId, {
        event: "ride-cancelled",
        data: ride,
      });
    }

    captainsInRadius.forEach((captain) => {
      if (!captain?.socketId) return;
      sendMessageToSocketId(captain.socketId, {
        event: "ride-cancelled",
        data: ride,
      });
    });

    return res.status(200).json(ride);
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Unable to cancel ride",
      code: "RIDE_CANCEL_FAILED",
    });
  }
};

module.exports.getPendingRidesForCaptain = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const queryRadius = Number(req.query.radius || 4);
  const radiusKm = Number.isFinite(queryRadius) && queryRadius > 0 ? queryRadius : 4;
  const ignoreLocation = String(req.query.ignoreLocation || "").trim() === "1";

  try {
    await rideService.expirePendingRideSearches();

    const captain = await captainModel
      .findOne({ _id: req.captain._id })
      .select("location vehicle.type");

    if (!captain) {
      return res.status(404).json({
        message: "Captain not found",
        code: "CAPTAIN_NOT_FOUND",
      });
    }

    const [lng, ltd] = captain.location?.coordinates || [];
    const hasUsableCaptainLocation =
      Number.isFinite(lng) &&
      Number.isFinite(ltd) &&
      (Math.abs(Number(lng)) > 0.0001 || Math.abs(Number(ltd)) > 0.0001);

    const baseRideQuery = {
      status: "pending",
      vehicle: captain.vehicle?.type,
      declinedByCaptains: { $nin: [req.captain._id] },
    };

    const ridesQuery = hasUsableCaptainLocation && !ignoreLocation
      ? {
          ...baseRideQuery,
          $or: [
            {
              pickupLocation: {
                $geoWithin: {
                  $centerSphere: [[lng, ltd], radiusKm / 6371],
                },
              },
            },
            {
              pickupLocation: { $exists: false },
            },
          ],
        }
      : baseRideQuery;

    const rides = await rideModel
      .find(ridesQuery)
      .sort({ createdAt: -1 })
      .limit(30)
      .populate("user", "fullname phone");

    const rideSummaries = rides.map((ride) => ({
      _id: ride._id,
      pickup: ride.pickup,
      stops: ride.stops || [],
      destination: ride.destination,
      fare: ride.fare,
      vehicle: ride.vehicle,
      status: ride.status,
      distance: ride.distance,
      duration: ride.duration,
      createdAt: ride.createdAt,
      user: ride.user
        ? {
            _id: ride.user._id,
            fullname: ride.user.fullname,
            phone: ride.user.phone,
          }
        : null,
    }));

    return res.status(200).json({ rides: rideSummaries });
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Unable to fetch pending rides",
      code: "PENDING_RIDES_FETCH_FAILED",
    });
  }
};

module.exports.getRideAvailability = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const queryRadius = Number(req.query.radius || 4);
  const radiusKm = Number.isFinite(queryRadius) && queryRadius > 0 ? queryRadius : 4;
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  try {
    const availability = await rideService.getRideAvailability({
      lat,
      lng,
      radiusKm,
    });

    return res.status(200).json(availability);
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Unable to fetch nearby vehicle availability",
      code: "RIDE_AVAILABILITY_FETCH_FAILED",
    });
  }
};

module.exports.rateRide = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId, rating, feedback } = req.body;

  try {
    const ride = await rideService.submitRatingByUser({
      userId: req.user._id,
      rideId,
      rating,
      feedback,
    });

    return res.status(200).json({
      rideId: ride._id,
      rating: ride.rating,
      message: "Rating submitted successfully",
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Unable to submit rating",
      code: "RIDE_RATING_FAILED",
    });
  }
};

module.exports.getRideReceipt = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId } = req.params;

  try {
    const receipt = await rideService.getRideReceipt({
      rideId,
      requesterType: "user",
      requesterId: req.user._id,
    });

    return res.status(200).json(receipt);
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Unable to fetch receipt",
      code: "RECEIPT_FETCH_FAILED",
    });
  }
};

module.exports.createPaymentSession = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId } = req.body;

  try {
    const paymentSession = await rideService.createRidePaymentSession({
      rideId,
      user: req.user,
    });

    return res.status(200).json(paymentSession);
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Unable to start payment",
      code: "PAYMENT_SESSION_CREATE_FAILED",
    });
  }
};

module.exports.confirmPayment = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId, sessionId } = req.body;

  try {
    const ride = await rideService.confirmRidePayment({
      rideId,
      sessionId,
      user: req.user,
    });

    return res.status(200).json({
      rideId: String(ride._id),
      paymentMethod: ride.paymentMethod || "stripe_checkout",
      paymentStatus: ride.paymentStatus || "pending",
      receiptNo: ride.receiptNo || null,
      receiptIssuedAt: ride.receiptIssuedAt || null,
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Unable to confirm payment",
      code: "PAYMENT_CONFIRM_FAILED",
    });
  }
};

module.exports.getPaymentStatus = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId } = req.params;

  try {
    const payment = await rideService.getRidePaymentStatus({
      rideId,
      userId: req.user._id,
    });

    return res.status(200).json(payment);
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Unable to fetch payment status",
      code: "PAYMENT_STATUS_FETCH_FAILED",
    });
  }
};

module.exports.triggerSos = async (req, res) => {
  if (!handleValidation(req, res)) {
    return;
  }

  const { rideId, message, location } = req.body;

  try {
    const ride = await rideModel
      .findOne({
        _id: rideId,
        user: req.user._id,
        status: { $in: ["pending", "accepted", "ongoing"] },
      })
      .populate("captain", "socketId fullname phone")
      .populate("user", "socketId fullname phone");

    if (!ride) {
      return res.status(404).json({
        message: "Active ride not found",
        code: "ACTIVE_RIDE_NOT_FOUND",
      });
    }

    const alert = await sosAlertModel.create({
      ride: ride._id,
      user: req.user._id,
      captain: ride.captain?._id,
      triggeredBy: "user",
      message:
        typeof message === "string" && message.trim()
          ? message.trim().slice(0, 400)
          : "Emergency assistance requested by rider",
      location:
        location &&
        Number.isFinite(location?.ltd) &&
        Number.isFinite(location?.lng)
          ? { ltd: Number(location.ltd), lng: Number(location.lng) }
          : undefined,
    });

    ride.messages.push({
      msg: "SOS triggered by rider",
      by: "user",
      time: new Date().toLocaleTimeString(),
      date: new Date().toLocaleDateString(),
      timestamp: new Date(),
    });
    await ride.save();

    if (ride.captain?.socketId) {
      sendMessageToSocketId(ride.captain.socketId, {
        event: "sos-alert",
        data: {
          rideId: ride._id,
          alertId: alert._id,
          message: alert.message,
        },
      });
    }

    return res.status(201).json({
      message: "Emergency alert sent",
      alertId: alert._id,
      status: alert.status,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Unable to trigger emergency alert",
      code: "SOS_TRIGGER_FAILED",
    });
  }
};
