const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const rideController = require('../controllers/ride.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.get('/chat-details/:id', rideController.chatDetails)

router.post('/create',
    authMiddleware.authUser,
    body('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    body('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    body('vehicleType').isString().isIn([ 'auto', 'car', 'bike' ]).withMessage('Invalid vehicle type'),
    body('stops').optional().isArray().withMessage('Stops should be an array'),
    body('promoCode').optional().isString().isLength({ min: 3, max: 30 }).withMessage('Invalid promo code'),
    rideController.createRide
)

router.get('/get-fare',
    authMiddleware.authUser,
    query('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    query('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    rideController.getFare
)

router.post('/apply-promo',
    authMiddleware.authUser,
    body('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    body('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    body('vehicleType').isString().isIn([ 'auto', 'car', 'bike' ]).withMessage('Invalid vehicle type'),
    body('stops').optional().isArray().withMessage('Stops should be an array'),
    body('promoCode').isString().isLength({ min: 3, max: 30 }).withMessage('Invalid promo code'),
    rideController.applyPromo
)

router.post('/confirm',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.confirmRide
)

router.post('/decline',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.declineRide
)

router.get(
    '/pending-for-captain',
    authMiddleware.authCaptain,
    query('radius').optional().isFloat({ gt: 0, lte: 20 }).withMessage('Invalid radius'),
    rideController.getPendingRidesForCaptain
)

router.get(
    '/availability',
    authMiddleware.authUser,
    query('lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    query('lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
    query('radius').optional().isFloat({ gt: 0, lte: 20 }).withMessage('Invalid radius'),
    rideController.getRideAvailability
)


router.get('/cancel',
    query('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.cancelRide
)


router.get('/start-ride',
    authMiddleware.authCaptain,
    query('rideId').isMongoId().withMessage('Invalid ride id'),
    query('otp').isString().isLength({ min: 6, max: 6 }).withMessage('Invalid OTP'),
    rideController.startRide
)

router.get('/otp/:rideId',
    authMiddleware.authUser,
    param('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.getRideOtp
)

router.post('/end-ride',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.endRide
)

router.post('/rate',
    authMiddleware.authUser,
    body('rideId').optional().isMongoId().withMessage('Invalid ride id'),
    body('rating').isFloat({ min: 1, max: 5 }).withMessage('Rating should be between 1 and 5'),
    body('feedback').optional().isString().isLength({ max: 500 }).withMessage('Feedback is too long'),
    rideController.rateRide
)

router.get('/receipt/:rideId',
    authMiddleware.authUser,
    param('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.getRideReceipt
)

router.post('/payment/create-session',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.createPaymentSession
)

router.post('/payment/confirm',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('sessionId').isString().isLength({ min: 1, max: 300 }).withMessage('Invalid Stripe session id'),
    rideController.confirmPayment
)

router.get('/payment-status/:rideId',
    authMiddleware.authUser,
    param('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.getPaymentStatus
)

router.post('/sos',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('message').optional().isString().isLength({ max: 400 }).withMessage('Invalid message'),
    rideController.triggerSos
)


module.exports = router;
