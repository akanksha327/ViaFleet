import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bike,
  Car,
  CarTaxiFront,
  Clock3,
  LocateFixed,
  MapPin,
  Navigation,
  Plus,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import AnimatedCounter from "@/components/ui/AnimatedCounter";
import MagneticButton from "@/components/ui/MagneticButton";
import RiderMap from "@/components/map/RiderMap";
import { cn } from "@/lib/utils";
import { riderApi, toApiErrorMessage, type NearbyVehicleAvailability } from "@/lib/api";
import { toast } from "@/components/ui/sonner";

type LocationSuggestion = {
  id: string;
  label: string;
  lat?: number;
  lon?: number;
  distanceKm?: number;
};

type LocationBias = {
  lat?: number;
  lon?: number;
  countryCode?: string;
  strictCountry?: boolean;
};

type RideVisualMeta = {
  icon: typeof Car;
  description: string;
  seatsLabel: string;
  availabilitySingular: string;
  availabilityPlural: string;
};

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const MIN_QUERY_LENGTH = 3;
const DEFAULT_SUGGESTION_LIMIT = 6;
const RIDE_FARE_RULES: Record<string, { base: number; perKm: number; minimum: number }> = {
  moto: { base: 22, perKm: 10, minimum: 80 },
  auto: { base: 28, perKm: 12, minimum: 95 },
  sedan: { base: 45, perKm: 16, minimum: 150 },
  xl: { base: 68, perKm: 22, minimum: 240 },
  economy: { base: 35, perKm: 14, minimum: 120 },
  comfort: { base: 55, perKm: 19, minimum: 180 },
  premium: { base: 95, perKm: 28, minimum: 320 },
};
const RIDE_ETA_RULES: Record<string, { avgSpeedKmh: number; serviceDelayMin: number; minimumMinutes: number }> = {
  moto: { avgSpeedKmh: 31, serviceDelayMin: 2, minimumMinutes: 3 },
  auto: { avgSpeedKmh: 27, serviceDelayMin: 3, minimumMinutes: 4 },
  sedan: { avgSpeedKmh: 30, serviceDelayMin: 2.5, minimumMinutes: 4 },
  xl: { avgSpeedKmh: 26, serviceDelayMin: 3.5, minimumMinutes: 5 },
  economy: { avgSpeedKmh: 26, serviceDelayMin: 3, minimumMinutes: 5 },
  comfort: { avgSpeedKmh: 30, serviceDelayMin: 2.5, minimumMinutes: 4 },
  premium: { avgSpeedKmh: 34, serviceDelayMin: 2, minimumMinutes: 4 },
};
const RIDE_VISUAL_META: Record<string, RideVisualMeta> = {
  moto: {
    icon: Bike,
    description: "Fast pickup for solo rides",
    seatsLabel: "1 seat",
    availabilitySingular: "bike",
    availabilityPlural: "bikes",
  },
  auto: {
    icon: CarTaxiFront,
    description: "Budget auto rides for short hops",
    seatsLabel: "3 seats",
    availabilitySingular: "auto",
    availabilityPlural: "autos",
  },
  sedan: {
    icon: Car,
    description: "Comfortable everyday taxi",
    seatsLabel: "4 seats",
    availabilitySingular: "cab",
    availabilityPlural: "cabs",
  },
  xl: {
    icon: Users,
    description: "Roomy ride for groups and luggage",
    seatsLabel: "6 seats",
    availabilitySingular: "SUV",
    availabilityPlural: "SUVs",
  },
  economy: {
    icon: CarTaxiFront,
    description: "Affordable city rides",
    seatsLabel: "4 seats",
    availabilitySingular: "cab",
    availabilityPlural: "cabs",
  },
  comfort: {
    icon: Car,
    description: "Premium comfort sedan",
    seatsLabel: "4 seats",
    availabilitySingular: "cab",
    availabilityPlural: "cabs",
  },
  premium: {
    icon: ShieldCheck,
    description: "Top-tier ride with extra comfort",
    seatsLabel: "4 seats",
    availabilitySingular: "premium car",
    availabilityPlural: "premium cars",
  },
};
const DEFAULT_RIDE_VISUAL_META: RideVisualMeta = {
  icon: Car,
  description: "Ride option available in your area",
  seatsLabel: "4 seats",
  availabilitySingular: "cab",
  availabilityPlural: "cabs",
};

const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isAbortError = (error: unknown) =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (error instanceof Error && error.name === "AbortError");

const inferCountryCodeFromLocale = () => {
  if (typeof navigator === "undefined") return "";

  const locales = [
    ...(navigator.languages ?? []),
    navigator.language,
  ].filter(Boolean);

  for (const locale of locales) {
    const region = locale.split("-")[1];
    if (region && region.length === 2) {
      return region.toLowerCase();
    }
  }

  return "";
};

const toViewBox = (lat: number, lon: number) => {
  const delta = 0.4;
  const west = lon - delta;
  const east = lon + delta;
  const north = lat + delta;
  const south = lat - delta;
  return `${west},${north},${east},${south}`;
};

const haversineDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

const searchLocationSuggestions = async (
  query: string,
  signal: AbortSignal,
  bias?: LocationBias,
  limit = DEFAULT_SUGGESTION_LIMIT
): Promise<LocationSuggestion[]> => {
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: String(limit),
    addressdetails: "1",
    dedupe: "1",
    q: query,
  });

  if (bias?.countryCode && bias.strictCountry) {
    params.set("countrycodes", bias.countryCode.toLowerCase());
  }

  if (bias?.lat !== undefined && bias?.lon !== undefined) {
    params.set("viewbox", toViewBox(bias.lat, bias.lon));
  }

  const url = `${NOMINATIM_BASE_URL}/search?${params.toString()}`;
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch location suggestions");
  }

  const payload = (await response.json()) as Array<{
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
  }>;

  return payload.map((item) => ({
    id: String(item.place_id),
    label: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon),
  }));
};

const searchWikipediaLocationSuggestions = async (
  query: string,
  signal: AbortSignal,
  limit = DEFAULT_SUGGESTION_LIMIT
): Promise<LocationSuggestion[]> => {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(Math.max(limit * 2, 8)),
    prop: "coordinates",
    format: "json",
    origin: "*",
  });

  const url = `https://en.wikipedia.org/w/api.php?${params.toString()}`;
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Wikipedia location suggestions");
  }

  const payload = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          pageid: number;
          title: string;
          index?: number;
          coordinates?: Array<{ lat: number; lon: number }>;
        }
      >;
    };
  };

  const pages = Object.values(payload.query?.pages ?? {})
    .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER));

  return pages
    .filter((page) => page.coordinates?.[0])
    .map((page) => ({
      id: `wiki-${page.pageid}`,
      label: `${page.title}, Wikipedia`,
      lat: page.coordinates![0].lat,
      lon: page.coordinates![0].lon,
    }))
    .slice(0, limit);
};

const searchWikipediaExactTitleSuggestion = async (
  query: string,
  signal: AbortSignal
): Promise<LocationSuggestion[]> => {
  const params = new URLSearchParams({
    action: "query",
    titles: query,
    prop: "coordinates",
    format: "json",
    origin: "*",
  });

  const url = `https://en.wikipedia.org/w/api.php?${params.toString()}`;
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Wikipedia exact title suggestion");
  }

  const payload = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          pageid?: number;
          title?: string;
          coordinates?: Array<{ lat: number; lon: number }>;
          missing?: string;
        }
      >;
    };
  };

  const pages = Object.values(payload.query?.pages ?? {});

  return pages
    .filter((page) => !page.missing && page.coordinates?.[0] && page.pageid && page.title)
    .map((page) => ({
      id: `wiki-title-${page.pageid}`,
      label: `${page.title}, Wikipedia`,
      lat: page.coordinates![0].lat,
      lon: page.coordinates![0].lon,
    }));
};

const reverseGeocode = async (
  lat: number,
  lon: number
): Promise<{ label: string; countryCode: string }> => {
  const url = `${NOMINATIM_BASE_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to resolve current location");
  }

  const payload = (await response.json()) as {
    display_name?: string;
    address?: { country_code?: string };
  };

  return {
    label: payload.display_name ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    countryCode: payload.address?.country_code?.toLowerCase() ?? "",
  };
};

const getGeolocationErrorMessage = (error: GeolocationPositionError) => {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission denied. Enable location access and try again.";
    case error.POSITION_UNAVAILABLE:
      return "Current location is unavailable right now.";
    case error.TIMEOUT:
      return "Location request timed out. Please try again.";
    default:
      return "Unable to get your current location.";
  }
};

const mergeUniqueSuggestions = (primary: LocationSuggestion[], fallback: LocationSuggestion[]) => {
  const merged = [...primary];
  const seen = new Set(primary.map((item) => item.id));

  for (const item of fallback) {
    if (!seen.has(item.id)) {
      merged.push(item);
      seen.add(item.id);
    }
  }

  return merged;
};

const getTextMatchPriority = (label: string, query: string) => {
  const normalizedLabel = normalizeSearchText(label);
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) return 3;
  if (normalizedLabel === normalizedQuery) return 0;
  if (normalizedLabel.startsWith(normalizedQuery)) return 1;
  if (normalizedLabel.includes(normalizedQuery)) return 2;

  const queryTokens = normalizedQuery.split(" ");
  const allTokensFound = queryTokens.every((token) => normalizedLabel.includes(token));
  if (allTokensFound) return 3;

  return 4;
};

const prioritizeByDistance = (
  suggestions: LocationSuggestion[],
  bias?: LocationBias,
  prioritizeNearest = false,
  query = ""
) => {
  const byTextPriority = [...suggestions].sort(
    (a, b) => getTextMatchPriority(a.label, query) - getTextMatchPriority(b.label, query)
  );

  if (!bias || bias.lat === undefined || bias.lon === undefined) {
    return byTextPriority;
  }

  const withDistance = byTextPriority.map((item) => ({
    ...item,
    distanceKm:
      item.distanceKm ??
      (item.lat !== undefined && item.lon !== undefined
        ? haversineDistanceKm(bias.lat!, bias.lon!, item.lat, item.lon)
        : undefined),
  }));

  if (!prioritizeNearest) {
    return withDistance;
  }

  return withDistance.sort((a, b) => {
    const textPriorityDiff = getTextMatchPriority(a.label, query) - getTextMatchPriority(b.label, query);
    if (textPriorityDiff !== 0) {
      return textPriorityDiff;
    }
    return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
  });
};

const prioritizeExactMatchFirst = (suggestions: LocationSuggestion[], query: string) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return suggestions;

  const exactIndex = suggestions.findIndex((item) => {
    const labelCore = item.label.split(",")[0]?.trim() ?? item.label;
    return normalizeSearchText(labelCore) === normalizedQuery;
  });

  if (exactIndex <= 0) return suggestions;

  const copy = [...suggestions];
  const [exact] = copy.splice(exactIndex, 1);
  copy.unshift(exact);
  return copy;
};

const calculateRouteBasedFare = (rideTypeId: string, distanceKm: number, fallbackFare: number) => {
  const rule = RIDE_FARE_RULES[rideTypeId];
  if (!rule || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return fallbackFare;
  }

  const computed = rule.base + distanceKm * rule.perKm;
  return Math.max(rule.minimum, Number(computed.toFixed(2)));
};

const parseEtaMinutes = (eta: string) => {
  const match = eta.match(/(\d+)\s*min/i);
  return match ? Number(match[1]) : null;
};

const calculateRouteBasedEta = (rideTypeId: string, distanceKm: number, fallbackEta: string) => {
  const rule = RIDE_ETA_RULES[rideTypeId];
  if (!rule || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return fallbackEta;
  }

  const computedMinutes = Math.max(
    rule.minimumMinutes,
    Math.round((distanceKm / rule.avgSpeedKmh) * 60 + rule.serviceDelayMin)
  );
  const fallbackMinutes = parseEtaMinutes(fallbackEta);
  const safeMinutes =
    fallbackMinutes !== null ? Math.max(Math.min(computedMinutes, 180), Math.max(2, fallbackMinutes - 10)) : computedMinutes;

  return `${safeMinutes} min`;
};

const getRideVisualMeta = (rideTypeId: string) => RIDE_VISUAL_META[rideTypeId] ?? DEFAULT_RIDE_VISUAL_META;

const getNearbyAvailabilityCount = (
  rideTypeId: string,
  availability: NearbyVehicleAvailability | null | undefined
) => {
  if (!availability) {
    return null;
  }

  if (rideTypeId === "moto") {
    return availability.bike;
  }

  if (rideTypeId === "auto") {
    return availability.auto;
  }

  return availability.car;
};

const formatRideAvailability = (
  rideTypeId: string,
  nearbyCount: number | null,
  options?: {
    hasLocation?: boolean;
    liveAvailabilityUnavailable?: boolean;
  }
) => {
  const visualMeta = getRideVisualMeta(rideTypeId);

  if (nearbyCount === null) {
    if (options?.liveAvailabilityUnavailable) {
      return "Live availability is unavailable right now";
    }

    return options?.hasLocation
      ? "Checking nearby availability..."
      : "Use current location to see nearby availability";
  }

  if (nearbyCount === 0) {
    return `No ${visualMeta.availabilityPlural} nearby right now`;
  }

  const vehicleLabel =
    nearbyCount === 1 ? visualMeta.availabilitySingular : visualMeta.availabilityPlural;
  return `${nearbyCount} ${vehicleLabel} near you`;
};

const useLocationSuggestions = (
  query: string,
  options?: { locationBias?: LocationBias | null; prioritizeNearest?: boolean }
) => {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const bias = options?.locationBias ?? null;

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setError("");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      setError("");

      let mergedResults: LocationSuggestion[] = [];

      try {
        mergedResults = await searchLocationSuggestions(normalized, controller.signal, bias ?? undefined);
      } catch (providerError) {
        if (isAbortError(providerError)) {
          return;
        }
      }

      if (
        mergedResults.length < DEFAULT_SUGGESTION_LIMIT &&
        bias?.countryCode &&
        bias.strictCountry
      ) {
        try {
          const countryOnlyFallback = await searchLocationSuggestions(normalized, controller.signal, {
            countryCode: bias.countryCode,
            strictCountry: true,
          });
          mergedResults = mergeUniqueSuggestions(mergedResults, countryOnlyFallback);
        } catch (providerError) {
          if (isAbortError(providerError)) {
            return;
          }
        }
      }

      if (mergedResults.length < DEFAULT_SUGGESTION_LIMIT) {
        try {
          const globalFallback = await searchLocationSuggestions(
            normalized,
            controller.signal,
            undefined,
            DEFAULT_SUGGESTION_LIMIT
          );
          mergedResults = mergeUniqueSuggestions(mergedResults, globalFallback);
        } catch (providerError) {
          if (isAbortError(providerError)) {
            return;
          }
        }
      }

      if (mergedResults.length < DEFAULT_SUGGESTION_LIMIT) {
        try {
          const wikipediaFallback = await searchWikipediaLocationSuggestions(
            normalized,
            controller.signal,
            DEFAULT_SUGGESTION_LIMIT
          );
          mergedResults = mergeUniqueSuggestions(mergedResults, wikipediaFallback);
        } catch (providerError) {
          if (isAbortError(providerError)) {
            return;
          }
        }
      }

      try {
        const wikipediaExact = await searchWikipediaExactTitleSuggestion(normalized, controller.signal);
        mergedResults = mergeUniqueSuggestions(wikipediaExact, mergedResults);
      } catch (providerError) {
        if (isAbortError(providerError)) {
          return;
        }
      }

      const ranked = prioritizeByDistance(
        mergedResults,
        bias ?? undefined,
        options?.prioritizeNearest ?? false,
        normalized
      );
      const exactFirst = prioritizeExactMatchFirst(ranked, normalized).slice(0, DEFAULT_SUGGESTION_LIMIT);

      if (controller.signal.aborted) {
        return;
      }

      setSuggestions(exactFirst);
      if (exactFirst.length === 0) {
        setError("");
      }
      setIsLoading(false);
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [query, bias, options?.prioritizeNearest]);

  return { suggestions, isLoading, error };
};

const RiderDashboardPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [stopInput, setStopInput] = useState("");
  const [stops, setStops] = useState<string[]>([]);
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromoFare, setAppliedPromoFare] = useState<number | null>(null);
  const [appliedPromoDiscount, setAppliedPromoDiscount] = useState(0);
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [selectedRide, setSelectedRide] = useState("");
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isPickupSuggestionsOpen, setIsPickupSuggestionsOpen] = useState(false);
  const [isDropoffSuggestionsOpen, setIsDropoffSuggestionsOpen] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationBias, setLocationBias] = useState<LocationBias | null>(null);
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const pickupContainerRef = useRef<HTMLDivElement | null>(null);
  const dropoffContainerRef = useRef<HTMLDivElement | null>(null);
  const localeCountryCode = useMemo(() => inferCountryCodeFromLocale(), []);

  const searchBias = useMemo<LocationBias | null>(() => {
    if (locationBias) {
      return locationBias;
    }
    if (localeCountryCode) {
      return { countryCode: localeCountryCode, strictCountry: false };
    }
    return null;
  }, [locationBias, localeCountryCode]);

  const pickupLookup = useLocationSuggestions(pickup, { locationBias: searchBias });
  const dropoffLookup = useLocationSuggestions(dropoff, {
    locationBias: searchBias,
    prioritizeNearest: true,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["rider", "dashboard"],
    queryFn: riderApi.getDashboard,
  });

  useEffect(() => {
    if (!data || isInitialized) return;
    setPickup(data.defaults.pickup ?? "");
    setDropoff(data.defaults.dropoff ?? "");
    setSelectedRide(data.selectedRideId || data.rideOptions[0]?.id || "");
    setIsInitialized(true);
  }, [data, isInitialized]);

  const createBookingMutation = useMutation({
    mutationFn: riderApi.createBooking,
    onSuccess: (booking) => {
      setActiveBookingId(booking.id);
      toast.success("Ride booked successfully");
      queryClient.invalidateQueries({ queryKey: ["rider", "history"] });
      queryClient.invalidateQueries({ queryKey: ["rider", "tracking"] });
      navigate("/rider/tracking");
    },
    onError: (mutationError) => {
      toast.error(toApiErrorMessage(mutationError, "Unable to create booking"));
    },
  });

  const cancelBookingMutation = useMutation({
    mutationFn: riderApi.cancelBooking,
    onSuccess: () => {
      setActiveBookingId(null);
      toast.success("Booking cancelled");
      queryClient.invalidateQueries({ queryKey: ["rider", "history"] });
    },
    onError: (mutationError) => {
      toast.error(toApiErrorMessage(mutationError, "Unable to cancel booking"));
    },
  });

  const applyPromoMutation = useMutation({
    mutationFn: riderApi.applyPromoCode,
    onSuccess: (quote) => {
      setAppliedPromoFare(quote.fare);
      setAppliedPromoDiscount(quote.promoDiscount);
      setAppliedPromoCode(quote.promoCode);
      toast.success("Promo code applied");
    },
    onError: (mutationError) => {
      setAppliedPromoFare(null);
      setAppliedPromoDiscount(0);
      setAppliedPromoCode(null);
      toast.error(toApiErrorMessage(mutationError, "Unable to apply promo code"));
    },
  });

  const selected = useMemo(
    () => data?.rideOptions.find((ride) => ride.id === selectedRide) ?? data?.rideOptions[0],
    [data?.rideOptions, selectedRide]
  );

  const straightLineDistanceKm = useMemo(() => {
    if (!(pickupCoords && dropoffCoords)) return null;
    return Number(haversineDistanceKm(pickupCoords.lat, pickupCoords.lon, dropoffCoords.lat, dropoffCoords.lon).toFixed(2));
  }, [dropoffCoords, pickupCoords]);

  const effectiveDistanceKm = routeDistanceKm ?? straightLineDistanceKm;
  const distanceLabel =
    effectiveDistanceKm !== null ? `${effectiveDistanceKm.toFixed(2)} km` : "Add pickup & dropoff";

  const riderReferenceLocation = useMemo(
    () =>
      locationBias?.lat !== undefined && locationBias?.lon !== undefined
        ? { lat: locationBias.lat, lon: locationBias.lon }
        : pickupCoords,
    [locationBias?.lat, locationBias?.lon, pickupCoords]
  );
  const hasReferenceLocation = Boolean(riderReferenceLocation);

  const nearbyAvailabilityQuery = useQuery({
    queryKey: [
      "rider",
      "availability",
      riderReferenceLocation?.lat ?? null,
      riderReferenceLocation?.lon ?? null,
    ],
    queryFn: () =>
      riderApi.getNearbyVehicleAvailability({
        lat: riderReferenceLocation!.lat,
        lng: riderReferenceLocation!.lon,
      }),
    enabled: hasReferenceLocation,
    refetchInterval: 10000,
    staleTime: 5000,
  });
  const liveAvailabilityUnavailable =
    hasReferenceLocation && Boolean(nearbyAvailabilityQuery.error);

  const nearbyAvailabilityByRideType = useMemo<Record<string, number | null>>(() => {
    const rideTypes = data?.rideOptions ?? [];
    if (!riderReferenceLocation) {
      return Object.fromEntries(rideTypes.map((ride) => [ride.id, null]));
    }

    return Object.fromEntries(
      rideTypes.map((ride) => [
        ride.id,
        getNearbyAvailabilityCount(ride.id, nearbyAvailabilityQuery.data),
      ])
    );
  }, [data?.rideOptions, nearbyAvailabilityQuery.data, riderReferenceLocation]);

  const baseEstimatedFare = useMemo(() => {
    if (!selected || effectiveDistanceKm === null) return null;
    return calculateRouteBasedFare(selected.id, effectiveDistanceKm, selected.fare);
  }, [effectiveDistanceKm, selected]);
  const estimatedFare =
    appliedPromoFare !== null && baseEstimatedFare !== null
      ? Math.max(0, Math.min(baseEstimatedFare, appliedPromoFare))
      : baseEstimatedFare;
  const selectedRideMeta = useMemo(
    () => (selected ? getRideVisualMeta(selected.id) : DEFAULT_RIDE_VISUAL_META),
    [selected]
  );
  const selectedRideNearbyCount =
    selected && selected.id in nearbyAvailabilityByRideType
      ? nearbyAvailabilityByRideType[selected.id]
      : null;
  const selectedRideAvailabilityLabel = selected
    ? formatRideAvailability(selected.id, selectedRideNearbyCount, {
        hasLocation: hasReferenceLocation,
        liveAvailabilityUnavailable,
      })
    : "Select a ride type to view nearby availability";
  const selectedRideEta = selected
    ? effectiveDistanceKm !== null
      ? calculateRouteBasedEta(selected.id, effectiveDistanceKm, selected.eta)
      : selected.eta
    : "Select a ride";
  const totalNearbyVehicles = useMemo(() => {
    if (!hasReferenceLocation || liveAvailabilityUnavailable) {
      return null;
    }
    if (!nearbyAvailabilityQuery.data) {
      return null;
    }
    return nearbyAvailabilityQuery.data.total;
  }, [hasReferenceLocation, liveAvailabilityUnavailable, nearbyAvailabilityQuery.data]);

  const currentMapLocation = useMemo(
    () =>
      locationBias?.lat !== undefined && locationBias?.lon !== undefined
        ? { lat: locationBias.lat, lon: locationBias.lon }
        : null,
    [locationBias?.lat, locationBias?.lon]
  );

  const bookingConfirmed = Boolean(activeBookingId);
  const isActionLoading = createBookingMutation.isPending || cancelBookingMutation.isPending;
  const stopsDependencyKey = useMemo(() => stops.join("|"), [stops]);

  useEffect(() => {
    setAppliedPromoFare(null);
    setAppliedPromoDiscount(0);
    setAppliedPromoCode(null);
  }, [pickup, dropoff, selectedRide, stopsDependencyKey]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (pickupContainerRef.current && !pickupContainerRef.current.contains(target)) {
        setIsPickupSuggestionsOpen(false);
      }
      if (dropoffContainerRef.current && !dropoffContainerRef.current.contains(target)) {
        setIsDropoffSuggestionsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!("permissions" in navigator) || !("geolocation" in navigator)) return;

    let isMounted = true;

    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (!isMounted || status.state !== "granted") return;

        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (!isMounted) return;

            setLocationBias((prev) => ({
              lat: position.coords.latitude,
              lon: position.coords.longitude,
              countryCode: prev?.countryCode ?? localeCountryCode,
              strictCountry: false,
            }));
          },
          () => {
            // Ignore silent bias failures.
          },
          {
            enableHighAccuracy: false,
            timeout: 4000,
            maximumAge: 120000,
          }
        );
      })
      .catch(() => {
        // Ignore unavailable permissions API.
      });

    return () => {
      isMounted = false;
    };
  }, [localeCountryCode]);

  const handleSelectPickup = (suggestion: LocationSuggestion) => {
    setPickup(suggestion.label);
    setPickupCoords(
      suggestion.lat !== undefined && suggestion.lon !== undefined
        ? { lat: suggestion.lat, lon: suggestion.lon }
        : null
    );
    setIsPickupSuggestionsOpen(false);
  };

  const handleSelectDropoff = (suggestion: LocationSuggestion) => {
    setDropoff(suggestion.label);
    setDropoffCoords(
      suggestion.lat !== undefined && suggestion.lon !== undefined
        ? { lat: suggestion.lat, lon: suggestion.lon }
        : null
    );
    setIsDropoffSuggestionsOpen(false);
  };

  const handleUseCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation is not supported in this browser");
      return;
    }

    setIsLocating(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        setLocationBias((prev) => ({
          lat,
          lon,
          countryCode: prev?.countryCode ?? localeCountryCode,
          strictCountry: false,
        }));

        try {
          const locationData = await reverseGeocode(lat, lon);

          setLocationBias({
            lat,
            lon,
            countryCode: locationData.countryCode || localeCountryCode,
            strictCountry: true,
          });

          setPickup(locationData.label);
          setPickupCoords({ lat, lon });
          setIsPickupSuggestionsOpen(false);
          toast.success("Current location added as pickup");
        } catch {
          setPickup(`${lat.toFixed(5)}, ${lon.toFixed(5)}`);
          setPickupCoords({ lat, lon });
          toast.error("Using coordinates because address lookup failed");
        } finally {
          setIsLocating(false);
        }
      },
      (geoError) => {
        setIsLocating(false);
        toast.error(getGeolocationErrorMessage(geoError));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  };

  const handleAddStop = () => {
    const stop = stopInput.trim();
    if (!stop) return;
    if (stops.length >= 4) {
      toast.error("Maximum 4 stops are supported");
      return;
    }
    if (stops.some((item) => item.toLowerCase() === stop.toLowerCase())) {
      toast.error("Stop already added");
      return;
    }
    setStops((current) => [...current, stop]);
    setStopInput("");
  };

  const handleRemoveStop = (stopToRemove: string) => {
    setStops((current) => current.filter((stop) => stop !== stopToRemove));
  };

  const handleApplyPromo = () => {
    if (!pickup.trim() || !dropoff.trim() || !selectedRide) {
      toast.error("Add pickup, dropoff, and ride type before applying promo");
      return;
    }
    if (!promoCode.trim()) {
      toast.error("Enter a promo code");
      return;
    }

    applyPromoMutation.mutate({
      pickup: pickup.trim(),
      destination: dropoff.trim(),
      rideTypeId: selectedRide,
      promoCode: promoCode.trim(),
      stops,
    });
  };

  const handleBookingAction = () => {
    if (bookingConfirmed && activeBookingId) {
      cancelBookingMutation.mutate(activeBookingId);
      return;
    }

    if (!pickup.trim() || !dropoff.trim() || !selectedRide) {
      toast.error("Please add pickup, dropoff, and ride type");
      return;
    }

    if (effectiveDistanceKm === null) {
      toast.error("Select pickup and dropoff from suggestions to calculate fare");
      return;
    }

    createBookingMutation.mutate({
      pickup: pickup.trim(),
      dropoff: dropoff.trim(),
      rideTypeId: selectedRide,
      distanceKm: effectiveDistanceKm,
      stops,
      promoCode: appliedPromoCode || undefined,
      pickupCoords,
      dropoffCoords,
    });
  };
  const SelectedRideIcon = selectedRideMeta.icon;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-80 rounded-3xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {toApiErrorMessage(error, "Failed to load rider dashboard")}
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
        <div className="relative isolate rounded-3xl border border-border bg-card overflow-hidden h-[290px] md:h-[360px] shadow-[0_22px_50px_-40px_hsl(var(--foreground)/0.35)]">
          <div className="absolute inset-0">
            <RiderMap
              currentLocation={currentMapLocation}
              pickup={pickupCoords}
              dropoff={dropoffCoords}
              onRouteDistanceChange={setRouteDistanceKm}
            />
          </div>
          <div className="absolute top-4 left-4 inline-flex items-center gap-2 rounded-xl border border-border bg-background/90 px-3 py-2 backdrop-blur-sm">
            <Navigation size={14} className="text-primary" />
            <span className="text-xs text-muted-foreground">Live taxi map</span>
          </div>
          <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-border bg-background/90 px-3 py-2 backdrop-blur-sm flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <MapPin size={12} /> Route distance
            </span>
            <span className="text-xs font-medium text-primary">{distanceLabel}</span>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-4 md:p-5 shadow-[0_24px_56px_-44px_hsl(var(--foreground)/0.4)] space-y-4">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Ride Now</p>
            <h2 className="text-2xl font-display font-semibold leading-tight">
              Fast booking with nearby taxi types
            </h2>
            <p className="text-sm text-muted-foreground">
              Pick your taxi category and book from what is available near your location.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-border bg-secondary/60 p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-[0.14em]">Selected Type</p>
              <p className="mt-1 inline-flex items-center gap-2 text-sm font-semibold">
                <SelectedRideIcon size={15} className="text-primary" />
                {selected?.label ?? "Choose ride"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">{selectedRideEta}</p>
            </div>
            <div className="rounded-2xl border border-border bg-secondary/60 p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-[0.14em]">Nearby Now</p>
              <p className="mt-1 text-sm font-semibold">
                {selectedRideNearbyCount === null ? "--" : selectedRideNearbyCount}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                {selectedRideAvailabilityLabel}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-muted-foreground">Pickup</label>
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={isLocating}
                className="text-xs font-medium text-primary inline-flex items-center gap-1.5 hover:text-primary/80 transition-colors disabled:opacity-70 disabled:pointer-events-none"
              >
                <LocateFixed size={12} />
                {isLocating ? "Locating..." : "Use current location"}
              </button>
            </div>
            <div ref={pickupContainerRef} className="relative">
              <input
                value={pickup}
                onChange={(event) => {
                  setPickup(event.target.value);
                  setPickupCoords(null);
                }}
                onFocus={() => setIsPickupSuggestionsOpen(true)}
                placeholder="Enter pickup location"
                className="h-12 w-full rounded-xl border border-border bg-secondary px-4 text-sm outline-none focus:border-primary transition-colors"
              />
              {isPickupSuggestionsOpen && (
                <div className="absolute top-[calc(100%+0.375rem)] left-0 right-0 z-30 rounded-xl border border-border bg-card shadow-[0_14px_30px_-20px_hsl(var(--foreground)/0.45)] max-h-56 overflow-auto">
                  {pickup.trim().length < MIN_QUERY_LENGTH ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      Type at least {MIN_QUERY_LENGTH} characters
                    </p>
                  ) : pickupLookup.isLoading ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Searching locations...</p>
                  ) : pickupLookup.error ? (
                    <p className="px-3 py-2 text-xs text-destructive">{pickupLookup.error}</p>
                  ) : pickupLookup.suggestions.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No matching locations found</p>
                  ) : (
                    pickupLookup.suggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => handleSelectPickup(suggestion)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-secondary transition-colors"
                      >
                        {suggestion.label}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <label className="text-xs text-muted-foreground">Dropoff</label>
            <div ref={dropoffContainerRef} className="relative">
              <input
                value={dropoff}
                onChange={(event) => {
                  setDropoff(event.target.value);
                  setDropoffCoords(null);
                }}
                onFocus={() => setIsDropoffSuggestionsOpen(true)}
                placeholder="Where are you going?"
                className="h-12 w-full rounded-xl border border-border bg-secondary px-4 text-sm outline-none focus:border-primary transition-colors"
              />
              {isDropoffSuggestionsOpen && (
                <div className="absolute top-[calc(100%+0.375rem)] left-0 right-0 z-20 rounded-xl border border-border bg-card shadow-[0_14px_30px_-20px_hsl(var(--foreground)/0.45)] max-h-56 overflow-auto">
                  {dropoff.trim().length < MIN_QUERY_LENGTH ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      Type at least {MIN_QUERY_LENGTH} characters
                    </p>
                  ) : dropoffLookup.isLoading ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Searching locations...</p>
                  ) : dropoffLookup.error ? (
                    <p className="px-3 py-2 text-xs text-destructive">{dropoffLookup.error}</p>
                  ) : dropoffLookup.suggestions.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No matching locations found</p>
                  ) : (
                    dropoffLookup.suggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => handleSelectDropoff(suggestion)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-secondary transition-colors flex items-start justify-between gap-3"
                      >
                        <span className="min-w-0">{suggestion.label}</span>
                        {suggestion.distanceKm !== undefined && (
                          <span className="shrink-0 text-[11px] text-muted-foreground mt-0.5">
                            {suggestion.distanceKm < 1
                              ? `${Math.round(suggestion.distanceKm * 1000)} m`
                              : `${suggestion.distanceKm.toFixed(1)} km`}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <label className="text-xs text-muted-foreground">Stops (Optional)</label>
            <div className="flex items-center gap-2">
              <input
                value={stopInput}
                onChange={(event) => setStopInput(event.target.value)}
                placeholder="Add a stop"
                className="h-11 w-full rounded-xl border border-border bg-secondary px-4 text-sm outline-none focus:border-primary transition-colors"
              />
              <button
                type="button"
                onClick={handleAddStop}
                className="h-11 px-3 rounded-xl border border-border bg-secondary text-sm inline-flex items-center justify-center hover:bg-muted transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>
            {stops.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {stops.map((stop) => (
                  <span
                    key={stop}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs"
                  >
                    {stop}
                    <button
                      type="button"
                      onClick={() => handleRemoveStop(stop)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${stop}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <label className="text-xs text-muted-foreground">Promo Code (Optional)</label>
            <div className="flex items-center gap-2">
              <input
                value={promoCode}
                onChange={(event) => {
                  const value = event.target.value.toUpperCase();
                  setPromoCode(value);
                  if (appliedPromoCode && appliedPromoCode !== value.trim()) {
                    setAppliedPromoFare(null);
                    setAppliedPromoDiscount(0);
                    setAppliedPromoCode(null);
                  }
                }}
                placeholder="Enter promo code"
                className="h-11 w-full rounded-xl border border-border bg-secondary px-4 text-sm outline-none focus:border-primary transition-colors"
              />
              <button
                type="button"
                onClick={handleApplyPromo}
                disabled={applyPromoMutation.isPending}
                className="h-11 px-4 rounded-xl border border-border bg-secondary text-xs font-medium hover:bg-muted transition-colors disabled:opacity-70 disabled:pointer-events-none"
              >
                {applyPromoMutation.isPending ? "Applying..." : "Apply"}
              </button>
            </div>
            {appliedPromoCode && appliedPromoDiscount > 0 && (
              <p className="text-xs text-primary">
                {appliedPromoCode} applied. You saved Rs. {appliedPromoDiscount.toFixed(0)}.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-4 md:p-5 shadow-[0_24px_56px_-44px_hsl(var(--foreground)/0.4)] space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-display font-semibold">Taxi categories near you</h3>
            <p className="text-sm text-muted-foreground">
              Switch between available bike, auto, sedan, SUV, and premium rides.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-secondary/60 px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Total Nearby</p>
            <p className="text-sm font-semibold">
              {!hasReferenceLocation
                ? "Enable location"
                : liveAvailabilityUnavailable
                  ? "Unavailable"
                  : totalNearbyVehicles === null
                    ? "Checking..."
                    : `${totalNearbyVehicles} vehicles`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {data.rideOptions.map((ride) => {
            const rideMeta = getRideVisualMeta(ride.id);
            const RideIcon = rideMeta.icon;
            const liveEta =
              effectiveDistanceKm !== null
                ? calculateRouteBasedEta(ride.id, effectiveDistanceKm, ride.eta)
                : ride.eta;
            const nearbyCount = nearbyAvailabilityByRideType[ride.id];
            const availabilityLabel = formatRideAvailability(ride.id, nearbyCount, {
              hasLocation: hasReferenceLocation,
              liveAvailabilityUnavailable,
            });
            const previewFare =
              effectiveDistanceKm !== null
                ? calculateRouteBasedFare(ride.id, effectiveDistanceKm, ride.fare)
                : ride.fare;

            return (
              <button
                key={ride.id}
                type="button"
                onClick={() => setSelectedRide(ride.id)}
                className={cn(
                  "rounded-2xl border p-3 text-left transition-[transform,background-color,color,border-color] duration-250 ease-smooth hover:-translate-y-[1px]",
                  ride.id === selectedRide
                    ? "border-primary bg-primary/12"
                    : "border-border bg-background hover:bg-secondary"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={cn(
                      "h-10 w-10 rounded-xl inline-flex items-center justify-center",
                      ride.id === selectedRide ? "bg-primary text-primary-foreground" : "bg-secondary text-primary"
                    )}
                  >
                    <RideIcon size={18} />
                  </div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {rideMeta.seatsLabel}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold">{ride.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{rideMeta.description}</p>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 size={12} /> {liveEta}
                  </span>
                  <span className="font-medium text-foreground">
                    Rs. {Number(previewFare).toFixed(0)}
                  </span>
                </div>
                <p
                  className={cn(
                    "text-[11px] mt-2",
                    nearbyCount && nearbyCount > 0 ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {availabilityLabel}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-4 md:p-5 shadow-[0_24px_56px_-44px_hsl(var(--foreground)/0.4)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-[0.14em]">Estimated Fare</p>
          {estimatedFare !== null ? (
            <div>
              <p className="text-2xl font-display font-bold">
                <AnimatedCounter value={estimatedFare} prefix="Rs. " decimals={2} />
              </p>
              {appliedPromoDiscount > 0 && baseEstimatedFare !== null && (
                <p className="text-xs text-muted-foreground mt-1">
                  Base: Rs. {baseEstimatedFare.toFixed(2)} | Discount: Rs. {appliedPromoDiscount.toFixed(2)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm font-medium text-muted-foreground mt-1">
              Add pickup and dropoff to see fare
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">Route distance: {distanceLabel}</p>
        </div>
        <MagneticButton
          type="button"
          onClick={handleBookingAction}
          loading={isActionLoading}
          className="h-12 px-8 text-base"
        >
          {bookingConfirmed ? "Cancel Booking" : "Confirm Ride"}
        </MagneticButton>
      </div>
    </motion.section>
  );
};

export default RiderDashboardPage;
