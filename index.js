const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, Browsers, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, DisconnectReason, jidNormalizedUser } = require("@whiskeysockets/baileys");
const pino = require("pino");
const mongoose = require("mongoose");
const path = require("path");
const fs = require('fs-extra');
const crypto = require('crypto');
const QRCode = require('qrcode');

// ==================== MODELS (centralized) ====================
const { Session, Pending, BotSettings } = require('./database/models');

// ==================== HANDLER ====================
const handler = require('./handler');

// ✅ **FANCY FUNCTION**
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

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ **MONGODB CONNECTION – EXPORT PROMISE SO MAIN.JS CAN WAIT**
console.log(fancy("🔗 Connecting to MongoDB..."));
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://sila_md:sila0022@sila.67mxtd7.mongodb.net/insidious?retryWrites=true&w=majority";

const dbPromise = mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10
}).then(() => {
    console.log(fancy("✅ MongoDB Connected"));
}).catch((err) => {
    console.log(fancy("❌ MongoDB Connection FAILED"));
    console.log(fancy("💡 Error: " + err.message));
    process.exit(1); // Exit if database fails – it's required
});

// ✅ **MIDDLEWARE to check DB connection before proceeding**
app.use((req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ 
            success: false, 
            error: 'Database not connected. Please try again in a few seconds.' 
        });
    }
    next();
});

// ✅ **ACTIVE SOCKETS MAP**
const activeSockets = new Map(); // key: number (sanitized) -> socket
const socketCreationTime = new Map();

// ✅ **MIDDLEWARE**
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve frontend files

// ✅ **CREATE PUBLIC FOLDER IF NOT EXISTS**
fs.ensureDirSync(path.join(__dirname, 'public'));

// ✅ **LOAD CONFIG**
let config = {};
try {
    config = require('./config');
    console.log(fancy("📋 Config loaded"));
} catch (error) {
    console.log(fancy("❌ Config file error, using defaults"));
    config = {
        prefix: '.',
        ownerNumber: ['255000000000'],
        botName: 'INSIDIOUS',
        workMode: 'public',
        botImage: 'https://files.catbox.moe/f3c07u.jpg',
        newsletterJid: '120363404317544295@newsletter'
    };
}

// ==================== SESSION MANAGEMENT FUNCTIONS ====================

async function saveSessionToDB(number, sessionData) {
    try {
        await Session.findOneAndUpdate(
            { number },
            { sessionData, lastActive: Date.now() },
            { upsert: true }
        );
        console.log(fancy(`✅ Session saved for ${number}`));
    } catch (error) {
        console.error(fancy(`❌ Failed to save session for ${number}:`), error.message);
    }
}

async function loadSessionFromDB(number) {
    try {
        const session = await Session.findOne({ number });
        return session ? session.sessionData : null;
    } catch (error) {
        console.error(fancy(`❌ Failed to load session for ${number}:`), error.message);
        return null;
    }
}

async function deleteSessionFromDB(number) {
    try {
        await Session.deleteOne({ number });
        console.log(fancy(`🗑️ Session deleted for ${number}`));
    } catch (error) {
        console.error(fancy(`❌ Failed to delete session for ${number}:`), error.message);
    }
}

// ✅ **GENERATE UNIQUE SECRET**
function generateSecret() {
    return 'INS' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ==================== BOT START FUNCTION (PER NUMBER) ====================

async function startBot(number, res = null, method = 'pair') {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    // If already connected, disconnect and delete old session
    if (activeSockets.has(sanitizedNumber)) {
        console.log(fancy(`⚠️ ${sanitizedNumber} already connected, disconnecting old session...`));
        const oldSocket = activeSockets.get(sanitizedNumber);
        try {
            await oldSocket.ws.close();
            oldSocket.ev.removeAllListeners();
        } catch (e) {}
        activeSockets.delete(sanitizedNumber);
        socketCreationTime.delete(sanitizedNumber);
        await deleteSessionFromDB(sanitizedNumber);
        const sessionDir = path.join(__dirname, 'sessions', sanitizedNumber);
        await fs.remove(sessionDir);
    }

    // Prevent multiple connection attempts
    const lockKey = `connecting_${sanitizedNumber}`;
    if (global[lockKey]) {
        console.log(fancy(`⏳ ${sanitizedNumber} connection in progress`));
        if (res && !res.headersSent) {
            return res.json({ success: false, status: 'in_progress', message: 'Connection in progress' });
        }
        return;
    }
    global[lockKey] = true;

    try {
        const sessionDir = path.join(__dirname, 'sessions', sanitizedNumber);
        await fs.ensureDir(sessionDir);

        // Load existing session from DB (if any) – but we already deleted above, so none should exist
        const existingSession = await loadSessionFromDB(sanitizedNumber);
        if (existingSession && !fs.existsSync(path.join(sessionDir, 'creds.json'))) {
            await fs.writeFile(
                path.join(sessionDir, 'creds.json'),
                JSON.stringify(existingSession, null, 2)
            );
            console.log(fancy(`🔄 Restored session for ${sanitizedNumber} from DB`));
        }

        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const conn = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            printQRInTerminal: method === 'qr',
            usePairingCode: method === 'pair',
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            defaultQueryTimeoutMs: 60000
        });

        activeSockets.set(sanitizedNumber, conn);
        socketCreationTime.set(sanitizedNumber, Date.now());

        // Generate a secret for this pending pairing
        const secret = generateSecret();
        await Pending.create({ number: sanitizedNumber, secret });

        if (method === 'pair') {
            // Pairing code flow
            setTimeout(async () => {
                try {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const code = await conn.requestPairingCode(sanitizedNumber);
                    console.log(fancy(`🔑 Pairing Code for ${sanitizedNumber}: ${code}`));

                    if (res && !res.headersSent) {
                        return res.json({
                            success: true,
                            code: code,
                            secret: secret,
                            message: `8-digit pairing code: ${code}\nYour secret ID: ${secret}`
                        });
                    }
                } catch (error) {
                    console.error(fancy(`❌ Pairing error for ${sanitizedNumber}:`), error.message);
                    if (res && !res.headersSent) {
                        return res.json({
                            success: false,
                            error: 'Failed to generate pairing code: ' + error.message
                        });
                    }
                }
            }, 3000);
        } else {
            // QR code flow – wait for 'qr' event
            let qrSent = false;
            const qrTimeout = setTimeout(() => {
                if (!qrSent && res && !res.headersSent) {
                    res.json({ success: false, error: 'QR generation timeout' });
                }
            }, 30000);

            conn.ev.on('connection.update', async (update) => {
                const { qr } = update;
                if (qr && !qrSent) {
                    qrSent = true;
                    clearTimeout(qrTimeout);
                    try {
                        const qrImage = await QRCode.toDataURL(qr);
                        console.log(fancy(`📱 QR Code generated for ${sanitizedNumber}`));
                        if (res && !res.headersSent) {
                            res.json({
                                success: true,
                                qr: qrImage,
                                secret: secret,
                                message: 'Scan the QR code with WhatsApp'
                            });
                        }
                    } catch (err) {
                        console.error(fancy(`❌ QR generation error for ${sanitizedNumber}:`), err.message);
                        if (res && !res.headersSent) {
                            res.json({ success: false, error: 'Failed to generate QR image' });
                        }
                    }
                }
            });
        }

        // ==================== SESSION UPDATE HANDLER ====================
        conn.ev.on('creds.update', async () => {
            await saveCreds();
            try {
                const credsData = await fs.readFile(path.join(sessionDir, 'creds.json'), 'utf8');
                const creds = JSON.parse(credsData);
                await saveSessionToDB(sanitizedNumber, creds);
            } catch (error) {
                console.error(fancy(`❌ Failed to save creds to DB for ${sanitizedNumber}:`), error.message);
            }
        });

        // ==================== CONNECTION UPDATE HANDLER ====================
        conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(fancy(`✅ ${sanitizedNumber} connected!`));

                // When connected, associate the pending secret with this number in BotSettings
                const pending = await Pending.findOne({ number: sanitizedNumber });
                if (pending) {
                    await BotSettings.findOneAndUpdate(
                        { secret: pending.secret },
                        { number: sanitizedNumber, updatedAt: Date.now() },
                        { upsert: true }
                    );
                    await pending.deleteOne();
                    console.log(fancy(`🔗 Linked secret ${pending.secret} to number ${sanitizedNumber}`));
                }

                // Send welcome message to owner if this number is in owner list
                if (config.ownerNumber && config.ownerNumber.includes(sanitizedNumber)) {
                    try {
                        const userJid = jidNormalizedUser(conn.user.id);
                        const welcomeMsg = `
╭─── • 🥀 • ───╮
   INSIDIOUS: THE LAST KEY
╰─── • 🥀 • ───╯

✅ *Bot Connected Successfully!*
🤖 *Name:* ${conn.user?.name || 'INSIDIOUS'}
📞 *Number:* ${sanitizedNumber}
⚡ *Status:* ONLINE & ACTIVE

👑 *Developer:* STANYTZ
💾 *Version:* 2.1.1 | Year: 2025`;

                        await conn.sendMessage(userJid, {
                            image: { url: config.botImage || "https://files.catbox.moe/f3c07u.jpg" },
                            caption: fancy(welcomeMsg),
                            contextInfo: {
                                isForwarded: true,
                                forwardingScore: 999,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: config.newsletterJid || "120363404317544295@newsletter",
                                    newsletterName: config.botName || "INSIDIOUS BOT"
                                }
                            }
                        });
                    } catch (e) {
                        console.log(fancy(`⚠️ Could not send welcome to owner: ${e.message}`));
                    }
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(fancy(`❌ ${sanitizedNumber} disconnected: ${statusCode}`));

                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log(fancy(`🔓 ${sanitizedNumber} logged out, deleting session`));
                    await deleteSessionFromDB(sanitizedNumber);
                    await fs.remove(sessionDir);
                } else {
                    // Try to reconnect after delay
                    console.log(fancy(`🔄 Reconnecting ${sanitizedNumber} in 10 seconds...`));
                    setTimeout(() => {
                        startBot(sanitizedNumber, null, method);
                    }, 10000);
                }
            }
        });

        // ==================== MESSAGE HANDLER – PASSTHROUGH TO MAIN HANDLER ====================
        conn.ev.on('messages.upsert', async (m) => {
            try {
                if (handler && typeof handler === 'function') {
                    await handler(conn, m, { botNumber: sanitizedNumber });
                }
            } catch (error) {
                console.error(fancy(`❌ Message handler error for ${sanitizedNumber}:`), error.message);
            }
        });

        // ==================== GROUP UPDATE HANDLER ====================
        conn.ev.on('group-participants.update', async (update) => {
            try {
                if (handler && handler.handleGroupUpdate) {
                    await handler.handleGroupUpdate(conn, update);
                }
            } catch (error) {
                console.error(fancy(`❌ Group update error for ${sanitizedNumber}:`), error.message);
            }
        });

        // ==================== CALL HANDLER ====================
        conn.ev.on('call', async (call) => {
            try {
                if (handler && handler.handleCall) {
                    await handler.handleCall(conn, call);
                }
            } catch (error) {
                console.error(fancy(`❌ Call handler error for ${sanitizedNumber}:`), error.message);
            }
        });

    } catch (error) {
        console.error(fancy(`❌ Fatal error for ${sanitizedNumber}:`), error.message);
        if (res && !res.headersSent) {
            res.json({ success: false, error: error.message });
        }
    } finally {
        global[lockKey] = false;
    }
}

// ==================== AUTO-RECONNECT ON STARTUP ====================
async function autoReconnectAll() {
    try {
        const sessions = await Session.find({});
        console.log(fancy(`🔄 Auto-reconnecting ${sessions.length} sessions...`));
        for (const session of sessions) {
            if (!activeSockets.has(session.number)) {
                console.log(fancy(`Reconnecting ${session.number}...`));
                startBot(session.number, null, 'pair');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    } catch (error) {
        console.error(fancy('❌ Auto-reconnect error:'), error.message);
    }
}

// ==================== HTTP ENDPOINTS ====================

// ✅ **PAIRING ENDPOINT (8-DIGIT CODE)**
app.get('/code', async (req, res) => {
    try {
        let num = req.query.number;
        if (!num) {
            return res.json({ success: false, error: "Provide number! Example: /code?number=255123456789" });
        }
        const cleanNum = num.replace(/[^0-9]/g, '');
        if (cleanNum.length < 10) {
            return res.json({ success: false, error: "Invalid number. Must be at least 10 digits." });
        }
        await startBot(cleanNum, res, 'pair');
    } catch (err) {
        console.error(fancy("Pairing error:"), err.message);
        if (!res.headersSent) {
            res.json({ success: false, error: "Failed: " + err.message });
        }
    }
});

// ✅ **QR ENDPOINT**
app.get('/qr', async (req, res) => {
    try {
        let num = req.query.number;
        if (!num) {
            return res.json({ success: false, error: "Provide number! Example: /qr?number=255123456789" });
        }
        const cleanNum = num.replace(/[^0-9]/g, '');
        if (cleanNum.length < 10) {
            return res.json({ success: false, error: "Invalid number. Must be at least 10 digits." });
        }
        await startBot(cleanNum, res, 'qr');
    } catch (err) {
        console.error(fancy("QR error:"), err.message);
        if (!res.headersSent) {
            res.json({ success: false, error: "Failed: " + err.message });
        }
    }
});

// ✅ **UNPAIR ENDPOINT**
app.get('/unpair', async (req, res) => {
    try {
        let num = req.query.num;
        if (!num) {
            return res.json({ success: false, error: "Provide number! Example: /unpair?num=255123456789" });
        }
        const cleanNum = num.replace(/[^0-9]/g, '');
        if (cleanNum.length < 10) {
            return res.json({ success: false, error: "Invalid number" });
        }

        const socket = activeSockets.get(cleanNum);
        if (socket) {
            await socket.ws.close();
            socket.ev.removeAllListeners();
            activeSockets.delete(cleanNum);
            socketCreationTime.delete(cleanNum);
        }

        await deleteSessionFromDB(cleanNum);
        await fs.remove(path.join(__dirname, 'sessions', cleanNum));

        res.json({ success: true, message: `Number ${cleanNum} unpaired successfully` });
    } catch (err) {
        console.error(fancy("Unpair error:"), err.message);
        res.json({ success: false, error: "Failed: " + err.message });
    }
});

// ✅ **LIST ALL CONNECTED NUMBERS**
app.get('/connections', (req, res) => {
    const connections = [];
    for (const [num, sock] of activeSockets.entries()) {
        connections.push({
            number: num,
            uptime: Math.floor((Date.now() - (socketCreationTime.get(num) || Date.now())) / 1000)
        });
    }
    res.json({
        success: true,
        total: activeSockets.size,
        connections
    });
});

// ✅ **HEALTH CHECK**
app.get('/health', (req, res) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    res.json({
        status: 'healthy',
        activeSessions: activeSockets.size,
        uptime: `${hours}h ${minutes}m ${seconds}s`,
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// ✅ **BOT INFO ENDPOINT**
app.get('/botinfo', (req, res) => {
    const firstSocket = activeSockets.values().next().value;
    if (!firstSocket || !firstSocket.user) {
        return res.json({
            success: false,
            error: "No bot connected",
            activeSessions: activeSockets.size
        });
    }

    res.json({
        success: true,
        botName: firstSocket.user?.name || "INSIDIOUS",
        botNumber: firstSocket.user?.id?.split(':')[0] || "Unknown",
        botJid: firstSocket.user?.id || "Unknown",
        activeSessions: activeSockets.size,
        uptime: Date.now() - (socketCreationTime.get(firstSocket.user?.id?.split(':')[0] || '') || Date.now())
    });
});

// ✅ **AUTH ENDPOINT – login with secret**
app.post('/api/auth', async (req, res) => {
    const { secret } = req.body;
    if (!secret) {
        return res.status(400).json({ success: false, error: 'Secret required' });
    }
    try {
        const settings = await BotSettings.findOne({ secret });
        if (settings) {
            res.json({ success: true, user: settings.number });
        } else {
            res.status(401).json({ success: false, error: 'Invalid secret' });
        }
    } catch (err) {
        console.error(fancy('Auth error:'), err);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// ✅ **GET SETTINGS – using secret**
app.get('/api/settings', async (req, res) => {
    const { secret } = req.query;
    if (!secret) {
        return res.status(400).json({ success: false, error: 'Secret required' });
    }
    try {
        const settings = await BotSettings.findOne({ secret });
        if (!settings) {
            return res.status(404).json({ success: false, error: 'Settings not found' });
        }
        res.json({ success: true, settings: settings.settings });
    } catch (err) {
        console.error(fancy('Get settings error:'), err);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// ✅ **UPDATE SETTINGS**
app.post('/api/settings', async (req, res) => {
    const { secret, settings } = req.body;
    if (!secret) {
        return res.status(400).json({ success: false, error: 'Secret required' });
    }
    if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ success: false, error: 'Settings must be an object' });
    }
    try {
        const result = await BotSettings.findOneAndUpdate(
            { secret },
            { settings, updatedAt: Date.now() },
            { new: true }
        );
        if (!result) {
            return res.status(404).json({ success: false, error: 'Secret not found' });
        }
        res.json({ success: true, message: 'Settings updated' });
    } catch (err) {
        console.error(fancy('Update settings error:'), err);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// ==================== SIMPLE ROUTES – serve frontend files ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

app.get('/pair', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/qrpage', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});

// ==================== EXPORT APP AND DBPROMISE ====================
module.exports = { app, dbPromise };