import { Home, Car, Clock, Star, User, MapPin, LogOut } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { authApi } from "@/lib/api";
import { clearSession } from "@/lib/session";

const navItems = [
  { icon: Home, label: "Ride", path: "/rider" },
  { icon: Car, label: "Drive", path: "/driver" },
  { icon: MapPin, label: "Tracking", path: "/tracking" },
  { icon: Clock, label: "History", path: "/history" },
  { icon: Star, label: "Ratings", path: "/ratings" },
  { icon: User, label: "Profile", path: "/profile" },
];

const SidebarNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await authApi.logout();
    } catch {
      // Session is client-managed; clear regardless of network state.
    } finally {
      clearSession();
      navigate("/", { replace: true });
    }
  };

  return (
    <aside className="hidden md:flex flex-col w-20 lg:w-64 bg-card min-h-screen py-6 px-3 lg:px-4 fixed left-0 top-0 z-40 border-r border-border">
      <div className="flex items-center gap-3 px-2 mb-8">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
          <Car size={20} className="text-primary-foreground" />
        </div>
        <div className="hidden lg:block">
          <span className="block text-xl font-display font-bold text-foreground">ViaFleet</span>
          <span className="block text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Transit Suite</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1.5 flex-1">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "relative flex items-center gap-3 px-3 py-3 rounded-xl transition-colors duration-200",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-foreground/80" />}
              <item.icon size={19} className="relative z-10" />
              <span className="hidden lg:block relative z-10 font-medium text-sm">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={handleSignOut}
        className="flex items-center gap-3 px-3 py-3 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        <LogOut size={20} />
        <span className="hidden lg:block text-sm font-medium">Sign Out</span>
      </button>
    </aside>
  );
};

export default SidebarNav;
