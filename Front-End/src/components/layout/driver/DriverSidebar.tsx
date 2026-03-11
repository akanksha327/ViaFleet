import { BarChart3, CarFront, ClipboardList, History, LogOut, UserCircle2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { authApi } from "@/lib/api";
import { clearSession } from "@/lib/session";

const driverNavItems = [
  { label: "Dashboard", icon: CarFront, path: "/driver" },
  { label: "Active Ride", icon: ClipboardList, path: "/driver/active-ride" },
  { label: "Earnings", icon: BarChart3, path: "/driver/earnings" },
  { label: "History", icon: History, path: "/driver/history" },
  { label: "Profile", icon: UserCircle2, path: "/driver/profile" },
];

const DriverSidebar = () => {
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
    <aside className="hidden md:flex w-72 shrink-0 border-r border-border bg-card min-h-screen sticky top-0">
      <div className="w-full p-4 flex flex-col">
        <div className="px-4 py-4 mb-5 rounded-[1.1rem] border border-border bg-secondary">
          <p className="font-display font-bold text-lg">ViaFleet Driver</p>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Operations Panel</p>
        </div>

        <nav className="space-y-1.5 flex-1">
          {driverNavItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                className={cn(
                  "w-full h-11 px-3 rounded-xl text-sm font-medium inline-flex items-center gap-2.5 transition-colors duration-200",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                {active && <span className="mr-0.5 h-4 w-0.5 rounded-full bg-foreground/80" />}
                <item.icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={handleSignOut}
          className="h-11 px-3 rounded-xl inline-flex items-center gap-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <LogOut size={16} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};

export default DriverSidebar;
