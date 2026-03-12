import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import fs from 'fs-extra';
import { delay } from '@whiskeysockets/baileys';

import qrRouter from './qr.js';
import pairRouter from './pair.js';
import { Session } from './database/models.js';
import handler from './handler.js';

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
    startBotManager(); // Start bot manager after DB is ready
}).catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// ==================== Bot Manager – Keep bots alive 24/7 ====================
const persistentBots = new Map(); // key: number -> { startFunction, reconnectTimer }

async function startBotManager() {
    console.log('🤖 Starting bot manager...');
    const sessions = await Session.find({});
    console.log(`📦 Found ${sessions.length} sessions in DB`);

    for (const session of sessions) {
        if (session.number) {
            // Tuma signal kwa bot manager (hii inaweza kuwa function tofauti)
            // Kwa sasa, tutaanza tena bot kwa kutumia pair.js logic
            // Lakini kwa kuwa pair.js inashughulikia connection, tunahitaji kuirejesha
            // Njia rahisi: tumia function inayoanza bot kwa kutumia session iliyopo
            console.log(`🔄 Restoring bot for ${session.number}`);
            // Hapa unaweza kuita function inayoanza bot (kutoka pair.js)
            // Kama huna, tumia mfumo rahisi wa kuhifadhi na kuweka alama
            await delay(2000);
        } else {
            console.warn(`⚠️ Session without number, deleting: ${session._id}`);
            await Session.deleteOne({ _id: session._id });
        }
    }
}

// ==================== Express Setup ====================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from public folder

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
    // Hapa unaweza kuongeza logic ya kuzima bot
    await Session.deleteOne({ number: cleanNum });
    res.json({ success: true, message: `Bot ${cleanNum} unpaired and removed.` });
});

// ==================== Health Check ====================
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Increase event listeners
import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

// ==================== Start Server ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`📱 Pairing: http://localhost:${PORT}/pair`);
    console.log(`📱 QR: http://localhost:${PORT}/qrpage`);
});

export default app;