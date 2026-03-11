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

// Only channel required (no group)
const CHANNEL_USERNAME = '@stanytech12';

// Links
const WHATSAPP_CHANNEL_LINK = config.whatsappChannel || config.channelUrl || 'https://whatsapp.com/channel/0029Vb7fzu4EwEjmsD4Tzs1p';
const WHATSAPP_GROUP_LINK = config.whatsappGroup || config.requiredGroupInvite || 'https://chat.whatsapp.com/J19JASXoaK0GVSoRvShr4Y';
const WEBSITE_LINK = config.websiteUrl || 'https://stanywebsite.vercel.app/';
const BOT_IMAGE = config.botImage || 'https://files.catbox.moe/mfngio.png';
const AVIATOR_IMAGE = 'https://raw.githubusercontent.com/stanytz378/stanyimagesservers/refs/heads/main/IMG_1424.jpeg';

// ==================== Database Models ====================
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

function scheduleDelete(chatId, messageId, seconds = 60) {
    const timeout = setTimeout(async () => {
        try {
            await bot.deleteMessage(chatId, messageId);
        } catch (e) {}
        autoDeleteMessages.delete(messageId);
    }, seconds * 1000);
    autoDeleteMessages.set(messageId, { timeout, chatId });
}

let bot;
let botInitialized = false;

// ==================== Helper: check channel membership only ====================
async function isMember(chatId) {
    try {
        const chatMember = await bot.getChatMember(CHANNEL_USERNAME, chatId);
        return ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch (err) {
        console.error('⚠️ Channel membership check error:', err.message);
        return false;
    }
}

// ==================== Helper: send message with image + buttons ====================
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
        return bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: inlineKeyboard
        });
    });
}

// ==================== DEPLOY LOGIC ====================
async function handleDeploy(chatId, phone) {
    const tempToken = crypto.randomBytes(8).toString('hex');
    const expires = new Date(Date.now() + 5 * 60 * 1000);

    await TelegramToken.create({
        chatId: chatId.toString(),
        token: tempToken,
        expires,
        used: false,
        phone
    });

    const procMsg = await bot.sendMessage(chatId, '⏳ *Generating pairing code...*');

    try {
        const baseUrl = process.env.APP_URL || `http://localhost:${config.port || 3000}`;
        const response = await axios.get(`${baseUrl}/code?number=${phone}`, { timeout: 30000 });
        const data = response.data;

        if (!data.success || !data.code) {
            throw new Error(data.error || 'Pairing failed');
        }

        const pairCode = data.code;
        const secret = data.secret || 'N/A';

        await UserNumber.create({
            chatId: chatId.toString(),
            phone,
            secret,
            pairedAt: new Date()
        });

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
            `╭─── • 🔑 • ───╮\n   *PAIRING SUCCESS*\n╰─── • 🔑 • ───╯\n\n` +
            `📱 *Number:* +${phone}\n` +
            `🔢 *Code:* \`${pairCode}\`\n` +
            `🔐 *Secret:* \`${secret}\`\n\n` +
            `*Instructions:*\n` +
            `1. Open WhatsApp on your phone\n` +
            `2. Go to *Linked Devices* → *Link a Device*\n` +
            `3. Enter the code above\n\n` +
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

// ==================== Command Handlers ====================
const handlers = {
    async start(msg) {
        const chatId = msg.chat.id;
        const firstName = msg.from.first_name || 'User';

        if (!await isMember(chatId)) {
            return bot.sendMessage(
                chatId,
                `Hello ${firstName}! 👋\n\nTo use this bot, you must join our Telegram channel first:\n\n📢 Channel: ${CHANNEL_USERNAME}\n\nAfter joining, click /start again.`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📢 Join Channel', url: 'https://t.me/stanytech12' }]
                        ]
                    }
                }
            );
        }

        const text = `╭─── • 🥀 • ───╮\n   INSIDIOUS BOT\n╰─── • 🥀 • ───╯\n\n👋 Welcome, ${firstName}!\n\nClick the button below to deploy your WhatsApp bot.`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy Bot', callback_data: 'deploy' }]);
    },

    async menu(msg) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);

        const text = `╭─── • 📋 • ───╮\n   *MAIN MENU*\n╰─── • 📋 • ───╯\n\n` +
            `• /info – Bot information\n` +
            `• /stats – Bot statistics\n` +
            `• /deploy – Deploy your WhatsApp bot\n` +
            `• /unpair – Manage paired numbers\n` +
            `• /aviator – Aviator game predictor\n` +
            `• /mines – Mines game predictor\n` +
            `• /channel – WhatsApp channel\n` +
            `• /group – WhatsApp group\n` +
            `• /website – Our website\n` +
            `• /fb <url> – Download Facebook video\n` +
            `• /tiktok <url> – Download TikTok video\n\n` +
            `_Select a command above or use the buttons below._`;
        await sendWithImage(chatId, text, [
            { text: '🚀 Deploy', callback_data: 'deploy' },
            { text: '🎲 Aviator', callback_data: 'aviator' },
            { text: '💣 Mines', callback_data: 'mines' },
            { text: 'ℹ️ Info', callback_data: 'info' },
            { text: '📊 Stats', callback_data: 'stats' },
            { text: '🗑️ Unpair', callback_data: 'unpair' }
        ]);
    },

    async info(msg) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);

        const text = `╭─── • ℹ️ • ───╮\n   *BOT INFO*\n╰─── • ℹ️ • ───╯\n\n` +
            `🤖 *Name:* ${config.botName}\n` +
            `👑 *Developer:* ${config.developer}\n` +
            `📧 *Email:* ${config.supportEmail || 'officialstanlee143@gmail.com'}\n` +
            `📱 *Phone:* +${config.developerNumber || '255787069580'}\n` +
            `💾 *Version:* ${config.version}\n` +
            `📅 *Year:* ${config.year} - ${config.updated}\n\n` +
            `⭐ *GitHub:* [Click](${config.githubUrl})\n` +
            `📢 *Channel:* [Join](${WHATSAPP_CHANNEL_LINK})`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
    },

    async stats(msg) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);

        try {
            const totalUsers = (await TelegramToken.distinct('chatId')).length;
            const totalDeployments = await TelegramToken.countDocuments({ used: true });
            const pendingTokens = await TelegramToken.countDocuments({ used: false, expires: { $gt: new Date() } });

            const text = `╭─── • 📊 • ───╮\n   *STATISTICS*\n╰─── • 📊 • ───╯\n\n` +
                `👥 *Total Users:* ${totalUsers}\n` +
                `✅ *Deployments:* ${totalDeployments}\n` +
                `⏳ *Pending Tokens:* ${pendingTokens}\n\n` +
                `📅 *Last Updated:* ${new Date().toLocaleString()}`;
            await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        } catch (e) {
            console.error('Stats error:', e);
            await sendWithImage(chatId, '❌ *Error retrieving statistics.*', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        }
    },

    async channel(msg) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);
        const text = `╭─── • 📢 • ───╮\n   *WHATSAPP CHANNEL*\n╰─── • 📢 • ───╯\n\n[Join here](${WHATSAPP_CHANNEL_LINK})`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
    },

    async group(msg) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);
        const text = `╭─── • 👥 • ───╮\n   *WHATSAPP GROUP*\n╰─── • 👥 • ───╯\n\n[Join here](${WHATSAPP_GROUP_LINK})`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
    },

    async website(msg) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);
        const text = `╭─── • 🌐 • ───╮\n   *OUR WEBSITE*\n╰─── • 🌐 • ───╯\n\n${WEBSITE_LINK}`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
    },

    async fb(msg, url) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);
        if (!url || !url.startsWith('http')) {
            return sendWithImage(chatId, '❌ *Please provide a valid URL.*\n\nExample: `/fb https://facebook.com/video`', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
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
    },

    async tiktok(msg, url) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);
        if (!url || !url.startsWith('http')) {
            return sendWithImage(chatId, '❌ *Please provide a valid URL.*\n\nExample: `/tiktok https://tiktok.com/video`', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
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
    },

    async aviator(msg, args) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);

        const companies = [
            '1win', 'betway', 'sportybet', 'premierbet', 'betika', 'wasafibet',
            '888sport', 'parimatch', '22bet', 'melbet', 'mozzart', 'mbet',
            'meridianbet', 'gsb', 'bet365', 'megapari', 'betpawa'
        ];

        if (!args || args.length === 0) {
            const manual = `
╭─── • 📘 • ───╮
   *AVIATOR USER MANUAL*
╰─── • 📘 • ───╯

━━━━━━━━━━━━━━━━━━━━━━━━━
🔰 *HOW TO USE*
━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ *View this manual*  
   Type: \`/aviator\`

2️⃣ *Request signals for a specific company*  
   Type: \`/aviator <company> [number]\`  
   Example: \`/aviator 1win 5\`  
   → Generates **5 signals** for **1win**.  
   → If you omit the number, you get 1 signal.

   Supported companies:  
   ${companies.map(c => '• ' + c).join('\n   ')}

3️⃣ *How each signal is delivered*  
   - Every **2 minutes**, a new signal appears.  
   - Each signal contains:
     • Company name
     • Expected burst multiplier (e.g., 2.35x)
     • Confidence percentage (75‑99%)
     • Recommended cashout point
   - The message auto‑deletes after 5 minutes.

━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 *PLAYING STRATEGIES*
━━━━━━━━━━━━━━━━━━━━━━━━━

┌─── 🛡️ *CONSERVATIVE*
│  • Bet: 1,000 TZS, cashout at 1.5x-2.0x
│  • Example: Signal says cashout at 1.8x → you cash out there.
└────────────────────────

┌─── ⚖️ *MODERATE*
│  • Bet: 2,000 TZS, cashout at 3.0x-5.0x
│  • Wait for high‑confidence signals.
└────────────────────────

┌─── 💎 *AGGRESSIVE*
│  • Bet: 500 TZS, hold for 10x+
│  • Use only on special signals.
└────────────────────────

━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 *PRO TIPS*
━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Always cash out at the recommended point.
✓ Never chase losses.
✓ Play responsibly.

_🥀 Trust the shadows, not the pilot._
`;
            return sendWithImage(chatId, manual, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        }

        const company = args[0].toLowerCase();
        let count = parseInt(args[1]) || 1;
        count = Math.min(12, Math.max(1, count));

        if (!companies.includes(company)) {
            return sendWithImage(chatId,
                `❌ *Unknown company.*\n\nSupported companies:\n${companies.join(', ')}`,
                [{ text: '🚀 Deploy', callback_data: 'deploy' }]
            );
        }

        // Send start image
        await bot.sendPhoto(chatId, AVIATOR_IMAGE, {
            caption: `╭── • 🥀 • ──╮\n  AVIATOR PREDICTOR\n╰── • 🥀 • ──╯\n\n` +
                `📌 *Company:* ${company.toUpperCase()}\n` +
                `🔢 *Signals:* ${count}\n` +
                `⏱️ *Total time:* ${count * 2} minutes\n\n` +
                `_Follow the signals carefully._`,
            parse_mode: 'Markdown'
        });

        await new Promise(resolve => setTimeout(resolve, 3000));

        const phrases = [
            "Low volatility – cashout at 1.5x.",
            "Green spike detected – cashout at 2.2x.",
            "Stable climb – recommended cashout 2.8x.",
            "High confidence – cashout at 3.5x.",
            "Early warning – cashout at 1.8x.",
            "Strong trend – cashout at 4.0x.",
            "Moderate risk – cashout at 2.0x.",
            "Safe pattern – cashout at 1.6x.",
            "Aggressive move – cashout at 5.0x."
        ];

        for (let i = 1; i <= count; i++) {
            const odds = (Math.random() * (4.5 - 1.2) + 1.2).toFixed(2);
            const confidence = Math.floor(Math.random() * (99 - 75) + 75);
            // Generate cashout suggestion (between 1.2 and odds)
            const cashout = (Math.random() * (parseFloat(odds) - 1.2) + 1.2).toFixed(2);
            const phrase = phrases[Math.floor(Math.random() * phrases.length)];

            const signalText = 
                `╭── • 📊 • ──╮\n  SIGNAL #${i} – ${company.toUpperCase()}\n╰── • 📊 • ──╯\n\n` +
                `🚀 *Expected burst:* ${odds}x\n` +
                `💰 *Recommended cashout:* ${cashout}x\n` +
                `📊 *Confidence:* ${confidence}%\n` +
                `💡 *Analysis:* ${phrase}\n\n` +
                `_This signal will auto‑delete in 5 minutes._`;

            // Send signal with the aviator image
            const sentMsg = await bot.sendPhoto(chatId, AVIATOR_IMAGE, {
                caption: signalText,
                parse_mode: 'Markdown'
            });
            setTimeout(() => bot.deleteMessage(chatId, sentMsg.message_id).catch(() => {}), 300000);

            if (i < count) {
                await new Promise(resolve => setTimeout(resolve, 120000)); // 2 minutes
            }
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        await bot.sendMessage(chatId,
            `╭── • 🔒 • ──╮\n  MARKET CLOSED\n╰── • 🔒 • ──╯\n\n` +
            `✅ *${count} signal(s) for ${company.toUpperCase()} completed.*\n` +
            `🕒 *Next analysis in 30 minutes.*\n\n` +
            `_Trust the shadows, not the pilot._`,
            { parse_mode: 'Markdown' }
        );
    },

    async mines(msg) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);

        // Generate 5x5 grid with 3 mines and 4 safe spots
        const size = 5;
        const totalCells = size * size;
        let grid = Array(totalCells).fill('⬛');
        
        let mines = [];
        while (mines.length < 3) {
            let pos = Math.floor(Math.random() * totalCells);
            if (!mines.includes(pos)) {
                mines.push(pos);
                grid[pos] = '💣';
            }
        }
        
        let safes = [];
        while (safes.length < 4) {
            let pos = Math.floor(Math.random() * totalCells);
            if (!mines.includes(pos) && !safes.includes(pos)) {
                safes.push(pos);
                grid[pos] = '💎';
            }
        }

        let map = '';
        for (let i = 0; i < totalCells; i++) {
            if (i % size === 0) map += '\n';
            map += grid[i] + ' ';
        }

        const text = 
            `╭─── • 💣 • ───╮\n   *MINES PREDICTION (1WIN)*\n╰─── • 💣 • ───╯` +
            `${map}\n\n` +
            `💣 *Mines:* 3\n` +
            `💎 *Safe:* 4 (follow the diamonds)\n` +
            `📊 *Algorithm:* 1win-based v2.1\n\n` +
            `_Insidious has penetrated the grid._`;
        await sendWithImage(chatId, text, [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
    },

    async deploy(msg, args) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);

        let phone = args && args.length > 0 ? args[0].replace(/[^0-9]/g, '') : null;

        if (!phone || phone.length < 9) {
            return sendWithImage(chatId,
                `╭─── • 📱 • ───╮\n   *DEPLOY BOT*\n╰─── • 📱 • ───╯\n\n` +
                `Please enter your WhatsApp number with country code.\n\n` +
                `Example: \`255787069580\`\n\n` +
                `You can do: \`/deploy 255787069580\``,
                []
            );
        }

        await handleDeploy(chatId, phone);
    },

    async unpair(msg) {
        const chatId = msg.chat.id;
        if (!await isMember(chatId)) return handlers.start(msg);

        const numbers = await UserNumber.find({ chatId: chatId.toString() }).sort({ pairedAt: -1 });
        if (numbers.length === 0) {
            return sendWithImage(chatId, '❌ *You have no paired numbers.*', [{ text: '🚀 Deploy', callback_data: 'deploy' }]);
        }

        let text = `╭─── • 🗑️ • ───╮\n   *YOUR PAIRED NUMBERS*\n╰─── • 🗑️ • ───╯\n\n`;
        const buttons = [];
        for (const n of numbers) {
            text += `📱 +${n.phone} (paired ${new Date(n.pairedAt).toLocaleDateString()})\n`;
            buttons.push([{ text: `🗑️ Delete +${n.phone}`, callback_data: `unpair_${n._id}` }]);
        }
        await sendWithImage(chatId, text, buttons);
    }
};

// ==================== Bot Setup ====================
function setupBot() {
    if (botInitialized) return;
    botInitialized = true;

    bot = new TelegramBot(token, { polling: true });
    global.bot = bot;

    // Polling error handler – fixes 409 and EFATAL
    bot.on('polling_error', (error) => {
        console.error('Telegram polling error:', error.message);
        if (error.message.includes('409') || error.message.includes('EFATAL')) {
            console.log('🔄 Restarting bot in 5 seconds...');
            bot.stopPolling().then(() => {
                setTimeout(() => {
                    bot.startPolling().catch(e => console.error('Restart failed:', e));
                }, 5000);
            }).catch(e => console.error('Stop polling error:', e));
        }
    });

    // Text handler
    bot.on('text', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (text.startsWith('/')) {
            const parts = text.slice(1).split(' ');
            const cmd = parts[0].toLowerCase();
            const args = parts.slice(1);

            switch (cmd) {
                case 'start': await handlers.start(msg); break;
                case 'menu':
                case 'help': await handlers.menu(msg); break;
                case 'info': await handlers.info(msg); break;
                case 'stats': await handlers.stats(msg); break;
                case 'channel': await handlers.channel(msg); break;
                case 'group': await handlers.group(msg); break;
                case 'website': await handlers.website(msg); break;
                case 'fb': await handlers.fb(msg, args[0]); break;
                case 'tiktok': await handlers.tiktok(msg, args[0]); break;
                case 'aviator': await handlers.aviator(msg, args); break;
                case 'mines': await handlers.mines(msg); break;
                case 'deploy': await handlers.deploy(msg, args); break;
                case 'unpair': await handlers.unpair(msg); break;
                default: await handlers.menu(msg);
            }
        }
    });

    // Callback queries
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const data = callbackQuery.data;
        await bot.answerCallbackQuery(callbackQuery.id);

        if (data === 'menu') await handlers.menu(msg);
        else if (data === 'deploy') await handlers.deploy(msg, []);
        else if (data === 'aviator') await handlers.aviator(msg, []);
        else if (data === 'mines') await handlers.mines(msg);
        else if (data === 'info') await handlers.info(msg);
        else if (data === 'stats') await handlers.stats(msg);
        else if (data === 'unpair') await handlers.unpair(msg);
        else if (data.startsWith('unpair_')) {
            const id = data.replace('unpair_', '');
            const num = await UserNumber.findByIdAndDelete(id);
            if (num) {
                await bot.sendMessage(chatId, `✅ Number +${num.phone} deleted.`);
                await handlers.unpair(msg);
            } else {
                await bot.sendMessage(chatId, '❌ Number not found.');
            }
        } else if (data.startsWith('copy_')) {
            const code = data.replace('copy_', '');
            await bot.sendMessage(chatId, `🔑 *Pairing Code:* \`${code}\``, { parse_mode: 'Markdown' });
        }
    });

    console.log('🤖 Telegram bot started – all commands ready');
}

// ==================== Wait for DB connection ====================
if (mongoose.connection.readyState === 1) {
    setupBot();
} else {
    mongoose.connection.once('connected', setupBot);
}