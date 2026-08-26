const Reservation = require('../models/Reservation');
const MassageShop = require('../models/MassageShop');

const shopPopulate = {
    path: 'massageShop',
    select: 'name address tel opentime closetime'
};

const userPopulate = {
    path: 'user',
    select: 'name tel email'
};

//@desc     Get reservations (own queues for users, all queues for admin)
//@route    GET /api/v1/reservations
//@route    GET /api/v1/massage-shops/:massageShopId/reservations
//@access   Private
exports.getReservations = async (req, res, next) => {
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
        res.status(200).json({
            success: true,
            count: reservations.length,
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
