import { motion } from "framer-motion";
import { Clock3, MapPin, Star } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import AnimatedCounter from "@/components/ui/AnimatedCounter";
import { driverApi, toApiErrorMessage } from "@/lib/api";
import { toast } from "@/components/ui/sonner";

const DriverDashboardPage = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["driver", "dashboard"],
    queryFn: driverApi.getDashboard,
    refetchInterval: 1500,
  });

  const acceptMutation = useMutation({
    mutationFn: driverApi.acceptRequest,
    onSuccess: () => {
      toast.success("Ride accepted");
      queryClient.invalidateQueries({ queryKey: ["driver", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["driver", "active-ride"] });
    },
    onError: (mutationError) => {
      toast.error(toApiErrorMessage(mutationError, "Unable to accept request"));
    },
  });

  const declineMutation = useMutation({
    mutationFn: driverApi.declineRequest,
    onSuccess: () => {
      toast.success("Ride declined");
      queryClient.invalidateQueries({ queryKey: ["driver", "dashboard"] });
    },
    onError: (mutationError) => {
      toast.error(toApiErrorMessage(mutationError, "Unable to decline request"));
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {toApiErrorMessage(error, "Failed to load driver dashboard")}
      </div>
    );
  }

  const isActionLoading = acceptMutation.isPending || declineMutation.isPending;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="rounded-[1.5rem] border border-border bg-card/90 p-4 shadow-[0_22px_44px_-34px_hsl(var(--foreground)/0.45)]">
          <p className="text-xs text-muted-foreground">Today Earnings</p>
          <p className="text-2xl font-display font-bold mt-1">
            <AnimatedCounter value={data.todayEarnings} prefix="Rs. " decimals={2} />
          </p>
        </div>
        <div className="rounded-[1.5rem] border border-border bg-card/90 p-4 shadow-[0_22px_44px_-34px_hsl(var(--foreground)/0.45)]">
          <p className="text-xs text-muted-foreground">Available Requests</p>
          <p className="text-2xl font-display font-bold mt-1">{data.requests.length}</p>
        </div>
        <div className="rounded-[1.5rem] border border-border bg-card/90 p-4 shadow-[0_22px_44px_-34px_hsl(var(--foreground)/0.45)]">
          <p className="text-xs text-muted-foreground">Online Time</p>
          <p className="text-2xl font-display font-bold mt-1">{data.onlineTime}</p>
        </div>
      </div>

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold">Dispatch Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">Review requests, compare fares, and respond fast.</p>
        </div>
      </header>

      {data.locationMessage ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {data.locationMessage}
        </div>
      ) : data.requests.length === 0 ? (
        <div className="rounded-[1.5rem] border border-border bg-card/90 p-4 text-sm text-muted-foreground">
          No ride requests available at the moment.
        </div>
      ) : (
        <div className="space-y-3">
          {data.requests.map((request, index) => (
            <motion.article
              key={request.id}
              initial={{ opacity: 0, x: 26 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.24, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-[1.5rem] border border-border bg-card/92 p-4 shadow-[0_24px_48px_-36px_hsl(var(--foreground)/0.45)]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{request.passenger}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Customer ID: {request.customerId}</p>
                  <p className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1.5">
                    <Star size={12} /> {request.rating} | {request.distance}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-display font-bold text-foreground">Rs. {request.fare.toFixed(2)}</p>
                  <span
                    className={`text-[10px] px-2 py-1 rounded-md ${
                      request.status === "Priority"
                        ? "border border-border bg-secondary text-foreground"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {request.status}
                  </span>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-border bg-secondary/70 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p className="inline-flex items-center gap-1.5">
                  <MapPin size={12} /> {request.pickup}
                </p>
                <p className="inline-flex items-center gap-1.5">
                  <MapPin size={12} /> {request.dropoff}
                </p>
                <p className="inline-flex items-center gap-1.5">
                  <Clock3 size={12} /> Pickup ETA: {Math.floor(request.pickupEtaSeconds / 60)}m{" "}
                  {String(request.pickupEtaSeconds % 60).padStart(2, "0")}s
                </p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isActionLoading}
                  onClick={() => acceptMutation.mutate(request.id)}
                  className="h-10 rounded-2xl border border-border bg-primary text-primary-foreground text-sm font-semibold transition-[transform,filter] duration-180 ease-smooth hover:brightness-95 hover:-translate-y-0.5 disabled:opacity-70 disabled:pointer-events-none"
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={isActionLoading}
                  onClick={() => declineMutation.mutate(request.id)}
                  className="h-10 rounded-2xl border border-border bg-secondary/75 text-sm font-semibold transition-[transform,border-color,color] duration-180 ease-smooth hover:-translate-y-0.5 hover:border-destructive/55 hover:text-destructive disabled:opacity-70 disabled:pointer-events-none"
                >
                  Decline
                </button>
              </div>
            </motion.article>
          ))}
        </div>
      )}
    </motion.section>
  );
};

export default DriverDashboardPage;
