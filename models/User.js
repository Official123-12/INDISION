const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    isOwner: { type: Boolean, default: false },
    pairedAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    settings: { type: Object, default: {} } // optional per-user settings
});

module.exports = mongoose.model('User', userSchema);