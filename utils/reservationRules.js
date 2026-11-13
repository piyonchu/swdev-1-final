/**
 * EXTRA CREDIT helpers — Project #8 Massage Reservation
 */

const HOLD_MINUTES = 8;
const CANCEL_FREE_HOURS = 2;
const USER_QUEUE_LIMIT = 3;

// Statuses that still consume the user's 3-queue quota
const USER_QUOTA_STATUSES = ['held', 'confirmed', 'cancelled_late'];

// Statuses that still consume a shop slot for that date
// (REQ6: shop queue restored ONLY when quota is returned → cancelled / expired free the slot)
const SHOP_SLOT_STATUSES = ['held', 'confirmed', 'cancelled_late'];

const parseHHMM = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map((n) => parseInt(n, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
};

/** REQ1: reservation clock time must fall inside shop open–close (using UTC hh:mm from the Date). */
const isWithinOpenCloseHours = (reservationDate, opentime, closetime) => {
    const d = new Date(reservationDate);
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    const open = parseHHMM(opentime);
    const close = parseHHMM(closetime);
    if (open === null || close === null) return false;
    if (open <= close) {
        return minutes >= open && minutes < close;
    }
    // overnight window e.g. 22:00–02:00
    return minutes >= open || minutes < close;
};

/** Calendar day bounds in UTC for "per date" shop cap (REQ3). */
const utcDayRange = (reservationDate) => {
    const d = new Date(reservationDate);
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
    return { start, end };
};

const hoursUntil = (reservationDate, from = new Date()) => {
    return (new Date(reservationDate).getTime() - from.getTime()) / (1000 * 60 * 60);
};

/** REQ6: ≥ 2 hours before → cancelled (quota returned); else cancelled_late (quota kept). */
const cancelStatusFor = (reservationDate, from = new Date()) => {
    return hoursUntil(reservationDate, from) >= CANCEL_FREE_HOURS ? 'cancelled' : 'cancelled_late';
};

module.exports = {
    HOLD_MINUTES,
    CANCEL_FREE_HOURS,
    USER_QUEUE_LIMIT,
    USER_QUOTA_STATUSES,
    SHOP_SLOT_STATUSES,
    isWithinOpenCloseHours,
    utcDayRange,
    hoursUntil,
    cancelStatusFor
};
