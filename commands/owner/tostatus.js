// tostatus.js – Post the replied message to your personal WhatsApp status (self)
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: "tostatus",
    aliases: ["selfstatus"],
    description: "Reply to any message to post it as your own WhatsApp status (owner only)",
    category: "owner",
    execute: async (conn, msg, args, { from, isOwner, reply, fancy }) => {
        if (!isOwner) return;

        const quotedMsg = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg) return reply("❌ Reply to the message you want to post as your status.");

        await reply("📤 Posting to your status...");

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
                return reply("❌ Unsupported message type.");
            }

            let statusContent = {};
            if (messageType === 'image') statusContent = { image: mediaBuffer, caption: caption || '' };
            else if (messageType === 'video') statusContent = { video: mediaBuffer, caption: caption || '' };
            else if (messageType === 'audio') statusContent = { audio: mediaBuffer, mimetype };
            else if (messageType === 'text') statusContent = { text: caption };

            await conn.sendMessage('status@broadcast', statusContent);
            reply(fancy("✅ Status posted to your account!"));
        } catch (e) {
            console.error("tostatus error:", e);
            reply("❌ Failed to post status.");
        }
    }
};