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

/**
 * Create / confirm reservation
 *
 * EXTRA CREDIT path (REQ4 + REQ5):
 *   Header Idempotency-Key + body.holdId → confirm hold in one MongoDB transaction
 *   Reusing the same key within 24h returns the original reservation (no duplicate)
 *
 * Base-project path (Presentation Runner still works):
 *   No Idempotency-Key → instant confirmed create (still enforces REQ1 hours + REQ3 cap + 3-queue)
 *
 * @route   POST /api/v1/massage-shops/:massageShopId/reservations
 */
exports.addReservation = async (req, res, next) => {
    const started = Date.now();
    const idempotencyKey = req.header('Idempotency-Key') || req.header('idempotency-key');

    // ---------- EXTRA CREDIT REQ5 path ----------
    if (idempotencyKey) {
        const existingKey = await IdempotencyKey.findOne({ key: idempotencyKey, user: req.user.id }).populate('reservation');
        if (existingKey && existingKey.reservation) {
            return res.status(200).json({
                success: true,
                idempotentReplay: true,
                elapsedMs: Date.now() - started,
                data: existingKey.reservation
            });
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            await releaseExpiredHolds(session);

            const shopId = req.params.massageShopId || req.body.massageShop;
            const { date, holdId } = req.body;

            if (!holdId) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    success: false,
                    message: 'holdId is required with Idempotency-Key — POST .../reservations/hold first'
                });
            }

            const shop = await MassageShop.findById(shopId).session(session);
            if (!shop) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ success: false, message: `No massage shop with the id of ${shopId}` });
            }

            const hold = await Reservation.findById(holdId).session(session);
            if (!hold) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ success: false, message: `No hold with the id of ${holdId}` });
            }

            if (hold.user.toString() !== req.user.id && req.user.role !== 'admin') {
                await session.abortTransaction();
                session.endSession();
                return res.status(401).json({ success: false, message: 'Not authorized to confirm this hold' });
            }

            if (hold.massageShop.toString() !== String(shopId)) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ success: false, message: 'holdId does not belong to this massage shop' });
            }

            // REQ4: must confirm within 8 minutes
            if (hold.status !== 'held' || !hold.holdExpiresAt || hold.holdExpiresAt.getTime() <= Date.now()) {
                if (hold.status === 'held') {
                    hold.status = 'expired';
                    await hold.save({ session });
                }
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    success: false,
                    message: 'Hold expired or invalid — queue number was released after 8 minutes'
                });
            }

            const confirmDate = date || hold.date;

            if (!isWithinOpenCloseHours(confirmDate, shop.opentime, shop.closetime)) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    success: false,
                    message: `Requested time is outside shop hours (${shop.opentime}–${shop.closetime} UTC)`
                });
            }

            hold.status = 'confirmed';
            hold.date = confirmDate;
            hold.idempotencyKey = idempotencyKey;
            hold.holdExpiresAt = undefined;
            await hold.save({ session });

            await IdempotencyKey.create(
                [{ key: idempotencyKey, user: req.user.id, reservation: hold._id }],
                { session }
            );

            await session.commitTransaction();
            session.endSession();

            const elapsedMs = Date.now() - started;
            return res.status(201).json({
                success: true,
                idempotentReplay: false,
                elapsedMs,
                within3Seconds: elapsedMs <= 3000,
                data: hold
            });
        } catch (error) {
            await session.abortTransaction().catch(() => {});
            session.endSession();

            if (error && error.code === 11000) {
                const again = await IdempotencyKey.findOne({ key: idempotencyKey, user: req.user.id }).populate('reservation');
                if (again && again.reservation) {
                    return res.status(200).json({
                        success: true,
                        idempotentReplay: true,
                        elapsedMs: Date.now() - started,
                        data: again.reservation
                    });
                }
            }

            return res.status(500).json({ success: false, message: error.message || 'Cannot create Reservation' });
        }
    }

    // ---------- Base path (no Idempotency-Key) — still enforces hours + shop cap + user quota ----------
    // If client already started a hold, confirming it MUST send Idempotency-Key (REQ5).
    if (req.body.holdId) {
        return res.status(400).json({
            success: false,
            message: 'Idempotency-Key header is required to create a reservation'
        });
    }

    try {
        await releaseExpiredHolds();

        const shopId = req.params.massageShopId || req.body.massageShop;
        req.body.massageShop = shopId;
        req.body.user = req.user.id;

        const shop = await MassageShop.findById(shopId);
        if (!shop) {
            return res.status(404).json({ success: false, message: `No massage shop with the id of ${shopId}` });
        }

        if (!req.body.date) {
            return res.status(400).json({ success: false, message: 'Please provide a reservation date' });
        }

        if (!isWithinOpenCloseHours(req.body.date, shop.opentime, shop.closetime)) {
            return res.status(400).json({
                success: false,
                message: `Requested time is outside shop hours (${shop.opentime}–${shop.closetime} UTC)`
            });
        }

        if (req.user.role !== 'admin') {
            const used = await countUserQuota(req.user.id);
            if (used >= USER_QUEUE_LIMIT) {
                return res.status(400).json({
                    success: false,
                    message: `The user with ID ${req.user.id} has already made 3 reservations`
                });
            }
        }

        const slots = await countShopSlotsForDate(shopId, req.body.date);
        if (slots >= shop.maxReservationsPerDate) {
            return res.status(400).json({
                success: false,
                message: `No queues remain for this shop on that date (cap ${shop.maxReservationsPerDate})`
            });
        }

        const queueNumber = await nextQueueNumber(shopId, req.body.date);
        const reservation = await Reservation.create({
            date: req.body.date,
            user: req.user.id,
            massageShop: shopId,
            status: 'confirmed',
            queueNumber
        });

        res.status(201).json({
            success: true,
            elapsedMs: Date.now() - started,
            data: reservation
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Cannot create Reservation' });
    }
};

//@desc     Update reservation
//@route    PUT /api/v1/reservations/:id
//@access   Private
exports.updateReservation = async (req, res, next) => {
    await releaseExpiredHolds();

    try {
        let reservation = await Reservation.findById(req.params.id);

        if (!reservation) {
            return res.status(404).json({ success: false, message: `No reservation with the id of ${req.params.id}` });
        }

        if (reservation.user.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(401).json({ success: false, message: `User ${req.user.id} is not authorized to update this reservation` });
        }

        // Users cannot edit finished bookings; admin still can (base presentation)
        if (
            req.user.role !== 'admin' &&
            ['cancelled', 'cancelled_late', 'expired'].includes(reservation.status)
        ) {
            return res.status(400).json({ success: false, message: `Cannot update a ${reservation.status} reservation` });
        }

        if (req.user.role !== 'admin') {
            delete req.body.user;
            delete req.body.status;
        }

        // REQ1 if date changes
        if (req.body.date) {
            const shop = await MassageShop.findById(reservation.massageShop);
            if (shop && !isWithinOpenCloseHours(req.body.date, shop.opentime, shop.closetime)) {
                return res.status(400).json({
                    success: false,
                    message: `Requested time is outside shop hours (${shop.opentime}–${shop.closetime} UTC)`
                });
            }
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

/**
 * EXTRA CREDIT REQ2 + REQ6 — Cancel confirmed (or release held) reservation
 * ≥ 2 hours before → status cancelled, user quota returned, shop slot restored
 * < 2 hours before → status cancelled_late, quota NOT returned, shop slot NOT restored
 *
 * @route   POST /api/v1/reservations/:id/cancel
 */
exports.cancelReservation = async (req, res, next) => {
    await releaseExpiredHolds();

    try {
        const reservation = await Reservation.findById(req.params.id);

        if (!reservation) {
            return res.status(404).json({ success: false, message: `No reservation with the id of ${req.params.id}` });
        }

        if (reservation.user.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(401).json({ success: false, message: `User ${req.user.id} is not authorized to cancel this reservation` });
        }

        if (['cancelled', 'cancelled_late', 'expired'].includes(reservation.status)) {
            return res.status(400).json({ success: false, message: `Reservation is already ${reservation.status}` });
        }

        // Held but not confirmed: release hold → frees quota + shop slot (like expired)
        if (reservation.status === 'held') {
            reservation.status = 'expired';
            reservation.holdExpiresAt = new Date();
            await reservation.save();
            const usedQuota = await countUserQuota(req.user.id);
            return res.status(200).json({
                success: true,
                message: 'Hold released — queue returned to quota',
                quotaReturned: true,
                usedQuota,
                remainingQuota: Math.max(0, USER_QUEUE_LIMIT - usedQuota),
                data: reservation
            });
        }

        // REQ2 + REQ6 for confirmed
        const status = cancelStatusFor(reservation.date);
        const quotaReturned = status === 'cancelled';
        reservation.status = status;
        await reservation.save();

        const usedQuota = await countUserQuota(req.user.id);

        res.status(200).json({
            success: true,
            message: quotaReturned
                ? 'Cancelled at least 2 hours before — quota and shop queue restored'
                : 'Cancelled late (< 2 hours) — quota and shop queue NOT restored',
            quotaReturned,
            shopQueueRestored: quotaReturned,
            usedQuota,
            remainingQuota: Math.max(0, USER_QUEUE_LIMIT - usedQuota),
            data: reservation
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Cannot cancel Reservation' });
    }
};

/**
 * DELETE /api/v1/reservations/:id
 * - admin: hard delete (base Project #8 presentation — edit/delete any)
 * - user: soft cancel with REQ2/REQ6 rules
 */
exports.deleteReservation = async (req, res, next) => {
    if (req.user.role === 'admin') {
        await releaseExpiredHolds();
        try {
            const reservation = await Reservation.findById(req.params.id);
            if (!reservation) {
                return res.status(404).json({ success: false, message: `No reservation with the id of ${req.params.id}` });
            }
            await reservation.deleteOne();
            return res.status(200).json({ success: true, data: {} });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Cannot delete Reservation' });
        }
    }
    return exports.cancelReservation(req, res, next);
};
