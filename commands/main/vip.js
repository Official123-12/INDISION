/**
 * 🚀 INSIDIOUS NEXUS • VIP ACCESS
 * 👑 Premium Membership Info • Upgrade Guide
 * 🇬🇧 English Only • Premium International Standard
 */

const { fancy } = require('../../lib/tools');
const config = require('../../config');

module.exports = {
    name: "vip",
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

            // ========== 👑 VIP CONTENT ==========
            const vipBody = `╭━━━━━━━━━━━━━━━━━━╮
   👑 VIP MEMBERSHIP
╰━━━━━━━━━━━━━━━━━━╯

👤 ${userName} 

┌─── 🌟 VIP BENEFITS ───
│ ✓ Priority Support (24/7)
│ ✓ Exclusive Commands
│ ✓ Custom Bot Configuration
│ ✓ API Access
│ ✓ Plugin Development
│ ✓ Analytics Dashboard
│ ✓ Early Feature Access
│ ✓ Dedicated Server
│ ✓ No Rate Limits
│ ✓ Custom Branding
└─────────────────────

┌─── 💰 PRICING PLANS ───
│ 🥉 BASIC: $5/month
│   • Priority Support
│   • Exclusive Commands
│
│ 🥈 PRO: $10/month
│   • All Basic Features
│   • API Access
│   • Custom Configuration
│
│ 🥇 ELITE: $12/month
│   • All Pro Features
│   • Dedicated Server
│   • Custom Branding
│   • Plugin Development
└─────────────────────

┌─── 📞 HOW TO UPGRADE ───
│ 1. Contact: ${config.developerName}
│ 2. Channel: ${config.channelUrl}
│ 3. Email: officialstanlee143@gmail.com
│ 4. Payment: M-Pesa / PayPal / Crypto
└─────────────────────

_© 2026 ${config.developerName} Industries_`;

            // 🔥 SPLIT: Tumia fancy kwa sehemu zote isipokuwa URL ya channel
            const url = config.channelUrl;
            const [before, after] = vipBody.split(url);
            const finalMessage = fancy(before) + url + fancy(after);

            // ========== 🎨 BUTTONS ==========
            const buttons = [
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                        display_text: `📞 Contact Dev`,
                        id: `${config.prefix}owner`
                    })
                },
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                        display_text: `💎 Features`,
                        id: `${config.prefix}features`
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
                        title: "ɪɴꜱɪᴅɪᴏᴜꜱ : ᴠɪᴘ ᴀᴄᴄᴇꜱꜱ",
                        body: "👑 Upgrade to Premium Today",
                        mediaType: 1,
                        thumbnailUrl: config.menuImage3,
                        renderLargerThumbnail: true,
                        sourceUrl: config.channelUrl,
                        showAdAttribution: true
                    }
                }
            }, { quoted: msg, mentions });

        } catch (e) {
            console.error("❌ VIP Error:", e);
            
            const text = `╭━━━━━━━━━━━━━━━━━━╮\n   👑 VIP ACCESS\n╰━━━━━━━━━━━━━━━━━━╯\n\n🌟 Priority Support\n💎 Exclusive Features\n🚀 Dedicated Server\n\n📞 Contact: ${config.developerName}\n\n━━━ 🚀 ━━━`;
            await conn.sendMessage(from, { text: fancy(text) }, { quoted: msg });
        }
    }
};