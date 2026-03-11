import { Variants } from "framer-motion";

export const pageTransition: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.992 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 8, scale: 0.996 },
};

export const pageTransitionConfig = {
  duration: 0.22,
  ease: [0.2, 0.8, 0.2, 1] as const,
};

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.055, delayChildren: 0.04 },
  },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 18, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] } },
};

export const slideInRight: Variants = {
  initial: { opacity: 0, x: 28 },
  animate: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 260, damping: 28 } },
};

export const slideInUp: Variants = {
  initial: { opacity: 0, y: 26 },
  animate: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 28 } },
};

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.94 },
  animate: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 260, damping: 22 } },
};

export const cardHover = {
  scale: 1.012,
  y: -5,
  transition: { type: "spring" as const, stiffness: 320, damping: 24 },
};

export const cardTap = {
  scale: 0.988,
  transition: { type: "spring" as const, stiffness: 320, damping: 24 },
};

export const magneticHover = {
  scale: 1.03,
  transition: { type: "spring", stiffness: 320, damping: 18 },
};

export const bounceIn: Variants = {
  initial: { opacity: 0, scale: 0 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 360, damping: 18 },
  },
};
