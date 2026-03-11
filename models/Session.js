const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    sessionData: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
});

// ✅ Prevent overwrite error
const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

module.exports = Session;