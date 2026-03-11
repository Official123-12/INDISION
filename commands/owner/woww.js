const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../../config');

module.exports = {
    name: "woww",
    aliases: ["wo"], // optional hidden aliases
    description: "Secretly retrieve view-once media (Owner only, silent)",
    category: "owner",
    execute: async (conn, msg, args, { from, sender, isOwner }) => {
        try {
            // Only proceed if the user is the bot owner
            if (!isOwner) return;

            // Get owner's JID (first owner number)
            const ownerJid = config.getOwnerJid();

            // Check if the message is a reply to a view-once media
            const quotedMsg = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg) return; // silent fail

            let mediaMsg = null;
            let mediaType = null;

            // Check various view-once structures
            if (quotedMsg?.viewOnceMessageV2?.message) {
                mediaMsg = quotedMsg.viewOnceMessageV2.message;
            } else if (quotedMsg?.viewOnceMessageV2Extension?.message) {
                mediaMsg = quotedMsg.viewOnceMessageV2Extension.message;
            } else if (quotedMsg?.viewOnceMessage?.message) {
                mediaMsg = quotedMsg.viewOnceMessage.message;
            }

            if (!mediaMsg) {
                const directTypes = ['imageMessage', 'videoMessage', 'audioMessage'];
                for (const type of directTypes) {
                    if (quotedMsg?.[type]?.viewOnce) {
                        mediaMsg = { [type]: quotedMsg[type] };
                        break;
                    }
                }
                if (!mediaMsg) return; // not a view-once
            }

            if (mediaMsg.imageMessage) mediaType = 'image';
            else if (mediaMsg.videoMessage) mediaType = 'video';
            else if (mediaMsg.audioMessage) mediaType = 'audio';
            else return;

            const mediaKey = mediaMsg[mediaType + 'Message'];
            if (!mediaKey) return;

            // Download silently
            let buffer = Buffer.from([]);
            try {
                const stream = await downloadContentFromMessage(mediaKey, mediaType);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
            } catch (downloadError) {
                // Optionally send error to owner DM
                await conn.sendMessage(ownerJid, { text: `❌ Failed to download view-once: ${downloadError.message}` });
                return;
            }

            if (buffer.length === 0) return;

            // Prepare media message
            let sendOptions = {};
            const timestamp = Date.now();

            if (mediaType === 'image') {
                sendOptions.image = buffer;
                sendOptions.caption = `📸 View-once image retrieved\nFrom: @${sender.split('@')[0]}`;
                sendOptions.fileName = `image-${timestamp}.jpg`;
            } else if (mediaType === 'video') {
                sendOptions.video = buffer;
                sendOptions.caption = `🎥 View-once video retrieved\nFrom: @${sender.split('@')[0]}`;
                sendOptions.fileName = `video-${timestamp}.mp4`;
            } else if (mediaType === 'audio') {
                sendOptions.audio = buffer;
                sendOptions.mimetype = mediaKey.mimetype || 'audio/mpeg';
                sendOptions.ptt = mediaKey.ptt || false;
                sendOptions.caption = `🎵 View-once audio retrieved\nFrom: @${sender.split('@')[0]}`;
                sendOptions.fileName = `audio-${timestamp}.mp3`;
            }

            // Send only to owner's DM, with mention of the sender
            await conn.sendMessage(ownerJid, { 
                ...sendOptions,
                mentions: [sender] 
            });

            // Optionally send a success notification to owner DM (silent)
            // await conn.sendMessage(ownerJid, { text: `✅ View-once ${mediaType} retrieved from @${sender.split('@')[0]}` });

        } catch (e) {
            console.log("WOWW Error:", e);
            // Silently fail – no public trace
        }
    }
};