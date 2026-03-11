import { useState } from "react";
import { motion } from "framer-motion";
import { Camera, CreditCard, Plus, Trash2, Bell, Moon, ChevronRight } from "lucide-react";
import { useTheme } from "next-themes";
import GlassCard from "@/components/ui/GlassCard";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";

const paymentMethods = [
  { id: 1, provider: "Stripe", type: "Visa", last4: "4242" },
];

const stripePaymentLink = import.meta.env.VITE_STRIPE_PAYMENT_LINK?.trim();

const Profile = () => {
  const [notifications, setNotifications] = useState(true);
  const { resolvedTheme, setTheme } = useTheme();
  const isDarkMode = resolvedTheme !== "light";

  const handleStripePaymentSetup = () => {
    if (!stripePaymentLink) {
      toast.error("Stripe payment link is not configured", {
        description: "Add VITE_STRIPE_PAYMENT_LINK to your .env file.",
      });
      return;
    }

    window.open(stripePaymentLink, "_blank", "noopener,noreferrer");
  };

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="p-4 lg:p-6 space-y-4 max-w-lg mx-auto"
    >
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl font-display font-bold">Profile</h1>
      </motion.div>

      <motion.div variants={staggerItem}>
        <GlassCard className="flex items-center gap-4">
          <motion.div className="relative group cursor-pointer" whileHover={{ scale: 1.03 }}>
            <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center text-xl font-semibold overflow-hidden">
              AJ
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              whileHover={{ opacity: 1 }}
              className="absolute inset-0 rounded-2xl bg-background/60 flex items-center justify-center"
            >
              <Camera size={20} className="text-foreground" />
            </motion.div>
          </motion.div>
          <div>
            <p className="font-display font-bold text-xl">Alex Johnson</p>
            <p className="text-sm text-muted-foreground">alex@email.com</p>
            <p className="text-xs text-muted-foreground mt-1">Member since Jan 2024</p>
          </div>
        </GlassCard>
      </motion.div>

      <motion.div variants={staggerItem}>
        <h3 className="text-sm font-medium text-muted-foreground mb-3 px-1">Payment Methods</h3>
        <div className="space-y-2">
          {paymentMethods.map((pm) => (
            <GlassCard key={pm.id} interactive className="!p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center">
                  <CreditCard size={18} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{pm.provider}</p>
                  <p className="text-xs text-muted-foreground">{pm.type} **** {pm.last4}</p>
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.1, color: "hsl(var(--destructive))" }}
                whileTap={{ scale: 0.95 }}
                className="text-muted-foreground"
                aria-label={`Remove ${pm.provider} payment method`}
              >
                <Trash2 size={16} />
              </motion.button>
            </GlassCard>
          ))}
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={handleStripePaymentSetup}
            className="w-full h-12 rounded-2xl border border-dashed border-border text-sm text-muted-foreground flex items-center justify-center gap-2 hover:border-primary hover:text-primary transition-colors"
          >
            <Plus size={16} /> Add Payment Method (Stripe)
          </motion.button>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <h3 className="text-sm font-medium text-muted-foreground mb-3 px-1">Settings</h3>
        <GlassCard className="space-y-0 !p-0 divide-y divide-border">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <Bell size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">Notifications</span>
            </div>
            <Switch checked={notifications} onCheckedChange={setNotifications} />
          </div>
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <Moon size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">Dark Mode</span>
            </div>
            <Switch checked={isDarkMode} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />
          </div>
        </GlassCard>
      </motion.div>

      <motion.div variants={staggerItem}>
        <GlassCard className="!p-0 divide-y divide-border">
          {["Help & Support", "Privacy Policy", "Terms of Service", "About ViaFleet"].map((item) => (
            <motion.button
              key={item}
              whileHover={{ x: 4 }}
              className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-foreground"
            >
              {item}
              <ChevronRight size={16} className="text-muted-foreground" />
            </motion.button>
          ))}
        </GlassCard>
      </motion.div>
    </motion.div>
  );
};

export default Profile;
