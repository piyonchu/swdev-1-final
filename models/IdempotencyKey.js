const mongoose = require('mongoose');

// EXTRA CREDIT REQ5: remember Idempotency-Key → reservation for 24 hours
const IdempotencyKeySchema = new mongoose.Schema({
    key: {
        type: String,
        required: true
    },
    user: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    reservation: {
        type: mongoose.Schema.ObjectId,
        ref: 'Reservation',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        // Auto-delete after 24 hours (MongoDB TTL index)
        expires: 60 * 60 * 24
    }
});

IdempotencyKeySchema.index({ key: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('IdempotencyKey', IdempotencyKeySchema);
