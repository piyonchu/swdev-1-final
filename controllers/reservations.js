const mongoose = require('mongoose');
const Reservation = require('../models/Reservation');
const MassageShop = require('../models/MassageShop');
const IdempotencyKey = require('../models/IdempotencyKey');
const {
    HOLD_MINUTES,
    USER_QUEUE_LIMIT,
    USER_QUOTA_STATUSES,
    SHOP_SLOT_STATUSES,
    isWithinOpenCloseHours,
    utcDayRange,
    cancelStatusFor
} = require('../utils/reservationRules');

const shopPopulate = {
    path: 'massageShop',
    select: 'name address tel opentime closetime maxReservationsPerDate'
};

const userPopulate = {
    path: 'user',
    select: 'name tel email'
};

/** REQ4: expire holds older than 8 minutes (lazy cleanup on each request). */
const releaseExpiredHolds = async (session) => {
    const now = new Date();
    const filter = {
        status: 'held',
        holdExpiresAt: { $lte: now }
    };
    if (session) {
        await Reservation.updateMany(filter, { $set: { status: 'expired' } }).session(session);
    } else {
        await Reservation.updateMany(filter, { $set: { status: 'expired' } });
    }
};

const countUserQuota = async (userId, session) => {
    const q = Reservation.countDocuments({
        user: userId,
        status: { $in: USER_QUOTA_STATUSES }
    });
    return session ? q.session(session) : q;
};

const countShopSlotsForDate = async (shopId, reservationDate, session) => {
    const { start, end } = utcDayRange(reservationDate);
    const q = Reservation.countDocuments({
        massageShop: shopId,
        status: { $in: SHOP_SLOT_STATUSES },
        date: { $gte: start, $lt: end }
    });
    return session ? q.session(session) : q;
};

const nextQueueNumber = async (shopId, reservationDate, session) => {
    const { start, end } = utcDayRange(reservationDate);
    const q = Reservation.find({
        massageShop: shopId,
        date: { $gte: start, $lt: end },
        status: { $in: [...SHOP_SLOT_STATUSES, 'expired', 'cancelled'] },
        queueNumber: { $ne: null }
    })
        .sort({ queueNumber: -1 })
        .limit(1)
        .select('queueNumber');
    const latest = session ? await q.session(session) : await q;
    return latest.length ? latest[0].queueNumber + 1 : 1;
};

//@desc     Get reservations (own queues for users, all queues for admin)
//@route    GET /api/v1/reservations
//@route    GET /api/v1/massage-shops/:massageShopId/reservations
//@access   Private
exports.getReservations = async (req, res, next) => {
    await releaseExpiredHolds();

    let query;

    if (req.user.role !== 'admin') {
        query = Reservation.find({ user: req.user.id }).populate(shopPopulate);
    } else if (req.params.massageShopId) {
        query = Reservation.find({ massageShop: req.params.massageShopId })
            .populate(shopPopulate)
            .populate(userPopulate);
    } else {
        query = Reservation.find().populate(shopPopulate).populate(userPopulate);
    }

    try {
        const reservations = await query;
        const usedQuota = await countUserQuota(req.user.id);
        res.status(200).json({
            success: true,
            count: reservations.length,
            usedQuota,
            remainingQuota: Math.max(0, USER_QUEUE_LIMIT - usedQuota),
            data: reservations
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Cannot find Reservation' });
    }
};

//@desc     Get single reservation
//@route    GET /api/v1/reservations/:id
//@access   Private
exports.getReservation = async (req, res, next) => {
    await releaseExpiredHolds();

    try {
        const reservation = await Reservation.findById(req.params.id)
            .populate(shopPopulate)
            .populate(userPopulate);

        if (!reservation) {
            return res.status(404).json({ success: false, message: `No reservation with the id of ${req.params.id}` });
        }

        if (reservation.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(401).json({ success: false, message: `User ${req.user.id} is not authorized to view this reservation` });
        }

        res.status(200).json({
            success: true,
            data: reservation
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Cannot find Reservation' });
    }
};

/**
 * EXTRA CREDIT REQ4 — Start reservation (8-minute hold)
 * @route   POST /api/v1/massage-shops/:massageShopId/reservations/hold
 * @access  Private
 * Body: { "date": "ISO datetime" }
 */
exports.holdReservation = async (req, res, next) => {
    const started = Date.now();

    try {
        await releaseExpiredHolds();

        const shopId = req.params.massageShopId || req.body.massageShop;
        const { date } = req.body;

        if (!date) {
            return res.status(400).json({ success: false, message: 'Please provide a reservation date' });
        }

        const shop = await MassageShop.findById(shopId);
        if (!shop) {
            return res.status(404).json({ success: false, message: `No massage shop with the id of ${shopId}` });
        }

        // REQ1: reject outside open–close hours
        if (!isWithinOpenCloseHours(date, shop.opentime, shop.closetime)) {
            return res.status(400).json({
                success: false,
                message: `Requested time is outside shop hours (${shop.opentime}–${shop.closetime} UTC)`
            });
        }

        // REQ2 / base: user 3-queue quota (held counts until expired/cancelled with refund)
        if (req.user.role !== 'admin') {
            const used = await countUserQuota(req.user.id);
            if (used >= USER_QUEUE_LIMIT) {
                return res.status(400).json({
                    success: false,
                    message: `The user with ID ${req.user.id} has already made 3 reservations`
                });
            }
        }

        // REQ3 + REQ4: if shop date cap full → reject hold ("no queues remain")
        const slots = await countShopSlotsForDate(shopId, date);
        if (slots >= shop.maxReservationsPerDate) {
            return res.status(400).json({
                success: false,
                message: `No queues remain for this shop on that date (cap ${shop.maxReservationsPerDate})`
            });
        }

        const queueNumber = await nextQueueNumber(shopId, date);
        const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);

        const reservation = await Reservation.create({
            date,
            user: req.user.id,
            massageShop: shopId,
            status: 'held',
            queueNumber,
            holdExpiresAt
        });

        res.status(201).json({
            success: true,
            holdMinutes: HOLD_MINUTES,
            elapsedMs: Date.now() - started,
            data: reservation
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Cannot hold Reservation' });
    }
};

//@desc     Add reservation
//@route    POST /api/v1/massage-shops/:massageShopId/reservations
//@access   Private
exports.addReservation = async (req, res, next) => {
    try {
        const shopId = req.params.massageShopId || req.body.massageShop;
        req.body.massageShop = shopId;
        req.body.user = req.user.id;

        const shop = await MassageShop.findById(shopId);

        if (!shop) {
            return res.status(404).json({ success: false, message: `No massage shop with the id of ${shopId}` });
        }

        const existedReservations = await Reservation.find({ user: req.user.id });

        if (existedReservations.length >= 3 && req.user.role !== 'admin') {
            return res.status(400).json({
                success: false,
                message: `The user with ID ${req.user.id} has already made 3 reservations`
            });
        }

        const reservation = await Reservation.create(req.body);

        res.status(201).json({
            success: true,
            data: reservation
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Cannot create Reservation' });
    }
};

//@desc     Update reservation
//@route    PUT /api/v1/reservations/:id
//@access   Private
exports.updateReservation = async (req, res, next) => {
    try {
        let reservation = await Reservation.findById(req.params.id);

        if (!reservation) {
            return res.status(404).json({ success: false, message: `No reservation with the id of ${req.params.id}` });
        }

        if (reservation.user.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(401).json({ success: false, message: `User ${req.user.id} is not authorized to update this reservation` });
        }

        if (req.user.role !== 'admin') {
            delete req.body.user;
        }

        reservation = await Reservation.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        res.status(200).json({
            success: true,
            data: reservation
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Cannot update Reservation' });
    }
};

//@desc     Delete reservation
//@route    DELETE /api/v1/reservations/:id
//@access   Private
exports.deleteReservation = async (req, res, next) => {
    try {
        const reservation = await Reservation.findById(req.params.id);

        if (!reservation) {
            return res.status(404).json({ success: false, message: `No reservation with the id of ${req.params.id}` });
        }

        if (reservation.user.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(401).json({ success: false, message: `User ${req.user.id} is not authorized to delete this reservation` });
        }

        await reservation.deleteOne();

        res.status(200).json({
            success: true,
            data: {}
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Cannot delete Reservation' });
    }
};
