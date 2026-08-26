const MassageShop = require('../models/MassageShop');
//@desc     Get all massage shops
//@route    GET /api/v1/massage-shops
//@access   Private
exports.getMassageShops = async (req, res, next) => {
    try {
        const shops = await MassageShop.find().sort('name');
        res.status(200).json({
            success: true,
            count: shops.length,
            data: shops
        });
    } catch (err) {
        res.status(400).json({ success: false });
    }
};

//@desc     Get single massage shop
//@route    GET /api/v1/massage-shops/:id
//@access   Private
exports.getMassageShop = async (req, res, next) => {
    try {
        const shop = await MassageShop.findById(req.params.id);

        if (!shop) {
            return res.status(404).json({ success: false, message: `No massage shop with the id of ${req.params.id}` });
        }

        res.status(200).json({ success: true, data: shop });
    } catch (err) {
        res.status(400).json({ success: false });
    }
};

//@desc     Create massage shop
//@route    POST /api/v1/massage-shops
//@access   Private/admin
exports.createMassageShop = async (req, res, next) => {
    try {
        const shop = await MassageShop.create(req.body);
        res.status(201).json({
            success: true,
            data: shop
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

//@desc     Update massage shop
//@route    PUT /api/v1/massage-shops/:id
//@access   Private/admin
exports.updateMassageShop = async (req, res, next) => {
    try {
        const shop = await MassageShop.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        if (!shop) {
            return res.status(404).json({ success: false, message: `No massage shop with the id of ${req.params.id}` });
        }

        res.status(200).json({ success: true, data: shop });
    } catch (err) {
        res.status(400).json({ success: false });
    }
};

//@desc     Delete massage shop
//@route    DELETE /api/v1/massage-shops/:id
//@access   Private/admin
exports.deleteMassageShop = async (req, res, next) => {
    try {
        const shop = await MassageShop.findById(req.params.id);

        if (!shop) {
            return res.status(404).json({ success: false, message: `No massage shop with the id of ${req.params.id}` });
        }

        await shop.deleteOne();

        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(400).json({ success: false });
    }
};
