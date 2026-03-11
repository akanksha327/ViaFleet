import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Clock3, MapPin, Phone, MessageCircle, ShieldAlert } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { driverApi, toApiErrorMessage } from "@/lib/api";
import { toast } from "@/components/ui/sonner";

const DriverActiveRidePage = () => {
  const queryClient = useQueryClient();
  const [eta, setEta] = useState(0);
  const [rideOtp, setRideOtp] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["driver", "active-ride"],
    queryFn: driverApi.getActiveRide,
    refetchInterval: 3000,
  });

  const startRideMutation = useMutation({
    mutationFn: driverApi.startRide,
    onSuccess: () => {
      toast.success("Ride started. Rider picked up.");
      queryClient.invalidateQueries({ queryKey: ["driver", "active-ride"] });
      queryClient.invalidateQueries({ queryKey: ["driver", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["rider", "tracking"] });
    },
    onError: (mutationError) => {
      toast.error(toApiErrorMessage(mutationError, "Unable to start ride"));
    },
  });

  const completeRideMutation = useMutation({
    mutationFn: driverApi.completeRide,
    onSuccess: () => {
      toast.success("Ride completed");
      queryClient.invalidateQueries({ queryKey: ["driver", "active-ride"] });
      queryClient.invalidateQueries({ queryKey: ["driver", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["driver", "history"] });
      queryClient.invalidateQueries({ queryKey: ["rider", "tracking"] });
      queryClient.invalidateQueries({ queryKey: ["rider", "history"] });
    },
    onError: (mutationError) => {
      toast.error(toApiErrorMessage(mutationError, "Unable to complete ride"));
    },
  });

  const cancelRideMutation = useMutation({
    mutationFn: driverApi.cancelRide,
    onSuccess: () => {
      toast.success("Ride cancelled");
      queryClient.invalidateQueries({ queryKey: ["driver", "active-ride"] });
      queryClient.invalidateQueries({ queryKey: ["driver", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["driver", "history"] });
      queryClient.invalidateQueries({ queryKey: ["rider", "tracking"] });
      queryClient.invalidateQueries({ queryKey: ["rider", "history"] });
    },
    onError: (mutationError) => {
      toast.error(toApiErrorMessage(mutationError, "Unable to cancel ride"));
    },
  });

  useEffect(() => {
    if (!data) return;
    setEta(data.etaSeconds);
    if (data.rideStatus !== "accepted") {
      setRideOtp("");
    }
  }, [data]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEta((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (isLoading) {
    return <Skeleton className="h-[420px] rounded-xl" />;
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {toApiErrorMessage(error, "Failed to load active ride")}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        No active ride is assigned right now.
      </div>
    );
  }

  const sanitizedOtp = rideOtp.replace(/\D/g, "").slice(0, 6);

  const handleStartRide = () => {
    if (sanitizedOtp.length !== 6) {
      toast.error("Enter the 6-digit rider OTP before starting the ride");
      return;
    }

    startRideMutation.mutate({
      rideId: data.id,
      otp: sanitizedOtp,
    });
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-4"
    >
      <header>
        <h1 className="text-2xl font-display font-semibold">Active Ride</h1>
        <p className="text-sm text-muted-foreground mt-1">High-priority ride execution panel.</p>
      </header>

      <div className="rounded-xl border border-border bg-card p-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-xl border border-border bg-secondary min-h-[280px] relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_25%,hsl(var(--primary)/0.16),transparent_45%),radial-gradient(circle_at_70%_75%,hsl(var(--primary)/0.1),transparent_45%)]" />
          <div className="absolute top-3 left-3 rounded-md border border-border bg-background/85 px-2.5 py-1 text-xs text-muted-foreground">
            Route monitoring
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-lg border border-border bg-secondary p-3">
            <p className="text-xs text-muted-foreground">Passenger</p>
            <p className="font-semibold text-sm mt-1">{data.passenger}</p>
            <p className="text-xs text-muted-foreground mt-1">Customer ID {data.customerId}</p>
            <p className="text-xs text-muted-foreground mt-1">Ride ID {data.id}</p>
          </div>
          <div className="rounded-lg border border-border bg-secondary p-3 space-y-2 text-xs text-muted-foreground">
            <p className="inline-flex items-center gap-1.5">
              <MapPin size={12} /> Pickup: {data.pickup}
            </p>
            <p className="inline-flex items-center gap-1.5">
              <MapPin size={12} /> Dropoff: {data.dropoff}
            </p>
            <p className="inline-flex items-center gap-1.5">
              <Clock3 size={12} /> {data.rideStatus === "accepted" ? "ETA to pickup" : "ETA to dropoff"}:{" "}
              {Math.floor(eta / 60)}m {String(eta % 60).padStart(2, "0")}s
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="h-10 rounded-lg border border-border bg-secondary text-sm font-medium inline-flex items-center justify-center gap-1.5 hover:bg-muted transition-colors">
              <Phone size={14} /> Call
            </button>
            <button className="h-10 rounded-lg border border-border bg-secondary text-sm font-medium inline-flex items-center justify-center gap-1.5 hover:bg-muted transition-colors">
              <MessageCircle size={14} /> Chat
            </button>
          </div>
          <button className="h-10 w-full rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm font-medium inline-flex items-center justify-center gap-1.5 hover:bg-destructive/15 transition-colors">
            <ShieldAlert size={14} /> Safety Assistance
          </button>
          {data.rideStatus === "accepted" ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Verify Rider OTP
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ask the rider for the 6-digit OTP shown in their app before pickup.
                </p>
                <input
                  value={rideOtp}
                  onChange={(event) => setRideOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="Enter OTP"
                  className="mt-3 h-11 w-full rounded-lg border border-border bg-background px-4 text-center font-mono text-lg tracking-[0.28em] outline-none transition-colors focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleStartRide}
                disabled={
                  startRideMutation.isPending ||
                  cancelRideMutation.isPending ||
                  sanitizedOtp.length !== 6
                }
                className="h-10 rounded-lg border border-primary bg-primary text-primary-foreground text-sm font-semibold transition-[transform,filter] duration-180 ease-smooth hover:brightness-95 hover:-translate-y-0.5 disabled:opacity-70 disabled:pointer-events-none"
              >
                {startRideMutation.isPending ? "Verifying..." : "Verify & Start"}
              </button>
              <button
                type="button"
                onClick={() => cancelRideMutation.mutate(data.id)}
                disabled={!data.canCancel || cancelRideMutation.isPending || startRideMutation.isPending}
                className="h-10 rounded-lg border border-destructive/45 bg-destructive/10 text-destructive text-sm font-semibold transition-colors hover:bg-destructive/15 disabled:opacity-70 disabled:pointer-events-none"
              >
                {cancelRideMutation.isPending ? "Cancelling..." : "Cancel Ride"}
              </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => completeRideMutation.mutate(data.id)}
              disabled={completeRideMutation.isPending}
              className="h-10 w-full rounded-lg border border-primary bg-primary text-primary-foreground text-sm font-semibold transition-[transform,filter] duration-180 ease-smooth hover:brightness-95 hover:-translate-y-0.5 disabled:opacity-70 disabled:pointer-events-none"
            >
              {completeRideMutation.isPending ? "Completing..." : "Complete Ride"}
            </button>
          )}
        </aside>
      </div>
    </motion.section>
  );
};

export default DriverActiveRidePage;
