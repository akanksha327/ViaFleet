const crypto = require("crypto");
const captainModel = require("../models/captain.model");
const promoCodeModel = require("../models/promoCode.model");
const rideModel = require("../models/ride.model");
const mapService = require("./map.service");
const stripePaymentService = require("./stripe-payment.service");

const BASE_FARE = {
  auto: 30,
  car: 50,
  bike: 20,
};

const PER_KM_RATE = {
  auto: 10,
  car: 15,
  bike: 8,
};

const PER_MINUTE_RATE = {
  auto: 2,
  car: 3,
  bike: 1.5,
};

const DEFAULT_PROMO_CODES = [
  {
    code: "RIDEX50",
    description: "Flat Rs. 50 off",
    discountType: "flat",
    discountValue: 50,
    minFare: 200,
    isActive: true,
  },
  {
    code: "SAVE10",
    description: "10% off up to Rs. 120",
    discountType: "percent",
    discountValue: 10,
    maxDiscount: 120,
    minFare: 150,
    isActive: true,
  },
];

const DRIVER_SEARCH_TIMEOUT_MS = 5 * 60 * 1000;
const SEARCH_FAILURE_REASON = "no_driver_available";

let defaultPromosEnsured = false;

const formatDistanceText = (meters) => {
  if (!Number.isFinite(meters) || meters <= 0) return "--";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
};

const formatDurationText = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
};

const normalizeStops = (stops) => {
  if (!Array.isArray(stops)) {
    return [];
  }

  return stops
    .map((stop) => (typeof stop === "string" ? stop.trim() : ""))
    .filter((stop) => stop.length >= 3)
    .slice(0, 4);
};

const normalizeCoordinates = (coordinates) => {
  const latitude = Number(coordinates?.lat ?? coordinates?.ltd);
  const longitude = Number(coordinates?.lon ?? coordinates?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    lat: latitude,
    lon: longitude,
  };
};

const buildSearchFailureUpdate = () => ({
  status: "cancelled",
  cancellationReason: SEARCH_FAILURE_REASON,
  searchFailedAt: new Date(),
});

const isRideSearchExpired = (ride) => {
  if (!ride || ride.status !== "pending" || !ride.createdAt) {
    return false;
  }

  const createdAt = new Date(ride.createdAt).getTime();
  return Number.isFinite(createdAt) && Date.now() - createdAt >= DRIVER_SEARCH_TIMEOUT_MS;
};

const getFareByDistanceTime = (distanceTime) => {
  const distanceValue = Number(distanceTime?.distance?.value || 0);
  const durationValue = Number(distanceTime?.duration?.value || 0);

  return {
    auto: Math.round(
      BASE_FARE.auto +
        (distanceValue / 1000) * PER_KM_RATE.auto +
        (durationValue / 60) * PER_MINUTE_RATE.auto
    ),
    car: Math.round(
      BASE_FARE.car +
        (distanceValue / 1000) * PER_KM_RATE.car +
        (durationValue / 60) * PER_MINUTE_RATE.car
    ),
    bike: Math.round(
      BASE_FARE.bike +
        (distanceValue / 1000) * PER_KM_RATE.bike +
        (durationValue / 60) * PER_MINUTE_RATE.bike
    ),
  };
};

const getRouteDistanceTime = async (
  pickup,
  destination,
  stops = [],
  options = {}
) => {
  const cleanStops = normalizeStops(stops);
  const points = [pickup, ...cleanStops, destination];
  const pickupCoordinates = normalizeCoordinates(options.pickupCoordinates);
  const destinationCoordinates = normalizeCoordinates(options.destinationCoordinates);

  if (cleanStops.length === 0 && pickupCoordinates && destinationCoordinates) {
    return mapService.getDistanceTimeByCoordinates(
      { ltd: pickupCoordinates.lat, lng: pickupCoordinates.lon },
      { ltd: destinationCoordinates.lat, lng: destinationCoordinates.lon }
    );
  }

  if (points.length <= 2) {
    return mapService.getDistanceTime(pickup, destination);
  }

  let totalDistance = 0;
  let totalDuration = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const legDistanceTime = await mapService.getDistanceTime(points[index], points[index + 1]);
    totalDistance += Number(legDistanceTime?.distance?.value || 0);
    totalDuration += Number(legDistanceTime?.duration?.value || 0);
  }

  if (!Number.isFinite(totalDistance) || totalDistance <= 0) {
    return mapService.getDistanceTime(pickup, destination);
  }

  return {
    distance: {
      value: totalDistance,
      text: formatDistanceText(totalDistance),
    },
    duration: {
      value: totalDuration,
      text: formatDurationText(totalDuration),
    },
  };
};

const ensureDefaultPromoCodes = async () => {
  if (defaultPromosEnsured) return;

  try {
    await promoCodeModel.bulkWrite(
      DEFAULT_PROMO_CODES.map((promo) => ({
        updateOne: {
          filter: { code: promo.code },
          update: { $setOnInsert: promo },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
  }

  defaultPromosEnsured = true;
};

const evaluatePromoCode = async ({ promoCode, fareAmount }) => {
  if (!promoCode || typeof promoCode !== "string" || !promoCode.trim()) {
    return {
      promo: null,
      promoCode: null,
      discount: 0,
      finalFare: fareAmount,
    };
  }

  await ensureDefaultPromoCodes();

  const normalizedCode = promoCode.trim().toUpperCase();
  const promo = await promoCodeModel.findOne({ code: normalizedCode, isActive: true });

  if (!promo) {
    throw new Error("Invalid promo code");
  }

  if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) {
    throw new Error("Promo code has expired");
  }

  if (Number.isFinite(promo.usageLimit) && promo.usedCount >= promo.usageLimit) {
    throw new Error("Promo code usage limit reached");
  }

  if (fareAmount < Number(promo.minFare || 0)) {
    throw new Error(`Promo requires minimum fare of Rs. ${Number(promo.minFare || 0)}`);
  }

  let discountAmount =
    promo.discountType === "percent"
      ? (fareAmount * Number(promo.discountValue || 0)) / 100
      : Number(promo.discountValue || 0);

  if (Number.isFinite(promo.maxDiscount)) {
    discountAmount = Math.min(discountAmount, promo.maxDiscount);
  }

  const safeDiscount = Math.max(0, Math.min(Math.round(discountAmount), fareAmount));

  return {
    promo,
    promoCode: promo.code,
    discount: safeDiscount,
    finalFare: Math.max(0, fareAmount - safeDiscount),
  };
};

const getOtp = (num) =>
  crypto.randomInt(Math.pow(10, num - 1), Math.pow(10, num)).toString();

const buildReceiptNo = () =>
  `RX-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;

const getClientBaseUrl = () => {
  const configuredOrigins = String(
    process.env.CLIENT_URL || process.env.FRONTEND_ORIGIN || "http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const fallbackOrigin = configuredOrigins[0] || "http://localhost:5173";
  return fallbackOrigin.replace(/\/+$/, "");
};

const buildPaymentRedirectUrls = (rideId, rideStatus) => {
  const baseUrl = getClientBaseUrl();
  const encodedRideId = encodeURIComponent(String(rideId));
  const returnPath = rideStatus === "completed" ? "/rider/history" : "/rider/tracking";

  return {
    successUrl: `${baseUrl}${returnPath}?payment=success&rideId=${encodedRideId}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl}${returnPath}?payment=cancelled&rideId=${encodedRideId}`,
  };
};

module.exports.getFare = async (pickup, destination, stops = [], options = {}) => {
  if (!pickup || !destination) {
    throw new Error("Pickup and destination are required");
  }

  const distanceTime = await getRouteDistanceTime(pickup, destination, stops, options);
  const fare = getFareByDistanceTime(distanceTime);

  return { fare, distanceTime };
};

module.exports.previewFareWithPromo = async ({
  pickup,
  destination,
  vehicleType,
  stops = [],
  promoCode,
  pickupCoordinates,
  destinationCoordinates,
}) => {
  if (!pickup || !destination || !vehicleType) {
    throw new Error("Pickup, destination and vehicle type are required");
  }

  const cleanStops = normalizeStops(stops);
  const { fare, distanceTime } = await module.exports.getFare(pickup, destination, cleanStops, {
    pickupCoordinates,
    destinationCoordinates,
  });
  const fareBeforeDiscount = Number(fare[vehicleType] || 0);
  const promoResult = await evaluatePromoCode({
    promoCode,
    fareAmount: fareBeforeDiscount,
  });

  return {
    vehicleType,
    stops: cleanStops,
    distanceTime,
    fareBeforeDiscount,
    promoCode: promoResult.promoCode,
    promoDiscount: promoResult.discount,
    fare: promoResult.finalFare,
  };
};

module.exports.createRide = async ({
  user,
  pickup,
  destination,
  vehicleType,
  stops = [],
  promoCode,
  pickupCoordinates,
  destinationCoordinates,
}) => {
  if (!user || !pickup || !destination || !vehicleType) {
    throw new Error("All fields are required");
  }

  try {
    const cleanStops = normalizeStops(stops);
    const farePreview = await module.exports.previewFareWithPromo({
      pickup,
      destination,
      vehicleType,
      stops: cleanStops,
      promoCode,
      pickupCoordinates,
      destinationCoordinates,
    });

    const normalizedPickupCoordinates = normalizeCoordinates(pickupCoordinates);
    const pickupCoordinatesForRide =
      normalizedPickupCoordinates
        ? {
            lng: normalizedPickupCoordinates.lon,
            ltd: normalizedPickupCoordinates.lat,
          }
        : await mapService.getAddressCoordinate(pickup);

    const hasValidPickupCoordinates =
      Number.isFinite(pickupCoordinatesForRide?.lng) &&
      Number.isFinite(pickupCoordinatesForRide?.ltd);

    const ride = await rideModel.create({
      user,
      pickup,
      pickupLocation: hasValidPickupCoordinates
        ? {
            type: "Point",
            coordinates: [pickupCoordinatesForRide.lng, pickupCoordinatesForRide.ltd],
          }
        : undefined,
      destination,
      stops: cleanStops,
      otp: getOtp(6),
      fareBeforeDiscount: farePreview.fareBeforeDiscount,
      promoCode: farePreview.promoCode || undefined,
      promoDiscount: farePreview.promoDiscount,
      fare: farePreview.fare,
      vehicle: vehicleType,
      distance: Number(farePreview.distanceTime?.distance?.value || 0),
      duration: Number(farePreview.distanceTime?.duration?.value || 0),
      paymentMethod: "stripe_checkout",
      paymentStatus: "pending",
    });

    if (farePreview.promoCode) {
      await promoCodeModel.updateOne(
        { code: farePreview.promoCode },
        { $inc: { usedCount: 1 } }
      );
    }

    return ride;
  } catch (error) {
    throw new Error(error?.message || "Error occurred while creating ride.");
  }
};

module.exports.DRIVER_SEARCH_TIMEOUT_MS = DRIVER_SEARCH_TIMEOUT_MS;
module.exports.SEARCH_FAILURE_REASON = SEARCH_FAILURE_REASON;
module.exports.isRideSearchExpired = isRideSearchExpired;

module.exports.expireRideSearch = async (rideId) => {
  if (!rideId) {
    throw new Error("Ride id is required");
  }

  return rideModel.findOneAndUpdate(
    { _id: rideId, status: "pending" },
    buildSearchFailureUpdate(),
    { new: true }
  );
};

module.exports.expirePendingRideSearches = async (filter = {}) => {
  const result = await rideModel.updateMany(
    {
      status: "pending",
      createdAt: {
        $lte: new Date(Date.now() - DRIVER_SEARCH_TIMEOUT_MS),
      },
      ...filter,
    },
    buildSearchFailureUpdate()
  );

  return Number(result.modifiedCount || 0);
};

module.exports.declineRide = async ({ rideId, captainId }) => {
  if (!rideId) {
    throw new Error("Ride id is required");
  }

  if (!captainId) {
    throw new Error("Captain is required");
  }

  const ride = await rideModel.findOneAndUpdate(
    { _id: rideId, status: "pending" },
    {
      $addToSet: { declinedByCaptains: captainId },
    },
    { new: true }
  );

  if (!ride) {
    throw new Error("Ride not found or no longer available");
  }

  return ride;
};

module.exports.getRideAvailability = async ({ lat, lng, radiusKm = 4 }) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Valid latitude and longitude are required");
  }

  const byVehicle = await mapService.getCaptainAvailabilityInTheRadius(lat, lng, radiusKm);

  return {
    radiusKm,
    byVehicle,
    total: byVehicle.total,
    updatedAt: new Date().toISOString(),
  };
};

module.exports.confirmRide = async ({ rideId, captain }) => {
  if (!rideId) {
    throw new Error("Ride id is required");
  }

  try {
    await rideModel.findOneAndUpdate(
      { _id: rideId },
      { status: "accepted", captain: captain._id }
    );

    const captainData = await captainModel.findOne({ _id: captain._id });
    captainData.rides.push(rideId);
    await captainData.save();

    const ride = await rideModel
      .findOne({ _id: rideId })
      .populate("user")
      .populate("captain")
      .select("+otp");

    if (!ride) {
      throw new Error("Ride not found");
    }

    return ride;
  } catch (error) {
    throw new Error(error?.message || "Error occurred while confirming ride.");
  }
};

module.exports.startRide = async ({ rideId, otp, captain }) => {
  if (!rideId) {
    throw new Error("Ride id is required");
  }

  const safeOtp = String(otp || "").trim();
  if (!safeOtp) {
    throw new Error("OTP is required to start ride");
  }

  const ride = await rideModel
    .findOne({ _id: rideId, captain: captain._id })
    .populate("user")
    .populate("captain")
    .select("+otp");

  if (!ride) {
    throw new Error("Ride not found");
  }

  if (ride.status !== "accepted") {
    throw new Error("Ride not accepted");
  }

  if (ride.otp !== safeOtp) {
    throw new Error("Invalid OTP");
  }

  const updatedRide = await rideModel
    .findOneAndUpdate({ _id: rideId }, { status: "ongoing" }, { new: true })
    .populate("user")
    .populate("captain")
    .select("+otp");

  return updatedRide;
};

module.exports.getRideOtpForUser = async ({ rideId, userId }) => {
  if (!rideId) {
    throw new Error("Ride id is required");
  }

  if (!userId) {
    throw new Error("User is required");
  }

  const ride = await rideModel
    .findOne({
      _id: rideId,
      user: userId,
      status: "accepted",
    })
    .select("+otp");

  if (!ride) {
    throw new Error("Accepted ride not found");
  }

  return {
    rideId: String(ride._id),
    otp: String(ride.otp || ""),
  };
};

module.exports.endRide = async ({ rideId, captain }) => {
  if (!rideId) {
    throw new Error("Ride id is required");
  }

  const ride = await rideModel
    .findOne({ _id: rideId, captain: captain._id })
    .populate("user")
    .populate("captain")
    .select("+otp");

  if (!ride) {
    throw new Error("Ride not found");
  }

  if (ride.status !== "ongoing") {
    throw new Error("Ride not ongoing");
  }

  const updatedRide = await rideModel
    .findOneAndUpdate(
      { _id: rideId },
      {
        status: "completed",
        paymentStatus:
          ride.paymentStatus === "paid"
            ? "paid"
            : Number(ride.fare || 0) > 0
              ? "pending"
              : "paid",
        paymentMethod: ride.paymentMethod || "stripe_checkout",
        receiptNo: ride.receiptNo || buildReceiptNo(),
        receiptIssuedAt: ride.receiptIssuedAt || new Date(),
      },
      { new: true }
    )
    .populate("user")
    .populate("captain")
    .select("+otp");

  return updatedRide;
};

module.exports.createRidePaymentSession = async ({ rideId, user }) => {
  if (!rideId) {
    throw new Error("Ride id is required");
  }

  if (!user?._id) {
    throw new Error("User is required");
  }

  const ride = await rideModel
    .findOne({ _id: rideId, user: user._id })
    .populate("user", "email");

  if (!ride) {
    throw new Error("Ride not found");
  }

  if (!["ongoing", "completed"].includes(ride.status)) {
    throw new Error("Payment is available once the ride has started");
  }

  const fareAmount = Number(ride.fare || 0);
  if (fareAmount <= 0) {
    if (ride.paymentStatus !== "paid") {
      ride.paymentStatus = "paid";
      ride.paymentMethod = "stripe_checkout";
      ride.receiptNo = ride.receiptNo || buildReceiptNo();
      ride.receiptIssuedAt = ride.receiptIssuedAt || new Date();
      await ride.save();
    }

    return {
      rideId: String(ride._id),
      sessionId: null,
      checkoutUrl: null,
      paymentStatus: "paid",
      alreadyPaid: true,
    };
  }

  if (ride.paymentStatus === "paid") {
    return {
      rideId: String(ride._id),
      sessionId: ride.orderId || null,
      checkoutUrl: null,
      paymentStatus: "paid",
      alreadyPaid: true,
    };
  }

  const { successUrl, cancelUrl } = buildPaymentRedirectUrls(ride._id, ride.status);
  const session = await stripePaymentService.createRideCheckoutSession({
    rideId: ride._id,
    userId: user._id,
    userEmail: ride.user?.email || user.email,
    amountInInr: fareAmount,
    successUrl,
    cancelUrl,
  });

  if (!session?.id || !session?.url) {
    throw new Error("Unable to create Stripe checkout session");
  }

  ride.paymentMethod = "stripe_checkout";
  ride.paymentStatus = "pending";
  ride.orderId = session.id;
  await ride.save();

  return {
    rideId: String(ride._id),
    sessionId: session.id,
    checkoutUrl: session.url,
    paymentStatus: "pending",
    alreadyPaid: false,
  };
};

module.exports.confirmRidePayment = async ({ rideId, sessionId, user }) => {
  if (!rideId) {
    throw new Error("Ride id is required");
  }

  if (!user?._id) {
    throw new Error("User is required");
  }

  const ride = await rideModel
    .findOne({ _id: rideId, user: user._id })
    .populate("user")
    .populate("captain")
    .select("+otp");

  if (!ride) {
    throw new Error("Ride not found");
  }

  if (!["ongoing", "completed"].includes(ride.status)) {
    throw new Error("Payment can be confirmed only after the ride has started");
  }

  if (ride.paymentStatus === "paid") {
    return ride;
  }

  const fareAmount = Number(ride.fare || 0);
  if (fareAmount <= 0) {
    ride.paymentStatus = "paid";
    ride.paymentMethod = "stripe_checkout";
    ride.receiptNo = ride.receiptNo || buildReceiptNo();
    ride.receiptIssuedAt = ride.receiptIssuedAt || new Date();
    await ride.save();
    return ride;
  }

  const safeSessionId = String(sessionId || "").trim();
  if (!safeSessionId) {
    throw new Error("Stripe session id is required");
  }

  const session = await stripePaymentService.getCheckoutSession(safeSessionId);

  if (!session?.id) {
    throw new Error("Invalid Stripe checkout session");
  }

  if (ride.orderId && ride.orderId !== session.id) {
    throw new Error("Invalid checkout session for this ride");
  }

  if (String(session?.metadata?.rideId || "") !== String(ride._id)) {
    throw new Error("Checkout session does not belong to this ride");
  }

  if (String(session?.metadata?.userId || "") !== String(user._id)) {
    throw new Error("Checkout session does not belong to this user");
  }

  if (session.payment_status !== "paid") {
    if (session.status === "expired") {
      ride.paymentStatus = "failed";
      ride.orderId = session.id;
      await ride.save();
    }
    return ride;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  ride.paymentStatus = "paid";
  ride.paymentMethod = "stripe_checkout";
  ride.paymentID = paymentIntentId;
  ride.orderId = session.id;
  ride.receiptNo = ride.receiptNo || buildReceiptNo();
  ride.receiptIssuedAt = ride.receiptIssuedAt || new Date();
  await ride.save();

  return ride;
};

module.exports.getRidePaymentStatus = async ({ rideId, userId }) => {
  if (!rideId) {
    throw new Error("Ride id is required");
  }

  if (!userId) {
    throw new Error("User is required");
  }

  const ride = await rideModel.findOne({ _id: rideId, user: userId }).select(
    "_id fare status paymentMethod paymentStatus paymentID orderId receiptNo receiptIssuedAt updatedAt createdAt"
  );

  if (!ride) {
    throw new Error("Ride not found");
  }

  return {
    rideId: String(ride._id),
    status: ride.status,
    fare: Number(ride.fare || 0),
    paymentMethod: ride.paymentMethod || "stripe_checkout",
    paymentStatus: ride.paymentStatus || "pending",
    paymentID: ride.paymentID || null,
    orderId: ride.orderId || null,
    receiptNo: ride.receiptNo || null,
    receiptIssuedAt: ride.receiptIssuedAt || null,
    updatedAt: ride.updatedAt || ride.createdAt,
  };
};

module.exports.submitRatingByUser = async ({ userId, rideId, rating, feedback }) => {
  if (!userId) {
    throw new Error("User is required");
  }

  const safeRating = Number(rating);
  if (!Number.isFinite(safeRating) || safeRating < 1 || safeRating > 5) {
    throw new Error("Rating should be between 1 and 5");
  }

  const query = {
    user: userId,
    status: "completed",
  };

  if (rideId) {
    query._id = rideId;
  } else {
    query["rating.score"] = { $exists: false };
  }

  const ride = await rideModel
    .find(query)
    .sort({ updatedAt: -1 })
    .limit(1)
    .then((items) => items[0]);

  if (!ride) {
    throw new Error("No completed ride found to review");
  }

  if (ride.rating?.score) {
    throw new Error("Rating already submitted for this ride");
  }

  ride.rating = {
    score: safeRating,
    feedback: typeof feedback === "string" ? feedback.trim().slice(0, 500) : "",
    byUser: userId,
    submittedAt: new Date(),
  };

  await ride.save();

  return ride;
};

module.exports.getRideReceipt = async ({ rideId, requesterType, requesterId }) => {
  if (!rideId) {
    throw new Error("Ride id is required");
  }

  const ride = await rideModel
    .findOne({ _id: rideId })
    .populate("user", "fullname phone")
    .populate("captain", "fullname phone vehicle");

  if (!ride) {
    throw new Error("Ride not found");
  }

  if (requesterType === "user" && String(ride.user?._id) !== String(requesterId)) {
    throw new Error("You are not allowed to access this receipt");
  }

  if (requesterType === "captain" && String(ride.captain?._id) !== String(requesterId)) {
    throw new Error("You are not allowed to access this receipt");
  }

  if (ride.status !== "completed") {
    throw new Error("Receipt is available only for completed rides");
  }

  if (!ride.receiptNo || !ride.receiptIssuedAt) {
    ride.receiptNo = ride.receiptNo || buildReceiptNo();
    ride.receiptIssuedAt = ride.receiptIssuedAt || new Date();
    await ride.save();
  }

  return {
    rideId: ride._id,
    receiptNo: ride.receiptNo,
    issuedAt: ride.receiptIssuedAt,
    rideDate: ride.updatedAt || ride.createdAt,
    pickup: ride.pickup,
    stops: ride.stops || [],
    destination: ride.destination,
    vehicle: ride.vehicle,
    fareBeforeDiscount: Number(
      Number.isFinite(ride.fareBeforeDiscount) ? ride.fareBeforeDiscount : ride.fare || 0
    ),
    promoCode: ride.promoCode || null,
    promoDiscount: Number(ride.promoDiscount || 0),
    totalFare: Number(ride.fare || 0),
    paymentMethod: ride.paymentMethod || "stripe_checkout",
    paymentStatus: ride.paymentStatus || "pending",
    rider: {
      name: `${ride.user?.fullname?.firstname || ""} ${ride.user?.fullname?.lastname || ""}`.trim(),
      phone: ride.user?.phone || "",
    },
    captain: {
      name: `${ride.captain?.fullname?.firstname || ""} ${
        ride.captain?.fullname?.lastname || ""
      }`.trim(),
      phone: ride.captain?.phone || "",
      vehicleNo: ride.captain?.vehicle?.number || "",
    },
  };
};
