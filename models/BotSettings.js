const mongoose = require('mongoose');

const groupSettingSchema = new mongoose.Schema({}, { strict: false });

const botSettingsSchema = new mongoose.Schema({
    botNumber: { type: String, unique: true, required: true },
    settings: { type: Object, default: {} },
    groupSettings: { type: Map, of: groupSettingSchema, default: {} }
}, { timestamps: true });

const BotSettings = mongoose.models.BotSettings || mongoose.model('BotSettings', botSettingsSchema);

module.exports = BotSettings;