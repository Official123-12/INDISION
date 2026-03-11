const mongoose = require('mongoose');

// ==================== USER SCHEMA ====================
const UserSchema = new mongoose.Schema({
    jid: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: 'Unknown' },
    deviceId: { type: String },
    linkedAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
    isFollowingChannel: { type: Boolean, default: false },
    messageCount: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now },
    warnings: { type: Number, default: 0 },
    countryCode: { type: String },
    isBlocked: { type: Boolean, default: false },
    isOwner: { type: Boolean, default: false },
    isPaired: { type: Boolean, default: false }
}, { timestamps: true });

// ==================== GROUP SCHEMA ====================
const GroupSchema = new mongoose.Schema({
    jid: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: 'Unknown Group' },
    participants: { type: Number, default: 0 },
    admins: [{ type: String }],
    joinedAt: { type: Date, default: Date.now },
    settings: {
        antilink: { type: Boolean, default: true },
        antiporn: { type: Boolean, default: true },
        antiscam: { type: Boolean, default: true },
        antimedia: { type: Boolean, default: false },
        antitag: { type: Boolean, default: true },
        antiviewonce: { type: Boolean, default: true },
        antidelete: { type: Boolean, default: true },
        welcomeGoodbye: { type: Boolean, default: true },
        chatbot: { type: Boolean, default: true }
    },
    welcomeMessage: { type: String, default: 'Welcome to the group! 🎉' },
    goodbyeMessage: { type: String, default: 'Goodbye! 👋' }
}, { timestamps: true });

// ==================== SETTINGS SCHEMA ====================
const SettingsSchema = new mongoose.Schema({
    antilink: { type: Boolean, default: true },
    antiporn: { type: Boolean, default: true },
    antiscam: { type: Boolean, default: true },
    antimedia: { type: Boolean, default: false },
    antitag: { type: Boolean, default: true },
    antiviewonce: { type: Boolean, default: true },
    antidelete: { type: Boolean, default: true },
    sleepingMode: { type: Boolean, default: false },
    welcomeGoodbye: { type: Boolean, default: true },
    chatbot: { type: Boolean, default: true },
    autoRead: { type: Boolean, default: true },
    autoReact: { type: Boolean, default: true },
    autoBio: { type: Boolean, default: true },
    anticall: { type: Boolean, default: true },
    antispam: { type: Boolean, default: true },
    antibug: { type: Boolean, default: true },
    prefix: { type: String, default: '.' },
    botName: { type: String, default: 'INSIDIOUS' },
    workMode: { type: String, enum: ['public', 'private', 'inbox', 'groups'], default: 'public' },
    ownerNumbers: [{ type: String }],
    botSecretId: { type: String, unique: true, sparse: true },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ==================== SESSION SCHEMA ====================
const SessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true, index: true },
    creds: { type: mongoose.Schema.Types.Mixed, default: {} },
    keys: { type: mongoose.Schema.Types.Mixed, default: {} },
    number: { type: String, index: true },
    lastActive: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// ==================== CREATE MODELS SAFELY ====================
const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Group = mongoose.models.Group || mongoose.model('Group', GroupSchema);
const Settings = mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);
const Session = mongoose.models.Session || mongoose.model('Session', SessionSchema);

// ==================== EXPORT MODELS ====================
module.exports = { User, Group, Settings, Session };