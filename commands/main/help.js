/**
 * 🚀 INSIDIOUS NEXUS • HELP CENTER
 * 📖 Complete Usage Guide • Commands Tutorial
 * 🇬🇧 English Only • Premium International Standard
 */

const { fancy, runtime } = require('../../lib/tools');
const config = require('../../config');

module.exports = {
    name: "help",
    execute: async (conn, msg, args, { from, sender, pushname }) => {
        try {
            // ========== 🎯 REAL USERNAME ==========
            const userNumber = sender.split('@')[0];
            let userName = pushname?.trim() || '';
            if (!userName || userName === 'undefined') {
                try {
                    const contact = conn.contactStore?.contacts?.[sender] || await conn.getContact(sender);
                    userName = contact?.name || contact?.pushname || contact?.verifiedName || '';
                } catch {}
            }
            userName = userName?.trim() || `User_${userNumber.slice(-4)}`;
            const mentions = [sender];

            // ========== 📖 HELP CONTENT ==========
            const helpBody = `╭━━━━━━━━━━━━━━━━━━╮
   📖 USER GUIDE
╰━━━━━━━━━━━━━━━━━━╯

👤 ${userName} (@${userNumber})

┌─── 🚀 GETTING STARTED ───
│ 1. Use ${config.prefix}menu for full list
│ 2. Use ${config.prefix}search to find commands
│ 3. Use ${config.prefix}menu3 for dashboard
│ 4. Type ${config.prefix}<command> to execute
└─────────────────────────

┌─── 📌 POPULAR COMMANDS ───
│ ${config.prefix}menu - Full command list
│ ${config.prefix}menu2 - Emergency menu
│ ${config.prefix}menu3 - Nexus dashboard
│ ${config.prefix}search - Find commands
│ ${config.prefix}stats - System statistics
│ ${config.prefix}ping - Check bot speed
│ ${config.prefix}owner - Contact developer
│ ${config.prefix}help - This guide
└─────────────────────────

┌─── 💡 TIPS & TRICKS ───
│ • Commands are case-sensitive
│ • No spaces between prefix & command
│ • Use ${config.prefix}search for quick access
│ • Menu3 has one-tap quick actions
│ • Report bugs to developer
└─────────────────────────

┌─── 🆘 NEED SUPPORT? ───
│ • Use ${config.prefix}support
│ • Contact: ${config.developerName}
│ • Channel: ${config.channelUrl}
└─────────────────────────

_© 2026 ${config.developerName} Industries_`;

            // 🔥 SPLIT: Tumia fancy kwa sehemu zote isipokuwa URL ya channel
            const url = config.channelUrl;
            const [before, after] = helpBody.split(url);
            const finalMessage = fancy(before) + url + fancy(after);

            // ========== 🎨 BUTTONS ==========
            const buttons = [
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                        display_text: `🏠 Main Menu`,
                        id: `${config.prefix}menu`
                    })
                },
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                        display_text: `🚀 Nexus`,
                        id: `${config.prefix}menu3`
                    })
                },
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                        display_text: `🔍 Search`,
                        id: `${config.prefix}search`
                    })
                },
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                        display_text: `📞 Support`,
                        id: `${config.prefix}support`
                    })
                }
            ];

            // ========== 📲 SEND MESSAGE ==========
            await conn.sendMessage(from, {
                text: finalMessage,
                contextInfo: {
                    externalAdReply: {
                        title: "ɪɴꜱɪᴅɪᴏᴜꜱ : ᴜꜱᴇʀ ɢᴜɪᴅᴇ",
                        body: "📖 Complete Command Reference",
                        mediaType: 1,
                        thumbnailUrl: config.menuImage3,
                        renderLargerThumbnail: true,
                        sourceUrl: config.channelUrl,
                        showAdAttribution: true
                    }
                }
            }, { quoted: msg, mentions });

        } catch (e) {
            console.error("❌ Help Error:", e);
            
            const userNumber = sender.split('@')[0];
            let userName = pushname || `User_${userNumber.slice(-4)}`;
            try {
                const contact = await conn.getContact(sender);
                userName = contact?.name || contact?.pushname || userName;
            } catch {}

            const text = `╭━━━━━━━━━━━━━━━━━━╮\n   📖 HELP GUIDE\n╰━━━━━━━━━━━━━━━━━━╯\n\n👤 ${userName}\n\n${config.prefix}menu - Full list\n${config.prefix}search - Find commands\n${config.prefix}owner - Support\n\n━━━ 🚀 ━━━\n👑 ${config.developerName}`;
            await conn.sendMessage(from, { text: fancy(text), mentions: [sender] }, { quoted: msg });
        }
    }
};