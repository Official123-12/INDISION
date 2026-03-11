import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    sessionData: { type: mongoose.Schema.Types.Mixed },
    lastActive: { type: Date, default: Date.now }
});
export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

const pendingSchema = new mongoose.Schema({
    number: { type: String, required: true },
    secret: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now, expires: 600 }
});
export const Pending = mongoose.models.Pending || mongoose.model('Pending', pendingSchema);

const botSettingsSchema = new mongoose.Schema({
    secret: { type: String, required: true, unique: true },
    number: { type: String },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now }
});
export const BotSettings = mongoose.models.BotSettings || mongoose.model('BotSettings', botSettingsSchema);