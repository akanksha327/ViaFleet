import { useEffect, useMemo, useState } from "react";
import { Camera, CreditCard, Plus, ChevronRight, Bell, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { riderApi, toApiErrorMessage } from "@/lib/api";
import { getSessionUser } from "@/lib/session";
import { Skeleton } from "@/components/ui/skeleton";

const stripePaymentLink = import.meta.env.VITE_STRIPE_PAYMENT_LINK?.trim();

const RiderProfilePage = () => {
  const queryClient = useQueryClient();
  const [notifications, setNotifications] = useState(true);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportPriority, setSupportPriority] = useState<"low" | "medium" | "high">("medium");
  const { resolvedTheme, setTheme } = useTheme();
  const isDarkMode = resolvedTheme !== "light";
  const sessionUser = getSessionUser();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["rider", "profile"],
    queryFn: riderApi.getProfile,
  });

  const { data: supportTickets = [], isLoading: isSupportLoading } = useQuery({
    queryKey: ["rider", "support-tickets"],
    queryFn: riderApi.getSupportTickets,
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!data) return;
    setNotifications(data.notifications);
  }, [data]);

  const updateProfileMutation = useMutation({
    mutationFn: riderApi.updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rider", "profile"] });
    },
    onError: (mutationError) => {
      toast.error(toApiErrorMessage(mutationError, "Failed to update profile settings"));
    },
  });

  const createSupportTicketMutation = useMutation({
    mutationFn: riderApi.createSupportTicket,
    onSuccess: () => {
      setSupportSubject("");
      setSupportMessage("");
      setSupportPriority("medium");
      toast.success("Support ticket submitted");
      queryClient.invalidateQueries({ queryKey: ["rider", "support-tickets"] });
    },
    onError: (mutationError) => {
      toast.error(toApiErrorMessage(mutationError, "Unable to submit support ticket"));
    },
  });

  const initials = useMemo(() => {
    const source = sessionUser?.name || "Rider";
    return source
      .split(" ")
      .map((word) => word[0]?.toUpperCase())
      .join("")
      .slice(0, 2);
  }, [sessionUser?.name]);

  const handleNotificationsToggle = (checked: boolean) => {
    setNotifications(checked);
    updateProfileMutation.mutate({ notifications: checked });
  };

  const handleDarkModeToggle = (checked: boolean) => {
    setTheme(checked ? "dark" : "light");
    updateProfileMutation.mutate({ darkMode: checked });
  };

  const openStripeLink = () => {
    if (!stripePaymentLink) {
      toast.error("Stripe payment link is not configured", {
        description: "Add VITE_STRIPE_PAYMENT_LINK to your .env file.",
      });
      return;
    }
    window.open(stripePaymentLink, "_blank", "noopener,noreferrer");
  };

  const handleSupportSubmit = () => {
    const subject = supportSubject.trim();
    const message = supportMessage.trim();

    if (!subject || !message) {
      toast.error("Add subject and message for support ticket");
      return;
    }

    createSupportTicketMutation.mutate({
      subject,
      message,
      priority: supportPriority,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-36 rounded-3xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {toApiErrorMessage(error, "Failed to load rider profile")}
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-4 max-w-2xl"
    >
      <header>
        <h1 className="text-2xl font-display font-semibold">Rider Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your personal settings and payments.</p>
      </header>

      <div className="rounded-3xl border border-border bg-card p-5 flex items-center gap-4">
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-secondary border border-border flex items-center justify-center text-lg font-semibold">
            {initials || "R"}
          </div>
          <button
            type="button"
            className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
          >
            <Camera size={12} />
          </button>
        </div>
        <div>
          <p className="font-semibold">{sessionUser?.name ?? "Rider User"}</p>
          <p className="text-sm text-muted-foreground">{sessionUser?.email ?? "No email"}</p>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Payment</h2>
        {data.paymentMethods.length > 0 ? (
          data.paymentMethods.map((method) => (
            <div
              key={method.id}
              className="rounded-2xl border border-border bg-secondary px-3 py-3 flex items-center justify-between"
            >
              <div className="inline-flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-lg bg-background border border-border flex items-center justify-center">
                  <CreditCard size={15} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{method.provider}</p>
                  <p className="text-xs text-muted-foreground">
                    {method.type} **** {method.last4}
                  </p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-border bg-secondary px-3 py-3 text-sm text-muted-foreground">
            No payment methods found.
          </div>
        )}
        <button
          type="button"
          onClick={openStripeLink}
          className="h-11 w-full rounded-xl border border-dashed border-border text-sm text-muted-foreground inline-flex items-center justify-center gap-2 hover:text-primary hover:border-primary transition-colors"
        >
          <Plus size={14} /> Add Payment Method (Stripe)
        </button>
      </div>

      <div className="rounded-3xl border border-border bg-card divide-y divide-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="inline-flex items-center gap-2.5">
            <Bell size={16} className="text-muted-foreground" />
            <span className="text-sm font-medium">Notifications</span>
          </div>
          <Switch checked={notifications} onCheckedChange={handleNotificationsToggle} />
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="inline-flex items-center gap-2.5">
            <Moon size={16} className="text-muted-foreground" />
            <span className="text-sm font-medium">Dark Mode</span>
          </div>
          <Switch checked={isDarkMode} onCheckedChange={handleDarkModeToggle} />
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Help & Support</h2>
        <input
          value={supportSubject}
          onChange={(event) => setSupportSubject(event.target.value)}
          maxLength={120}
          placeholder="Subject"
          className="h-11 w-full rounded-xl border border-border bg-secondary px-3 text-sm outline-none focus:border-primary transition-colors"
        />
        <textarea
          value={supportMessage}
          onChange={(event) => setSupportMessage(event.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="Describe your issue"
          className="w-full rounded-xl border border-border bg-secondary p-3 text-sm outline-none focus:border-primary transition-colors resize-none"
        />
        <div className="grid grid-cols-3 gap-2">
          {(["low", "medium", "high"] as const).map((priority) => (
            <button
              key={priority}
              type="button"
              onClick={() => setSupportPriority(priority)}
              className={`h-9 rounded-lg border text-xs capitalize transition-colors ${
                supportPriority === priority
                  ? "border-primary bg-primary/12 text-primary"
                  : "border-border bg-secondary text-muted-foreground hover:bg-muted"
              }`}
            >
              {priority}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleSupportSubmit}
          disabled={createSupportTicketMutation.isPending}
          className="h-11 w-full rounded-xl border border-primary bg-primary text-primary-foreground text-sm font-semibold transition-[transform,filter] duration-180 ease-smooth hover:brightness-95 hover:-translate-y-0.5 disabled:opacity-70 disabled:pointer-events-none"
        >
          {createSupportTicketMutation.isPending ? "Submitting..." : "Submit Ticket"}
        </button>

        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground uppercase tracking-[0.14em]">Recent Tickets</p>
          {isSupportLoading ? (
            <p className="text-xs text-muted-foreground">Loading support tickets...</p>
          ) : supportTickets.length === 0 ? (
            <p className="text-xs text-muted-foreground">No support tickets yet.</p>
          ) : (
            supportTickets.slice(0, 3).map((ticket) => (
              <div key={ticket.id} className="rounded-xl border border-border bg-secondary px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{ticket.subject}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-background border border-border capitalize">
                    {ticket.status.replace("_", " ")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ticket.message}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {ticket.createdAt}
                  {ticket.rideSummary ? ` | ${ticket.rideSummary}` : ""}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card divide-y divide-border">
        {["Privacy Policy", "Terms of Service", "About ViaFleet"].map((item) => (
          <button
            key={item}
            type="button"
            className="w-full px-4 py-3 flex items-center justify-between text-sm hover:bg-secondary transition-colors"
          >
            <span>{item}</span>
            <ChevronRight size={14} className="text-muted-foreground" />
          </button>
        ))}
      </div>
    </motion.section>
  );
};

export default RiderProfilePage;
