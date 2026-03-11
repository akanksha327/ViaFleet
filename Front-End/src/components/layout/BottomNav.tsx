import { Home, Car, Clock, Star, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const tabs = [
  { icon: Home, label: "Ride", path: "/rider" },
  { icon: Car, label: "Drive", path: "/driver" },
  { icon: Clock, label: "History", path: "/history" },
  { icon: Star, label: "Rate", path: "/ratings" },
  { icon: User, label: "Profile", path: "/profile" },
];

const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-3 left-3 right-3 z-50 md:hidden">
      <div className="flex items-center justify-around rounded-[1.5rem] border border-border bg-card px-2 py-2 shadow-[0_18px_36px_-28px_hsl(0_0%_0%/0.7)]">
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className="relative flex min-w-[60px] flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-colors"
            >
              <tab.icon
                size={20}
                className={cn(
                  "transition-colors duration-200",
                  active ? "text-foreground" : "text-muted-foreground"
                )}
              />
              <span className={cn(
                "text-[10px] font-medium",
                active ? "text-foreground" : "text-muted-foreground"
              )}>
                {tab.label}
              </span>
              {active && <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-foreground/80" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
