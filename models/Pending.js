const mongoose = require('mongoose');

const pendingSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    secret: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now, expires: 3600 } // expires after 1 hour
});

const Pending = mongoose.models.Pending || mongoose.model('Pending', pendingSchema);

module.exports = Pending;