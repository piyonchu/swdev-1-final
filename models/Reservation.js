const mongoose = require('mongoose');

const ReservationSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: [true, 'Please add a reservation date']
    },
    user: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    massageShop: {
        type: mongoose.Schema.ObjectId,
        ref: 'MassageShop',
        required: true
    },
    // EXTRA CREDIT: lifecycle of a queue
    // held → confirmed → cancelled | cancelled_late
    // held → expired (8 minutes without confirm)
    status: {
        type: String,
        enum: ['held', 'confirmed', 'cancelled', 'cancelled_late', 'expired'],
        default: 'confirmed'
    },
    // EXTRA CREDIT REQ4: queue number reserved during hold / after confirm
    queueNumber: {
        type: Number
    },
    // EXTRA CREDIT REQ4: hold expires after 8 minutes
    holdExpiresAt: {
        type: Date
    },
    // EXTRA CREDIT REQ5: Idempotency-Key stored on the confirmed reservation
    idempotencyKey: {
        type: String,
        index: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Same user cannot reuse the same Idempotency-Key for two different rows
ReservationSchema.index(
    { user: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

module.exports = mongoose.model('Reservation', ReservationSchema);
