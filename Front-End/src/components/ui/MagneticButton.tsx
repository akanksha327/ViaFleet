import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import React, { useRef, useState } from "react";

interface MagneticButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "success" | "danger";
  loading?: boolean;
}

const MagneticButton = ({ className, variant = "primary", loading, children, ...props }: MagneticButtonProps) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      setRipple({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setTimeout(() => setRipple(null), 600);
    }
    props.onClick?.(e);
  };

  const variants = {
    primary:
      "bg-primary text-primary-foreground hover:bg-primary/90",
    outline:
      "border border-border bg-card/70 text-foreground hover:border-primary/60 hover:text-primary hover:bg-secondary/80",
    success: "bg-[hsl(var(--success))] text-primary-foreground hover:brightness-95",
    danger: "bg-destructive text-destructive-foreground hover:brightness-95",
  };

  return (
    <motion.button
      ref={ref}
      className={cn(
        "relative overflow-hidden rounded-2xl px-6 py-3 font-semibold tracking-[0.01em] transition-[transform,filter,border-color,color,background-color] duration-200 ease-smooth",
        variants[variant],
        loading && "opacity-70 pointer-events-none",
        className
      )}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.99 }}
      onClick={handleClick}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      {...(props as any)}
    >
      {ripple && (
        <span
          className="absolute rounded-full bg-background/25 animate-ripple"
          style={{ left: ripple.x, top: ripple.y, width: 10, height: 10, transform: "translate(-50%, -50%)" }}
        />
      )}
      {loading ? (
        <motion.div
          className="h-5 w-5 border-2 border-current border-t-transparent rounded-full"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
        />
      ) : (
        children
      )}
    </motion.button>
  );
};

export default MagneticButton;
