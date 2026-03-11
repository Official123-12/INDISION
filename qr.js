import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import QRCode from 'qrcode';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    delay,
    DisconnectReason
} from '@whiskeysockets/baileys';
import { Session } from './database/models.js';
import handler from './handler.js';
import config from './config.js';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 60000;

// Same welcome message
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
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;
    if (!fs.existsSync('./qr_sessions')) await fs.mkdir('./qr_sessions', { recursive: true });

    let qrGenerated = false;
    let sessionCompleted = false;
    let responseSent = false;
    let reconnectAttempts = 0;
    let currentSocket = null;
    let timeoutHandle = null;
    let isCleaningUp = false;

    async function cleanup(reason = 'unknown') {
        if (isCleaningUp) return;
        isCleaningUp = true;

        console.log(`🧹 Cleaning up session ${sessionId} - Reason: ${reason}`);

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
        }, 5000);
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

        if (!fs.existsSync(dirs)) await fs.mkdir(dirs, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            if (currentSocket) {
                try {
                    currentSocket.ev.removeAllListeners();
                    await currentSocket.end();
                } catch (e) {}
            }

            currentSocket = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.macOS('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                printQRInTerminal: false,
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 3,
            });

            const sock = currentSocket;

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent || sessionCompleted || isCleaningUp) return;
                qrGenerated = true;

                try {
                    const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M' });
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.json({
                            success: true,
                            qr: qrDataURL,
                            message: 'Scan the QR code with WhatsApp',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above'
                            ]
                        });
                        console.log('📱 QR Code sent to client');
                    }
                } catch (err) {
                    console.error('Error generating QR code:', err);
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(500).json({ success: false, error: 'Failed to generate QR code' });
                    }
                    await cleanup('qr_error');
                }
            };

            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;

                const { connection, lastDisconnect, qr, isNewLogin } = update;

                if (qr && !qrGenerated && !sessionCompleted) {
                    await handleQRCode(qr);
                }

                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;

                    try {
                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            const credsData = await fs.readFile(credsFile, 'utf8');
                            const creds = JSON.parse(credsData);
                            const number = sock.user?.id?.split(':')[0];
                            if (number) {
                                await saveSessionToDB(number, creds);
                            }
                        }

                        // Send welcome message
                        const userJid = sock.user?.id;
                        if (userJid) {
                            const { prepareWAMessageMedia } = await import('@whiskeysockets/baileys');
                            const imageMedia = await prepareWAMessageMedia({ image: { url: config.botImage } }, { upload: sock.waUploadToServer });
                            await sock.sendMessage(userJid, {
                                image: imageMedia.imageMessage,
                                caption: WELCOME_MESSAGE
                            });
                        }

                        if (handler && handler.init) {
                            await handler.init(sock);
                        }
                    } catch (err) {
                        console.error('Error sending welcome or saving session:', err);
                    } finally {
                        await cleanup('session_complete');
                    }
                }

                if (isNewLogin) console.log('🔐 New login via QR code');

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) {
                        await cleanup('already_complete');
                        return;
                    }

                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(401).json({ success: false, error: 'Invalid QR scan or session expired' });
                        }
                        await cleanup('logged_out');
                    } else if (qrGenerated && !sessionCompleted) {
                        reconnectAttempts++;
                        console.log(`🔁 Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
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

            sock.ev.on('creds.update', saveCreds);

            timeoutHandle = setTimeout(async () => {
                if (!sessionCompleted && !isCleaningUp) {
                    console.log('⏰ QR generation timeout');
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).json({ success: false, error: 'QR generation timeout' });
                    }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error('❌ Error initializing session:', err);
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).json({ success: false, error: 'Service Unavailable' });
            }
            await cleanup('init_error');
        }
    }

    await initiateSession();
});

// Cleanup old QR sessions
setInterval(async () => {
    try {
        if (!fs.existsSync('./qr_sessions')) return;
        const sessions = await fs.readdir('./qr_sessions');
        const now = Date.now();
        for (const session of sessions) {
            const sessionPath = `./qr_sessions/${session}`;
            try {
                const stats = await fs.stat(sessionPath);
                if (now - stats.mtimeMs > 300000) {
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
    try { await fs.remove('./qr_sessions'); } catch (e) {}
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT received, cleaning up...');
    try { await fs.remove('./qr_sessions'); } catch (e) {}
    process.exit(0);
});

export default router;