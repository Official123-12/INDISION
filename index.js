import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import fs from 'fs-extra';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    DisconnectReason
} from '@whiskeysockets/baileys';

import qrRouter from './qr.js';
import pairRouter from './pair.js';
import { Session } from './database/models.js';
import handler from './handler.js';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// ==================== MongoDB Connection ====================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://sila_md:sila0022@sila.67mxtd7.mongodb.net/insidious?retryWrites=true&w=majority';
mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10
}).then(() => {
    console.log('✅ MongoDB connected');
    // Start bot manager after DB is ready
    startBotManager();
}).catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// ==================== Bot Manager – Persistent Connections ====================
const persistentBots = new Map(); // key: number -> { socket, reconnectTimer }

const SESSION_DIR = './persistent_sessions';
fs.ensureDirSync(SESSION_DIR);

async function saveSessionToDB(number, sessionData) {
    try {
        await Session.findOneAndUpdate(
            { number },
            { sessionData, lastActive: Date.now() },
            { upsert: true }
        );
        console.log(`✅ Session saved for ${number}`);
    } catch (error) {
        console.error(`❌ Failed to save session for ${number}:`, error.message);
    }
}

async function deleteSessionFromDB(number) {
    try {
        await Session.deleteOne({ number });
        console.log(`🗑️ Session deleted for ${number}`);
    } catch (error) {
        console.error(`❌ Failed to delete session for ${number}:`, error.message);
    }
}

async function startPersistentBot(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    if (persistentBots.has(sanitizedNumber)) {
        console.log(`⚠️ Bot ${sanitizedNumber} already running`);
        return;
    }

    const sessionDir = path.join(SESSION_DIR, sanitizedNumber);
    await fs.ensureDir(sessionDir);

    // Load session from DB
    const session = await Session.findOne({ number: sanitizedNumber });
    if (session && session.sessionData) {
        await fs.writeFile(
            path.join(sessionDir, 'creds.json'),
            JSON.stringify(session.sessionData, null, 2)
        );
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Chrome'),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 250,
        maxRetries: 3,
    });

    persistentBots.set(sanitizedNumber, { socket: sock, reconnectTimer: null });

    // Creds update
    sock.ev.on('creds.update', async () => {
        await saveCreds();
        try {
            const credsData = await fs.readFile(path.join(sessionDir, 'creds.json'), 'utf8');
            const creds = JSON.parse(credsData);
            await saveSessionToDB(sanitizedNumber, creds);
        } catch (error) {
            console.error(`❌ Failed to save creds to DB for ${sanitizedNumber}:`, error.message);
        }
    });

    // Connection update
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log(`✅ Bot ${sanitizedNumber} connected!`);

            // Initialize handler
            if (handler && handler.init) {
                await handler.init(sock);
            }

            // Clear any reconnect timer
            const bot = persistentBots.get(sanitizedNumber);
            if (bot && bot.reconnectTimer) {
                clearTimeout(bot.reconnectTimer);
                bot.reconnectTimer = null;
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Bot ${sanitizedNumber} disconnected: ${statusCode}`);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log(`🔓 Bot ${sanitizedNumber} logged out, deleting session`);
                await deleteSessionFromDB(sanitizedNumber);
                await fs.remove(sessionDir);
                persistentBots.delete(sanitizedNumber);
            } else {
                // Schedule reconnect
                console.log(`🔄 Reconnecting ${sanitizedNumber} in 10 seconds...`);
                const bot = persistentBots.get(sanitizedNumber);
                if (bot) {
                    bot.reconnectTimer = setTimeout(() => {
                        persistentBots.delete(sanitizedNumber);
                        startPersistentBot(sanitizedNumber);
                    }, 10000);
                }
            }
        }
    });

    // Message handler
    sock.ev.on('messages.upsert', async (m) => {
        try {
            if (handler && typeof handler === 'function') {
                await handler(sock, m, { botNumber: sanitizedNumber });
            }
        } catch (error) {
            console.error(`❌ Message handler error for ${sanitizedNumber}:`, error.message);
        }
    });

    // Group updates
    sock.ev.on('group-participants.update', async (update) => {
        try {
            if (handler && handler.handleGroupUpdate) {
                await handler.handleGroupUpdate(sock, update);
            }
        } catch (error) {
            console.error(`❌ Group update error for ${sanitizedNumber}:`, error.message);
        }
    });

    // Calls
    sock.ev.on('call', async (call) => {
        try {
            if (handler && handler.handleCall) {
                await handler.handleCall(sock, call);
            }
        } catch (error) {
            console.error(`❌ Call handler error for ${sanitizedNumber}:`, error.message);
        }
    });
}

async function stopPersistentBot(number) {
    const sanitized = number.replace(/[^0-9]/g, '');
    const bot = persistentBots.get(sanitized);
    if (bot) {
        if (bot.reconnectTimer) clearTimeout(bot.reconnectTimer);
        try {
            bot.socket.ev.removeAllListeners();
            await bot.socket.end();
        } catch (e) {}
        persistentBots.delete(sanitized);
    }
    await deleteSessionFromDB(sanitized);
    const sessionDir = path.join(SESSION_DIR, sanitized);
    await fs.remove(sessionDir);
}

async function startBotManager() {
    console.log('🤖 Starting bot manager...');
    // Load all sessions from DB
    const sessions = await Session.find({});
    console.log(`📦 Found ${sessions.length} sessions in DB`);
    for (const session of sessions) {
        await startPersistentBot(session.number);
        await delay(2000); // avoid flooding
    }
}

// ==================== Express Setup ====================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount routers
app.use('/qr', qrRouter);
app.use('/code', pairRouter);

// HTML pages
app.get('/pair', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});
app.get('/qrpage', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

// ==================== Unpair Endpoint ====================
app.get('/unpair', async (req, res) => {
    let num = req.query.num;
    if (!num) {
        return res.status(400).json({ success: false, error: 'Number required' });
    }
    const cleanNum = num.replace(/[^0-9]/g, '');
    await stopPersistentBot(cleanNum);
    res.json({ success: true, message: `Bot ${cleanNum} unpaired and removed.` });
});

// ==================== Health Check ====================
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        activeBots: persistentBots.size,
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// ==================== Start Server ====================
app.listen(PORT, () => {
    console.log(`🌐 Server running on http://localhost:${PORT}`);
});

export default app;