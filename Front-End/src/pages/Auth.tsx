import { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Car,
  Phone,
  BadgeCheck,
  CarFront,
  Palette,
  Hash,
  Users,
  type LucideIcon,
} from "lucide-react";
import MagneticButton from "@/components/ui/MagneticButton";
import { cn } from "@/lib/utils";
import { ApiError, authApi, toApiErrorMessage } from "@/lib/api";
import { getSession, setSession } from "@/lib/session";
import { toast } from "@/components/ui/sonner";

const FloatingInput = ({ icon: Icon, label, type = "text", value, onChange, maxLength }: {
  icon: LucideIcon;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
}) => {
  const [focused, setFocused] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const isPassword = type === "password";
  const active = focused || value.length > 0;
  const resolvedType = isPassword ? (showPw ? "text" : "password") : type;

  return (
    <div className="relative">
      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground z-10">
        <Icon size={18} />
      </div>
      <motion.label
        className="absolute left-11 pointer-events-none text-muted-foreground z-10"
        animate={{
          top: active ? "6px" : "50%",
          y: active ? 0 : "-50%",
          fontSize: active ? "10px" : "14px",
        }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        {label}
      </motion.label>
      <input
        type={resolvedType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={maxLength}
        className={cn(
          "w-full h-14 pl-11 pr-12 pt-4 pb-1 rounded-2xl bg-secondary border text-foreground text-sm",
          "outline-none transition-all duration-300",
          focused ? "border-primary glow-emerald" : "border-border"
        )}
      />
      {isPassword && (
        <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground">
          {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      )}
    </div>
  );
};

const FloatingSelect = ({
  icon: Icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) => {
  const [focused, setFocused] = useState(false);
  const hasValue = value.length > 0;

  return (
    <div className="relative">
      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground z-10 pointer-events-none">
        <Icon size={18} />
      </div>
      <motion.label
        className="absolute left-11 pointer-events-none text-muted-foreground z-10"
        animate={{
          top: "6px",
          y: 0,
          fontSize: "10px",
        }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        {label}
      </motion.label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          "w-full h-14 pl-11 pr-4 pt-4 pb-1 rounded-2xl bg-secondary border text-foreground text-sm",
          "outline-none transition-all duration-300 appearance-none",
          !hasValue && "text-muted-foreground",
          focused ? "border-primary glow-emerald" : "border-border"
        )}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.value === ""}
            className="text-foreground"
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

const AppleLogo = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
    <path d="M16.37 12.24c.03 3.24 2.83 4.32 2.86 4.33-.02.08-.45 1.54-1.47 3.05-.88 1.3-1.8 2.59-3.24 2.62-1.42.03-1.88-.84-3.5-.84-1.62 0-2.14.82-3.46.87-1.39.05-2.45-1.39-3.34-2.68-1.82-2.63-3.21-7.45-1.34-10.69.93-1.61 2.58-2.63 4.37-2.66 1.36-.03 2.65.92 3.5.92.84 0 2.42-1.14 4.08-.98.69.03 2.62.28 3.86 2.09-.1.06-2.3 1.34-2.32 3.97ZM13.73 4.42c.74-.9 1.24-2.15 1.1-3.42-1.07.04-2.36.72-3.13 1.62-.69.79-1.29 2.06-1.13 3.27 1.2.09 2.42-.61 3.16-1.47Z" />
  </svg>
);

const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
    <path fill="#EA4335" d="M12 10.2v3.96h5.52c-.24 1.27-.96 2.35-2.05 3.07l3.31 2.57c1.93-1.78 3.04-4.39 3.04-7.48 0-.72-.06-1.42-.2-2.12H12Z" />
    <path fill="#34A853" d="M12 22c2.76 0 5.07-.91 6.76-2.47l-3.31-2.57c-.92.62-2.09.99-3.45.99-2.65 0-4.9-1.79-5.71-4.19H2.87v2.65A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.29 13.76a6 6 0 0 1 0-3.52V7.59H2.87a10 10 0 0 0 0 8.82l3.42-2.65Z" />
    <path fill="#4285F4" d="M12 6.05c1.5 0 2.85.52 3.91 1.53l2.93-2.94C17.06 2.98 14.76 2 12 2a10 10 0 0 0-9.13 5.59l3.42 2.65C7.1 7.84 9.35 6.05 12 6.05Z" />
  </svg>
);

const FacebookLogo = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
    <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.5-3.88 3.79-3.88 1.09 0 2.23.2 2.23.2v2.46H15.2c-1.24 0-1.63.77-1.63 1.56V12h2.77l-.44 2.89h-2.33v6.99A10 10 0 0 0 22 12Z" />
  </svg>
);

const SocialButton = ({ icon, label, note, disabled = false }: { icon: ReactNode; label: string; note?: string; disabled?: boolean }) => (
  <motion.button
    type="button"
    disabled={disabled}
    whileHover={!disabled ? { scale: 1.03 } : undefined}
    whileTap={!disabled ? { scale: 0.97 } : undefined}
    className={cn(
      "flex items-center justify-center gap-2 h-12 rounded-2xl border border-border bg-secondary text-sm font-medium text-foreground transition-colors flex-1",
      disabled ? "opacity-70 cursor-not-allowed" : "hover:border-primary/50 hover:bg-muted"
    )}
  >
    <span className="inline-flex items-center justify-center">{icon}</span>
    <span className="hidden sm:flex flex-col leading-tight text-left">
      <span>{label}</span>
      {note && <span className="text-[10px] text-muted-foreground mt-0.5">({note})</span>}
    </span>
  </motion.button>
);

type AccountType = "rider" | "driver";
type DriverSignupDetails = {
  phone: string;
  drivingLicenseNumber: string;
  vehicleType: "" | "car" | "bike" | "auto";
  vehicleModel: string;
  vehicleColor: string;
  vehicleNumber: string;
  vehicleCapacity: string;
};

const DEFAULT_DRIVER_SIGNUP_DETAILS: DriverSignupDetails = {
  phone: "",
  drivingLicenseNumber: "",
  vehicleType: "",
  vehicleModel: "",
  vehicleColor: "",
  vehicleNumber: "",
  vehicleCapacity: "4",
};

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [accountType, setAccountType] = useState<AccountType>("rider");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [driverDetails, setDriverDetails] = useState<DriverSignupDetails>(DEFAULT_DRIVER_SIGNUP_DETAILS);
  const [loading, setLoading] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationAccountType, setVerificationAccountType] = useState<AccountType>("rider");
  const [showVerification, setShowVerification] = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const navigate = useNavigate();
  const isDriverSignup = !isLogin && accountType === "driver";

  const updateDriverDetails = (patch: Partial<DriverSignupDetails>) => {
    setDriverDetails((current) => ({ ...current, ...patch }));
  };

  useEffect(() => {
    const session = getSession();
    if (session?.user?.accountType) {
      navigate(session.user.accountType === "driver" ? "/driver" : "/rider", { replace: true });
    }
  }, [navigate]);

  const isEmailNotVerifiedError = (error: unknown) => {
    if (!(error instanceof ApiError)) return false;

    const details = error.details;
    if (details && typeof details === "object" && "code" in details) {
      const code = String((details as { code?: unknown }).code || "").trim().toUpperCase();
      if (code === "EMAIL_NOT_VERIFIED") {
        return true;
      }
    }

    return /verify your email/i.test(error.message);
  };

  const handleResendVerification = async () => {
    const targetEmail = verificationEmail || email.trim().toLowerCase();
    if (!targetEmail) {
      toast.error("Enter your email to resend verification link");
      return;
    }

    setVerificationLoading(true);
    try {
      await authApi.resendVerification({
        email: targetEmail,
        accountType: verificationAccountType || accountType,
      });
      toast.success("Verification link sent. Check your inbox and spam folder.");
    } catch (error) {
      toast.error(toApiErrorMessage(error, "Failed to send verification link."));
    } finally {
      setVerificationLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password || (!isLogin && !name)) {
      toast.error("Please fill in all required fields");
      return;
    }

    const normalizedPhone = driverDetails.phone.replace(/\D/g, "").slice(0, 10);
    const normalizedVehicleNumber = driverDetails.vehicleNumber.trim().toUpperCase();
    const normalizedLicenseNumber = driverDetails.drivingLicenseNumber.trim().toUpperCase();
    const vehicleCapacity = Number(driverDetails.vehicleCapacity);

    if (!isLogin && accountType === "driver") {
      if (
        !normalizedPhone ||
        !normalizedLicenseNumber ||
        !driverDetails.vehicleModel.trim() ||
        !driverDetails.vehicleColor.trim() ||
        !normalizedVehicleNumber ||
        !driverDetails.vehicleType
      ) {
        toast.error("Please fill in all driver registration details");
        return;
      }

      if (normalizedPhone.length !== 10) {
        toast.error("Driver phone number must be 10 digits");
        return;
      }

      if (normalizedLicenseNumber.length < 6) {
        toast.error("Enter a valid driving license number");
        return;
      }

      if (!Number.isFinite(vehicleCapacity) || vehicleCapacity < 1 || vehicleCapacity > 8) {
        toast.error("Vehicle capacity should be between 1 and 8");
        return;
      }
    }

    setLoading(true);

    try {
      if (isLogin) {
        const authPayload = await authApi.login({ email, password, accountType });

        setSession({
          token: authPayload.token,
          user: authPayload.user,
        });
        setShowVerification(false);
        setVerificationEmail("");

        navigate(authPayload.redirectPath, { replace: true });
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const signupPayload = await authApi.signup({
        name,
        email: normalizedEmail,
        password,
        accountType,
        driverDetails:
          accountType === "driver"
            ? {
                phone: normalizedPhone,
                drivingLicenseNumber: normalizedLicenseNumber,
                vehicleModel: driverDetails.vehicleModel.trim(),
                vehicleColor: driverDetails.vehicleColor.trim(),
                vehicleNumber: normalizedVehicleNumber,
                vehicleCapacity,
                vehicleType: driverDetails.vehicleType as "car" | "bike" | "auto",
              }
            : undefined,
      });
      const needsVerification = signupPayload.requiresEmailVerification || !signupPayload.token;

      if (!needsVerification && signupPayload.token) {
        setSession({
          token: signupPayload.token,
          user: signupPayload.user,
        });
        setShowVerification(false);
        setVerificationEmail("");

        navigate(signupPayload.redirectPath, { replace: true });
        return;
      }

      setIsLogin(true);
      setShowVerification(true);
      setVerificationEmail(normalizedEmail);
      setVerificationAccountType(accountType);
      toast.success(
        "Registration started. Check your email to verify your account before signing in."
      );
    } catch (error) {
      if (isLogin && isEmailNotVerifiedError(error)) {
        const normalizedEmail = email.trim().toLowerCase();
        setVerificationEmail(normalizedEmail);
        setVerificationAccountType(accountType);
        setShowVerification(true);
        toast.error(
          "Account not verified. Check your email for the verification link or use Resend Verification Link."
        );
        return;
      }

      toast.error(toApiErrorMessage(error, "Authentication failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden grain-texture">
      <div className="fixed inset-0 bg-background" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
        className={cn("relative z-10 w-full", isDriverSignup ? "max-w-3xl" : "max-w-md")}
      >
        <div className="glass rounded-[2rem] p-8">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-[1.25rem] bg-primary flex items-center justify-center">
              <Car size={24} className="text-primary-foreground" />
            </div>
            <div className="text-center">
              <h1 className="text-3xl font-display font-bold text-foreground">ViaFleet</h1>
              <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Smart City Commute</p>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-xs font-medium text-muted-foreground mb-2 px-1">Continue as</p>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary p-1.5">
              {[
                { id: "rider" as const, label: "Customer (Rider)" },
                { id: "driver" as const, label: "Driver" },
              ].map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setAccountType(type.id)}
                  className={cn(
                    "relative h-11 rounded-xl text-sm font-medium transition-colors",
                    accountType === type.id
                      ? "text-primary-foreground"
                      : "text-foreground hover:bg-background"
                  )}
                >
                  {accountType === type.id && (
                    <motion.span
                      layoutId="account-type-pill"
                      className="absolute inset-0 rounded-xl bg-primary"
                      transition={{ type: "spring", stiffness: 320, damping: 28 }}
                    />
                  )}
                  <span className="relative z-10">{type.label}</span>
                </button>
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.form
              key={`${isLogin ? "login" : "signup"}-${accountType}`}
              initial={{ opacity: 0, x: isLogin ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isLogin ? 20 : -20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              {!isLogin && (
                <FloatingInput icon={User} label="Full Name" value={name} onChange={setName} />
              )}
              {isDriverSignup && (
                <div className="rounded-[1.6rem] border border-border bg-card p-4 space-y-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">Driver onboarding details</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      These details are required before a driver account can be used for rides.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FloatingInput
                      icon={Phone}
                      label="Phone Number"
                      type="tel"
                      value={driverDetails.phone}
                      onChange={(value) =>
                        updateDriverDetails({ phone: value.replace(/\D/g, "").slice(0, 10) })
                      }
                      maxLength={10}
                    />
                    <FloatingInput
                      icon={BadgeCheck}
                      label="Driving License Number"
                      value={driverDetails.drivingLicenseNumber}
                      onChange={(value) =>
                        updateDriverDetails({
                          drivingLicenseNumber: value.toUpperCase().slice(0, 25),
                        })
                      }
                      maxLength={25}
                    />
                    <FloatingSelect
                      icon={CarFront}
                      label="What vehicle do you drive?"
                      value={driverDetails.vehicleType}
                      onChange={(value) =>
                        updateDriverDetails({
                          vehicleType: value as DriverSignupDetails["vehicleType"],
                        })
                      }
                      options={[
                        { value: "", label: "Select Bike / Auto / Car" },
                        { value: "car", label: "Car" },
                        { value: "auto", label: "Auto" },
                        { value: "bike", label: "Bike" },
                      ]}
                    />
                    <FloatingInput
                      icon={Users}
                      label="Seating Capacity"
                      type="number"
                      value={driverDetails.vehicleCapacity}
                      onChange={(value) =>
                        updateDriverDetails({
                          vehicleCapacity: value.replace(/\D/g, "").slice(0, 1),
                        })
                      }
                      maxLength={1}
                    />
                    <FloatingInput
                      icon={Car}
                      label="Vehicle Model"
                      value={driverDetails.vehicleModel}
                      onChange={(value) => updateDriverDetails({ vehicleModel: value })}
                      maxLength={40}
                    />
                    <FloatingInput
                      icon={Palette}
                      label="Vehicle Color"
                      value={driverDetails.vehicleColor}
                      onChange={(value) => updateDriverDetails({ vehicleColor: value })}
                      maxLength={30}
                    />
                    <div className="md:col-span-2">
                      <FloatingInput
                        icon={Hash}
                        label="Vehicle Number"
                        value={driverDetails.vehicleNumber}
                        onChange={(value) =>
                          updateDriverDetails({
                            vehicleNumber: value.toUpperCase().slice(0, 20),
                          })
                        }
                        maxLength={20}
                      />
                    </div>
                  </div>
                </div>
              )}
              <FloatingInput icon={Mail} label="Email Address" value={email} onChange={setEmail} />
              <FloatingInput icon={Lock} label="Password" type="password" value={password} onChange={setPassword} />

              <MagneticButton type="submit" loading={loading} className="w-full h-12 text-base">
                {isLogin ? `Sign In as ${accountType === "driver" ? "Driver" : "Rider"}` : `Create ${accountType === "driver" ? "Driver" : "Rider"} Account`}
              </MagneticButton>

              {showVerification && isLogin && verificationAccountType === accountType && (
                <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Verify <span className="text-foreground">{verificationEmail}</span> by clicking the
                    email link sent to your inbox.
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={verificationLoading}
                      className={cn(
                        "h-10 rounded-2xl border border-border bg-secondary text-sm font-medium transition-colors",
                        verificationLoading ? "opacity-70 pointer-events-none" : "hover:border-primary/50"
                      )}
                    >
                      Resend Verification Link
                    </button>
                  </div>
                </div>
              )}
            </motion.form>
          </AnimatePresence>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or continue with</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="flex gap-3">
            <SocialButton icon={<AppleLogo />} label="Apple" note="Coming soon" disabled />
            <SocialButton icon={<GoogleLogo />} label="Google" />
            <SocialButton icon={<FacebookLogo />} label="Facebook" note="Coming soon" disabled />
          </div>

          <div className="flex rounded-2xl bg-secondary p-1.5 mt-6">
            {["Login", "Sign Up"].map((tab, i) => (
              <button
                key={tab}
                onClick={() => setIsLogin(i === 0)}
                className={cn(
                  "relative flex-1 py-2.5 text-sm font-medium rounded-xl transition-colors",
                  (i === 0 ? isLogin : !isLogin) ? "text-primary-foreground" : "text-foreground"
                )}
              >
                {(i === 0 ? isLogin : !isLogin) && (
                  <motion.span
                    layoutId="auth-mode-pill"
                    className="absolute inset-0 rounded-xl bg-primary"
                    transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  />
                )}
                <span className="relative z-10">{tab}</span>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Auth;
