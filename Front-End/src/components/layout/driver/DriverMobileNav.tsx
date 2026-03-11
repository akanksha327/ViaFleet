import { BarChart3, CarFront, ClipboardList, History, UserCircle2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const driverTabs = [
  { label: "Home", icon: CarFront, path: "/driver" },
  { label: "Active", icon: ClipboardList, path: "/driver/active-ride" },
  { label: "Earn", icon: BarChart3, path: "/driver/earnings" },
  { label: "History", icon: History, path: "/driver/history" },
  { label: "Profile", icon: UserCircle2, path: "/driver/profile" },
];

const DriverMobileNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-3 inset-x-3 z-50 md:hidden">
      <div className="grid grid-cols-5 gap-1 rounded-[1.5rem] border border-border bg-card px-2 py-2 shadow-[0_18px_36px_-28px_hsl(0_0%_0%/0.7)]">
        {driverTabs.map((tab) => {
          const active = location.pathname === tab.path;
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => navigate(tab.path)}
              className={cn(
                "h-14 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary"
              )}
            >
              <tab.icon size={18} />
              <span className="text-[11px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default DriverMobileNav;
