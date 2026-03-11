import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { cardHover, cardTap } from "@/lib/animations";

interface GlassCardProps extends HTMLMotionProps<"div"> {
  interactive?: boolean;
  glow?: "emerald" | "gold" | "none";
}

const GlassCard = ({ className, interactive = false, glow = "none", children, ...props }: GlassCardProps) => (
  <motion.div
    className={cn(
      "glass card-light-reflection rounded-[1.6rem] p-6",
      glow === "emerald" && "glow-emerald",
      glow === "gold" && "glow-gold",
      className
    )}
    whileHover={interactive ? cardHover : undefined}
    whileTap={interactive ? cardTap : undefined}
    {...props}
  >
    {children}
  </motion.div>
);

export default GlassCard;
