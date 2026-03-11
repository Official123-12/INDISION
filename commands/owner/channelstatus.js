const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: "channelstatus",
    aliases: ["chstatus", "cstatus"],
    description: "Reply to any message to post it to your WhatsApp channel (owner only).\nRequires NEWSLETTER_JID in config/.env.",
    category: "owner",
    execute: async (conn, msg, args, { from, isOwner, reply, fancy, getBotSetting }) => {
        if (!isOwner) return;

        // Get the channel JID for this specific bot
        const channelJid = await getBotSetting('newsletterJid');
        if (!channelJid) {
            return reply("❌ Channel JID not configured. Set NEWSLETTER_JID in your environment or config.");
        }

        const quotedMsg = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg) return reply("❌ Reply to the message you want to post to your channel.");

        await reply("📤 Posting to channel...");

        let messageType = null;
        let mediaBuffer = null;
        let caption = null;
        let mimetype = null;

        const downloadMedia = async (mediaKey, type) => {
            const stream = await downloadContentFromMessage(mediaKey, type);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            return buffer;
        };

        try {
            if (quotedMsg.imageMessage) {
                messageType = 'image';
                caption = quotedMsg.imageMessage.caption || '';
                mediaBuffer = await downloadMedia(quotedMsg.imageMessage, 'image');
            } else if (quotedMsg.videoMessage) {
                messageType = 'video';
                caption = quotedMsg.videoMessage.caption || '';
                mediaBuffer = await downloadMedia(quotedMsg.videoMessage, 'video');
            } else if (quotedMsg.audioMessage) {
                messageType = 'audio';
                mimetype = quotedMsg.audioMessage.mimetype || 'audio/mpeg';
                mediaBuffer = await downloadMedia(quotedMsg.audioMessage, 'audio');
            } else if (quotedMsg.conversation) {
                messageType = 'text';
                caption = quotedMsg.conversation;
            } else if (quotedMsg.extendedTextMessage?.text) {
                messageType = 'text';
                caption = quotedMsg.extendedTextMessage.text;
            } else {
                return reply("❌ Unsupported message type. Only text, image, video, and audio are supported.");
            }

            let channelContent = {};
            if (messageType === 'image') channelContent = { image: mediaBuffer, caption: caption || '' };
            else if (messageType === 'video') channelContent = { video: mediaBuffer, caption: caption || '' };
            else if (messageType === 'audio') channelContent = { audio: mediaBuffer, mimetype };
            else if (messageType === 'text') channelContent = { text: caption };

            await conn.sendMessage(channelJid, channelContent);
            reply(fancy("✅ Posted to your channel!"));
        } catch (e) {
            console.error("channelstatus error:", e);
            reply("❌ Failed to post to channel. " + (e.message || "Unknown error"));
        }
    }
};