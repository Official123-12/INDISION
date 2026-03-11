const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('./config');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN not set. Telegram bot disabled.');
    process.exit(1);
}

const YOUR_CHANNEL_USERNAME = '@stanytech12';
const WHATSAPP_CHANNEL_LINK = config.whatsappChannel || config.channelUrl || 'https://whatsapp.com/channel/0029Vb7fzu4EwEjmsD4Tzs1p';
const WHATSAPP_GROUP_LINK = config.whatsappGroup || config.requiredGroupInvite || 'https://chat.whatsapp.com/J19JASXoaK0GVSoRvShr4Y';
const WEBSITE_LINK = config.websiteUrl || 'https://stanywebsite.vercel.app/';
const BOT_IMAGE = config.botImage || 'https://files.catbox.moe/mfngio.png';

// ==================== Database Schemas ====================
const telegramTokenSchema = new mongoose.Schema({
    chatId: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    phone: { type: String },
    expires: { type: Date, required: true },
    used: { type: Boolean, default: false }
});
const TelegramToken = mongoose.models.TelegramToken || mongoose.model('TelegramToken', telegramTokenSchema);

const userNumberSchema = new mongoose.Schema({
    chatId: { type: String, required: true, index: true },
    phone: { type: String, required: true },
    secret: { type: String },
    pairedAt: { type: Date, default: Date.now }
});
const UserNumber = mongoose.models.UserNumber || mongoose.model('UserNumber', userNumberSchema);

// Auto‑delete map
const autoDeleteMessages = new Map();
// Pending deploy state (waiting for phone number)
const pendingDeploy = new Map(); // chatId -> true

function scheduleDelete(chatId, messageId, seconds = 60) {
    const timeout = setTimeout(async () => {
        try {
            await bot.deleteMessage(chatId, messageId);
        } catch (e) {}
        autoDeleteMessages.delete(messageId);
    }, seconds * 1000);
    autoDeleteMessages.set(messageId, { timeout, chatId });
}

let bot; // will be created after DB ready
let botInitialized = false;

// ==================== Helper: check channel membership ====================
async function isMember(chatId) {
    try {
        const chatMember = await bot.getChatMember(YOUR_CHANNEL_USERNAME, chatId);
        return ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch {
        return false;
    }
}

// ==================== Helper: send message with image + custom buttons ====================
async function sendWithImage(chatId, text, extraButtons = []) {
    const inlineKeyboard = {
        inline_keyboard: [
            ...extraButtons.map(btn => [btn]),
            [{ text: '🏠 Main Menu', callback_data: 'menu' }]
        ]
    };
    return bot.sendPhoto(chatId, BOT_IMAGE, {
        caption: text,
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
    }).catch(() => {
        // fallback to text if photo fails
        return bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: inlineKeyboard
        });
    });
}

// ==================== Bot Setup (called once) ====================
function setupBot() {
    if (botInitialized) return;
    botInitialized = true;

    bot = new TelegramBot(token, { polling: true });
    global.bot = bot; // make globally accessible for graceful shutdown

    // Prevent crash on polling errors & handle 409 conflict
    bot.on('polling_error', (error) => {
        console.error('Telegram polling error:', error.message);
        if (error.message.includes('409')) {
            console.log('🔄 Conflict detected, restarting bot in 5 seconds...');
            bot.stopPolling().then(() => {
                setTimeout(() => {
                    bot.startPolling().catch(e => console.error('Restart failed:', e));
                }, 5000);
            }).catch(e => console.error('Stop polling error:', e));
        }
    });

    // Handle text messages (for pending deploy)
    bot.on('text', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text.trim();

        // If waiting for phone number
        if (pendingDeploy.has(chatId)) {
            pendingDeploy.delete(chatId);
            const phone = text.replace(/[^0-9]/g, '');
            if (phone.length < 9) {
                return sendWithImage(chatId, '❌ *Invalid phone number.* Please try /deploy again.');
            }
            // Process deploy with phone
            await handleDeploy(chatId, phone);
        }
    });

    // /start – checks membership, then offers deploy button
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const firstName = msg.from.first_name || 'User';

        if (!await isMember(chatId)) {
            return bot.sendMessage(
                chatId,
                `Hello ${firstName}! 👋\n\nTo use this bot, you must join our Telegram channel first: ${YOUR_CHANNEL_USERNAME}\n\nAfter joining, click /start again.`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📢 Join Channel', url: 'https://t.me/stanytech12' }]
                        ]
                    }
                }
            );
        }

        const text = `╭─── • 🥀 • ───╮\n   ɪɴꜱɪᴅɪᴏᴜꜱ ʙᴏᴛ\n╰─── • 🥀 • ───╯\n\n👋 Welcome, ${firstName}!\n\nClick the button below to deploy your WhatsApp bot.`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy Bot', callback_data: 'deploy' }]);
    });

    // /menu – lists all commands
    bot.onText(/\/menu/, async (msg) => {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return bot.emit('text', { ...msg, text: '/start' });

        const text = `╭─── • 📋 • ───╮\n   *ᴍᴀɪɴ ᴍᴇɴᴜ*\n╰─── • 📋 • ───╯\n\n` +
            `• /info – Bot information\n` +
            `• /stats – Bot statistics\n` +
            `• /deploy – Deploy your WhatsApp bot\n` +
            `• /unpair – Manage paired numbers\n` +
            `• /channel – WhatsApp channel\n` +
            `• /group – Support group\n` +
            `• /website – Our website\n` +
            `• /fb <url> – Download Facebook video\n` +
            `• /tiktok <url> – Download TikTok video\n\n` +
            `_Select a command above or use the buttons below._`;
        await sendWithImage(chatId, text, [
            { text: '🚀 Deploy', callback_data: 'deploy' },
            { text: 'ℹ️ Info', callback_data: 'info' },
            { text: '📊 Stats', callback_data: 'stats' },
            { text: '🗑️ Unpair', callback_data: 'unpair' }
        ]);
    });

    // /info
    bot.onText(/\/info/, async (msg) => {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return bot.emit('text', { ...msg, text: '/start' });

        const text = `╭─── • ℹ️ • ───╮\n   *ʙᴏᴛ ɪɴꜰᴏ*\n╰─── • ℹ️ • ───╯\n\n` +
            `🤖 *Name:* ${config.botName}\n` +
            `👑 *Developer:* ${config.developer}\n` +
            `📧 *Email:* ${config.supportEmail || 'officialstanlee143@gmail.com'}\n` +
            `📱 *Phone:* +${config.developerNumber || '255787069580'}\n` +
            `💾 *Version:* ${config.version}\n` +
            `📅 *Year:* ${config.year} - ${config.updated}\n\n` +
            `⭐ *GitHub:* [Click](${config.githubUrl})\n` +
            `📢 *Channel:* [Join](${WHATSAPP_CHANNEL_LINK})`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
    });

    // /stats
    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return bot.emit('text', { ...msg, text: '/start' });

        try {
            const totalUsers = (await TelegramToken.distinct('chatId')).length;
            const totalDeployments = await TelegramToken.countDocuments({ used: true });
            const pendingTokens = await TelegramToken.countDocuments({ used: false, expires: { $gt: new Date() } });

            const text = `╭─── • 📊 • ───╮\n   *ꜱᴛᴀᴛɪꜱᴛɪᴄꜱ*\n╰─── • 📊 • ───╯\n\n` +
                `👥 *Total Users:* ${totalUsers}\n` +
                `✅ *Deployments:* ${totalDeployments}\n` +
                `⏳ *Pending Tokens:* ${pendingTokens}\n\n` +
                `📅 *Last Updated:* ${new Date().toLocaleString()}`;
            await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        } catch (e) {
            console.error('Stats error:', e);
            await sendWithImage(chatId, '❌ *Error retrieving statistics.*', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        }
    });

    // /channel
    bot.onText(/\/channel/, async (msg) => {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return bot.emit('text', { ...msg, text: '/start' });
        const text = `╭─── • 📢 • ───╮\n   *ᴡʜᴀᴛꜱᴀᴘᴘ ᴄʜᴀɴɴᴇʟ*\n╰─── • 📢 • ───╯\n\n[Join here](${WHATSAPP_CHANNEL_LINK})`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
    });

    // /group
    bot.onText(/\/group/, async (msg) => {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return bot.emit('text', { ...msg, text: '/start' });
        const text = `╭─── • 👥 • ───╮\n   *ꜱᴜᴘᴘᴏʀᴛ ɢʀᴏᴜᴘ*\n╰─── • 👥 • ───╯\n\n[Join here](${WHATSAPP_GROUP_LINK})`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
    });

    // /website
    bot.onText(/\/website/, async (msg) => {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return bot.emit('text', { ...msg, text: '/start' });
        const text = `╭─── • 🌐 • ───╮\n   *ᴏᴜʀ ᴡᴇʙꜱɪᴛᴇ*\n╰─── • 🌐 • ───╯\n\n${WEBSITE_LINK}`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
    });

    // /fb – Facebook download
    bot.onText(/\/fb (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return bot.emit('text', { ...msg, text: '/start' });
        const url = match[1].trim();
        if (!url.startsWith('http')) {
            return sendWithImage(chatId, '❌ *Please provide a valid URL.*', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        }

        const processingMsg = await bot.sendMessage(chatId, '⏳ *Fetching video...*');
        try {
            const apiUrl = `https://api.princetechn.com/api/download/facebook?apikey=prince&url=${encodeURIComponent(url)}`;
            const res = await axios.get(apiUrl, { timeout: 20000 });
            const data = res.data;
            let videoUrl = data.url || data.link || data.video || data.data?.url;
            if (videoUrl) {
                await bot.deleteMessage(chatId, processingMsg.message_id);
                await sendWithImage(chatId, `✅ *Facebook video ready!*\n\n[Download](${videoUrl})`, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
            } else {
                throw new Error('No video URL found');
            }
        } catch (e) {
            await bot.deleteMessage(chatId, processingMsg.message_id);
            await sendWithImage(chatId, '❌ *Failed to download video.*', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        }
    });

    // /tiktok – TikTok download
    bot.onText(/\/tiktok (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return bot.emit('text', { ...msg, text: '/start' });
        const url = match[1].trim();
        if (!url.startsWith('http')) {
            return sendWithImage(chatId, '❌ *Please provide a valid URL.*', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        }

        const processingMsg = await bot.sendMessage(chatId, '⏳ *Fetching TikTok video...*');
        try {
            const apiUrl = `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`;
            const res = await axios.get(apiUrl, { timeout: 20000 });
            const data = res.data;
            let videoUrl = data.url || data.link || data.video || data.data?.play;
            if (videoUrl) {
                await bot.deleteMessage(chatId, processingMsg.message_id);
                await sendWithImage(chatId, `✅ *TikTok video ready!*\n\n[Download](${videoUrl})`, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
            } else {
                throw new Error('No video URL found');
            }
        } catch (e) {
            await bot.deleteMessage(chatId, processingMsg.message_id);
            await sendWithImage(chatId, '❌ *Failed to download video.*', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        }
    });

    // /deploy command (with optional phone)
    bot.onText(/\/deploy(?: (.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return bot.emit('text', { ...msg, text: '/start' });

        const phone = match[1] ? match[1].replace(/[^0-9]/g, '') : null;

        if (!phone || phone.length < 9) {
            // Ask for phone number
            pendingDeploy.set(chatId, true);
            return sendWithImage(chatId,
                `╭─── • 📱 • ───╮\n   *ᴅᴇᴘʟᴏʏ ʙᴏᴛ*\n╰─── • 📱 • ───╯\n\n` +
                `Please enter your WhatsApp number with country code.\n\n` +
                `Example: \`255787069580\`\n\n` +
                `(You will receive an 8‑digit pairing code and a QR code.)`,
                [] // no extra buttons, just Main Menu
            );
        }

        await handleDeploy(chatId, phone);
    });

    // /unpair command – show list of paired numbers and allow deletion
    bot.onText(/\/unpair/, async (msg) => {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return bot.emit('text', { ...msg, text: '/start' });

        const numbers = await UserNumber.find({ chatId: chatId.toString() }).sort({ pairedAt: -1 });
        if (numbers.length === 0) {
            return sendWithImage(chatId, '❌ *You have no paired numbers.*', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        }

        let text = `╭─── • 🗑️ • ───╮\n   *ʏᴏᴜʀ ᴘᴀɪʀᴇᴅ ɴᴜᴍʙᴇʀꜱ*\n╰─── • 🗑️ • ───╯\n\n`;
        const buttons = [];
        for (const n of numbers) {
            text += `📱 +${n.phone} (paired ${new Date(n.pairedAt).toLocaleDateString()})\n`;
            buttons.push([{ text: `🗑️ Delete +${n.phone}`, callback_data: `unpair_${n._id}` }]);
        }
        await sendWithImage(chatId, text, buttons);
    });

    // ==================== DEPLOY LOGIC ====================
    async function handleDeploy(chatId, phone) {
        // Generate a temporary token and store it
        const tempToken = crypto.randomBytes(8).toString('hex');
        const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        await TelegramToken.create({
            chatId: chatId.toString(),
            token: tempToken,
            expires,
            used: false,
            phone
        });

        const procMsg = await bot.sendMessage(chatId, '⏳ *Generating pairing code and QR...*');

        try {
            const baseUrl = process.env.APP_URL || `http://localhost:${config.port || 3000}`;
            const response = await axios.get(`${baseUrl}/code?number=${phone}`, { timeout: 30000 });
            const data = response.data;

            if (!data.success || !data.code) {
                throw new Error(data.error || 'Pairing failed');
            }

            const pairCode = data.code;
            const secret = data.secret || 'N/A';

            // Save to user's paired numbers
            await UserNumber.create({
                chatId: chatId.toString(),
                phone,
                secret,
                pairedAt: new Date()
            });

            // Generate QR code from the pairing code
            let qrImageBuffer = null;
            try {
                const qrDataUrl = await QRCode.toDataURL(pairCode);
                const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
                qrImageBuffer = Buffer.from(base64Data, 'base64');
            } catch (qrErr) {
                console.warn('QR generation failed, sending only text:', qrErr.message);
            }

            await bot.deleteMessage(chatId, procMsg.message_id);

            const caption = 
                `╭─── • 🔑 • ───╮\n   *ᴘᴀɪʀɪɴɢ ꜱᴜᴄᴄᴇꜱꜱ*\n╰─── • 🔑 • ───╯\n\n` +
                `📱 *Number:* +${phone}\n` +
                `🔢 *Code:* \`${pairCode}\`\n` +
                `🔐 *Secret:* \`${secret}\`\n\n` +
                `*Instructions:*\n` +
                `1. Open WhatsApp on your phone\n` +
                `2. Go to *Linked Devices* → *Link a Device*\n` +
                `3. Enter the code above\n\n` +
                `_The QR code below contains the same code (scan to copy)._\n\n` +
                `_This message will auto‑delete in 60 seconds._`;

            if (qrImageBuffer) {
                const sent = await bot.sendPhoto(chatId, qrImageBuffer, {
                    caption,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📋 Copy Code', callback_data: `copy_${pairCode}` }],
                            [{ text: '🏠 Main Menu', callback_data: 'menu' }]
                        ]
                    }
                });
                scheduleDelete(chatId, sent.message_id, 60);
            } else {
                const sent = await bot.sendMessage(chatId, caption, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📋 Copy Code', callback_data: `copy_${pairCode}` }],
                            [{ text: '🏠 Main Menu', callback_data: 'menu' }]
                        ]
                    }
                });
                scheduleDelete(chatId, sent.message_id, 60);
            }

            await TelegramToken.findOneAndUpdate({ token: tempToken }, { used: true });

        } catch (err) {
            console.error('Deploy error:', err.message);
            await bot.deleteMessage(chatId, procMsg.message_id);
            await sendWithImage(chatId, '❌ *Failed to generate pairing code. Please try again later.*', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        }
    }

    // ==================== CALLBACK QUERIES ====================
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const data = callbackQuery.data;

        if (data === 'menu') {
            await bot.answerCallbackQuery(callbackQuery.id);
            bot.emit('text', { ...msg, text: '/menu' });
        } else if (data === 'deploy') {
            await bot.answerCallbackQuery(callbackQuery.id);
            bot.emit('text', { ...msg, text: '/deploy' });
        } else if (data === 'info') {
            await bot.answerCallbackQuery(callbackQuery.id);
            bot.emit('text', { ...msg, text: '/info' });
        } else if (data === 'stats') {
            await bot.answerCallbackQuery(callbackQuery.id);
            bot.emit('text', { ...msg, text: '/stats' });
        } else if (data === 'unpair') {
            await bot.answerCallbackQuery(callbackQuery.id);
            bot.emit('text', { ...msg, text: '/unpair' });
        } else if (data.startsWith('unpair_')) {
            const id = data.replace('unpair_', '');
            const num = await UserNumber.findByIdAndDelete(id);
            if (num) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: `Number +${num.phone} deleted.` });
                // Refresh unpair list
                bot.emit('text', { ...msg, text: '/unpair' });
            } else {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Number not found.' });
            }
        } else if (data.startsWith('copy_')) {
            const code = data.replace('copy_', '');
            await bot.answerCallbackQuery(callbackQuery.id);
            await bot.sendMessage(chatId, `🔑 *Pairing Code:* \`${code}\`\n\nTap the code to copy.`, { parse_mode: 'Markdown' });
        }
    });

    console.log('🤖 Telegram bot started with enhanced features');
}

// ==================== Wait for DB connection ====================
if (mongoose.connection.readyState === 1) {
    setupBot();
} else {
    mongoose.connection.once('connected', setupBot);
}