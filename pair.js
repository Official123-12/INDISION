import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import pn from 'awesome-phonenumber';
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
import { Session } from './database/models.js';
import handler from './handler.js';
import config from './config.js';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 5 * 60 * 1000;
const CLEANUP_DELAY = 5000;

// Welcome message – same as in your handler
const WELCOME_MESSAGE = `
╭─── • 🥀 • ───╮
   INSIDIOUS: THE LAST KEY
╰─── • 🥀 • ───╯

✅ *Bot Connected Successfully!*
⚡ Status: ONLINE & ACTIVE

👑 *Developer:* STANYTZ
💾 *Version:* 2.1.1 | Year: 2025

🔗 Channel: ${config.whatsappChannel}
👥 Group: ${config.requiredGroupInvite}

🛡️ *All security features: ACTIVE*
`;

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

async function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        await fs.remove(FilePath);
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;

    if (!num) {
        return res.status(400).json({ success: false, error: 'Phone number is required' });
    }

    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);

    if (!phone.isValid()) {
        return res.status(400).json({ success: false, error: 'Invalid phone number. Use full international format without + or spaces.' });
    }

    num = phone.getNumber('e164').replace('+', '');

    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./auth_info_baileys/session_${sessionId}`;

    let pairingCodeSent = false;
    let sessionCompleted = false;
    let isCleaningUp = false;
    let responseSent = false;
    let reconnectAttempts = 0;
    let currentSocket = null;
    let timeoutHandle = null;

    async function cleanup(reason = 'unknown') {
        if (isCleaningUp) return;
        isCleaningUp = true;

        console.log(`🧹 Cleaning up session ${sessionId} (${num}) - Reason: ${reason}`);

        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }

        if (currentSocket) {
            try {
                currentSocket.ev.removeAllListeners();
                await currentSocket.end();
            } catch (e) {}
            currentSocket = null;
        }

        setTimeout(async () => {
            await removeFile(dirs);
        }, CLEANUP_DELAY);
    }

    async function initiateSession() {
        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (sessionCompleted || isCleaningUp) return;

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).json({ success: false, error: 'Connection failed after multiple attempts' });
            }
            await cleanup('max_reconnects');
            return;
        }

        try {
            if (!fs.existsSync(dirs)) await fs.mkdir(dirs, { recursive: true });

            const { state, saveCreds } = await useMultiFileAuthState(dirs);
            const { version } = await fetchLatestBaileysVersion();

            if (currentSocket) {
                try {
                    currentSocket.ev.removeAllListeners();
                    await currentSocket.end();
                } catch (e) {}
            }

            currentSocket = makeWASocket({
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

            const sock = currentSocket;

            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;

                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;

                    // Save session to MongoDB
                    try {
                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            const credsData = await fs.readFile(credsFile, 'utf8');
                            const creds = JSON.parse(credsData);
                            await saveSessionToDB(num, creds);
                        }

                        // Send welcome message to user
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        const imageUrl = config.botImage || 'https://files.catbox.moe/f3c07u.jpg';
                        const { prepareWAMessageMedia } = await import('@whiskeysockets/baileys');
                        const imageMedia = await prepareWAMessageMedia({ image: { url: imageUrl } }, { upload: sock.waUploadToServer });
                        await sock.sendMessage(userJid, {
                            image: imageMedia.imageMessage,
                            caption: WELCOME_MESSAGE
                        });

                        // Initialize handler
                        if (handler && handler.init) {
                            await handler.init(sock);
                        }
                    } catch (err) {
                        console.error('Error sending welcome or saving session:', err);
                    } finally {
                        await cleanup('session_complete');
                    }
                }

                if (isNewLogin) console.log(`🔐 New login via pair code for ${num}`);

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) {
                        await cleanup('already_complete');
                        return;
                    }

                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(401).json({ success: false, error: 'Invalid pairing code or session expired' });
                        }
                        await cleanup('logged_out');
                    } else if (pairingCodeSent && !sessionCompleted) {
                        reconnectAttempts++;
                        console.log(`🔁 Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} for ${num}`);
                        if (currentSocket) {
                            try {
                                currentSocket.ev.removeAllListeners();
                                await currentSocket.end();
                            } catch (e) {}
                            currentSocket = null;
                        }
                        await delay(2000);
                        await initiateSession();
                    } else {
                        await cleanup('connection_closed');
                    }
                }
            });

            if (!sock.authState.creds.registered && !pairingCodeSent && !isCleaningUp) {
                await delay(1500);
                try {
                    pairingCodeSent = true;
                    let code = await sock.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;

                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.json({ success: true, code });
                        console.log(`📱 Pairing code sent for ${num}: ${code}`);
                    }
                } catch (error) {
                    console.error('❌ Error requesting pairing code:', error);
                    pairingCodeSent = false;
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(503).json({ success: false, error: 'Failed to get pairing code' });
                    }
                    await cleanup('pairing_code_error');
                }
            }

            sock.ev.on('creds.update', saveCreds);

            timeoutHandle = setTimeout(async () => {
                if (!sessionCompleted && !isCleaningUp) {
                    console.log(`⏰ Pairing timeout for ${num}`);
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).json({ success: false, error: 'Pairing timeout' });
                    }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error(`❌ Error initializing session for ${num}:`, err);
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).json({ success: false, error: 'Service Unavailable' });
            }
            await cleanup('init_error');
        }
    }

    await initiateSession();
});

// Cleanup old session folders periodically
setInterval(async () => {
    try {
        const baseDir = './auth_info_baileys';
        if (!fs.existsSync(baseDir)) return;

        const sessions = await fs.readdir(baseDir);
        const now = Date.now();

        for (const session of sessions) {
            const sessionPath = `${baseDir}/${session}`;
            try {
                const stats = await fs.stat(sessionPath);
                if (now - stats.mtimeMs > 10 * 60 * 1000) {
                    console.log(`🗑️ Removing old session: ${session}`);
                    await fs.remove(sessionPath);
                }
            } catch (e) {}
        }
    } catch (e) {
        console.error('Error in cleanup interval:', e);
    }
}, 60000);

process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received, cleaning up...');
    try { await fs.remove('./auth_info_baileys'); } catch (e) {}
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT received, cleaning up...');
    try { await fs.remove('./auth_info_baileys'); } catch (e) {}
    process.exit(0);
});

export default router;