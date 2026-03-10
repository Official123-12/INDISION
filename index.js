const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, Browsers, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, DisconnectReason, jidNormalizedUser } = require("@whiskeysockets/baileys");
const pino = require("pino");
const mongoose = require("mongoose");
const path = require("path");
const fs = require('fs-extra'); // tumia fs-extra kwa mkdirp rahisi

// ==================== HANDLER ====================
const handler = require('./handler');

// ✅ **FANCY FUNCTION** (imebaki sawa)
function fancy(text) {
    if (!text || typeof text !== 'string') return text;
    
    try {
        const fancyMap = {
            a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
            j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ',
            s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
            A: 'ᴀ', B: 'ʙ', C: 'ᴄ', D: 'ᴅ', E: 'ᴇ', F: 'ꜰ', G: 'ɢ', H: 'ʜ', I: 'ɪ',
            J: 'ᴊ', K: 'ᴋ', L: 'ʟ', M: 'ᴍ', N: 'ɴ', O: 'ᴏ', P: 'ᴘ', Q: 'ǫ', R: 'ʀ',
            S: 'ꜱ', T: 'ᴛ', U: 'ᴜ', V: 'ᴠ', W: 'ᴡ', X: 'x', Y: 'ʏ', Z: 'ᴢ'
        };
        
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            result += fancyMap[char] || char;
        }
        return result;
    } catch (e) {
        return text;
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ **MONGODB CONNECTION**
console.log(fancy("🔗 Connecting to MongoDB..."));
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://sila_md:sila0022@sila.67mxtd7.mongodb.net/insidious?retryWrites=true&w=majority";

mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10
})
.then(() => console.log(fancy("✅ MongoDB Connected")))
.catch((err) => {
    console.log(fancy("❌ MongoDB Connection FAILED"));
    console.log(fancy("💡 Error: " + err.message));
});

// ✅ **SESSION SCHEMA – kuhifadhi creds za kila namba**
const sessionSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    sessionData: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
});
const Session = mongoose.model('Session', sessionSchema);

// ✅ **ACTIVE SOCKETS MAP** (badala ya globalConn moja)
const activeSockets = new Map(); // key: namba (sanitized) -> socket
const socketCreationTime = new Map();

// ✅ **MIDDLEWARE**
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// ==================== BOT START FUNCTION (PER NUMBER) ====================

async function startBot(number, res = null) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    
    // Check if already connected
    if (activeSockets.has(sanitizedNumber)) {
        console.log(fancy(`⚠️ ${sanitizedNumber} already connected`));
        if (res && !res.headersSent) {
            return res.json({
                success: false,
                status: 'already_connected',
                message: 'Number is already connected'
            });
        }
        return;
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
        // Session directory – tumia sessions folder kwa kila namba
        const sessionDir = path.join(__dirname, 'sessions', sanitizedNumber);
        await fs.ensureDir(sessionDir);

        // Load existing session from DB
        const existingSession = await loadSessionFromDB(sanitizedNumber);
        
        // If session exists in DB but not locally, restore it
        if (existingSession && !fs.existsSync(path.join(sessionDir, 'creds.json'))) {
            await fs.writeFile(
                path.join(sessionDir, 'creds.json'),
                JSON.stringify(existingSession, null, 2)
            );
            console.log(fancy(`🔄 Restored session for ${sanitizedNumber} from DB`));
        }

        // Get Baileys version
        const { version } = await fetchLatestBaileysVersion();
        
        // Load auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        // Create socket
        const conn = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            printQRInTerminal: false,
            usePairingCode: !existingSession,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            defaultQueryTimeoutMs: 60000
        });

        // Store socket
        activeSockets.set(sanitizedNumber, conn);
        socketCreationTime.set(sanitizedNumber, Date.now());

        // ==================== PAIRING CODE (if new session) ====================
        if (!existingSession) {
            // Tuma pairing code baada ya muda mfupi
            setTimeout(async () => {
                try {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const code = await conn.requestPairingCode(sanitizedNumber);
                    console.log(fancy(`🔑 Pairing Code for ${sanitizedNumber}: ${code}`));
                    
                    if (res && !res.headersSent) {
                        return res.json({
                            success: true,
                            code: code,
                            message: `8-digit pairing code: ${code}`
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
            if (res && !res.headersSent) {
                res.json({
                    success: true,
                    status: 'reconnecting',
                    message: 'Reconnecting with existing session'
                });
            }
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

            if (connection === 'connecting') {
                console.log(fancy(`🔄 Connecting ${sanitizedNumber}...`));
            }

            if (connection === 'open') {
                console.log(fancy(`✅ ${sanitizedNumber} connected!`));
                
                // Send welcome message to owner (only if this number is the main owner)
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
                            caption: welcomeMsg,
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

                // Remove from active sockets
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);

                // If logged out, delete session
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log(fancy(`🔓 ${sanitizedNumber} logged out, deleting session`));
                    await deleteSessionFromDB(sanitizedNumber);
                    await fs.remove(sessionDir);
                } else {
                    // Try to reconnect after delay
                    console.log(fancy(`🔄 Reconnecting ${sanitizedNumber} in 10 seconds...`));
                    setTimeout(() => {
                        startBot(sanitizedNumber, null);
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
                startBot(session.number, null);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    } catch (error) {
        console.error(fancy('❌ Auto-reconnect error:'), error.message);
    }
}

// ==================== HTTP ENDPOINTS ====================

// ✅ **PAIRING ENDPOINT (8-DIGIT CODE)**
app.get('/pair', async (req, res) => {
    try {
        let num = req.query.num;
        if (!num) {
            return res.json({ success: false, error: "Provide number! Example: /pair?num=255123456789" });
        }
        
        const cleanNum = num.replace(/[^0-9]/g, '');
        if (cleanNum.length < 10) {
            return res.json({ success: false, error: "Invalid number. Must be at least 10 digits." });
        }
        
        // Anza mchakato wa kuconnect namba hii
        await startBot(cleanNum, res);
        // Kumbuka: startBot itajibu kupitia `res` baada ya kupata code
    } catch (err) {
        console.error(fancy("Pairing error:"), err.message);
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

// ✅ **BOT INFO ENDPOINT – sasa inaonyesha taarifa za bot kuu (kama ipo) au tu ujumbe**
app.get('/botinfo', (req, res) => {
    // Tunaweza kutoa taarifa za kwanza kwenye activeSockets
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

// ✅ **SIMPLE ROUTES**
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(fancy(`🌐 Web Interface: http://localhost:${PORT}`));
    console.log(fancy(`🔗 8-digit Pairing: http://localhost:${PORT}/pair?num=255XXXXXXXXX`));
    console.log(fancy(`🗑️  Unpair: http://localhost:${PORT}/unpair?num=255XXXXXXXXX`));
    console.log(fancy(`📊 Connections: http://localhost:${PORT}/connections`));
    console.log(fancy(`❤️ Health: http://localhost:${PORT}/health`));
    console.log(fancy("👑 Developer: STANYTZ"));
    console.log(fancy("📅 Version: 2.1.1 | Year: 2025"));
    console.log(fancy("🙏 Special Thanks: REDTECH"));
    
    // Anzisha auto-reconnect baada ya sekunde chache
    setTimeout(autoReconnectAll, 5000);
});

// ==================== CLEANUP ON EXIT ====================
process.on('SIGINT', async () => {
    console.log(fancy('\n🛑 Shutting down...'));
    for (const [number, sock] of activeSockets.entries()) {
        try {
            await sock.ws.close();
            console.log(fancy(`Closed connection for ${number}`));
        } catch (error) {
            console.error(fancy(`Error closing ${number}:`), error.message);
        }
    }
    await mongoose.connection.close();
    process.exit(0);
});

module.exports = app;