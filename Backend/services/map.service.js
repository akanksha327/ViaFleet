const axios = require("axios");
const captainModel = require("../models/captain.model");

const GEOCODE_CACHE_TTL_MS = 15 * 60 * 1000;
const GEOCODE_CACHE_MAX_ENTRIES = 200;
const geocodeCache = new Map();

const formatDistanceText = (meters) => {
  if (!Number.isFinite(meters) || meters <= 0) {
    return "0 m";
  }

  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
};

const formatDurationText = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0 min";
  }

  const roundedMinutes = Math.max(1, Math.round(seconds / 60));
  return `${roundedMinutes} min`;
};

const normalizeCoordinateInput = (coordinates) => {
  const latitude = Number(coordinates?.lat ?? coordinates?.ltd);
  const longitude = Number(coordinates?.lon ?? coordinates?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    ltd: latitude,
    lng: longitude,
  };
};

const normalizeAddressCacheKey = (address) =>
  String(address || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const getCachedCoordinates = (address) => {
  const key = normalizeAddressCacheKey(address);
  if (!key) {
    return null;
  }

  const cached = geocodeCache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAt > GEOCODE_CACHE_TTL_MS) {
    geocodeCache.delete(key);
    return null;
  }

  return cached.value;
};

const setCachedCoordinates = (address, coordinates) => {
  const key = normalizeAddressCacheKey(address);
  if (!key || !coordinates) {
    return;
  }

  geocodeCache.set(key, {
    value: coordinates,
    cachedAt: Date.now(),
  });

  if (geocodeCache.size <= GEOCODE_CACHE_MAX_ENTRIES) {
    return;
  }

  const oldestKey = geocodeCache.keys().next().value;
  if (oldestKey) {
    geocodeCache.delete(oldestKey);
  }
};

const buildLiveCaptainRadiusQuery = (ltd, lng, radius, vehicleType) => {
  const query = {
    location: {
      $geoWithin: {
        $centerSphere: [[lng, ltd], radius / 6371],
      },
    },
    status: "active",
    socketId: {
      $exists: true,
      $nin: [null, ""],
    },
  };

  if (vehicleType) {
    query["vehicle.type"] = vehicleType;
  }

  return query;
};

const getAddressCoordinateFromNominatim = async (address) => {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(
    address
  )}`;

  const response = await axios.get(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "QuickRide/1.0",
    },
    timeout: 10000,
  });

  const firstResult = response.data?.[0];
  if (!firstResult) {
    throw new Error("Unable to fetch coordinates using OpenStreetMap");
  }

  return {
    ltd: Number(firstResult.lat),
    lng: Number(firstResult.lon),
  };
};

module.exports.getAddressCoordinate = async (address) => {
  if (!address) {
    throw new Error("Address is required");
  }

  const cachedCoordinates = getCachedCoordinates(address);
  if (cachedCoordinates) {
    return cachedCoordinates;
  }

  const coordinates = await getAddressCoordinateFromNominatim(address);
  setCachedCoordinates(address, coordinates);
  return coordinates;
};

const getDistanceTimeFromOsrmCoordinates = async (originCoordinates, destinationCoordinates) => {
  const url = `https://router.project-osrm.org/route/v1/driving/${originCoordinates.lng},${originCoordinates.ltd};${destinationCoordinates.lng},${destinationCoordinates.ltd}?overview=false`;

  const response = await axios.get(url, {
    timeout: 10000,
  });

  const route = response.data?.routes?.[0];
  if (!route) {
    throw new Error("No routes found");
  }

  const distanceValue = Math.round(route.distance);
  const durationValue = Math.round(route.duration);

  return {
    distance: {
      text: formatDistanceText(distanceValue),
      value: distanceValue,
    },
    duration: {
      text: formatDurationText(durationValue),
      value: durationValue,
    },
    status: "OK",
  };
};

const getDistanceTimeFromOsrm = async (origin, destination) => {
  const originCoordinates = await module.exports.getAddressCoordinate(origin);
  const destinationCoordinates = await module.exports.getAddressCoordinate(destination);
  return getDistanceTimeFromOsrmCoordinates(originCoordinates, destinationCoordinates);
};

module.exports.getDistanceTime = async (origin, destination) => {
  if (!origin || !destination) {
    throw new Error("Origin and destination are required");
  }

  return await getDistanceTimeFromOsrm(origin, destination);
};

module.exports.getDistanceTimeByCoordinates = async (originCoordinates, destinationCoordinates) => {
  const normalizedOrigin = normalizeCoordinateInput(originCoordinates);
  const normalizedDestination = normalizeCoordinateInput(destinationCoordinates);

  if (!normalizedOrigin || !normalizedDestination) {
    throw new Error("Valid origin and destination coordinates are required");
  }

  return getDistanceTimeFromOsrmCoordinates(normalizedOrigin, normalizedDestination);
};

module.exports.getAutoCompleteSuggestions = async (input) => {
  if (!input) {
    throw new Error("query is required");
  }

  const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(
    input
  )}`;

  try {
    const response = await axios.get(fallbackUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "QuickRide/1.0",
      },
      timeout: 10000,
    });

    return (response.data || [])
      .map((item) => item.display_name)
      .filter((value) => value);
  } catch (error) {
    throw new Error("Unable to fetch suggestions");
  }
};

module.exports.getCaptainsInTheRadius = async (ltd, lng, radius, vehicleType) => {
  // radius in km
  
  try {
    const captains = await captainModel.find(
      buildLiveCaptainRadiusQuery(ltd, lng, radius, vehicleType)
    );
    return captains;
  } catch (error) {
    throw new Error("Error in getting captain in radius: " + error.message);
  }
};

module.exports.getCaptainAvailabilityInTheRadius = async (ltd, lng, radius) => {
  try {
    const groupedCounts = await captainModel.aggregate([
      {
        $match: buildLiveCaptainRadiusQuery(ltd, lng, radius),
      },
      {
        $group: {
          _id: "$vehicle.type",
          count: { $sum: 1 },
        },
      },
    ]);

    const availability = {
      auto: 0,
      car: 0,
      bike: 0,
      total: 0,
    };

    groupedCounts.forEach((entry) => {
      if (entry?._id === "auto" || entry?._id === "car" || entry?._id === "bike") {
        availability[entry._id] = Number(entry.count || 0);
        availability.total += Number(entry.count || 0);
      }
    });

    return availability;
  } catch (error) {
    throw new Error("Error in getting captain availability: " + error.message);
  }
};
