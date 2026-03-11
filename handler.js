const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const crypto = require('crypto');

// ==================== LOAD CONFIG ====================
let config = {};
try { config = require('./config'); } catch { config = {}; }

config.ownerNumber = (config.ownerNumber || [])
    .map(num => num.replace(/[^0-9]/g, ''))
    .filter(num => num.length >= 10);

// ==================== DEFAULT SETTINGS ====================
const DEFAULT_SETTINGS = {
    mode: 'public',
    prefix: '.',
    maxCoOwners: 2,
    botName: 'INSIDIOUS: THE LAST KEY',
    developer: 'Stanley Assanaly',
    developerNumber: '255787069580',
    version: '2.1.1',
    year: 2025,
    updated: 2026,
    specialThanks: 'REDTECH',
    botImage: 'https://files.catbox.moe/mfngio.png',
    aliveImage: 'https://files.catbox.moe/mfngio.png',
    newsletterJid: '120363404317544295@newsletter',
    newsletterLink: 'https://whatsapp.com/channel/0029Vb7fzu4EwEjmsD4Tzs1p',
    requiredGroupJid: '120363406549688641@g.us',
    requiredGroupInvite: 'https://chat.whatsapp.com/J19JASXoaK0GVSoRvShr4Y',
    autoFollowChannels: ['120363404317544295@newsletter'],

    // ========== ANTI FEATURES ==========
    antilink: true,
    antiporn: true,
    antiscam: true,
    antimedia: true,
    antitag: true,
    antiviewonce: true,
    antidelete: true,
    sleepingmode: true,
    antispam: true,
    anticall: true,
    antistatusmention: true,
    antifake: true,
    antipromote: true,
    antiurl: true,

    // ========== AUTO FEATURES ==========
    autoRead: true,
    autoReact: true,
    autoTyping: true,
    autoRecording: true,
    autoBio: true,
    autostatus: true,
    downloadStatus: false,
    autoSaveContact: false,
    autoDeleteMessages: false,
    autoReply: false,

    // ========== GROUP MANAGEMENT ==========
    welcomeGoodbye: true,
    activemembers: true,
    autoblockCountry: false,
    lockGroupSettings: false,

    // ========== AI ==========
    chatbot: true,

    // ========== THRESHOLDS & LIMITS ==========
    warnLimit: 3,
    maxTags: 5,
    inactiveDays: 7,
    antiSpamLimit: 5,
    antiSpamInterval: 10000,
    sleepingStart: '23:00',
    sleepingEnd: '06:00',
    maxMessagesPerMinute: 20,

    // ========== KEYWORDS ==========
    scamKeywords: ['win', 'prize', 'lottery', 'congratulations', 'million', 'inheritance', 'selected', 'claim', 'urgent', 'verify account'],
    pornKeywords: ['xxx', 'porn', 'sex', 'nude', 'adult', '18+', 'onlyfans', 'cam', 'escort'],
    fakeNumberPrefixes: ['120', '121', '122', '123', '999', '000'],
    blockedMediaTypes: ['photo', 'video', 'sticker'],
    blockedCountries: [],
    blockedUrlShorteners: ['bit.ly', 'tinyurl', 'short.link', 'cutt.ly', 'ow.ly'],

    // ========== AUTO REACT / STATUS ==========
    autoReactEmojis: ['❤️', '🔥', '👍', '🎉', '👏', '⚡', '✨', '🌟', '💎', '🛡️'],
    autoStatusActions: ['view', 'react', 'reply'],
    statusReplyLimit: 50,

    // ========== SCOPES ==========
    autoReadScope: 'all',
    autoReactScope: 'all',
    chatbotScope: 'all',
    antiviewonceScope: 'all',
    antideleteScope: 'all',

    // ========== AUTO EXPIRE ==========
    autoExpireMinutes: 10,

    // ========== SECURITY ==========
    enableRateLimit: true,
    rateLimitWindow: 60000,
    rateLimitMax: 30,
    enableIpBlock: false,
    blockedIps: [],

    // ========== API ==========
    quoteApiUrl: 'https://api.quotable.io/random',
    aiApiUrl: 'https://text.pollinations.ai/',
    pornFilterApiKey: '',
};

// ==================== MONGODB MODELS (Centralized) ====================
const { Session, BotSettings } = require('./database/models');

// ==================== PER‑BOT SETTINGS CACHE ====================
const botSettingsCache = new Map(); // key: botNumber, value: settings object

async function loadBotSettings(botNumber) {
    try {
        let settings = await BotSettings.findOne({ botNumber });
        if (!settings) {
            settings = new BotSettings({ botNumber, settings: DEFAULT_SETTINGS });
            await settings.save();
        }
        botSettingsCache.set(botNumber, settings.settings);
        return settings.settings;
    } catch (err) {
        console.error(`[${botNumber}] Error loading settings:`, err);
        return DEFAULT_SETTINGS;
    }
}

async function saveBotSettings(botNumber, newSettings) {
    try {
        await BotSettings.findOneAndUpdate(
            { botNumber },
            { settings: newSettings },
            { upsert: true }
        );
        botSettingsCache.set(botNumber, newSettings);
    } catch (err) {
        console.error(`[${botNumber}] Error saving settings:`, err);
    }
}

function getBotSetting(botNumber, key) {
    const settings = botSettingsCache.get(botNumber);
    return settings && settings[key] !== undefined ? settings[key] : DEFAULT_SETTINGS[key];
}

// ==================== PER‑BOT GROUP SETTINGS ====================
async function getGroupSetting(botNumber, groupJid, key) {
    const settings = await loadBotSettings(botNumber);
    const groupSettings = settings.groupSettings || {};
    const gs = groupSettings[groupJid] || {};
    return gs[key] !== undefined ? gs[key] : getBotSetting(botNumber, key);
}

async function setGroupSetting(botNumber, groupJid, key, value) {
    const settings = await loadBotSettings(botNumber);
    if (!settings.groupSettings) settings.groupSettings = {};
    if (!settings.groupSettings[groupJid]) settings.groupSettings[groupJid] = {};
    settings.groupSettings[groupJid][key] = value;
    await saveBotSettings(botNumber, settings);
}

// ==================== PAIRING / SESSION SYSTEM ====================
let botSecretId = null;

function generateBotId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = 'INS';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

async function loadBotId() {
    const botSession = await Session.findOne({ sessionId: 'BOT_MASTER' });
    if (botSession && botSession.creds && botSession.creds.botId) {
        botSecretId = botSession.creds.botId;
    } else {
        botSecretId = generateBotId();
        await Session.updateOne(
            { sessionId: 'BOT_MASTER' },
            { $set: { creds: { botId: botSecretId } } },
            { upsert: true }
        );
    }
}

// ==================== OWNERSHIP CHECKS ====================
function isGlobalAdmin(number) {
    const clean = number.replace(/[^0-9]/g, '');
    return config.ownerNumber.includes(clean);
}

function isBotOwner(botNumber, senderNumber) {
    return senderNumber === botNumber;
}

async function isDeployer(number) { // kept for backward compatibility
    return isGlobalAdmin(number);
}
async function isCoOwner(number) {
    return isGlobalAdmin(number);
}

async function getSessionInfo(number) {
    const clean = number.replace(/[^0-9]/g, '');
    const session = await Session.findOne({ number: clean, status: 'active' });
    if (!session) return null;
    return {
        sessionId: session.sessionId,
        phoneNumber: session.number,      // ← map number field
        status: session.status,
        createdAt: session.createdAt
    };
}

async function getActiveSessions() {
    const sessions = await Session.find({ status: 'active' });
    return sessions.filter(s => !config.ownerNumber.includes(s.number));
}

// ==================== PER‑BOT STORAGE (to avoid cross‑bot interference) ====================
const messageStore = new Map();          // key: botNumber -> Map of messageId -> content
const warningTracker = new Map();        // key: botNumber -> Map of sender -> count
const spamTracker = new Map();           // key: botNumber -> Map of key -> {count, timestamp}
const inactiveTracker = new Map();       // key: botNumber -> Map of userJid -> lastActive
const statusCache = new Map();           // key: botNumber -> Set of status IDs
const rateLimitStore = new Map();        // key: botNumber -> Map of userId -> {count, windowStart}

let statusReplyCount = 0;                // global? but per bot? better to make per bot
let lastReset = Date.now();

// ==================== HELPER FUNCTIONS ====================
function fancy(text) {
    if (!text || typeof text !== 'string') return text;
    const map = {
        a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
        j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ',
        s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
        A: 'ᴀ', B: 'ʙ', C: 'ᴄ', D: 'ᴅ', E: 'ᴇ', F: 'ꜰ', G: 'ɢ', H: 'ʜ', I: 'ɪ',
        J: 'ᴊ', K: 'ᴋ', L: 'ʟ', M: 'ᴍ', N: 'ɴ', O: 'ᴏ', P: 'ᴘ', Q: 'ǫ', R: 'ʀ',
        S: 'ꜱ', T: 'ᴛ', U: 'ᴜ', V: 'ᴠ', W: 'ᴡ', X: 'x', Y: 'ʏ', Z: 'ᴢ'
    };
    return text.split('').map(c => map[c] || c).join('');
}

function getUsername(jid) { return jid?.split('@')[0] || 'Unknown'; }

async function getContactName(conn, jid) {
    try {
        const contact = await conn.getContact(jid);
        return contact?.name || contact?.pushname || getUsername(jid);
    } catch { return getUsername(jid); }
}

async function getGroupName(conn, groupJid) {
    try {
        const meta = await conn.groupMetadata(groupJid);
        return meta.subject || 'Group';
    } catch { return 'Group'; }
}

async function isBotAdmin(conn, groupJid) {
    try {
        if (!conn.user?.id) return false;
        const meta = await conn.groupMetadata(groupJid);
        return meta.participants.some(p => p.id === conn.user.id && (p.admin === 'admin' || p.admin === 'superadmin'));
    } catch { return false; }
}

async function isParticipantAdmin(conn, groupJid, participantJid) {
    try {
        const meta = await conn.groupMetadata(groupJid);
        const participant = meta.participants.find(p => p.id === participantJid);
        return participant ? (participant.admin === 'admin' || participant.admin === 'superadmin') : false;
    } catch { return false; }
}

function enhanceMessage(conn, msg) {
    if (!msg) return msg;
    if (!msg.reply) {
        msg.reply = async (text, options = {}) => {
            try {
                return await conn.sendMessage(msg.key.remoteJid, { text, ...options }, { quoted: msg });
            } catch (e) { return null; }
        };
    }
    return msg;
}

async function isUserInRequiredGroup(conn, userJid, botNumber) {
    const requiredJid = getBotSetting(botNumber, 'requiredGroupJid');
    if (!requiredJid) return true;
    try {
        const groupMeta = await conn.groupMetadata(requiredJid);
        return groupMeta.participants.some(p => p.id === userJid);
    } catch { return false; }
}

// ==================== RATE LIMITING (per bot) ====================
function checkRateLimit(botNumber, userId) {
    const settings = getBotSetting(botNumber, 'enableRateLimit');
    if (!settings) return { allowed: true };
    
    const now = Date.now();
    const window = getBotSetting(botNumber, 'rateLimitWindow');
    const max = getBotSetting(botNumber, 'rateLimitMax');
    
    let botStore = rateLimitStore.get(botNumber);
    if (!botStore) {
        botStore = new Map();
        rateLimitStore.set(botNumber, botStore);
    }
    
    let record = botStore.get(userId);
    if (!record || now - record.windowStart > window) {
        record = { count: 1, windowStart: now };
    } else {
        record.count++;
    }
    botStore.set(userId, record);
    
    // Cleanup old entries
    if (botStore.size > 1000) {
        for (const [key, val] of botStore) {
            if (now - val.windowStart > window * 2) {
                botStore.delete(key);
            }
        }
    }
    
    return { allowed: record.count <= max, remaining: max - record.count, resetIn: window - (now - record.windowStart) };
}

// ==================== UNIVERSAL MESSAGE EXTRACTOR ====================
function extractMessageText(msg) {
    try {
        if (!msg.message) return '';
        const type = Object.keys(msg.message)[0];
        let body = '';

        if (type === 'conversation') body = msg.message.conversation || '';
        else if (type === 'extendedTextMessage') body = msg.message.extendedTextMessage.text || '';
        else if (type === 'buttonsResponseMessage') body = msg.message.buttonsResponseMessage.selectedButtonId || '';
        else if (type === 'templateButtonReplyMessage') body = msg.message.templateButtonReplyMessage.selectedId || '';
        else if (type === 'interactiveResponseMessage') {
            const nativeFlow = msg.message.interactiveResponseMessage?.nativeFlowResponseMessage;
            if (nativeFlow && nativeFlow.paramsJson) {
                const parsed = JSON.parse(nativeFlow.paramsJson);
                body = parsed.id || '';
            }
        }
        else if (type === 'imageMessage') body = msg.message.imageMessage.caption || '';
        else if (type === 'videoMessage') body = msg.message.videoMessage.caption || '';
        else if (type === 'documentMessage') body = msg.message.documentMessage.caption || '';
        else if (type === 'viewOnceMessage') {
            const subMsg = msg.message.viewOnceMessage.message;
            if (subMsg) return extractMessageText({ message: subMsg });
        }
        return body.trim();
    } catch (e) {
        console.error('Error extracting message text:', e);
        return '';
    }
}

// ==================== ACTION APPLIER ====================
async function applyAction(conn, from, sender, actionType, reason, warnIncrement = 1, customMessage = '') {
    if (!from.endsWith('@g.us')) return;
    const isAdmin = await isBotAdmin(conn, from);
    if (!isAdmin) return;

    const botNumber = conn.user.id.split(':')[0];
    const mention = [sender];
    const userTag = `@${sender.split('@')[0]}`;
    const userName = await getContactName(conn, sender);

    if (actionType === 'warn') {
        let botWarns = warningTracker.get(botNumber);
        if (!botWarns) {
            botWarns = new Map();
            warningTracker.set(botNumber, botWarns);
        }
        const warn = (botWarns.get(sender) || 0) + warnIncrement;
        botWarns.set(sender, warn);
        const warnLimit = await getGroupSetting(botNumber, from, 'warnLimit');
        
        let message = customMessage || `⚠️ ${userTag} (${userName}) – Rule violation: *${reason}*. Message deleted. Warning ${warn}/${warnLimit}.`;
        await conn.sendMessage(from, { text: fancy(message), mentions: mention }).catch(() => {});
        
        if (warn >= warnLimit) {
            await conn.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
            const removeMsg = `🚫 ${userTag} (${userName}) – Removed. Reason: *${reason}* (exceeded ${warnLimit} warnings).`;
            await conn.sendMessage(from, { text: fancy(removeMsg), mentions: mention }).catch(() => {});
            botWarns.delete(sender);
        }
    } else if (actionType === 'remove') {
        await conn.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
        const removeMsg = `🚫 ${userTag} (${userName}) – Removed. Reason: *${reason}*.`;
        await conn.sendMessage(from, { text: fancy(removeMsg), mentions: mention }).catch(() => {});
    } else if (actionType === 'block') {
        await conn.updateBlockStatus(sender, 'block').catch(() => {});
    }
}

// ==================== ANTI FEATURES ====================
async function handleAntiStatusMention(conn, msg, from, sender) {
    if (!from.endsWith('@g.us')) return false;
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, from, 'antistatusmention'))) return false;
    
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    if (contextInfo?.stanzaId && contextInfo?.remoteJid === 'status@broadcast') {
        await conn.sendMessage(from, { delete: msg.key }).catch(() => {});
        const userName = await getContactName(conn, sender);
        const customMsg = `⚠️ @${sender.split('@')[0]} (${userName}) – Replying to status in groups is not allowed. Your message has been deleted.`;
        await applyAction(conn, from, sender, 'warn', 'Status mention in group', 1, customMsg);
        return true;
    }
    return false;
}

function isFakeNumber(botNumber, number) {
    if (!getBotSetting(botNumber, 'antifake')) return false;
    const prefixes = getBotSetting(botNumber, 'fakeNumberPrefixes') || [];
    return prefixes.some(prefix => number.startsWith(prefix));
}

async function handleAntiUrl(conn, msg, body, from, sender) {
    if (!from.endsWith('@g.us')) return false;
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, from, 'antiurl'))) return false;
    
    const shorteners = await getGroupSetting(botNumber, from, 'blockedUrlShorteners') || DEFAULT_SETTINGS.blockedUrlShorteners;
    const hasShortener = shorteners.some(short => body.toLowerCase().includes(short));
    
    if (hasShortener) {
        await conn.sendMessage(from, { delete: msg.key }).catch(() => {});
        const userName = await getContactName(conn, sender);
        const customMsg = `⚠️ @${sender.split('@')[0]} (${userName}) – URL shorteners are not allowed. Your message has been deleted.`;
        await applyAction(conn, from, sender, 'warn', 'URL shortener', 1, customMsg);
        return true;
    }
    return false;
}

async function handleAntiPromote(conn, update) {
    const { id, participants, action, author } = update;
    if (!id.endsWith('@g.us')) return;
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, id, 'antipromote'))) return;
    
    const isAdmin = await isBotAdmin(conn, id);
    if (!isAdmin) return;
    
    if (author && !await isParticipantAdmin(conn, id, author)) {
        if (action === 'promote') {
            await conn.groupParticipantsUpdate(id, participants, 'demote').catch(() => {});
        } else if (action === 'demote') {
            await conn.groupParticipantsUpdate(id, participants, 'promote').catch(() => {});
        }
        
        const authorName = await getContactName(conn, author);
        await conn.sendMessage(id, {
            text: fancy(`🔒 @${author.split('@')[0]} (${authorName}) – Unauthorized group setting change reverted. Only admins can promote/demote.`),
            mentions: [author]
        }).catch(() => {});
    }
}

async function handleAntiLink(conn, msg, body, from, sender) {
    if (!from.endsWith('@g.us')) return false;
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, from, 'antilink'))) return false;
    const linkRegex = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-\/a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
    if (!linkRegex.test(body)) return false;
    
    await conn.sendMessage(from, { delete: msg.key }).catch(() => {});
    const userName = await getContactName(conn, sender);
    const customMsg = `⚠️ @${sender.split('@')[0]} (${userName}) – Links are not allowed. Message deleted. Warning`;
    await applyAction(conn, from, sender, 'warn', 'Sending links', 1, customMsg);
    return true;
}

async function handleAntiPorn(conn, msg, body, from, sender) {
    if (!from.endsWith('@g.us')) return false;
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, from, 'antiporn'))) return false;
    const keywords = await getGroupSetting(botNumber, from, 'pornKeywords');
    if (keywords.some(w => body.toLowerCase().includes(w))) {
        await conn.sendMessage(from, { delete: msg.key }).catch(() => {});
        const userName = await getContactName(conn, sender);
        const customMsg = `⚠️ @${sender.split('@')[0]} (${userName}) – Adult content forbidden. Message deleted. Warning`;
        await applyAction(conn, from, sender, 'warn', 'Adult content', 2, customMsg);
        return true;
    }
    return false;
}

async function handleAntiScam(conn, msg, body, from, sender) {
    if (!from.endsWith('@g.us')) return false;
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, from, 'antiscam'))) return false;
    const keywords = await getGroupSetting(botNumber, from, 'scamKeywords');
    if (keywords.some(w => body.toLowerCase().includes(w))) {
        await conn.sendMessage(from, { delete: msg.key }).catch(() => {});
        const meta = await conn.groupMetadata(from);
        const allMentions = meta.participants.map(p => p.id);
        const userName = await getContactName(conn, sender);
        await conn.sendMessage(from, {
            text: fancy(`⚠️ *SCAM ALERT!* @${sender.split('@')[0]} (${userName}) sent suspicious content. Message deleted. Do not engage.`),
            mentions: allMentions
        }).catch(() => {});
        const customMsg = `⚠️ @${sender.split('@')[0]} (${userName}) – Scam content detected. Message deleted. Warning`;
        await applyAction(conn, from, sender, 'warn', 'Scam content', 2, customMsg);
        return true;
    }
    return false;
}

async function handleAntiMedia(conn, msg, from, sender) {
    if (!from.endsWith('@g.us')) return false;
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, from, 'antimedia'))) return false;
    const blocked = await getGroupSetting(botNumber, from, 'blockedMediaTypes') || [];
    const isPhoto = !!msg.message?.imageMessage;
    const isVideo = !!msg.message?.videoMessage;
    const isSticker = !!msg.message?.stickerMessage;
    const isAudio = !!msg.message?.audioMessage;
    const isDocument = !!msg.message?.documentMessage;
    
    let mediaType = isPhoto ? 'PHOTO' : isVideo ? 'VIDEO' : isSticker ? 'STICKER' : isAudio ? 'AUDIO' : isDocument ? 'DOCUMENT' : '';
    if ((blocked.includes('photo') && isPhoto) ||
        (blocked.includes('video') && isVideo) ||
        (blocked.includes('sticker') && isSticker) ||
        (blocked.includes('audio') && isAudio) ||
        (blocked.includes('document') && isDocument) ||
        (blocked.includes('all') && (isPhoto || isVideo || isSticker || isAudio || isDocument))) {
        
        await conn.sendMessage(from, { delete: msg.key }).catch(() => {});
        const userName = await getContactName(conn, sender);
        const customMsg = `⚠️ @${sender.split('@')[0]} (${userName}) – ${mediaType} not allowed. Message deleted. Warning`;
        await applyAction(conn, from, sender, 'warn', `Sending ${mediaType}`, 1, customMsg);
        return true;
    }
    return false;
}

async function handleAntiTag(conn, msg, from, sender) {
    if (!from.endsWith('@g.us')) return false;
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, from, 'antitag'))) return false;
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    if (!mentions || mentions.length < (await getGroupSetting(botNumber, from, 'maxTags'))) return false;
    
    await conn.sendMessage(from, { delete: msg.key }).catch(() => {});
    const userName = await getContactName(conn, sender);
    const customMsg = `⚠️ @${sender.split('@')[0]} (${userName}) – Excessive tagging (${mentions.length} mentions). Message deleted. Warning`;
    await applyAction(conn, from, sender, 'warn', 'Excessive tagging', 1, customMsg);
    return true;
}

async function handleAntiSpam(conn, msg, from, sender) {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, from, 'antispam'))) return false;
    const now = Date.now();
    const key = `${from}:${sender}`;
    const limit = await getGroupSetting(botNumber, from, 'antiSpamLimit');
    const interval = await getGroupSetting(botNumber, from, 'antiSpamInterval');
    
    let botSpam = spamTracker.get(botNumber);
    if (!botSpam) {
        botSpam = new Map();
        spamTracker.set(botNumber, botSpam);
    }
    
    let record = botSpam.get(key) || { count: 0, timestamp: now };
    if (now - record.timestamp > interval) {
        record = { count: 1, timestamp: now };
    } else {
        record.count++;
    }
    botSpam.set(key, record);
    
    if (record.count > limit) {
        await conn.sendMessage(from, { delete: msg.key }).catch(() => {});
        const userName = await getContactName(conn, sender);
        const customMsg = `⚠️ @${sender.split('@')[0]} (${userName}) – Sending too fast. Slow down. Warning`;
        await applyAction(conn, from, sender, 'warn', 'Spamming', 1, customMsg);
        return true;
    }
    return false;
}

async function handleAntiCall(conn, call) {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getBotSetting(botNumber, 'anticall'))) return;
    await conn.rejectCall(call.id, call.from).catch(() => {});
    if (!config.ownerNumber.includes(call.from.split('@')[0])) {
        await conn.updateBlockStatus(call.from, 'block').catch(() => {});
    }
}

async function handleViewOnce(conn, msg) {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getBotSetting(botNumber, 'antiviewonce'))) return false;
    if (!msg.message?.viewOnceMessageV2 && !msg.message?.viewOnceMessage) return false;
    const scope = await getBotSetting(botNumber, 'antiviewonceScope') || 'all';
    if (scope === 'group' && !msg.key.remoteJid.endsWith('@g.us')) return false;
    if (scope === 'private' && msg.key.remoteJid.endsWith('@g.us')) return false;
    
    for (const num of config.ownerNumber) {
        const sentMsg = await conn.sendMessage(num + '@s.whatsapp.net', {
            forward: msg,
            caption: fancy(`👁️ VIEW ONCE RECOVERED\nFrom: @${msg.key.participant?.split('@')[0] || 'Unknown'}\nTime: ${new Date().toLocaleString()}`),
            mentions: [msg.key.participant].filter(Boolean)
        }).catch(() => {});
        if (sentMsg && (await getBotSetting(botNumber, 'autoDeleteMessages')) && (await getBotSetting(botNumber, 'autoExpireMinutes')) > 0) {
            setTimeout(async () => {
                try { await conn.sendMessage(num + '@s.whatsapp.net', { delete: sentMsg.key }); } catch {}
            }, (await getBotSetting(botNumber, 'autoExpireMinutes')) * 60 * 1000);
        }
    }
    return true;
}

async function handleAntiDelete(conn, msg) {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getBotSetting(botNumber, 'antidelete'))) return false;
    if (!msg.message?.protocolMessage || msg.message.protocolMessage.type !== 5) return false;
    
    let botMsgStore = messageStore.get(botNumber);
    if (!botMsgStore) {
        botMsgStore = new Map();
        messageStore.set(botNumber, botMsgStore);
    }
    const stored = botMsgStore.get(msg.message.protocolMessage.key.id);
    if (!stored) return false;
    
    const scope = await getBotSetting(botNumber, 'antideleteScope') || 'all';
    const isGroup = stored.sender.includes('@g.us');
    if (scope === 'group' && !isGroup) return false;
    if (scope === 'private' && isGroup) return false;
    
    for (const num of config.ownerNumber) {
        const sentMsg = await conn.sendMessage(num + '@s.whatsapp.net', {
            text: `🗑️ *DELETED MESSAGE*\n\nFrom: @${stored.sender.split('@')[0]}\nContent: ${stored.content}`,
            mentions: [stored.sender]
        }).catch(() => {});
        if (sentMsg && (await getBotSetting(botNumber, 'autoDeleteMessages')) && (await getBotSetting(botNumber, 'autoExpireMinutes')) > 0) {
            setTimeout(async () => {
                try { await conn.sendMessage(num + '@s.whatsapp.net', { delete: sentMsg.key }); } catch {}
            }, (await getBotSetting(botNumber, 'autoExpireMinutes')) * 60 * 1000);
        }
    }
    botMsgStore.delete(msg.message.protocolMessage.key.id);
    return true;
}

// ==================== AUTO FEATURES ====================
async function handleAutoStatus(conn, statusMsg) {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getBotSetting(botNumber, 'autostatus'))) return;
    if (statusMsg.key.remoteJid !== 'status@broadcast') return;
    const actions = await getBotSetting(botNumber, 'autoStatusActions');
    const statusId = statusMsg.key.id;
    
    let botStatusCache = statusCache.get(botNumber);
    if (!botStatusCache) {
        botStatusCache = new Set();
        statusCache.set(botNumber, botStatusCache);
    }
    if (botStatusCache.has(statusId)) return;
    botStatusCache.add(statusId);
    if (botStatusCache.size > 500) {
        const keys = Array.from(botStatusCache).slice(0, 100);
        keys.forEach(k => botStatusCache.delete(k));
    }
    if (actions.includes('view')) await conn.readMessages([statusMsg.key]).catch(() => {});
    if (actions.includes('react')) {
        const emoji = (await getBotSetting(botNumber, 'autoReactEmojis'))[Math.floor(Math.random() * (await getBotSetting(botNumber, 'autoReactEmojis')).length)];
        await conn.sendMessage('status@broadcast', { react: { text: emoji, key: statusMsg.key } }).catch(() => {});
    }
    if (actions.includes('reply') && statusReplyCount < (await getBotSetting(botNumber, 'statusReplyLimit'))) {
        const caption = statusMsg.message?.imageMessage?.caption || statusMsg.message?.videoMessage?.caption || statusMsg.message?.conversation || '';
        if (caption) {
            try {
                const res = await axios.get((await getBotSetting(botNumber, 'aiApiUrl')) + encodeURIComponent(caption) + '?system=Reply warmly to this status.');
                await conn.sendMessage(statusMsg.key.participant, { text: res.data }).catch(() => {});
                statusReplyCount++;
            } catch {}
        }
    }
}

async function updateAutoBio(conn) {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getBotSetting(botNumber, 'autoBio'))) return;
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const bio = `${await getBotSetting(botNumber, 'developer')} | Uptime: ${hours}h ${minutes}m | INSIDIOUS V${await getBotSetting(botNumber, 'version')}`;
    await conn.updateProfileStatus(bio).catch(() => {});
}

async function handleAutoBlockCountry(conn, participant, isExempt = false) {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getBotSetting(botNumber, 'autoblockCountry')) || isExempt) return false;
    const blocked = await getBotSetting(botNumber, 'blockedCountries') || [];
    if (!blocked.length) return false;
    const number = participant.split('@')[0];
    const countryMatch = number.match(/^(\d{1,3})/);
    if (countryMatch && blocked.includes(countryMatch[1])) {
        await conn.updateBlockStatus(participant, 'block').catch(() => {});
        return true;
    }
    return false;
}

async function autoSaveContact(conn, sender, from, isGroup) {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getBotSetting(botNumber, 'autoSaveContact')) || isGroup || sender === conn.user.id) return;
    const contactFile = path.join(__dirname, 'contacts.json');
    let contacts = {};
    try { contacts = await fs.readJson(contactFile); } catch {}
    if (!contacts[sender]) {
        const name = await getContactName(conn, sender);
        contacts[sender] = { name, firstSeen: new Date().toISOString() };
        await fs.writeJson(contactFile, contacts);
    }
}

// ==================== WELCOME / GOODBYE ====================
async function handleWelcome(conn, participant, groupJid, action = 'add') {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, groupJid, 'welcomeGoodbye'))) return;
    const isAdmin = await isBotAdmin(conn, groupJid);
    if (!isAdmin) return;

    const name = await getContactName(conn, participant);
    const group = await getGroupName(conn, groupJid);
    const meta = await conn.groupMetadata(groupJid);
    const total = meta.participants.length;
    
    let quote = '';
    try {
        const res = await axios.get(await getBotSetting(botNumber, 'quoteApiUrl'));
        quote = res.data.content;
    } catch { quote = 'Welcome to the family!'; }

    const userTag = `@${participant.split('@')[0]}`;
    const mentions = [participant];
    const header = action === 'add' ? `🎉 WELCOME TO ${group.toUpperCase()}!` : `👋 GOODBYE!`;
    
    const messageText = fancy(
        `╭━━━━━━━━━━━━━━╮\n   ${header}\n╰━━━━━━━━━━━━━━╯\n\n` +
        `👤 Name: ${name}\n📞 Phone: ${userTag}\n🕐 ${action === 'add' ? 'Joined' : 'Left'}: ${new Date().toLocaleString()}\n` +
        `📝 Description: ${meta.desc || 'No description'}\n👥 Total Members: ${total}\n` +
        `🔗 Group: ${await getBotSetting(botNumber, 'requiredGroupInvite')}\n💬 "${quote}"`
    );

    try {
        const picUrl = await conn.profilePictureUrl(participant, 'image');
        const { prepareWAMessageMedia } = require('@whiskeysockets/baileys');
        const profilePic = await prepareWAMessageMedia({ image: { url: picUrl } }, { upload: conn.waUploadToServer });
        await conn.sendMessage(groupJid, { image: profilePic.imageMessage, caption: messageText, mentions }).catch(() => {});
    } catch {
        await conn.sendMessage(groupJid, { text: messageText, mentions }).catch(() => {});
    }
}

function trackActivity(botNumber, userJid) {
    let botInactive = inactiveTracker.get(botNumber);
    if (!botInactive) {
        botInactive = new Map();
        inactiveTracker.set(botNumber, botInactive);
    }
    botInactive.set(userJid, Date.now());
}

async function autoRemoveInactive(conn) {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getBotSetting(botNumber, 'activemembers'))) return;
    const inactiveDays = await getBotSetting(botNumber, 'inactiveDays');
    const now = Date.now();
    let botInactive = inactiveTracker.get(botNumber);
    if (!botInactive) botInactive = new Map();
    
    for (const [jid, _] of (await getBotSetting(botNumber, 'groupSettings')) || {}) {
        if (!jid.endsWith('@g.us')) continue;
        if (!(await getGroupSetting(botNumber, jid, 'activemembers'))) continue;
        const isAdmin = await isBotAdmin(conn, jid);
        if (!isAdmin) continue;
        
        const meta = await conn.groupMetadata(jid).catch(() => null);
        if (!meta) continue;
        
        const toRemove = [];
        for (const p of meta.participants) {
            const lastActive = botInactive.get(p.id) || 0;
            if (now - lastActive > inactiveDays * 24 * 60 * 60 * 1000) {
                toRemove.push(p.id);
            }
        }
        if (toRemove.length) {
            await conn.groupParticipantsUpdate(jid, toRemove, 'remove').catch(() => {});
            await conn.sendMessage(jid, { text: fancy(`🧹 Removed ${toRemove.length} inactive members (${inactiveDays} days).`) }).catch(() => {});
        }
    }
}

// ==================== SLEEPING MODE (per bot) ====================
const sleepingCrons = new Map(); // key: botNumber -> cron job

async function initSleepingMode(conn) {
    const botNumber = conn.user.id.split(':')[0];
    
    // Stop previous cron for this bot if exists
    if (sleepingCrons.has(botNumber)) {
        sleepingCrons.get(botNumber).stop();
        sleepingCrons.delete(botNumber);
    }
    
    if (!(await getBotSetting(botNumber, 'sleepingmode'))) return;
    
    const [startHour, startMin] = (await getBotSetting(botNumber, 'sleepingStart')).split(':').map(Number);
    const [endHour, endMin] = (await getBotSetting(botNumber, 'sleepingEnd')).split(':').map(Number);
    
    const cronJob = cron.schedule('* * * * *', async () => {
        const now = new Date();
        const current = now.getHours() * 60 + now.getMinutes();
        const start = startHour * 60 + startMin;
        const end = endHour * 60 + endMin;
        
        for (const [jid, _] of (await getBotSetting(botNumber, 'groupSettings')) || {}) {
            if (!jid.endsWith('@g.us')) continue;
            if (!(await getGroupSetting(botNumber, jid, 'sleepingmode'))) continue;
            const isAdmin = await isBotAdmin(conn, jid);
            if (!isAdmin) continue;
            
            const meta = await conn.groupMetadata(jid).catch(() => null);
            if (!meta) continue;
            const isClosed = meta.announce === true;
            
            const shouldClose = (start <= end) ? (current >= start && current < end) : (current >= start || current < end);
            
            if (shouldClose && !isClosed) {
                await conn.groupSettingUpdate(jid, 'announcement').catch(() => {});
            } else if (!shouldClose && isClosed) {
                await conn.groupSettingUpdate(jid, 'not_announcement').catch(() => {});
            }
        }
    });
    sleepingCrons.set(botNumber, cronJob);
}

// ==================== AI CHATBOT ====================
async function handleChatbot(conn, msg, from, body, sender) {
    const botNumber = conn.user.id.split(':')[0];
    if (!(await getGroupSetting(botNumber, from, 'chatbot')) && !(await getBotSetting(botNumber, 'chatbot'))) return false;
    const scope = await getGroupSetting(botNumber, from, 'chatbotScope') || 'all';
    const isGroup = from.endsWith('@g.us');
    if (scope === 'group' && !isGroup) return false;
    if (scope === 'private' && isGroup) return false;

    if (isGroup) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const botJid = conn.user.id.split(':')[0] + '@s.whatsapp.net';
        const isReplyToBot = msg.message?.extendedTextMessage?.contextInfo?.stanzaId &&
                             msg.message.extendedTextMessage.contextInfo.participant === botJid;
        if (!mentioned.includes(botJid) && !isReplyToBot) return false;
    }
    
    await conn.sendPresenceUpdate('composing', from);

    const systemPrompt = `You are INSIDIOUS V${await getBotSetting(botNumber, 'version')}, created by Stanley Assanaly. 
Stanley is a 22-year-old Tanzanian software engineer from Mwanza, graduated from Shinyanga Technical College (2024). 
He builds web apps, predictors, and automation tools. When asked about your developer, introduce Stanley proudly. 
Reply in the user's language, be helpful and concise.`;

    try {
        const url = (await getBotSetting(botNumber, 'aiApiUrl')) + encodeURIComponent(body) + '?system=' + encodeURIComponent(systemPrompt);
        const res = await axios.get(url, { timeout: 10000 });
        await conn.sendMessage(from, {
            text: fancy(res.data),
            contextInfo: {
                isForwarded: true,
                forwardingScore: 999,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: await getBotSetting(botNumber, 'newsletterJid'),
                    newsletterName: await getBotSetting(botNumber, 'botName')
                }
            }
        }, { quoted: msg }).catch(() => {});
        return true;
    } catch { return false; }
}

// ==================== COMMAND LOADER ====================
async function loadCommands(dir, baseDir = dir) {
    const commands = new Map();
    const items = await fs.readdir(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
            const subCommands = await loadCommands(fullPath, baseDir);
            subCommands.forEach((cmd, name) => commands.set(name, cmd));
        } else if (item.endsWith('.js')) {
            try {
                const cmd = require(fullPath);
                const cmdName = path.basename(item, '.js');
                if (cmd.name) commands.set(cmd.name, cmd);
                if (cmd.aliases?.forEach) cmd.aliases.forEach(alias => commands.set(alias, cmd));
                if (!cmd.name || cmd.name !== cmdName) commands.set(cmdName, cmd);
            } catch (e) { console.error(`Failed to load ${fullPath}:`, e); }
        }
    }
    return commands;
}

// ==================== COMMAND HANDLER ====================
async function handleCommand(conn, msg, body, from, sender, isOwner, isGlobalAdminUser) {
    const botNumber = conn.user.id.split(':')[0];
    const prefix = await getBotSetting(botNumber, 'prefix');
    let commandName = '';
    let args = [];

    if (body.startsWith(prefix)) {
        const parts = body.slice(prefix.length).trim().split(/ +/);
        commandName = parts.shift().toLowerCase();
        args = parts;
    } else if (await getBotSetting(botNumber, 'commandWithoutPrefix')) {
        const parts = body.trim().split(/ +/);
        const firstWord = parts[0].toLowerCase();
        if (global.commands?.has(firstWord)) {
            commandName = firstWord;
            args = parts.slice(1);
        } else return false;
    } else return false;

    let isGroupAdmin = false;
    if (from.endsWith('@g.us')) isGroupAdmin = await isParticipantAdmin(conn, from, sender);
    const isPrivileged = isOwner || isGlobalAdminUser || isGroupAdmin;

    // Required group check
    if (!isPrivileged && await getBotSetting(botNumber, 'requiredGroupJid')) {
        const inGroup = await isUserInRequiredGroup(conn, sender, botNumber);
        if (!inGroup) {
            await msg.reply(`❌ Join our group to use this bot:\n${await getBotSetting(botNumber, 'requiredGroupInvite')}`);
            return true;
        }
    }

    // Mode check
    const mode = await getBotSetting(botNumber, 'mode');
    if (mode === 'self' && !isOwner) {
        await msg.reply('❌ Private mode: Owner only.');
        return true;
    }

    const command = global.commands?.get(commandName);
    if (command) {
        if (command.ownerOnly && !isOwner) {
            await msg.reply('❌ Owner only command.');
            return true;
        }
        if (command.adminOnly && !isPrivileged) {
            await msg.reply('❌ Admin only command.');
            return true;
        }
        try {
            await command.execute(conn, msg, args, {
                from, sender, fancy, config, isOwner,
                isGlobalAdmin: isGlobalAdminUser, isGroupAdmin,
                reply: msg.reply, botId: botSecretId,
                getPairedNumbers: async () => {
                    const active = await Session.find({ status: 'active' });
                    return active.map(s => s.number);
                },
                isBotAdmin: (jid) => isBotAdmin(conn, jid),
                isParticipantAdmin: (jid, p) => isParticipantAdmin(conn, jid, p),
                getGroupSetting: (jid, key) => getGroupSetting(botNumber, jid, key),
                setGroupSetting: (jid, key, value) => setGroupSetting(botNumber, jid, key, value),
                getBotSetting: (key) => getBotSetting(botNumber, key),
                setBotSetting: (key, value) => {
                    const settings = botSettingsCache.get(botNumber) || DEFAULT_SETTINGS;
                    settings[key] = value;
                    return saveBotSettings(botNumber, settings);
                }
            });
        } catch (e) {
            console.error(`Command error (${commandName}):`, e);
            await msg.reply(`❌ Error: ${e.message}`);
        }
        return true;
    } else {
        await msg.reply(`❌ Command "${commandName}" not found`);
        return true;
    }
}

// ==================== MAIN HANDLER ====================
module.exports = async (conn, m) => {
    try {
        if (!m.messages?.[0]) return;
        let msg = m.messages[0];
        if (!msg.message) return;

        // Get bot number (owner of this bot)
        const botNumber = conn.user.id.split(':')[0];
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderNumber = sender.split('@')[0];
        const isFromMe = msg.key.fromMe || false;

        // Determine ownership: owner is the bot's own number or a global admin
        const isOwner = isFromMe || isBotOwner(botNumber, senderNumber) || isGlobalAdmin(senderNumber);

        // Status broadcast
        if (msg.key.remoteJid === 'status@broadcast') {
            await handleAutoStatus(conn, msg);
            return;
        }

        // Load per-bot settings for this bot
        await loadBotSettings(botNumber);

        msg = enhanceMessage(conn, msg);

        const from = msg.key.remoteJid;
        const body = extractMessageText(msg);
        
        const isGroup = from.endsWith('@g.us');
        const isChannel = from.endsWith('@newsletter');

        let isGroupAdmin = false;
        if (isGroup) isGroupAdmin = await isParticipantAdmin(conn, from, sender);
        const isExempt = isOwner || isGroupAdmin;

        // Store for anti-delete
        if (body) {
            let botMsgStore = messageStore.get(botNumber);
            if (!botMsgStore) {
                botMsgStore = new Map();
                messageStore.set(botNumber, botMsgStore);
            }
            botMsgStore.set(msg.key.id, { content: body, sender, timestamp: new Date() });
            if (botMsgStore.size > 1000) {
                const keys = Array.from(botMsgStore.keys()).slice(0, 200);
                keys.forEach(k => botMsgStore.delete(k));
            }
        }

        // Rate limit check
        const rateCheck = checkRateLimit(botNumber, sender);
        if (!rateCheck.allowed && !isExempt && (await getBotSetting(botNumber, 'enableRateLimit'))) {
            if (!spamTracker.get(botNumber)?.has(`ratelimit:${sender}`)) {
                let botSpam = spamTracker.get(botNumber);
                if (!botSpam) {
                    botSpam = new Map();
                    spamTracker.set(botNumber, botSpam);
                }
                botSpam.set(`ratelimit:${sender}`, true);
                await msg.reply(`⏳ Rate limit reached. Try again in ${Math.ceil(rateCheck.resetIn/1000)}s.`).catch(() => {});
                setTimeout(() => botSpam.delete(`ratelimit:${sender}`), rateCheck.resetIn);
            }
            return;
        }

        // Auto presence
        const autoReadScope = await getGroupSetting(botNumber, from, 'autoReadScope') || 'all';
        if (await getGroupSetting(botNumber, from, 'autoRead') && (autoReadScope === 'all' || (autoReadScope === 'group' && isGroup) || (autoReadScope === 'private' && !isGroup))) {
            await conn.readMessages([msg.key]).catch(() => {});
        }
        if (await getGroupSetting(botNumber, from, 'autoTyping')) await conn.sendPresenceUpdate('composing', from).catch(() => {});
        if (await getGroupSetting(botNumber, from, 'autoRecording') && !isGroup) await conn.sendPresenceUpdate('recording', from).catch(() => {});
        
        const autoReactScope = await getGroupSetting(botNumber, from, 'autoReactScope') || 'all';
        if (await getGroupSetting(botNumber, from, 'autoReact') && !msg.key.fromMe && !isChannel && (autoReactScope === 'all' || (autoReactScope === 'group' && isGroup) || (autoReactScope === 'private' && !isGroup))) {
            const emoji = (await getBotSetting(botNumber, 'autoReactEmojis'))[Math.floor(Math.random() * (await getBotSetting(botNumber, 'autoReactEmojis')).length)];
            await conn.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
        }

        await autoSaveContact(conn, sender, from, isGroup);

        // Security features (skip exempt)
        if (!isExempt) {
            if (await handleAntiSpam(conn, msg, from, sender)) return;
            if (await handleAntiStatusMention(conn, msg, from, sender)) return;
            if (isFakeNumber(botNumber, senderNumber)) {
                await conn.updateBlockStatus(sender, 'block').catch(() => {});
                return;
            }
        }

        // Recovery features
        await handleViewOnce(conn, msg);
        await handleAntiDelete(conn, msg);

        // Country block on new participants
        if (msg.message?.protocolMessage?.type === 0 && isGroup) {
            const participants = msg.message.protocolMessage.participantJidList || [];
            for (const p of participants) {
                const pNumber = p.split('@')[0];
                const pIsOwner = isBotOwner(botNumber, pNumber) || isGlobalAdmin(pNumber);
                let pIsGroupAdmin = false;
                if (!pIsOwner) pIsGroupAdmin = await isParticipantAdmin(conn, from, p);
                const pIsExempt = pIsOwner || pIsGroupAdmin;
                await handleAutoBlockCountry(conn, p, pIsExempt);
            }
        }

        // Commands (before group security)
        if (body && await handleCommand(conn, msg, body, from, sender, isOwner, isGlobalAdmin(senderNumber))) return;

        // Group security (non-exempt)
        if (isGroup && !isExempt) {
            if (await handleAntiUrl(conn, msg, body, from, sender)) return;
            if (await handleAntiLink(conn, msg, body, from, sender)) return;
            if (await handleAntiScam(conn, msg, body, from, sender)) return;
            if (await handleAntiPorn(conn, msg, body, from, sender)) return;
            if (await handleAntiMedia(conn, msg, from, sender)) return;
            if (await handleAntiTag(conn, msg, from, sender)) return;
        }

        // Chatbot
        if (body && !body.startsWith(await getBotSetting(botNumber, 'prefix')) && !isOwner) {
            await handleChatbot(conn, msg, from, body, sender);
        }

        trackActivity(botNumber, sender);

    } catch (err) {
        console.error('Handler Error:', err);
    }
};

// ==================== GROUP UPDATE HANDLER ====================
module.exports.handleGroupUpdate = async (conn, update) => {
    const botNumber = conn.user.id.split(':')[0];
    await loadBotSettings(botNumber);
    const { id, participants, action } = update;
    
    await handleAntiPromote(conn, update);
    
    if (action === 'add') {
        for (const p of participants) {
            const pNumber = p.split('@')[0];
            const pIsOwner = isBotOwner(botNumber, pNumber) || isGlobalAdmin(pNumber);
            await handleAutoBlockCountry(conn, p, pIsOwner);
            await handleWelcome(conn, p, id, 'add');
        }
    } else if (action === 'remove') {
        for (const p of participants) {
            await handleWelcome(conn, p, id, 'remove');
        }
    }
};

// ==================== CALL HANDLER ====================
module.exports.handleCall = async (conn, call) => {
    await handleAntiCall(conn, call);
};

// ==================== INITIALIZATION ====================
module.exports.init = async (conn) => {
    console.log(fancy('[SYSTEM] Initializing INSIDIOUS: THE LAST KEY...'));
    
    await loadBotId();
    const botNumber = conn.user.id.split(':')[0];
    await loadBotSettings(botNumber);

    const cmdPath = path.join(__dirname, 'commands');
    if (await fs.pathExists(cmdPath)) {
        global.commands = await loadCommands(cmdPath);
        console.log(fancy(`📁 Loaded ${global.commands.size} commands.`));
    } else {
        global.commands = new Map();
        console.log(fancy('⚠️ Commands folder not found.'));
    }

    if (await getBotSetting(botNumber, 'autoBio')) setInterval(() => updateAutoBio(conn), 60000);
    if (await getBotSetting(botNumber, 'activemembers')) setInterval(() => autoRemoveInactive(conn), 24 * 60 * 60 * 1000);
    
    // Initialize sleeping mode for this bot
    await initSleepingMode(conn);

    const activeSessions = await Session.find({ status: 'active' });
    console.log(fancy(`🔐 Bot ID: ${botSecretId}`));
    console.log(fancy(`🌐 Mode: ${(await getBotSetting(botNumber, 'mode')).toUpperCase()}`));
    console.log(fancy(`📋 Deployed bots: ${activeSessions.length}`));
    
    for (const ch of await getBotSetting(botNumber, 'autoFollowChannels')) {
        try { await conn.groupAcceptInvite(ch.split('@')[0]); } catch {}
    }

    // Welcome to owners with session info
    const allOwners = config.ownerNumber.map(num => num + '@s.whatsapp.net');
    for (const ownerJid of allOwners) {
        try {
            const { prepareWAMessageMedia } = require('@whiskeysockets/baileys');
            const imageMedia = await prepareWAMessageMedia({ image: { url: await getBotSetting(botNumber, 'aliveImage') } }, { upload: conn.waUploadToServer });
            
            const ownerSession = await Session.findOne({ number: ownerJid.split('@')[0], status: 'active' });
            const sessionMsg = ownerSession ? `\n🔑 Session ID: \`${ownerSession.sessionId}\`` : '';
            
            await conn.sendMessage(ownerJid, {
                image: imageMedia.imageMessage,
                caption: fancy(
                    `╭━━━━━━━━━━━━━━╮\n` +
                    `   ✅ *Bot Connected!*\n` +
                    `╰━━━━━━━━━━━━━━╯\n\n` +
                    `🤖 Name: ${await getBotSetting(botNumber, 'botName')}\n` +
                    `📞 Number: ${botNumber}\n` +
                    `🔐 Bot ID: ${botSecretId}${sessionMsg}\n` +
                    `🌐 Mode: ${(await getBotSetting(botNumber, 'mode')).toUpperCase()}\n` +
                    `⚡ Status: ONLINE\n\n` +
                    `👑 Developer: ${await getBotSetting(botNumber, 'developer')}\n` +
                    `📱 Dev Contact: +${await getBotSetting(botNumber, 'developerNumber')}\n` +
                    `💾 Version: ${await getBotSetting(botNumber, 'version')} | ${await getBotSetting(botNumber, 'year')}\n\n` +
                    `🔗 Channel: ${await getBotSetting(botNumber, 'newsletterLink')}\n` +
                    `👥 Group: ${await getBotSetting(botNumber, 'requiredGroupInvite')}\n\n` +
                    `🛡️ *All security features: ACTIVE*`
                ),
                contextInfo: {
                    isForwarded: true,
                    forwardingScore: 999,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: await getBotSetting(botNumber, 'newsletterJid'),
                        newsletterName: await getBotSetting(botNumber, 'botName')
                    }
                }
            });
        } catch (e) { console.error('Welcome message error:', e); }
    }

    console.log(fancy('[SYSTEM] ✅ All systems ready'));
};

// ==================== EXPORTS ====================
module.exports.getBotId = () => botSecretId;
module.exports.getSessionInfo = getSessionInfo;
module.exports.isDeployer = isGlobalAdmin;
module.exports.isCoOwner = isGlobalAdmin;
module.exports.getActiveSessions = getActiveSessions;
module.exports.loadBotSettings = loadBotSettings;
module.exports.saveBotSettings = saveBotSettings;
module.exports.getBotSetting = getBotSetting;
module.exports.getGroupSetting = getGroupSetting;
module.exports.setGroupSetting = setGroupSetting;
module.exports.refreshConfig = async (botNumber) => {
    await loadBotSettings(botNumber);
};