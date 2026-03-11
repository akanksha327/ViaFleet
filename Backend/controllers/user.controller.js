const asyncHandler = require("express-async-handler");
const userModel = require("../models/user.model");
const userService = require("../services/user.service");
const rideService = require("../services/ride.service");
const { validationResult } = require("express-validator");
const blacklistTokenModel = require("../models/blacklistToken.model");
const jwt = require("jsonwebtoken");
const supabaseAuthService = require("../services/supabase-auth.service");

module.exports.registerUser = asyncHandler(async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json(errors.array());
  }

  const { fullname, email, password, phone } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const requireEmailVerification =
    String(process.env.REQUIRE_EMAIL_VERIFICATION || "").trim().toLowerCase() === "true";

  const alreadyExists = await userModel.findOne({ email: normalizedEmail });

  if (alreadyExists) {
    const existingUser = {
      _id: alreadyExists._id,
      fullname: {
        firstname: alreadyExists.fullname.firstname,
        lastname: alreadyExists.fullname.lastname,
      },
      email: alreadyExists.email,
      phone: alreadyExists.phone,
      emailVerified: alreadyExists.emailVerified || false,
    };

    if (requireEmailVerification && !existingUser.emailVerified) {
      let verificationDispatchFailed = false;

      if (supabaseAuthService.isSupabaseVerificationEnabled()) {
        try {
          await supabaseAuthService.ensureSupabaseSignup({
            email: existingUser.email,
            password: String(password || ""),
            userType: "user",
          });
        } catch (error) {
          verificationDispatchFailed = true;
        }
      }

      return res.status(200).json({
        message: verificationDispatchFailed
          ? "User already exists but is not verified. Failed to send verification link. Use resend verification."
          : "User already exists but is not verified. Verification link sent.",
        requiresEmailVerification: true,
        verificationDispatchFailed,
        user: existingUser,
      });
    }

    return res.status(400).json({ message: "User already exists" });
  }

  const user = await userService.createUser(
    fullname.firstname,
    fullname.lastname,
    normalizedEmail,
    password,
    phone
  );

  const publicUser = {
    _id: user._id,
    fullname: {
      firstname: user.fullname.firstname,
      lastname: user.fullname.lastname,
    },
    email: user.email,
    phone: user.phone,
    emailVerified: user.emailVerified || false,
  };

  const requiresEmailVerification = requireEmailVerification && !publicUser.emailVerified;
  let verificationDispatchFailed = false;

  if (requiresEmailVerification && supabaseAuthService.isSupabaseVerificationEnabled()) {
    try {
      await supabaseAuthService.ensureSupabaseSignup({
        email: publicUser.email,
        password,
        userType: "user",
      });
    } catch (error) {
      verificationDispatchFailed = true;
    }
  }

  if (requiresEmailVerification) {
    return res.status(201).json({
      message: verificationDispatchFailed
        ? "User registered successfully, but verification email could not be sent. Use resend verification."
        : "User registered successfully. Please verify your email before logging in.",
      requiresEmailVerification: true,
      verificationDispatchFailed,
      user: publicUser,
    });
  }

  const token = user.generateAuthToken();
  return res.status(201).json({
    message: "User registered successfully",
    requiresEmailVerification: false,
    token,
    user: publicUser,
  });
});

module.exports.verifyEmail = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(errors.array());
  }

  const { token, email, otp, code, token_hash: tokenHash, type } = req.body;
  const providedOtp = otp || code;
  const providedTokenHash = String(tokenHash || "").trim();

  if (supabaseAuthService.isSupabaseVerificationEnabled() && (providedOtp || providedTokenHash)) {
    let resolvedEmail = String(email || "").trim().toLowerCase();

    if (providedTokenHash) {
      const verificationResult = await supabaseAuthService.verifyEmailTokenHash({
        tokenHash: providedTokenHash,
        type,
      });
      resolvedEmail =
        resolvedEmail || String(verificationResult?.user?.email || "").trim().toLowerCase();
    } else {
      if (!resolvedEmail) {
        return res.status(400).json({
          message: "Email is required for OTP verification",
        });
      }

      await supabaseAuthService.verifyEmailOtp({
        email: resolvedEmail,
        otp: providedOtp,
      });
    }

    if (!resolvedEmail) {
      return res.status(400).json({
        message: "Email is required for verification",
      });
    }

    const userByEmail = await userModel.findOne({ email: resolvedEmail });
    if (!userByEmail) {
      return res.status(404).json({
        message: "User not found. Please register first.",
      });
    }

    if (!userByEmail.emailVerified) {
      userByEmail.emailVerified = true;
      await userByEmail.save();
    }

    return res.status(200).json({
      message: "Email verified successfully",
      provider: "supabase",
    });
  }

  if (!token) {
    return res
      .status(400)
      .json({ message: "Invalid verification request", error: "Token, token hash, or OTP is required" });
  }

  let decodedTokenData;
  try {
    decodedTokenData = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(400).json({
      message: "You're trying to use an invalid or expired verification link",
      error: "Invalid token",
    });
  }

  if (!decodedTokenData || decodedTokenData.purpose !== "email-verification") {
    return res.status(400).json({ message: "You're trying to use an invalid or expired verification link", error: "Invalid token" });
  }

  let user = await userModel.findOne({ _id: decodedTokenData.id });

  if (!user) {
    return res.status(404).json({ message: "User not found. Please ask for another verification link." });
  }

  if (user.emailVerified) {
    return res.status(400).json({ message: "Email already verified" });
  }

  user.emailVerified = true;
  await user.save();

  res.status(200).json({
    message: "Email verified successfully",
  });
});

module.exports.loginUser = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(errors.array());
  }

  const { email, password } = req.body;

  const user = await userModel.findOne({ email }).select("+password");
  if (!user) {
    res.status(404).json({ message: "Invalid email or password" });
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    return res.status(404).json({ message: "Invalid email or password" });
  }

  if (String(process.env.REQUIRE_EMAIL_VERIFICATION || "").trim().toLowerCase() === "true" && !user.emailVerified) {
    return res.status(403).json({
      message: "Please verify your email before logging in.",
      code: "EMAIL_NOT_VERIFIED",
    });
  }

  const token = user.generateAuthToken();
  res.cookie("token", token);

  res.json({
    message: "Logged in successfully",
    token,
    user: {
      _id: user._id,
      fullname: {
        firstname: user.fullname.firstname,
        lastname: user.fullname.lastname,
      },
      email: user.email,
      phone: user.phone,
      rides: user.rides,
      socketId: user.socketId,
      emailVerified: user.emailVerified,
    },
  });
});

module.exports.userProfile = asyncHandler(async (req, res) => {
  const expiredCount = await rideService.expirePendingRideSearches({ user: req.user._id });

  if (!expiredCount) {
    return res.status(200).json({ user: req.user });
  }

  const refreshedUser = await userModel.findOne({ _id: req.user._id }).populate("rides");

  if (!refreshedUser) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.status(200).json({
    user: {
      _id: refreshedUser._id,
      fullname: {
        firstname: refreshedUser.fullname.firstname,
        lastname: refreshedUser.fullname.lastname,
      },
      email: refreshedUser.email,
      phone: refreshedUser.phone,
      rides: refreshedUser.rides,
      socketId: refreshedUser.socketId,
      emailVerified: refreshedUser.emailVerified || false,
    },
  });
});

module.exports.updateUserProfile = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(errors.array());
  }

  const { fullname,  phone } = req.body;

  const updatedUserData = await userModel.findOneAndUpdate(
    { _id: req.user._id },
    {
      fullname: fullname,
      phone,
    },
    { new: true }
  );

  res
    .status(200)
    .json({ message: "Profile updated successfully", user: updatedUserData });
});

module.exports.logoutUser = asyncHandler(async (req, res) => {
  res.clearCookie("token");
  const token = req.cookies.token || req.headers.token;

  await blacklistTokenModel.create({ token });

  res.status(200).json({ message: "Logged out successfully" });
});

module.exports.resetPassword = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(errors.array());
  }

  const { token, password } = req.body;
  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(400).json({
        message:
          "This password reset link has expired or is no longer valid. Please request a new one to continue",
      });
    } else {
      return res.status(400).json({
        message:
          "The password reset link is invalid or has already been used. Please request a new one to proceed",
        error: err,
      });
    }
  }

  const user = await userModel.findById(payload.id);
  if (!user)
    return res.status(404).json({
      message: "User not found. Please check your credentials and try again",
    });

  user.password = await userModel.hashPassword(password);
  await user.save();

  res.status(200).json({
    message:
      "Your password has been successfully reset. You can now log in with your new credentials",
  });
});
