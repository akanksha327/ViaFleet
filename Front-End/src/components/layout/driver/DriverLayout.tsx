import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import DriverMobileNav from "./DriverMobileNav";
import DriverSidebar from "./DriverSidebar";
import { clearSession, getSession } from "@/lib/session";
import { authApi } from "@/lib/api";

const DriverLayout = () => {
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

  useEffect(() => {
    const session = getSession();
    if (!session?.user) {
      navigate("/", { replace: true });
      return;
    }
    if (session.user.accountType !== "driver") {
      navigate(session.user.accountType === "rider" ? "/rider" : "/", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="driver-shell min-h-screen md:flex">
      <DriverSidebar />

      <div className="flex-1 min-w-0">
        <header className="md:sticky md:top-0 z-30 border-b border-border bg-card">
          <div className="px-4 lg:px-6 py-3 flex items-center justify-between">
            <div>
              <p className="font-display font-bold text-lg">Driver Workspace</p>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Dispatch Monitor</p>
            </div>
            <div className="inline-flex items-center gap-2">
              <span className="text-xs font-medium text-primary bg-primary/12 px-2.5 py-1 rounded-full border border-primary/20">
                Online
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="md:hidden h-8 px-2.5 rounded-full border border-border bg-secondary text-muted-foreground hover:text-foreground hover:bg-muted transition-colors inline-flex items-center gap-1.5 text-xs font-medium"
              >
                <LogOut size={12} />
                Sign Out
              </button>
            </div>
          </div>
        </header>

        <main className="px-4 lg:px-6 py-4 pb-24 md:pb-6">
          <Outlet />
        </main>
      </div>

      <DriverMobileNav />
    </div>
  );
};

export default DriverLayout;
