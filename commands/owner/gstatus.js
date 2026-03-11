// gstatus.js – Post the replied message to the current group as a normal message
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: "gstatus",
    aliases: ["grouppost"],
    description: "Reply to any message to repost it in this group (owner only)",
    category: "owner",
    execute: async (conn, msg, args, { from, isOwner, reply, fancy }) => {
        if (!isOwner) return;
        if (!from.endsWith('@g.us')) return reply("❌ This command can only be used in groups.");

        const quotedMsg = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg) return reply("❌ Reply to the message you want to repost in this group.");

        await reply("📤 Reposting in group...");

        try {
            await conn.sendMessage(from, { forward: msg, contextInfo: { forwardingScore: 0, isForwarded: false } }); // Simple forward
            // Or we could reconstruct the message exactly.
        } catch (e) {
            console.error("gstatus error:", e);
            reply("❌ Failed to repost.");
        }
    }
};