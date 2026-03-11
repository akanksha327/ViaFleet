import { io, type Socket } from "socket.io-client";
import { getSession, type AccountType, type SessionData, type SessionUser } from "@/lib/session";

const RAW_API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:3000";
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/+$/, "");
const STRIPE_PAYMENT_LINK = import.meta.env.VITE_STRIPE_PAYMENT_LINK?.trim() || "";
let ACTIVE_API_BASE_URL = API_BASE_URL;

const RIDER_PREFS_KEY = "ridex-rider-preferences";
const DRIVER_PREFS_KEY = "ridex-driver-preferences";
const FAILED_RIDE_IDS_KEY = "ridex-failed-ride-ids";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type BackendUserType = "user" | "captain";
type BackendVehicleType = "auto" | "car" | "bike";
type DriverLocationStatus = "unknown" | "enabled" | "denied" | "unsupported";
type GeoPoint = {
  type?: string;
  coordinates?: number[];
};

export type MapCoordinates = {
  lat: number;
  lon: number;
};

type BackendRide = {
  _id: string;
  user?: string | { _id?: string; fullname?: { firstname?: string; lastname?: string }; phone?: string };
  captain?: string | { fullname?: { firstname?: string; lastname?: string }; vehicle?: { number?: string } };
  pickup?: string;
  pickupLocation?: GeoPoint;
  stops?: string[];
  destination?: string;
  destinationLocation?: GeoPoint;
  fare?: number;
  fareBeforeDiscount?: number;
  promoCode?: string;
  promoDiscount?: number;
  vehicle?: BackendVehicleType;
  status?: "pending" | "accepted" | "ongoing" | "completed" | "cancelled";
  declinedByCaptains?: string[];
  cancellationReason?: "user_cancelled" | "driver_cancelled" | "no_driver_available";
  searchFailedAt?: string;
  duration?: number;
  distance?: number;
  paymentMethod?: string;
  paymentStatus?: "pending" | "paid" | "failed";
  receiptNo?: string;
  receiptIssuedAt?: string;
  rating?: {
    score?: number;
    feedback?: string;
    submittedAt?: string;
  };
  otp?: string;
  createdAt?: string;
  updatedAt?: string;
};

type RiderPrefs = { notifications: boolean; darkMode: boolean };
type DriverPrefs = { notifications: boolean; autoAccept: boolean; darkMode: boolean };

const DEFAULT_RIDER_PREFS: RiderPrefs = { notifications: true, darkMode: false };
const DEFAULT_DRIVER_PREFS: DriverPrefs = { notifications: true, autoAccept: false, darkMode: false };

const FRONTEND_RIDE_OPTIONS: RideOption[] = [
  { id: "moto", label: "Bike", eta: "4 min", fare: 90 },
  { id: "auto", label: "Auto", eta: "6 min", fare: 130 },
  { id: "sedan", label: "Car", eta: "8 min", fare: 180 },
];

let socketRef: Socket | null = null;
let socketKey = "";
let driverRequestStore: BackendRide[] = [];
let driverOnlineSince: number | null = null;
let driverLocationWatchId: number | null = null;
let driverLocationStatus: DriverLocationStatus = "unknown";
let driverBackfillInFlight: Promise<void> | null = null;
let driverBackfillFetchedAt = 0;

const isBrowser = () => typeof window !== "undefined";
const toBackendUserType = (type: AccountType): BackendUserType => (type === "driver" ? "captain" : "user");
const path = (p: string) => (p.startsWith("/") ? p : `/${p}`);

const getSocketBase = () => {
  try {
    return new URL(ACTIVE_API_BASE_URL).origin;
  } catch {
    return ACTIVE_API_BASE_URL;
  }
};

const getFallbackApiBases = (baseUrl: string) => {
  try {
    const parsed = new URL(baseUrl);
    const pathName = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    const build = (host: string, port = parsed.port) =>
      `${parsed.protocol}//${host}${port ? `:${port}` : ""}${pathName}`;

    const candidates: string[] = [];
    if (parsed.hostname === "localhost") {
      candidates.push(build("127.0.0.1"));
    } else if (parsed.hostname === "127.0.0.1") {
      candidates.push(build("localhost"));
    }

    if (isBrowser()) {
      const browserHost = window.location.hostname;
      if (browserHost && browserHost !== parsed.hostname) {
        candidates.push(build(browserHost));
      }

      const isBrowserLocalHost =
        browserHost === "localhost" || browserHost === "127.0.0.1";
      if (isBrowserLocalHost) {
        candidates.push(`http://localhost:3000${pathName}`);
        candidates.push(`http://127.0.0.1:3000${pathName}`);
        candidates.push(`http://localhost:4000${pathName}`);
        candidates.push(`http://127.0.0.1:4000${pathName}`);
      }
    }

    const isLocalHost =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (isLocalHost) {
      const localPorts = ["3000", "4000"];
      for (const localPort of localPorts) {
        if (localPort !== parsed.port) {
          candidates.push(build(parsed.hostname, localPort));
        }
      }
    }

    return [...new Set(candidates.map((item) => item.replace(/\/+$/, "")))];
  } catch {
    return [];
  }
};

const readJson = <T>(key: string, fallback: T): T => {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
};

const readStringArray = (key: string) => {
  if (!isBrowser()) return [] as string[];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [] as string[];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [] as string[];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [] as string[];
  }
};

const writeJson = <T>(key: string, value: T) => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore localStorage failures.
  }
};

const riderPrefs = () => readJson(RIDER_PREFS_KEY, DEFAULT_RIDER_PREFS);
const driverPrefs = () => readJson(DRIVER_PREFS_KEY, DEFAULT_DRIVER_PREFS);
const failedRideIds = () => new Set(readStringArray(FAILED_RIDE_IDS_KEY));

const persistFailedRideIds = (ids: Set<string>) => {
  writeJson(FAILED_RIDE_IDS_KEY, Array.from(ids));
};

const markRideFailed = (rideId: string) => {
  const ids = failedRideIds();
  ids.add(rideId);
  persistFailedRideIds(ids);
};

const clearRideFailedFlag = (rideId: string) => {
  const ids = failedRideIds();
  if (!ids.has(rideId)) return;
  ids.delete(rideId);
  persistFailedRideIds(ids);
};

const isRideFailed = (rideId: string) => failedRideIds().has(rideId);

const updateRiderPrefs = (patch: Partial<RiderPrefs>) => {
  const next = { ...riderPrefs(), ...patch };
  writeJson(RIDER_PREFS_KEY, next);
  return next;
};

const updateDriverPrefs = (patch: Partial<DriverPrefs>) => {
  const next = { ...driverPrefs(), ...patch };
  writeJson(DRIVER_PREFS_KEY, next);
  return next;
};

const safeName = (name?: { firstname?: string; lastname?: string }) => {
  const first = name?.firstname?.trim() || "";
  const last = name?.lastname?.trim() || "";
  return `${first} ${last}`.trim() || "User";
};

const cap = (value?: string) => (value ? value[0].toUpperCase() + value.slice(1) : "");

const rideTime = (ride: BackendRide) => {
  const v = ride.updatedAt || ride.createdAt;
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
};

const sortNewest = (rides: BackendRide[] = []) => [...rides].sort((a, b) => rideTime(b) - rideTime(a));

const fmtDate = (value?: string) => {
  if (!value) return "Recently";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Recently" : d.toLocaleString();
};

const fmtDuration = (seconds?: number) => {
  if (!seconds || seconds <= 0) return "--";
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} min`;
};

const fmtDistance = (meters?: number) => {
  if (!meters || meters <= 0) return "--";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const haversineMeters = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
};

const estimateEtaSecondsFromDistance = (
  distanceMeters?: number,
  options?: { avgSpeedKmh?: number; minSeconds?: number; maxSeconds?: number; bufferSeconds?: number }
) => {
  const meters = Number(distanceMeters || 0);
  const avgSpeedKmh = Number(options?.avgSpeedKmh || 28);
  const minSeconds = Number(options?.minSeconds || 60);
  const maxSeconds = Number(options?.maxSeconds || 5400);
  const bufferSeconds = Number(options?.bufferSeconds || 90);

  if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(avgSpeedKmh) || avgSpeedKmh <= 0) {
    return clamp(8 * 60, minSeconds, maxSeconds);
  }

  const metersPerSecond = (avgSpeedKmh * 1000) / 3600;
  const rawSeconds = Math.round(meters / metersPerSecond) + bufferSeconds;
  return clamp(rawSeconds, minSeconds, maxSeconds);
};

const toMapCoordinates = (coordinates?: number[] | null): MapCoordinates | null => {
  const [lon, lat] = coordinates || [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  return {
    lat: Number(lat),
    lon: Number(lon),
  };
};

const toMapCoordinatesFromGeoPoint = (point?: GeoPoint | null) => toMapCoordinates(point?.coordinates);

const toFrontendRideId = (vehicle?: BackendVehicleType) => {
  if (vehicle === "bike") return "moto";
  if (vehicle === "auto") return "auto";
  return "sedan";
};

const toBackendVehicle = (rideId: string): BackendVehicleType => {
  const n = rideId.toLowerCase();
  if (n.includes("auto")) return "auto";
  if (n.includes("bike") || n.includes("moto")) return "bike";
  return "car";
};

const fallbackPhone = (seed: string) => {
  const digits = Array.from(seed).map((c) => String(c.charCodeAt(0) % 10)).join("");
  return `9${(digits + "1234567890").slice(0, 9)}`;
};

const splitName = (full: string) => {
  const parts = full.split(" ").map((s) => s.trim()).filter(Boolean);
  const firstRaw = parts[0] || "Rider";
  const lastRaw = parts.slice(1).join(" ") || "User";
  const first = firstRaw.length >= 3 ? firstRaw : firstRaw.padEnd(3, "x");
  const last = lastRaw.length >= 2 ? lastRaw : lastRaw.padEnd(2, "x");
  return { firstname: first, lastname: last };
};

const errMessage = (payload: unknown, fallback: string) => {
  if (Array.isArray(payload)) {
    const msgs = payload
      .map((i) => {
        if (typeof i === "string") return i;
        if (i && typeof i === "object" && "msg" in i && typeof i.msg === "string") return i.msg;
        return "";
      })
      .filter(Boolean);
    if (msgs.length) return msgs.join(", ");
  }

  if (payload && typeof payload === "object") {
    if ("message" in payload && typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }

    if ("errors" in payload && Array.isArray(payload.errors)) {
      const msgs = payload.errors
        .map((i) => (i && typeof i === "object" && "msg" in i && typeof i.msg === "string" ? i.msg : ""))
        .filter(Boolean);
      if (msgs.length) return msgs.join(", ");
    }
  }

  if (typeof payload === "string" && payload.trim()) return payload;
  return fallback;
};

const disconnectSocket = () => {
  if (driverLocationWatchId !== null && isBrowser() && "geolocation" in navigator) {
    navigator.geolocation.clearWatch(driverLocationWatchId);
    driverLocationWatchId = null;
  }
  socketRef?.removeAllListeners();
  socketRef?.disconnect();
  socketRef = null;
  socketKey = "";
  driverRequestStore = [];
  driverLocationStatus = "unknown";
  driverBackfillInFlight = null;
  driverBackfillFetchedAt = 0;
};

const connectSocketIfNeeded = (session: SessionData) => {
  if (!isBrowser() || !session?.token || !session.user?.id) return;

  const key = `${session.user.accountType}:${session.user.id}:${session.token}`;
  if (socketRef && socketKey === key) return;

  disconnectSocket();

  if (session.user.accountType === "driver" && driverOnlineSince === null) {
    driverOnlineSince = Date.now();
  }
  if (session.user.accountType === "driver") {
    driverLocationStatus = "unknown";
  }

  const socket = io(getSocketBase(), { transports: ["websocket", "polling"], withCredentials: false });

  socket.on("connect", () => {
    socket.emit("join", { userId: session.user.id, userType: toBackendUserType(session.user.accountType) });

    if (session.user.accountType === "driver" && isBrowser()) {
      if (!("geolocation" in navigator)) {
        driverLocationStatus = "unsupported";
      } else if (driverLocationWatchId === null) {
        driverLocationWatchId = navigator.geolocation.watchPosition(
          (position) => {
            driverLocationStatus = "enabled";
            socket.emit("update-location-captain", {
              userId: session.user.id,
              location: {
                ltd: position.coords.latitude,
                lng: position.coords.longitude,
              },
            });
          },
          (geoError) => {
            driverLocationStatus =
              geoError.code === geoError.PERMISSION_DENIED ? "denied" : "unknown";

            if (
              geoError.code === geoError.PERMISSION_DENIED &&
              driverLocationWatchId !== null &&
              "geolocation" in navigator
            ) {
              navigator.geolocation.clearWatch(driverLocationWatchId);
              driverLocationWatchId = null;
            }
          },
          {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 30000,
          }
        );
      }

      void syncDriverPendingRides(session, { force: true });
    }
  });

  socket.on("connect_error", () => {
    if (session.user.accountType === "driver" && driverLocationStatus === "unknown") {
      driverLocationStatus = "unsupported";
    }
  });

  socket.on("new-ride", (ride: BackendRide) => {
    if (!ride?._id || ride.status !== "pending") return;
    const idx = driverRequestStore.findIndex((r) => r._id === ride._id);
    if (idx >= 0) {
      driverRequestStore[idx] = { ...driverRequestStore[idx], ...ride };
    } else {
      driverRequestStore = [ride, ...driverRequestStore];
    }
    driverRequestStore = sortNewest(driverRequestStore);
  });

  socket.on("ride-cancelled", (ride: BackendRide) => {
    if (!ride?._id) return;
    driverRequestStore = driverRequestStore.filter((r) => r._id !== ride._id);
  });

  socketRef = socket;
  socketKey = key;
};

const request = async <T>(endpoint: string, options?: { method?: HttpMethod; body?: unknown }): Promise<T> => {
  const session = getSession();
  if (session?.token) connectSocketIfNeeded(session);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options?.body !== undefined) headers["Content-Type"] = "application/json";
  if (session?.token) {
    headers.token = session.token;
    headers.authorization = `Bearer ${session.token}`;
  }

  const fetchForBase = async (baseUrl: string) =>
    fetch(`${baseUrl}${path(endpoint)}`, {
      method: options?.method ?? "GET",
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res: Response | null = null;
  let usedBase = ACTIVE_API_BASE_URL;
  const attemptedBases = [ACTIVE_API_BASE_URL, ...getFallbackApiBases(ACTIVE_API_BASE_URL)];

  let networkError: unknown;
  for (const baseUrl of attemptedBases) {
    try {
      res = await fetchForBase(baseUrl);
      usedBase = baseUrl;
      break;
    } catch (error) {
      networkError = error;
    }
  }

  if (!res) {
    throw new ApiError(
      `Unable to connect to backend API. Tried: ${attemptedBases.join(", ")}. Ensure backend is running and VITE_API_BASE_URL is correct.`,
      0,
      networkError
    );
  }

  ACTIVE_API_BASE_URL = usedBase;

  const raw = await res.text();
  let payload: unknown = undefined;
  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = raw;
    }
  }

  if (!res.ok) {
    throw new ApiError(errMessage(payload, "Request failed"), res.status, payload);
  }

  return payload as T;
};

const requestWithToken = async <T>(
  token: string,
  endpoint: string,
  options?: { method?: HttpMethod; body?: unknown }
): Promise<T> => {
  const headers: Record<string, string> = {
    Accept: "application/json",
    token,
    authorization: `Bearer ${token}`,
  };
  if (options?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const fetchForBase = async (baseUrl: string) =>
    fetch(`${baseUrl}${path(endpoint)}`, {
      method: options?.method ?? "GET",
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res: Response | null = null;
  let usedBase = ACTIVE_API_BASE_URL;
  const attemptedBases = [ACTIVE_API_BASE_URL, ...getFallbackApiBases(ACTIVE_API_BASE_URL)];

  for (const baseUrl of attemptedBases) {
    try {
      res = await fetchForBase(baseUrl);
      usedBase = baseUrl;
      break;
    } catch {
      // Try next base.
    }
  }

  if (!res) {
    throw new ApiError(
      `Unable to connect to backend API. Tried: ${attemptedBases.join(", ")}.`,
      0
    );
  }

  ACTIVE_API_BASE_URL = usedBase;

  const raw = await res.text();
  let payload: unknown = undefined;
  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = raw;
    }
  }

  if (!res.ok) {
    throw new ApiError(errMessage(payload, "Request failed"), res.status, payload);
  }

  return payload as T;
};

const syncDriverPendingRides = async (session: SessionData, options?: { force?: boolean }) => {
  if (session.user.accountType !== "driver") {
    return;
  }

  const now = Date.now();
  if (!options?.force && now - driverBackfillFetchedAt < 4000) {
    return;
  }

  if (driverBackfillInFlight) {
    return driverBackfillInFlight;
  }

  driverBackfillInFlight = (async () => {
    const qs = new URLSearchParams();
    if (driverLocationStatus !== "enabled") {
      qs.set("ignoreLocation", "1");
    }

    const endpoint = qs.toString()
      ? `/ride/pending-for-captain?${qs.toString()}`
      : "/ride/pending-for-captain";
    const response = await request<{ rides?: BackendRide[] }>(endpoint);
    const pendingRides = (response.rides || []).filter((ride) => ride.status === "pending");
    driverRequestStore = sortNewest(pendingRides);
    driverBackfillFetchedAt = Date.now();
  })()
    .catch(() => {
      // Keep socket-updated request list on backfill errors.
    })
    .finally(() => {
      driverBackfillInFlight = null;
    });

  return driverBackfillInFlight;
};

const userProfile = async () => (await request<{ user: { _id: string; rides?: BackendRide[] } }>("/user/profile")).user;
const captainProfile = async () =>
  (await request<{ captain: { _id: string; rides?: BackendRide[]; vehicle?: { model?: string; color?: string; number?: string; capacity?: number; type?: string }; location?: { coordinates?: number[] } } }>("/captain/profile")).captain;

const fareEstimate = async (
  pickup: string,
  destination: string,
  stops?: string[]
): Promise<FareEstimate> => {
  const qsParams = new URLSearchParams({ pickup, destination });
  if (Array.isArray(stops) && stops.length > 0) {
    qsParams.set("stops", JSON.stringify(stops));
  }
  const qs = qsParams.toString();
  const payload = await request<{ fare?: Partial<Record<BackendVehicleType, number>>; distanceTime?: { duration?: { text?: string; value?: number }; distance?: { text?: string; value?: number } } }>(`/ride/get-fare?${qs}`);

  const durationSeconds = Number(payload.distanceTime?.duration?.value ?? 0);
  const distanceMeters = Number(payload.distanceTime?.distance?.value ?? 0);

  return {
    fare: {
      auto: Number(payload.fare?.auto ?? 0),
      car: Number(payload.fare?.car ?? 0),
      bike: Number(payload.fare?.bike ?? 0),
    },
    durationSeconds,
    distanceMeters,
    durationText: payload.distanceTime?.duration?.text || fmtDuration(durationSeconds),
    distanceText: payload.distanceTime?.distance?.text || fmtDistance(distanceMeters),
  };
};

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  accountType: AccountType;
}

export interface AuthPayload {
  token: string;
  user: SafeUser;
  redirectPath: string;
}

export interface SignupPayload {
  requiresEmailVerification: boolean;
  token?: string;
  user: SafeUser;
  redirectPath: string;
}

export interface RideOption {
  id: string;
  label: string;
  eta: string;
  fare: number;
}

export interface RiderProfile {
  userId: string;
  notifications: boolean;
  darkMode: boolean;
  paymentMethods: Array<{ id: string; provider: string; type: string; last4: string }>;
}

export interface DriverProfile {
  userId: string;
  notifications: boolean;
  autoAccept: boolean;
  darkMode: boolean;
  vehicle: { model: string; plate: string; category: string };
}

export interface RiderDashboardData {
  rideOptions: RideOption[];
  selectedRideId: string;
  defaults: { pickup: string; dropoff: string };
  profile: RiderProfile | null;
}

export interface RiderHistoryItem {
  id: string;
  userId: string;
  date: string;
  from: string;
  to: string;
  stops: string[];
  fare: number;
  fareBeforeDiscount: number;
  promoCode: string | null;
  promoDiscount: number;
  hasReceipt: boolean;
  ratingScore: number | null;
  status: "Completed" | "Cancelled" | "Searching" | "On Trip" | "Failed";
  duration: string;
  paymentMethod: string;
  paymentStatus: "pending" | "paid" | "failed";
  canPay: boolean;
}

export interface PromoQuote {
  fareBeforeDiscount: number;
  promoDiscount: number;
  fare: number;
  promoCode: string | null;
  distanceText: string;
  durationText: string;
}

export interface RiderReceipt {
  receiptNo: string;
  issuedAt: string;
  rideDate: string;
  pickup: string;
  stops: string[];
  destination: string;
  vehicle: string;
  fareBeforeDiscount: number;
  promoCode: string | null;
  promoDiscount: number;
  totalFare: number;
  paymentMethod: string;
  paymentStatus: string;
  rider: {
    name: string;
    phone: string;
  };
  captain: {
    name: string;
    phone: string;
    vehicleNo: string;
  };
}

export interface SupportTicket {
  id: string;
  subject: string;
  message: string;
  priority: "low" | "medium" | "high";
  status: "open" | "in_progress" | "resolved" | "closed";
  createdAt: string;
  rideSummary: string | null;
}

export interface RiderTrackingData {
  userId: string;
  rideId: string;
  driverName: string;
  car: string;
  plate: string;
  otp: string | null;
  fare: number;
  etaSeconds: number;
  rideStatus: "searching" | "accepted" | "ongoing" | "failed";
  statusText: string;
  canCancel: boolean;
  paymentMethod: string;
  paymentStatus: "pending" | "paid" | "failed";
  canPay: boolean;
}

export interface NearbyVehicleAvailability {
  auto: number;
  car: number;
  bike: number;
  total: number;
  radiusKm: number;
  updatedAt: string | null;
}

export interface DriverRideRequest {
  id: string;
  customerId: string;
  passenger: string;
  pickup: string;
  dropoff: string;
  fare: number;
  distance: string;
  pickupEtaSeconds: number;
  rating: number;
  status: "Priority" | "Standard";
}

export interface DriverDashboardData {
  requests: DriverRideRequest[];
  todayEarnings: number;
  onlineTime: string;
  locationStatus: DriverLocationStatus;
  locationMessage: string | null;
}

export interface DriverActiveRide {
  id: string;
  customerId: string;
  driverId: string;
  passenger: string;
  pickup: string;
  dropoff: string;
  driverCoords: MapCoordinates | null;
  pickupCoords: MapCoordinates | null;
  dropoffCoords: MapCoordinates | null;
  etaSeconds: number;
  rideStatus: "accepted" | "ongoing";
  canCancel: boolean;
}

export interface DriverEarningsData {
  weekly: Array<{ day: string; value: number }>;
  total: number;
  highest: number;
  tripsCompleted: number;
}

export interface DriverHistoryItem {
  id: string;
  driverId: string;
  passenger: string;
  date: string;
  from: string;
  to: string;
  fare: number;
  status: "Completed" | "Cancelled";
  duration: string;
}

export interface FareEstimate {
  fare: Record<BackendVehicleType, number>;
  durationSeconds: number;
  durationText: string;
  distanceMeters: number;
  distanceText: string;
}

export const toApiErrorMessage = (error: unknown, fallback = "Something went wrong") => {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

const toSessionUser = (id: string, fullname: { firstname?: string; lastname?: string } | undefined, email: string | undefined, accountType: AccountType): SessionUser => ({
  id,
  name: safeName(fullname),
  email: email || "",
  accountType,
});

export const authApi = {
  login: async (payload: { email: string; password: string; accountType: AccountType }) => {
    if (payload.accountType === "rider") {
      const res = await request<{ token: string; user: { _id: string; fullname?: { firstname?: string; lastname?: string }; email?: string } }>("/user/login", {
        method: "POST",
        body: { email: payload.email, password: payload.password },
      });

      return {
        token: res.token,
        user: toSessionUser(String(res.user._id), res.user.fullname, res.user.email, "rider"),
        redirectPath: "/rider",
      } as AuthPayload;
    }

    const res = await request<{ token: string; captain: { _id: string; fullname?: { firstname?: string; lastname?: string }; email?: string } }>("/captain/login", {
      method: "POST",
      body: { email: payload.email, password: payload.password },
    });

    return {
      token: res.token,
      user: toSessionUser(String(res.captain._id), res.captain.fullname, res.captain.email, "driver"),
      redirectPath: "/driver",
    } as AuthPayload;
  },

  signup: async (payload: {
    name: string;
    email: string;
    password: string;
    accountType: AccountType;
    driverDetails?: {
      phone: string;
      drivingLicenseNumber: string;
      vehicleModel: string;
      vehicleColor: string;
      vehicleNumber: string;
      vehicleCapacity: number;
      vehicleType: BackendVehicleType;
    };
  }): Promise<SignupPayload> => {
    const fullname = splitName(payload.name);
    const phone = fallbackPhone(`${payload.email}-${payload.name}`);

    if (payload.accountType === "rider") {
      const res = await request<{ token?: string; requiresEmailVerification?: boolean; user: { _id: string; fullname?: { firstname?: string; lastname?: string }; email?: string } }>("/user/register", {
        method: "POST",
        body: { fullname, email: payload.email, password: payload.password, phone },
      });

      return {
        requiresEmailVerification: Boolean(res.requiresEmailVerification),
        token: res.token,
        user: toSessionUser(String(res.user._id), res.user.fullname, res.user.email, "rider"),
        redirectPath: "/rider",
      };
    }

    if (!payload.driverDetails) {
      throw new ApiError("Driver registration details are required", 400);
    }

    const res = await request<{ token?: string; requiresEmailVerification?: boolean; captain: { _id: string; fullname?: { firstname?: string; lastname?: string }; email?: string } }>("/captain/register", {
      method: "POST",
      body: {
        fullname,
        email: payload.email,
        password: payload.password,
        phone: payload.driverDetails.phone,
        drivingLicenseNumber: payload.driverDetails.drivingLicenseNumber,
        vehicle: {
          model: payload.driverDetails.vehicleModel,
          color: payload.driverDetails.vehicleColor,
          number: payload.driverDetails.vehicleNumber,
          capacity: payload.driverDetails.vehicleCapacity,
          type: payload.driverDetails.vehicleType,
        },
      },
    });

    return {
      requiresEmailVerification: Boolean(res.requiresEmailVerification),
      token: res.token,
      user: toSessionUser(String(res.captain._id), res.captain.fullname, res.captain.email, "driver"),
      redirectPath: "/driver",
    };
  },

  resendVerification: async (payload: { email: string; accountType: AccountType }) => {
    return request<{ message?: string; provider?: string }>("/mail/resend-verification", {
      method: "POST",
      body: {
        email: payload.email,
        userType: toBackendUserType(payload.accountType),
      },
    });
  },

  verifyEmail: async (payload: { email: string; code: string; accountType: AccountType }) => {
    const endpoint =
      payload.accountType === "driver" ? "/captain/verify-email" : "/user/verify-email";

    return request<{ message?: string; provider?: string }>(endpoint, {
      method: "POST",
      body: {
        email: payload.email,
        otp: payload.code,
      },
    });
  },

  verifyEmailToken: async (payload: {
    accountType: AccountType;
    token?: string;
    tokenHash?: string;
    type?: string;
  }) => {
    const endpoint =
      payload.accountType === "driver" ? "/captain/verify-email" : "/user/verify-email";

    return request<{ message?: string; provider?: string }>(endpoint, {
      method: "POST",
      body: {
        token: payload.token,
        token_hash: payload.tokenHash,
        type: payload.type,
      },
    });
  },

  logout: async () => {
    const session = getSession();
    const endpoint = session?.user?.accountType === "driver" ? "/captain/logout" : "/user/logout";
    try {
      return await request<{ message?: string }>(endpoint, { method: "GET" });
    } finally {
      disconnectSocket();
      driverOnlineSince = null;
    }
  },
};
const toRiderHistory = (ride: BackendRide, userId: string): RiderHistoryItem => ({
  id: ride._id,
  userId,
  date: fmtDate(ride.updatedAt || ride.createdAt),
  from: ride.pickup || "Pickup",
  to: ride.destination || "Destination",
  stops: Array.isArray(ride.stops) ? ride.stops : [],
  fare: Number(ride.fare || 0),
  fareBeforeDiscount: Number(
    Number.isFinite(ride.fareBeforeDiscount) ? ride.fareBeforeDiscount : ride.fare || 0
  ),
  promoCode: ride.promoCode || null,
  promoDiscount: Number(ride.promoDiscount || 0),
  hasReceipt: ride.status === "completed",
  ratingScore: Number.isFinite(ride.rating?.score) ? Number(ride.rating?.score) : null,
  status:
    ride.status === "cancelled" &&
    (ride.cancellationReason === "no_driver_available" || isRideFailed(ride._id))
      ? "Failed"
      : ride.status === "cancelled"
      ? "Cancelled"
      : ride.status === "completed"
        ? "Completed"
        : ride.status === "ongoing"
          ? "On Trip"
          : "Searching",
  duration: fmtDuration(ride.duration),
  paymentMethod: ride.paymentMethod || "stripe_checkout",
  paymentStatus: ride.paymentStatus || "pending",
  canPay:
    ride.status === "completed" &&
    (ride.paymentStatus || "pending") !== "paid" &&
    Number(ride.fare || 0) > 0,
});

const isHistorical = (ride: BackendRide) => ride.status === "completed" || ride.status === "cancelled";

const isToday = (value?: string) => {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

export const mapApi = {
  getCoordinates: async (address: string): Promise<MapCoordinates | null> => {
    const safeAddress = address.trim();
    if (safeAddress.length < 3) {
      return null;
    }

    try {
      const response = await request<{ ltd?: number; lng?: number }>(
        `/map/get-coordinates?address=${encodeURIComponent(safeAddress)}`
      );
      if (!Number.isFinite(response.ltd) || !Number.isFinite(response.lng)) {
        return null;
      }

      return {
        lat: Number(response.ltd),
        lon: Number(response.lng),
      };
    } catch {
      return null;
    }
  },
};

const getCaptainDetailsForRide = async (rideId: string) => {
  try {
    const details = await request<{ captain?: { fullname?: { firstname?: string; lastname?: string } } }>(
      `/ride/chat-details/${encodeURIComponent(rideId)}`
    );
    return safeName(details.captain?.fullname);
  } catch {
    return "Searching for driver";
  }
};

const getPassengerForRide = async (ride: BackendRide) => {
  if (ride.user && typeof ride.user === "object") return safeName(ride.user.fullname);
  try {
    const details = await request<{ user?: { fullname?: { firstname?: string; lastname?: string } } }>(
      `/ride/chat-details/${encodeURIComponent(ride._id)}`
    );
    return safeName(details.user?.fullname);
  } catch {
    return "Rider";
  }
};

export const riderApi = {
  getDashboard: async (): Promise<RiderDashboardData> => {
    const user = await userProfile();
    const rides = sortNewest(user.rides || []);
    const last = rides[0];

    const defaults = {
      pickup: last?.pickup || "",
      dropoff: last?.destination || "",
    };

    let rideOptions = [...FRONTEND_RIDE_OPTIONS];
    if (defaults.pickup && defaults.dropoff) {
      try {
        const quote = await fareEstimate(defaults.pickup, defaults.dropoff);
        rideOptions = rideOptions.map((opt) => {
          const mapped = toBackendVehicle(opt.id);
          return {
            ...opt,
            fare: quote.fare[mapped] || opt.fare,
            eta: quote.durationText || opt.eta,
          };
        });
      } catch {
        // Keep fallback options.
      }
    }

    const prefs = riderPrefs();
    return {
      rideOptions,
      selectedRideId: toFrontendRideId(last?.vehicle),
      defaults,
      profile: {
        userId: String(user._id),
        notifications: prefs.notifications,
        darkMode: prefs.darkMode,
        paymentMethods: [
          {
            id: "stripe-default",
            provider: "Stripe",
            type: STRIPE_PAYMENT_LINK ? "Card" : "Setup required",
            last4: "----",
          },
        ],
      },
    };
  },

  getTracking: async (): Promise<RiderTrackingData | null> => {
    const user = await userProfile();
    const rides = sortNewest(user.rides || []);
    const active = rides.find((ride) => ["pending", "accepted", "ongoing"].includes(ride.status || ""));

    if (!active) {
      const latestRide = rides[0];
      const failedSearchRecently =
        latestRide?.status === "cancelled" &&
        (latestRide.cancellationReason === "no_driver_available" || isRideFailed(latestRide._id)) &&
        Date.now() - rideTime(latestRide) <= 30 * 60 * 1000;

      if (!failedSearchRecently || !latestRide) {
        return null;
      }

      return {
        userId: String(user._id),
        rideId: latestRide._id,
        driverName: "No driver nearby",
        car: `${cap(latestRide.vehicle) || "Ride"} search ended`,
        plate: "--",
        otp: null,
        fare: Number(latestRide.fare || 0),
        etaSeconds: 0,
        rideStatus: "failed",
        statusText: "No driver accepted this ride within 5 minutes.",
        canCancel: false,
        paymentMethod: latestRide.paymentMethod || "stripe_checkout",
        paymentStatus: latestRide.paymentStatus || "pending",
        canPay: false,
      };
    }

    let driverName = "Searching for driver";
    let plate = "--";

    if (active.captain && typeof active.captain === "object") {
      driverName = safeName(active.captain.fullname);
      plate = active.captain.vehicle?.number || "--";
    } else if (active._id) {
      driverName = await getCaptainDetailsForRide(active._id);
    }

    const hasAssignedDriver =
      driverName.trim().toLowerCase() !== "searching for driver" &&
      driverName.trim().toLowerCase() !== "user";
    const rideStatus =
      active.status === "ongoing"
        ? "ongoing"
        : active.status === "accepted" && hasAssignedDriver
          ? "accepted"
          : "searching";
    const routeDistanceMeters = Number(active.distance || 0);
    const estimatedPickupMeters =
      routeDistanceMeters > 0 ? Math.max(500, Math.round(routeDistanceMeters * 0.25)) : 1800;
    const estimatedDropoffMeters =
      routeDistanceMeters > 0 ? Math.max(1000, Math.round(routeDistanceMeters * 0.6)) : 4200;
    const etaSeconds =
      rideStatus === "searching"
        ? 0
        : rideStatus === "accepted"
          ? estimateEtaSecondsFromDistance(estimatedPickupMeters, {
              avgSpeedKmh: 26,
              minSeconds: 120,
              maxSeconds: 50 * 60,
              bufferSeconds: 120,
            })
          : estimateEtaSecondsFromDistance(estimatedDropoffMeters, {
              avgSpeedKmh: 28,
              minSeconds: 180,
              maxSeconds: 90 * 60,
              bufferSeconds: 90,
            });
    const statusText =
      rideStatus === "searching"
        ? "Searching for nearby rides..."
        : rideStatus === "accepted"
          ? "Driver accepted. Heading to pickup."
          : "Ride in progress";
    const otp =
      rideStatus === "accepted"
        ? await request<{ rideId: string; otp: string }>(`/ride/otp/${encodeURIComponent(active._id)}`)
            .then((response) => response.otp || null)
            .catch(() => null)
        : null;

    return {
      userId: String(user._id),
      rideId: active._id,
      driverName,
      car: active.status === "pending" ? "Matching nearby drivers" : `${cap(active.vehicle) || "Cab"} ride`,
      plate,
      otp,
      fare: Number(active.fare || 0),
      etaSeconds,
      rideStatus,
      statusText,
      canCancel: rideStatus === "searching" || rideStatus === "accepted",
      paymentMethod: active.paymentMethod || "stripe_checkout",
      paymentStatus: active.paymentStatus || "pending",
      canPay:
        rideStatus === "ongoing" &&
        Number(active.fare || 0) > 0 &&
        (active.paymentStatus || "pending") !== "paid",
    };
  },

  getHistory: async (): Promise<RiderHistoryItem[]> => {
    const user = await userProfile();
    return sortNewest(user.rides || []).map((ride) => toRiderHistory(ride, String(user._id)));
  },

  getProfile: async (): Promise<RiderProfile> => {
    const user = await userProfile();
    const prefs = riderPrefs();

    return {
      userId: String(user._id),
      notifications: prefs.notifications,
      darkMode: prefs.darkMode,
      paymentMethods: [
        {
          id: "stripe-default",
          provider: "Stripe",
          type: STRIPE_PAYMENT_LINK ? "Card" : "Setup required",
          last4: "----",
        },
      ],
    };
  },

  updateProfile: async (payload: Partial<Pick<RiderProfile, "notifications" | "darkMode">>) => {
    const user = await userProfile();
    const prefs = updateRiderPrefs(payload);

    return {
      userId: String(user._id),
      notifications: prefs.notifications,
      darkMode: prefs.darkMode,
      paymentMethods: [
        {
          id: "stripe-default",
          provider: "Stripe",
          type: STRIPE_PAYMENT_LINK ? "Card" : "Setup required",
          last4: "----",
        },
      ],
    };
  },

  submitRating: async (payload: { rideId?: string; rating: number; feedback: string }) => {
    const response = await request<{ rideId: string; rating?: { score?: number } }>("/ride/rate", {
      method: "POST",
      body: {
        rideId: payload.rideId,
        rating: payload.rating,
        feedback: payload.feedback,
      },
    });

    return {
      id: response.rideId,
      rating: Number(response.rating?.score || payload.rating),
    };
  },

  createBooking: async (payload: {
    pickup: string;
    dropoff: string;
    rideTypeId: string;
    distanceKm?: number;
    stops?: string[];
    promoCode?: string;
    pickupCoords?: { lat: number; lon: number } | null;
    dropoffCoords?: { lat: number; lon: number } | null;
  }) => {
    // Enforce a single active search: cancel any existing pending/accepted search before creating a new one.
    const currentUser = await userProfile();
    const activeSearchRide = sortNewest(currentUser.rides || []).find((ride) =>
      ["pending", "accepted"].includes(ride.status || "")
    );

    if (activeSearchRide?._id) {
      const cancelQs = new URLSearchParams({ rideId: activeSearchRide._id }).toString();
      await request<BackendRide>(`/ride/cancel?${cancelQs}`);
      clearRideFailedFlag(activeSearchRide._id);
    }

    const vehicleType = toBackendVehicle(payload.rideTypeId);
    const ride = await request<BackendRide>("/ride/create", {
      method: "POST",
      body: {
        pickup: payload.pickup,
        destination: payload.dropoff,
        vehicleType,
        stops: payload.stops || [],
        promoCode: payload.promoCode?.trim() || undefined,
        pickupCoordinates: payload.pickupCoords
          ? { lat: payload.pickupCoords.lat, lon: payload.pickupCoords.lon }
          : undefined,
        destinationCoordinates: payload.dropoffCoords
          ? { lat: payload.dropoffCoords.lat, lon: payload.dropoffCoords.lon }
          : undefined,
      },
    });
    clearRideFailedFlag(ride._id);
    const session = getSession();
    return toRiderHistory(ride, session?.user?.id || "");
  },

  cancelBooking: async (bookingId: string) => {
    const qs = new URLSearchParams({ rideId: bookingId }).toString();
    const ride = await request<BackendRide>(`/ride/cancel?${qs}`);
    clearRideFailedFlag(ride._id);
    const session = getSession();
    return toRiderHistory(ride, session?.user?.id || "");
  },

  getFareEstimate: (payload: { pickup: string; destination: string; stops?: string[] }) =>
    fareEstimate(payload.pickup, payload.destination, payload.stops),

  getNearbyVehicleAvailability: async (payload: {
    lat: number;
    lng: number;
    radiusKm?: number;
  }): Promise<NearbyVehicleAvailability> => {
    const qs = new URLSearchParams({
      lat: String(payload.lat),
      lng: String(payload.lng),
      radius: String(payload.radiusKm ?? 4),
    }).toString();

    const response = await request<{
      radiusKm?: number;
      total?: number;
      updatedAt?: string | null;
      byVehicle?: Partial<Record<BackendVehicleType, number>>;
    }>(`/ride/availability?${qs}`);

    return {
      auto: Number(response.byVehicle?.auto || 0),
      car: Number(response.byVehicle?.car || 0),
      bike: Number(response.byVehicle?.bike || 0),
      total: Number(response.total || 0),
      radiusKm: Number(response.radiusKm || payload.radiusKm || 4),
      updatedAt: response.updatedAt || null,
    };
  },

  applyPromoCode: async (payload: {
    pickup: string;
    destination: string;
    rideTypeId: string;
    promoCode: string;
    stops?: string[];
  }): Promise<PromoQuote> => {
    const response = await request<{
      fareBeforeDiscount: number;
      promoDiscount: number;
      fare: number;
      promoCode: string | null;
      distanceTime?: { duration?: { text?: string }; distance?: { text?: string } };
    }>("/ride/apply-promo", {
      method: "POST",
      body: {
        pickup: payload.pickup,
        destination: payload.destination,
        vehicleType: toBackendVehicle(payload.rideTypeId),
        promoCode: payload.promoCode.trim(),
        stops: payload.stops || [],
      },
    });

    return {
      fareBeforeDiscount: Number(response.fareBeforeDiscount || 0),
      promoDiscount: Number(response.promoDiscount || 0),
      fare: Number(response.fare || 0),
      promoCode: response.promoCode || null,
      distanceText: response.distanceTime?.distance?.text || "--",
      durationText: response.distanceTime?.duration?.text || "--",
    };
  },

  getReceipt: async (rideId: string): Promise<RiderReceipt> => {
    const response = await request<{
      receiptNo: string;
      issuedAt: string;
      rideDate: string;
      pickup: string;
      stops?: string[];
      destination: string;
      vehicle: string;
      fareBeforeDiscount: number;
      promoCode?: string | null;
      promoDiscount?: number;
      totalFare: number;
      paymentMethod: string;
      paymentStatus: string;
      rider: { name: string; phone: string };
      captain: { name: string; phone: string; vehicleNo: string };
    }>(`/ride/receipt/${encodeURIComponent(rideId)}`);

    return {
      receiptNo: response.receiptNo,
      issuedAt: response.issuedAt,
      rideDate: response.rideDate,
      pickup: response.pickup,
      stops: response.stops || [],
      destination: response.destination,
      vehicle: response.vehicle,
      fareBeforeDiscount: Number(response.fareBeforeDiscount || response.totalFare || 0),
      promoCode: response.promoCode || null,
      promoDiscount: Number(response.promoDiscount || 0),
      totalFare: Number(response.totalFare || 0),
      paymentMethod: response.paymentMethod,
      paymentStatus: response.paymentStatus,
      rider: response.rider,
      captain: response.captain,
    };
  },

  createPaymentSession: async (
    rideId: string
  ): Promise<{
    rideId: string;
    sessionId: string | null;
    checkoutUrl: string | null;
    paymentStatus: "pending" | "paid" | "failed";
    alreadyPaid: boolean;
  }> => {
    const response = await request<{
      rideId: string;
      sessionId: string | null;
      checkoutUrl: string | null;
      paymentStatus: "pending" | "paid" | "failed";
      alreadyPaid: boolean;
    }>("/ride/payment/create-session", {
      method: "POST",
      body: { rideId },
    });

    return {
      rideId: response.rideId,
      sessionId: response.sessionId || null,
      checkoutUrl: response.checkoutUrl || null,
      paymentStatus: response.paymentStatus || "pending",
      alreadyPaid: Boolean(response.alreadyPaid),
    };
  },

  confirmPayment: async (payload: {
    rideId: string;
    sessionId: string;
  }): Promise<{
    rideId: string;
    paymentMethod: string;
    paymentStatus: "pending" | "paid" | "failed";
    receiptNo: string | null;
    receiptIssuedAt: string | null;
  }> => {
    const response = await request<{
      rideId: string;
      paymentMethod: string;
      paymentStatus: "pending" | "paid" | "failed";
      receiptNo: string | null;
      receiptIssuedAt: string | null;
    }>("/ride/payment/confirm", {
      method: "POST",
      body: payload,
    });

    return {
      rideId: response.rideId,
      paymentMethod: response.paymentMethod || "stripe_checkout",
      paymentStatus: response.paymentStatus || "pending",
      receiptNo: response.receiptNo || null,
      receiptIssuedAt: response.receiptIssuedAt || null,
    };
  },

  getPaymentStatus: async (rideId: string): Promise<{
    rideId: string;
    status: string;
    fare: number;
    paymentMethod: string;
    paymentStatus: "pending" | "paid" | "failed";
    paymentID: string | null;
    orderId: string | null;
    receiptNo: string | null;
    receiptIssuedAt: string | null;
    updatedAt: string | null;
  }> => {
    const response = await request<{
      rideId: string;
      status: string;
      fare: number;
      paymentMethod: string;
      paymentStatus: "pending" | "paid" | "failed";
      paymentID: string | null;
      orderId: string | null;
      receiptNo: string | null;
      receiptIssuedAt: string | null;
      updatedAt: string | null;
    }>(`/ride/payment-status/${encodeURIComponent(rideId)}`);

    return {
      rideId: response.rideId,
      status: response.status,
      fare: Number(response.fare || 0),
      paymentMethod: response.paymentMethod || "stripe_checkout",
      paymentStatus: response.paymentStatus || "pending",
      paymentID: response.paymentID || null,
      orderId: response.orderId || null,
      receiptNo: response.receiptNo || null,
      receiptIssuedAt: response.receiptIssuedAt || null,
      updatedAt: response.updatedAt || null,
    };
  },

  triggerSos: async (payload: {
    rideId: string;
    message?: string;
    location?: { ltd: number; lng: number };
  }) =>
    request<{ alertId: string; status: string; message: string }>("/ride/sos", {
      method: "POST",
      body: payload,
    }),

  createSupportTicket: async (payload: {
    subject: string;
    message: string;
    priority?: "low" | "medium" | "high";
    rideId?: string;
  }): Promise<SupportTicket> => {
    const response = await request<{
      ticket: {
        _id: string;
        subject: string;
        message: string;
        priority: "low" | "medium" | "high";
        status: "open" | "in_progress" | "resolved" | "closed";
        createdAt: string;
      };
    }>("/support/tickets", {
      method: "POST",
      body: payload,
    });

    return {
      id: response.ticket._id,
      subject: response.ticket.subject,
      message: response.ticket.message,
      priority: response.ticket.priority,
      status: response.ticket.status,
      createdAt: fmtDate(response.ticket.createdAt),
      rideSummary: null,
    };
  },

  getSupportTickets: async (): Promise<SupportTicket[]> => {
    const response = await request<{
      tickets: Array<{
        _id: string;
        subject: string;
        message: string;
        priority: "low" | "medium" | "high";
        status: "open" | "in_progress" | "resolved" | "closed";
        createdAt: string;
        ride?: { pickup?: string; destination?: string } | null;
      }>;
    }>("/support/tickets");

    return (response.tickets || []).map((ticket) => ({
      id: ticket._id,
      subject: ticket.subject,
      message: ticket.message,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: fmtDate(ticket.createdAt),
      rideSummary:
        ticket.ride?.pickup && ticket.ride?.destination
          ? `${ticket.ride.pickup} to ${ticket.ride.destination}`
          : null,
    }));
  },
};

export const driverApi = {
  getDashboard: async (): Promise<DriverDashboardData> => {
    const captain = await captainProfile();
    const session = getSession();
    const completed = (captain.rides || []).filter((ride) => ride.status === "completed");

    const todayEarnings = completed.reduce((sum, ride) => {
      if (!isToday(ride.updatedAt || ride.createdAt)) return sum;
      return sum + Number(ride.fare || 0);
    }, 0);

    const elapsed = driverOnlineSince ? Date.now() - driverOnlineSince : 0;
    const minutes = Math.max(0, Math.floor(elapsed / 60000));
    const onlineTime = `${String(Math.floor(minutes / 60)).padStart(2, "0")}h ${String(minutes % 60).padStart(2, "0")}m`;
    const [captainLng, captainLtd] = captain.location?.coordinates || [];
    const hasCaptainLocation =
      Number.isFinite(captainLng) &&
      Number.isFinite(captainLtd) &&
      (Math.abs(Number(captainLng)) > 0.0001 || Math.abs(Number(captainLtd)) > 0.0001);
    const locationBlocked =
      driverLocationStatus === "denied" || driverLocationStatus === "unsupported";
    const locationMessage =
      locationBlocked || !hasCaptainLocation
        ? "Enable location for nearby matching. Showing available rides anyway."
        : null;

    if (
      session?.token &&
      session.user.accountType === "driver"
    ) {
      await syncDriverPendingRides(session);
    }

    return {
      requests: driverRequestStore
        .filter((ride) => ride.status === "pending")
        .map((ride) => {
          const [pickupLng, pickupLtd] = ride.pickupLocation?.coordinates || [];
          const hasRealtimeCoordinates =
            Number.isFinite(captainLng) &&
            Number.isFinite(captainLtd) &&
            Number.isFinite(pickupLng) &&
            Number.isFinite(pickupLtd);
          const pickupDistanceMeters = hasRealtimeCoordinates
            ? haversineMeters(captainLtd, captainLng, pickupLtd, pickupLng)
            : Number.isFinite(ride.distance)
              ? Math.max(500, Math.round(Number(ride.distance) * 0.2))
              : 1800;

          return {
            id: ride._id,
            customerId:
              ride.user && typeof ride.user === "object"
                ? String(ride.user._id || "Unavailable")
                : String(ride.user || "Unavailable"),
            passenger: ride.user && typeof ride.user === "object" ? safeName(ride.user.fullname) : "New rider",
            pickup: ride.pickup || "Pickup",
            dropoff: ride.destination || "Destination",
            fare: Number(ride.fare || 0),
            distance: fmtDistance(ride.distance),
            pickupEtaSeconds: estimateEtaSecondsFromDistance(pickupDistanceMeters, {
              avgSpeedKmh: 26,
              minSeconds: 120,
              maxSeconds: 50 * 60,
              bufferSeconds: 120,
            }),
            rating: 4.8,
            status: Number(ride.fare || 0) >= 200 ? "Priority" : "Standard",
          };
        }),
      todayEarnings,
      onlineTime,
      locationStatus: driverLocationStatus,
      locationMessage,
    };
  },

  getActiveRide: async (): Promise<DriverActiveRide | null> => {
    const captain = await captainProfile();
    const rides = sortNewest(captain.rides || []);
    const active = rides.find((ride) => ride.status === "ongoing") || rides.find((ride) => ride.status === "accepted");

    if (!active) return null;

    const passenger = await getPassengerForRide(active);
    const rideStatus = active.status === "ongoing" ? "ongoing" : "accepted";
    const [captainLng, captainLtd] = captain.location?.coordinates || [];
    const driverCoords = toMapCoordinates(captain.location?.coordinates);
    const [pickupLng, pickupLtd] = active.pickupLocation?.coordinates || [];
    const pickupCoords = toMapCoordinatesFromGeoPoint(active.pickupLocation);
    const dropoffCoords = toMapCoordinatesFromGeoPoint(active.destinationLocation);
    const hasRealtimeCoordinates =
      Number.isFinite(captainLng) &&
      Number.isFinite(captainLtd) &&
      Number.isFinite(pickupLng) &&
      Number.isFinite(pickupLtd);
    const routeDistanceMeters = Number(active.distance || 0);
    const acceptedDistanceMeters = hasRealtimeCoordinates
      ? haversineMeters(captainLtd, captainLng, pickupLtd, pickupLng)
      : routeDistanceMeters > 0
        ? Math.max(500, Math.round(routeDistanceMeters * 0.25))
        : 1800;
    const ongoingDistanceMeters =
      routeDistanceMeters > 0 ? Math.max(1000, Math.round(routeDistanceMeters * 0.6)) : 4200;
    const etaSeconds =
      rideStatus === "accepted"
        ? estimateEtaSecondsFromDistance(acceptedDistanceMeters, {
            avgSpeedKmh: 26,
            minSeconds: 120,
            maxSeconds: 50 * 60,
            bufferSeconds: 120,
          })
        : estimateEtaSecondsFromDistance(ongoingDistanceMeters, {
            avgSpeedKmh: 28,
            minSeconds: 180,
            maxSeconds: 90 * 60,
            bufferSeconds: 90,
          });

    return {
      id: active._id,
      customerId:
        active.user && typeof active.user === "object"
          ? String(active.user._id || "Unavailable")
          : String(active.user || "Unavailable"),
      driverId: String(captain._id),
      passenger,
      pickup: active.pickup || "Pickup",
      dropoff: active.destination || "Destination",
      driverCoords,
      pickupCoords,
      dropoffCoords,
      etaSeconds,
      rideStatus,
      canCancel: rideStatus === "accepted",
    };
  },

  getEarnings: async (): Promise<DriverEarningsData> => {
    const captain = await captainProfile();
    const rides = sortNewest(captain.rides || []).filter((ride) => ride.status === "completed");

    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - i));
      return d;
    });

    const weekly = days.map((day) => {
      const from = day.getTime();
      const to = from + 86400000;
      const value = rides.reduce((sum, ride) => {
        const t = rideTime(ride);
        return t >= from && t < to ? sum + Number(ride.fare || 0) : sum;
      }, 0);
      return { day: day.toLocaleDateString(undefined, { weekday: "short" }), value };
    });

    const total = weekly.reduce((sum, item) => sum + item.value, 0);
    const highest = weekly.reduce((max, item) => Math.max(max, item.value), 0);

    return {
      weekly,
      total,
      highest,
      tripsCompleted: rides.length,
    };
  },

  getHistory: async (): Promise<DriverHistoryItem[]> => {
    const captain = await captainProfile();
    const rides = sortNewest(captain.rides || []).filter(isHistorical);

    const items = await Promise.all(
      rides.map(async (ride) => ({
        id: ride._id,
        driverId: String(captain._id),
        passenger: await getPassengerForRide(ride),
        date: fmtDate(ride.updatedAt || ride.createdAt),
        from: ride.pickup || "Pickup",
        to: ride.destination || "Destination",
        fare: Number(ride.fare || 0),
        status: ride.status === "cancelled" ? ("Cancelled" as const) : ("Completed" as const),
        duration: fmtDuration(ride.duration),
      }))
    );

    return items;
  },

  getProfile: async (): Promise<DriverProfile> => {
    const captain = await captainProfile();
    const prefs = driverPrefs();

    return {
      userId: String(captain._id),
      notifications: prefs.notifications,
      autoAccept: prefs.autoAccept,
      darkMode: prefs.darkMode,
      vehicle: {
        model:
          captain.vehicle?.model ||
          `${cap(captain.vehicle?.color) || "Vehicle"} ${cap(captain.vehicle?.type) || ""}`.trim(),
        plate: captain.vehicle?.number || "Not assigned",
        category: captain.vehicle?.capacity ? `${captain.vehicle.capacity} seats` : "Standard",
      },
    };
  },

  updateProfile: async (payload: Partial<Pick<DriverProfile, "notifications" | "autoAccept" | "darkMode">>) => {
    const captain = await captainProfile();
    const prefs = updateDriverPrefs(payload);

    return {
      userId: String(captain._id),
      notifications: prefs.notifications,
      autoAccept: prefs.autoAccept,
      darkMode: prefs.darkMode,
      vehicle: {
        model:
          captain.vehicle?.model ||
          `${cap(captain.vehicle?.color) || "Vehicle"} ${cap(captain.vehicle?.type) || ""}`.trim(),
        plate: captain.vehicle?.number || "Not assigned",
        category: captain.vehicle?.capacity ? `${captain.vehicle.capacity} seats` : "Standard",
      },
    };
  },

  acceptRequest: async (requestId: string): Promise<DriverActiveRide> => {
    const ride = await request<BackendRide>("/ride/confirm", {
      method: "POST",
      body: { rideId: requestId },
    });

    driverRequestStore = driverRequestStore.filter((r) => r._id !== requestId);

    return {
      id: ride._id,
      customerId:
        ride.user && typeof ride.user === "object"
          ? String(ride.user._id || "Unavailable")
          : String(ride.user || "Unavailable"),
      driverId: getSession()?.user?.id || "",
      passenger: await getPassengerForRide(ride),
      pickup: ride.pickup || "Pickup",
      dropoff: ride.destination || "Destination",
      driverCoords: null,
      pickupCoords: toMapCoordinatesFromGeoPoint(ride.pickupLocation),
      dropoffCoords: toMapCoordinatesFromGeoPoint(ride.destinationLocation),
      etaSeconds: estimateEtaSecondsFromDistance(
        Number(ride.distance || 0) > 0 ? Math.max(500, Math.round(Number(ride.distance || 0) * 0.25)) : 1800,
        {
          avgSpeedKmh: 26,
          minSeconds: 120,
          maxSeconds: 50 * 60,
          bufferSeconds: 120,
        }
      ),
      rideStatus: "accepted",
      canCancel: true,
    };
  },

  startRide: async (payload: { rideId: string; otp: string }): Promise<DriverActiveRide> => {
    const qs = new URLSearchParams({
      rideId: payload.rideId,
      otp: payload.otp.trim(),
    }).toString();
    const ride = await request<BackendRide>(`/ride/start-ride?${qs}`);

    return {
      id: ride._id,
      customerId:
        ride.user && typeof ride.user === "object"
          ? String(ride.user._id || "Unavailable")
          : String(ride.user || "Unavailable"),
      driverId: getSession()?.user?.id || "",
      passenger: await getPassengerForRide(ride),
      pickup: ride.pickup || "Pickup",
      dropoff: ride.destination || "Destination",
      driverCoords: null,
      pickupCoords: toMapCoordinatesFromGeoPoint(ride.pickupLocation),
      dropoffCoords: toMapCoordinatesFromGeoPoint(ride.destinationLocation),
      etaSeconds: estimateEtaSecondsFromDistance(
        Number(ride.distance || 0) > 0 ? Math.max(1000, Math.round(Number(ride.distance || 0) * 0.6)) : 4200,
        {
          avgSpeedKmh: 28,
          minSeconds: 180,
          maxSeconds: 90 * 60,
          bufferSeconds: 90,
        }
      ),
      rideStatus: "ongoing",
      canCancel: false,
    };
  },

  completeRide: async (rideId: string) => {
    const ride = await request<BackendRide>("/ride/end-ride", {
      method: "POST",
      body: { rideId },
    });
    return { id: ride._id };
  },

  cancelRide: async (rideId: string) => {
    const qs = new URLSearchParams({ rideId }).toString();
    const ride = await request<BackendRide>(`/ride/cancel?${qs}`);
    driverRequestStore = driverRequestStore.filter((r) => r._id !== rideId);
    return { id: ride._id };
  },

  declineRequest: async (requestId: string) => {
    const ride = await request<BackendRide>("/ride/decline", {
      method: "POST",
      body: { rideId: requestId },
    });
    driverRequestStore = driverRequestStore.filter((r) => r._id !== requestId);
    return { id: ride._id };
  },
};
