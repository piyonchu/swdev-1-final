const express = require('express');
const {
    getReservations,
    getReservation,
    holdReservation,
    addReservation,
    updateReservation,
    cancelReservation,
    deleteReservation
} = require('../controllers/reservations');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.route('/')
    .get(protect, getReservations)
    .post(protect, authorize('admin', 'user'), addReservation);

// EXTRA CREDIT REQ4: start 8-minute hold before confirm/create
router.route('/hold')
    .post(protect, authorize('admin', 'user'), holdReservation);

router.route('/:id/cancel')
    .post(protect, authorize('admin', 'user'), cancelReservation);

router.route('/:id')
    .get(protect, getReservation)
    .put(protect, authorize('admin', 'user'), updateReservation)
    .delete(protect, authorize('admin', 'user'), deleteReservation);

module.exports = router;
