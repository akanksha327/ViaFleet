const express = require("express");
const router = express.Router();
const captainController = require("../controllers/captain.controller");
const { body } = require("express-validator");
const { authCaptain } = require("../middlewares/auth.middleware");
const { requireDbReady } = require("../middlewares/db.middleware");

router.post("/register",
    requireDbReady,
    body("email").isEmail().withMessage("Invalid Email"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters long"),
    body("phone").isLength({ min: 10, max: 10 }).withMessage("Phone Number should be of 10 characters only"),
    body("fullname.firstname").isLength({min:3}).withMessage("First name must be at least 3 characters long"),
    body("drivingLicenseNumber").isLength({ min: 6, max: 25 }).withMessage("Driving license number is required"),
    body("vehicle.model").isLength({ min: 2, max: 40 }).withMessage("Vehicle model is required"),
    body("vehicle.color").isLength({ min: 3, max: 30 }).withMessage("Vehicle color is required"),
    body("vehicle.number").isLength({ min: 3, max: 20 }).withMessage("Vehicle number is required"),
    body("vehicle.capacity").isInt({ min: 1, max: 8 }).withMessage("Vehicle capacity should be between 1 and 8"),
    body("vehicle.type").isIn([ "auto", "car", "bike" ]).withMessage("Invalid vehicle type"),
    captainController.registerCaptain
);

router.post("/verify-email", captainController.verifyEmail);

router.post("/login", 
    requireDbReady,
    body("email").isEmail().withMessage("Invalid Email"),
    captainController.loginCaptain
);

router.post("/update", 
    body("captainData.phone").isLength({ min: 10, max: 10 }).withMessage("Phone Number should be of 10 characters only"),
    body("captainData.fullname.firstname").isLength({min:2}).withMessage("First name must be at least 2 characters long"),
    authCaptain,
    captainController.updateCaptainProfile
);

router.get("/profile", authCaptain, captainController.captainProfile);

router.get("/logout", authCaptain, captainController.logoutCaptain);

router.post(
    "/reset-password",
    body("token").notEmpty().withMessage("Token is required"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters long"),
    captainController.resetPassword
);

module.exports = router;
