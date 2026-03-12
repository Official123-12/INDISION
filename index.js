import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

import qrRouter from './qr.js';
import pairRouter from './pair.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// ==================== MongoDB Connection – SAHIHISHA HAPA ====================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://sila_md:sila0022@sila.67mxtd7.mongodb.net/insidious?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10
}).then(() => {
    console.log('✅ MongoDB connected');
}).catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
});

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

// Health check
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