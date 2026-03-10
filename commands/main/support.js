/**
 * 🚀 INSIDIOUS NEXUS • SUPPORT CENTER
 * 🆘 Contact Developer • Bug Reports • Feature Requests
 * 🇬🇧 English Only • Premium International Standard
 */

const { fancy } = require('../../lib/tools');
const config = require('../../config');

module.exports = {
    name: "support",
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

            // ========== 🆘 SUPPORT CONTENT ==========
            const supportBody = `╭━━━━━━━━━━━━━━━━━━╮
   🆘 SUPPORT CENTER
╰━━━━━━━━━━━━━━━━━━╯

👤 ${userName} (@${userNumber})

┌─── 📞 CONTACT OPTIONS ───
│ 👑 Developer: ${config.developerName}
│ 📱 WhatsApp: ${config.channelUrl}
│ 📧 Email: officialstanlee143@gmail.com
│ 🌐 Website: .......
│ 💬 Telegram: @StanyTz076
└─────────────────────

┌─── ⏰ SUPPORT HOURS ───
│ 🕐 Monday - Friday: 9AM - 6PM
│ 🕐 Saturday: 10AM - 4PM
│ 🕐 Sunday: Emergency Only
│ 🌍 Timezone: EAT (UTC+3)
└─────────────────────

┌─── 📝 WHAT TO INCLUDE ───
│ • Your phone number
│ • Bot version
│ • Error message (screenshot)
│ • Steps to reproduce
│ • Expected behavior
└─────────────────────

┌─── 🚀 QUICK LINKS ───
│ • Report Bug: ${config.prefix}bug
│ • Request Feature: ${config.prefix}request
│ • Check Status: ${config.prefix}status
│ • User Guide: ${config.prefix}help
└─────────────────────

_© 2026 ${config.developerName} Industries_`;

            // 🔥 SPLIT: Tumia fancy kwa sehemu zote isipokuwa URL ya channel
            const url = config.channelUrl;
            const [before, after] = supportBody.split(url);
            const finalMessage = fancy(before) + url + fancy(after);

            // ========== 🎨 BUTTONS ==========
            const buttons = [
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                        display_text: `👤 Contact Owner`,
                        id: `${config.prefix}owner`
                    })
                },
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                        display_text: `📖 Help Guide`,
                        id: `${config.prefix}help`
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
                        display_text: `🏠 Main Menu`,
                        id: `${config.prefix}menu`
                    })
                }
            ];

            // ========== 📲 SEND MESSAGE ==========
            await conn.sendMessage(from, {
                text: finalMessage,
                contextInfo: {
                    externalAdReply: {
                        title: "ɪɴꜱɪᴅɪᴏᴜꜱ : ꜱᴜᴘᴘᴏʀᴛ ᴄᴇɴᴛᴇʀ",
                        body: "🆘 We're Here to Help 24/7",
                        mediaType: 1,
                        thumbnailUrl: config.menuImage3,
                        renderLargerThumbnail: true,
                        sourceUrl: config.channelUrl,
                        showAdAttribution: true
                    }
                }
            }, { quoted: msg, mentions });

        } catch (e) {
            console.error("❌ Support Error:", e);
            
            const text = `╭━━━━━━━━━━━━━━━━━━╮\n   🆘 SUPPORT\n╰━━━━━━━━━━━━━━━━━━╯\n\n👑 Dev: ${config.developerName}\n📱 Channel: ${config.channelUrl}\n\n━━━ 🚀 ━━━`;
            await conn.sendMessage(from, { text: fancy(text) }, { quoted: msg });
        }
    }
};