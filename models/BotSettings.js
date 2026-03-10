const mongoose = require('mongoose');

const groupSettingSchema = new mongoose.Schema({
    // per‑group overrides – can be added dynamically
}, { strict: false });

const botSettingsSchema = new mongoose.Schema({
    botNumber: { type: String, unique: true, required: true },
    settings: { type: Object, default: {} },
    groupSettings: { type: Map, of: groupSettingSchema, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('BotSettings', botSettingsSchema);