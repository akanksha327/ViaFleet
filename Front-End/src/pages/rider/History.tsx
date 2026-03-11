import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Clock3, FileDown, MapPin } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { riderApi, toApiErrorMessage } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";

const tabs = ["All", "Completed", "Cancelled"] as const;

const RiderHistoryPage = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);
  const [processingPaymentRideId, setProcessingPaymentRideId] = useState<string | null>(null);
  const [handledPaymentKey, setHandledPaymentKey] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["rider", "history"],
    queryFn: riderApi.getHistory,
    refetchInterval: 7000,
  });

  const createPaymentSessionMutation = useMutation({
    mutationFn: riderApi.createPaymentSession,
    onSuccess: (session) => {
      if (session.alreadyPaid || session.paymentStatus === "paid") {
        toast.success("Payment already completed for this ride.");
        void queryClient.invalidateQueries({ queryKey: ["rider", "history"] });
        setProcessingPaymentRideId(null);
        return;
      }

      if (!session.checkoutUrl) {
        toast.error("Unable to open Stripe checkout");
        setProcessingPaymentRideId(null);
        return;
      }

      window.location.assign(session.checkoutUrl);
    },
    onError: (mutationError) => {
      toast.error(toApiErrorMessage(mutationError, "Unable to start Stripe checkout"));
      setProcessingPaymentRideId(null);
    },
  });

  useEffect(() => {
    const paymentState = searchParams.get("payment");
    if (!paymentState) {
      return;
    }

    const rideId = searchParams.get("rideId") || "";
    const sessionId = searchParams.get("session_id") || "";
    const key = `${paymentState}|${rideId}|${sessionId}`;
    if (key === handledPaymentKey) {
      return;
    }
    setHandledPaymentKey(key);

    const clearPaymentParams = () => {
      const next = new URLSearchParams(searchParams);
      next.delete("payment");
      next.delete("rideId");
      next.delete("session_id");
      setSearchParams(next, { replace: true });
    };

    if (paymentState === "cancelled") {
      toast.message("Stripe payment was cancelled.");
      clearPaymentParams();
      return;
    }

    if (paymentState !== "success") {
      clearPaymentParams();
      return;
    }

    if (!rideId || !sessionId) {
      toast.error("Missing Stripe payment confirmation details.");
      clearPaymentParams();
      return;
    }

    setProcessingPaymentRideId(rideId);

    void riderApi
      .confirmPayment({ rideId, sessionId })
      .then((payment) => {
        if (payment.paymentStatus === "paid") {
          toast.success("Payment completed successfully.");
        } else {
          toast.message("Payment is still pending. Please refresh in a few moments.");
        }
      })
      .catch((mutationError) => {
        toast.error(toApiErrorMessage(mutationError, "Unable to confirm Stripe payment"));
      })
      .finally(() => {
        setProcessingPaymentRideId(null);
        clearPaymentParams();
        void queryClient.invalidateQueries({ queryKey: ["rider", "history"] });
      });
  }, [searchParams, setSearchParams, handledPaymentKey, queryClient]);

  const filteredRides = useMemo(() => {
    const rides = data ?? [];
    if (activeTab === "All") return rides;
    if (activeTab === "Cancelled") {
      return rides.filter((ride) => ride.status === "Cancelled" || ride.status === "Failed");
    }
    return rides.filter((ride) => ride.status === activeTab);
  }, [activeTab, data]);

  const handleDownloadReceipt = async (rideId: string) => {
    try {
      setDownloadingReceiptId(rideId);
      const receipt = await riderApi.getReceipt(rideId);
      const receiptText = [
        `ViaFleet Receipt #${receipt.receiptNo}`,
        `Issued: ${new Date(receipt.issuedAt).toLocaleString()}`,
        `Ride Date: ${new Date(receipt.rideDate).toLocaleString()}`,
        "",
        `Rider: ${receipt.rider.name} (${receipt.rider.phone})`,
        `Driver: ${receipt.captain.name} (${receipt.captain.vehicleNo})`,
        "",
        `Pickup: ${receipt.pickup}`,
        ...(receipt.stops.length > 0 ? [`Stops: ${receipt.stops.join(" -> ")}`] : []),
        `Destination: ${receipt.destination}`,
        "",
        `Fare Before Discount: Rs. ${receipt.fareBeforeDiscount.toFixed(2)}`,
        `Promo: ${receipt.promoCode || "N/A"}`,
        `Discount: Rs. ${receipt.promoDiscount.toFixed(2)}`,
        `Total Fare: Rs. ${receipt.totalFare.toFixed(2)}`,
        `Payment: ${receipt.paymentMethod} (${receipt.paymentStatus})`,
      ].join("\n");

      const blob = new Blob([receiptText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `receipt-${receipt.receiptNo}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Receipt downloaded");
    } catch (error) {
      toast.error(toApiErrorMessage(error, "Unable to download receipt"));
    } finally {
      setDownloadingReceiptId(null);
    }
  };

  const handlePayWithStripe = (rideId: string) => {
    if (processingPaymentRideId || createPaymentSessionMutation.isPending) {
      return;
    }

    setProcessingPaymentRideId(rideId);
    createPaymentSessionMutation.mutate(rideId);
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-4"
    >
      <header>
        <h1 className="text-2xl font-display font-semibold">Ride History</h1>
        <p className="text-sm text-muted-foreground mt-1">Review recent bookings and ride details.</p>
      </header>

      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border bg-card p-1">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "h-10 rounded-xl text-sm font-medium transition-colors",
              activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      )}

      {isError && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {toApiErrorMessage(error, "Failed to load ride history")}
        </div>
      )}

      {!isLoading && !isError && filteredRides.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          No rides found for this filter.
        </div>
      )}

      <div className="space-y-3">
        {filteredRides.map((ride, index) => {
          const isOpen = expanded === ride.id;
          return (
            <motion.article
              key={ride.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-2xl border border-border bg-card p-4 shadow-[0_12px_30px_-28px_hsl(var(--foreground)/0.55)]"
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : ride.id)}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {ride.from} to {ride.to}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{ride.date}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs px-2 py-1 rounded-md",
                        ride.status === "Completed"
                          ? "bg-primary/12 text-primary"
                          : ride.status === "Cancelled" || ride.status === "Failed"
                            ? "bg-destructive/12 text-destructive"
                            : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {ride.status}
                    </span>
                    <ChevronDown
                      size={16}
                      className={cn("text-muted-foreground transition-transform", isOpen && "rotate-180")}
                    />
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="mt-3 pt-3 border-t border-border space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                      <Clock3 size={13} /> Duration: <span className="text-foreground">{ride.duration}</span>
                    </p>
                    <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                      <MapPin size={13} /> Fare:{" "}
                      <span className="text-foreground font-semibold">Rs. {ride.fare.toFixed(2)}</span>
                    </p>
                  </div>
                  {ride.stops.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Stops: <span className="text-foreground">{ride.stops.join(" -> ")}</span>
                    </p>
                  )}
                  {ride.promoCode && ride.promoDiscount > 0 && (
                    <p className="text-xs text-primary">
                      Promo {ride.promoCode} applied. Saved Rs. {ride.promoDiscount.toFixed(2)}.
                    </p>
                  )}
                  {ride.ratingScore !== null && (
                    <p className="text-xs text-muted-foreground">
                      Your rating: <span className="text-foreground">{ride.ratingScore}/5</span>
                    </p>
                  )}
                  {ride.status === "Completed" && (
                    <p className="text-xs text-muted-foreground">
                      Payment:{" "}
                      <span
                        className={cn(
                          "font-medium",
                          ride.paymentStatus === "paid"
                            ? "text-primary"
                            : ride.paymentStatus === "failed"
                              ? "text-destructive"
                              : "text-foreground"
                        )}
                      >
                        {ride.paymentStatus.toUpperCase()}
                      </span>
                    </p>
                  )}
                  {ride.canPay && (
                    <button
                      type="button"
                      onClick={() => handlePayWithStripe(ride.id)}
                      disabled={processingPaymentRideId === ride.id}
                      className="h-9 rounded-lg border border-primary bg-primary px-3 text-xs text-primary-foreground inline-flex items-center gap-1.5 hover:brightness-95 transition-[filter] disabled:opacity-70 disabled:pointer-events-none"
                    >
                      {processingPaymentRideId === ride.id ? "Opening Stripe..." : "Pay with Stripe"}
                    </button>
                  )}
                  {ride.hasReceipt && (
                    <button
                      type="button"
                      onClick={() => handleDownloadReceipt(ride.id)}
                      disabled={downloadingReceiptId === ride.id}
                      className="h-9 rounded-lg border border-border bg-secondary px-3 text-xs inline-flex items-center gap-1.5 hover:bg-muted transition-colors disabled:opacity-70 disabled:pointer-events-none"
                    >
                      <FileDown size={13} />
                      {downloadingReceiptId === ride.id ? "Preparing receipt..." : "Download Receipt"}
                    </button>
                  )}
                </div>
              )}
            </motion.article>
          );
        })}
      </div>
    </motion.section>
  );
};

export default RiderHistoryPage;
