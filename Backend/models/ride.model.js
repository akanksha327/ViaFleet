const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    captain: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Captain",
    },
    pickup: {
      type: String,
      required: true,
    },
    pickupLocation: {
      type: {
        type: String,
        enum: ["Point"],
      },
      coordinates: {
        type: [Number],
        validate: {
          validator(value) {
            return !value || value.length === 2;
          },
          message: "pickupLocation.coordinates must contain [lng, lat]",
        },
      },
    },
    destination: {
      type: String,
      required: true,
    },
    stops: [
      {
        type: String,
        trim: true,
      },
    ],
    fare: {
      type: Number,
      required: true,
    },
    fareBeforeDiscount: {
      type: Number,
    },
    promoCode: {
      type: String,
      trim: true,
      uppercase: true,
    },
    promoDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },
    vehicle: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "ongoing", "completed", "cancelled"],
      default: "pending",
    },
    declinedByCaptains: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Captain",
      },
    ],
    cancellationReason: {
      type: String,
      enum: ["user_cancelled", "driver_cancelled", "no_driver_available"],
    },
    searchFailedAt: {
      type: Date,
    },
    duration: {
      type: Number,
    }, // in seconds

    distance: {
      type: Number,
    }, // in meters

    paymentID: {
      type: String,
    },
    orderId: {
      type: String,
    },
    signature: {
      type: String,
    },
    receiptNo: {
      type: String,
      index: true,
    },
    receiptIssuedAt: {
      type: Date,
    },
    paymentMethod: {
      type: String,
      default: "stripe_checkout",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    otp: {
      type: String,
      select: false,
      required: true,
    },
    rating: {
      score: {
        type: Number,
        min: 1,
        max: 5,
      },
      feedback: {
        type: String,
        trim: true,
        maxlength: 500,
      },
      byUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      submittedAt: {
        type: Date,
      },
    },
    messages: [
      {
        msg: String,
        by: {
          type: String,
          enum: ["user", "captain"],
        },
        time: String,
        date: String,
        timestamp: Date,
        _id: false
      },
    ],
  },
  { timestamps: true }
);

rideSchema.index({ pickupLocation: "2dsphere" }, { sparse: true });

module.exports = mongoose.model("Ride", rideSchema);
