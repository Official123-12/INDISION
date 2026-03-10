const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const config = require('./config');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN not set. Telegram bot disabled.');
    process.exit(1);
}

const YOUR_CHANNEL_USERNAME = '@stanytech12'; // ✅ Telegram channel
const WHATSAPP_CHANNEL_LINK = config.whatsappChannel;
const WHATSAPP_GROUP_LINK = config.whatsappGroup;
const WEBSITE_LINK = config.websiteUrl;

// Schema ya kuhifadhi token za muda
const telegramTokenSchema = new mongoose.Schema({
    chatId: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    phone: { type: String },
    expires: { type: Date, required: true },
    used: { type: Boolean, default: false }
});
const TelegramToken = mongoose.models.TelegramToken || mongoose.model('TelegramToken', telegramTokenSchema);

let bot; // itaundwa baada ya DB kuunganishwa

// ==================== UTARATIBU WA BOT ====================
function setupBot() {
    bot = new TelegramBot(token, { polling: true });

    // Helper: angalia uanachama wa channel
    async function isMember(chatId) {
        try {
            const chatMember = await bot.getChatMember(YOUR_CHANNEL_USERNAME, chatId);
            return ['member', 'administrator', 'creator'].includes(chatMember.status);
        } catch {
            return false;
        }
    }

    // ==================== AMRI ZA MSINGI ====================

    // /start
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

        bot.sendMessage(
            chatId,
            `✅ Welcome back, ${firstName}! You're a member of the channel.\n\nUse /menu to see all available commands.`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔑 Generate Token', callback_data: 'generate_token' }]
                    ]
                }
            }
        );
    });

    // Generate token (callback)
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const data = callbackQuery.data;

        if (data === 'generate_token') {
            const tempToken = crypto.randomBytes(16).toString('hex');
            const expires = new Date(Date.now() + 5 * 60 * 1000); // dakika 5

            await TelegramToken.create({
                chatId: chatId.toString(),
                token: tempToken,
                expires,
                used: false
            });

            await bot.sendMessage(
                chatId,
                `🔑 *Your Temporary Token Generated!*\n\n` +
                `Token: \`${tempToken}\`\n\n` +
                `This token is valid for 5 minutes.\n\n` +
                `Now use the command:\n` +
                `/deploy YOUR_PHONE_NUMBER ${tempToken}\n\n` +
                `Example: \`/deploy 255787069580 ${tempToken}\``,
                { parse_mode: 'Markdown' }
            );

            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Token generated!' });
        }
    });

    // /deploy
    bot.onText(/\/deploy (.+) (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const phone = match[1].replace(/[^0-9]/g, '');
        const token = match[2];

        if (!phone || phone.length < 10) {
            return bot.sendMessage(chatId, '❌ *Invalid phone number.* Use format: 2557XXXXXXXX', { parse_mode: 'Markdown' });
        }

        const tokenDoc = await TelegramToken.findOne({ token, used: false, expires: { $gt: new Date() } });
        if (!tokenDoc) {
            return bot.sendMessage(chatId, '❌ *Invalid or expired token.* Please generate a new one with /start.', { parse_mode: 'Markdown' });
        }
        if (tokenDoc.chatId !== chatId.toString()) {
            return bot.sendMessage(chatId, '❌ *Token does not belong to you.*', { parse_mode: 'Markdown' });
        }

        tokenDoc.used = true;
        tokenDoc.phone = phone;
        await tokenDoc.save();

        try {
            const baseUrl = `http://localhost:${config.port || 3000}`;
            const response = await axios.get(`${baseUrl}/pair?num=${phone}`, { timeout: 30000 });
            const data = response.data;

            if (data.success && data.code) {
                let message = `✅ *Pairing Code Generated!*\n\n` +
                    `Code: \`${data.code}\`\n\n` +
                    `Enter this code in WhatsApp to link your bot.\n\n`;
                if (data.secret) {
                    message += `🔐 *Your Secret ID:* \`${data.secret}\`\n` +
                        `_Use this ID to manage your bot settings on our website._\n\n`;
                }
                message += `Your bot will be active shortly.`;
                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, `❌ *Failed to generate code:* ${data.error || 'Unknown error'}`, { parse_mode: 'Markdown' });
            }
        } catch (err) {
            console.error('Error calling /pair:', err);
            await bot.sendMessage(chatId, '❌ *Internal server error.* Please try again later.', { parse_mode: 'Markdown' });
        }
    });

    // /menu – Fancy command list with new border style
    bot.onText(/\/menu/, async (msg) => {
        const chatId = msg.chat.id;
        const menuText = `
╭─── • 🥀 • ───╮
   ✦ *INSIDIOUS BOT COMMANDS* ✦
╰─── • 🥀 • ───╯

╭─── • 🔰 BASIC COMMANDS • ───╮
│ • /start – Start the bot     
│ • /menu – Show this menu     
│ • /help – Alias for /menu     
│ • /info – Bot information     
│ • /stats – Bot statistics     
╰────────────────────────────╯

╭─── • 🤖 DEPLOYMENT COMMANDS • ───╮
│ • /deploy <phone> <token> – Deploy
│ • (Generate token via /start)     
╰────────────────────────────────╯

╭─── • 📥 DOWNLOAD COMMANDS • ───╮
│ • /fb <url> – Download Facebook 
│ • /tiktok <url> – Download TikTok
╰──────────────────────────────╯

╭─── • 🔗 SOCIAL LINKS • ───╮
│ • /channel – WhatsApp channel 
│ • /group – WhatsApp group     
│ • /website – Our website      
╰──────────────────────────╯

╭─── • 📢 CONNECT WITH US • ───╮
│ 📱 WhatsApp: [Channel](${WHATSAPP_CHANNEL_LINK}) │
│ 👥 Group: [Join](${WHATSAPP_GROUP_LINK})        │
│ 🌐 Website: ${WEBSITE_LINK}                    │
╰──────────────────────────────╯
        `;
        await bot.sendMessage(chatId, menuText, { parse_mode: 'Markdown', disable_web_page_preview: true });
    });

    // /help – alias
    bot.onText(/\/help/, async (msg) => {
        bot.emit('text', { ...msg, text: '/menu' });
    });

    // /channel – WhatsApp channel link
    bot.onText(/\/channel/, async (msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, `╭─── • 📢 • ───╮\n   *WhatsApp Channel*\n╰─── • 📢 • ───╯\n\n${WHATSAPP_CHANNEL_LINK}`, { parse_mode: 'Markdown' });
    });

    // /group – WhatsApp group link
    bot.onText(/\/group/, async (msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, `╭─── • 👥 • ───╮\n   *Support Group*\n╰─── • 👥 • ───╯\n\n${WHATSAPP_GROUP_LINK}`, { parse_mode: 'Markdown' });
    });

    // /website – Website link
    bot.onText(/\/website/, async (msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, `╭─── • 🌐 • ───╮\n   *Our Website*\n╰─── • 🌐 • ───╯\n\n${WEBSITE_LINK}`, { parse_mode: 'Markdown' });
    });

    // /stats – Statistics
    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const totalUsers = (await TelegramToken.distinct('chatId')).length;
            const totalDeployments = await TelegramToken.countDocuments({ used: true });
            const pendingTokens = await TelegramToken.countDocuments({ used: false, expires: { $gt: new Date() } });
            const statsText = `
╭─── • 📊 • ───╮
   *BOT STATISTICS*
╰─── • 📊 • ───╯

• 👥 *Total Users*: ${totalUsers}
• ✅ *Successful Deployments*: ${totalDeployments}
• ⏳ *Pending Tokens*: ${pendingTokens}

📅 *Last Updated*: ${new Date().toLocaleString()}
            `;
            await bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('Error fetching stats:', err);
            await bot.sendMessage(chatId, '❌ *Error retrieving statistics.*', { parse_mode: 'Markdown' });
        }
    });

    // /info – Bot information
    bot.onText(/\/info/, async (msg) => {
        const chatId = msg.chat.id;
        const infoText = `
╭─── • ℹ️ • ───╮
   *INSIDIOUS BOT INFO*
╰─── • ℹ️ • ───╯

🤖 *Bot Name*: ${config.botName}
👑 *Developer*: ${config.developer}
📧 *Email*: ${config.supportEmail || 'officialstanlee143@gmail.com'}
📱 *Phone*: ${config.developerNumber || '+255787069580'}
💾 *Version*: ${config.version}
📅 *Year*: ${config.year} - ${config.updated}

╭─── • 🔗 LINKS • ───╮
│ 📢 Channel: [Click](${WHATSAPP_CHANNEL_LINK}) 
│ 👥 Group: [Join](${WHATSAPP_GROUP_LINK})      
│ 🌐 Website: ${WEBSITE_LINK}                    
│ ⭐ GitHub: [Repo](${config.githubUrl})         
╰──────────────────────╯

💬 *Special Thanks*: ${config.specialThanks || 'REDTECH'}
        `;
        await bot.sendMessage(chatId, infoText, { parse_mode: 'Markdown', disable_web_page_preview: true });
    });

    // ==================== AMRI ZA DOWNLOAD ====================

    // /fb <url> – Download Facebook video
    bot.onText(/\/fb (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const url = match[1].trim();

        if (!url.startsWith('http')) {
            return bot.sendMessage(chatId, '❌ *Please provide a valid URL.*', { parse_mode: 'Markdown' });
        }

        const processingMsg = await bot.sendMessage(chatId, '⏳ *Fetching video... Please wait.*', { parse_mode: 'Markdown' });

        try {
            const apiUrl = `${config.facebookApi}${encodeURIComponent(url)}`;
            const response = await axios.get(apiUrl, { timeout: 30000 });

            const data = response.data;
            let videoUrl = null;

            if (data.url) videoUrl = data.url;
            else if (data.data && data.data.url) videoUrl = data.data.url;
            else if (data.video) videoUrl = data.video;
            else if (data.result && data.result.url) videoUrl = data.result.url;
            else if (data.link) videoUrl = data.link;

            if (videoUrl) {
                await bot.sendMessage(chatId, `✅ *Facebook video ready!*\n\n[Click here to download](${videoUrl})`, { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, '❌ *Could not extract video URL. Please check the link or try again later.*', { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error('Facebook download error:', error.message);
            await bot.sendMessage(chatId, '❌ *Failed to download video. The service may be unavailable.*', { parse_mode: 'Markdown' });
        } finally {
            await bot.deleteMessage(chatId, processingMsg.message_id);
        }
    });

    // /tiktok <url> – Download TikTok video
    bot.onText(/\/tiktok (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const url = match[1].trim();

        if (!url.startsWith('http')) {
            return bot.sendMessage(chatId, '❌ *Please provide a valid URL.*', { parse_mode: 'Markdown' });
        }

        const processingMsg = await bot.sendMessage(chatId, '⏳ *Fetching TikTok video... Please wait.*', { parse_mode: 'Markdown' });

        try {
            const apiUrl = `${config.tiktokApi}${encodeURIComponent(url)}`;
            const response = await axios.get(apiUrl, { timeout: 30000 });
            const data = response.data;
            let videoUrl = null;

            if (data.url) videoUrl = data.url;
            else if (data.data && data.data.play) videoUrl = data.data.play;
            else if (data.video) videoUrl = data.video;
            else if (data.result && data.result.video) videoUrl = data.result.video;
            else if (data.link) videoUrl = data.link;

            if (videoUrl) {
                await bot.sendMessage(chatId, `✅ *TikTok video ready!*\n\n[Click here to download](${videoUrl})`, { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, '❌ *Could not extract video URL. Please check the link or try again later.*', { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error('TikTok download error:', error.message);
            await bot.sendMessage(chatId, '❌ *Failed to download video. The service may be unavailable.*', { parse_mode: 'Markdown' });
        } finally {
            await bot.deleteMessage(chatId, processingMsg.message_id);
        }
    });

    console.log('🤖 Telegram bot started with enhanced features');
}

// ==================== SUBIRI DB IUNGANISHE ====================
if (mongoose.connection.readyState === 1) {
    setupBot();
} else {
    mongoose.connection.once('connected', setupBot);
}