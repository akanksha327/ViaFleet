const Stripe = require("stripe");

let stripeClient = null;

const getStripeClient = () => {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!secretKey) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in Backend/.env");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }

  return stripeClient;
};

const toPaise = (amountInInr) => {
  const amount = Number(amountInInr || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  return Math.round(amount * 100);
};

module.exports.createRideCheckoutSession = async ({
  rideId,
  userId,
  userEmail,
  amountInInr,
  successUrl,
  cancelUrl,
}) => {
  const stripe = getStripeClient();
  const unitAmount = toPaise(amountInInr);

  if (unitAmount <= 0) {
    throw new Error("Invalid ride amount for Stripe checkout");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: userEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "inr",
          unit_amount: unitAmount,
          product_data: {
            name: `RideX Ride Payment (${rideId})`,
          },
        },
      },
    ],
    metadata: {
      rideId: String(rideId),
      userId: String(userId),
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session;
};

module.exports.getCheckoutSession = async (sessionId) => {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.retrieve(String(sessionId || "").trim(), {
    expand: ["payment_intent"],
  });
};
