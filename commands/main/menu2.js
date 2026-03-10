/**
 * 🥀 INSIDIOUS - EMERGENCY HUB
 * 🥀 THEME: LUXURY VERTICAL TEXT (NO INTERACTIVE BUTTONS)
 * 🥀 LOGO: BUFFERED THUMBNAIL (LARGE) • ENGLISH ONLY
 * 🥀 PURPOSE: Emergency fallback when interactive messages fail
 */

const fs = require('fs-extra');
const path = require('path');
const config = require('../../config');
const { fancy, runtime } = require('../../lib/tools');

module.exports = {
    name: 'menu2',
    async execute(m, sock, commands, args, db, forwardedContext) {
        try {
            const from = m.key.remoteJid;
            const sender = m.key.participant || m.key.remoteJid;
            const pushName = m.pushName || '';

            // ========== 🎯 REAL USERNAME FETCHER ==========
            const userNumber = sender.split('@')[0];
            let userName = pushName?.trim() || '';
            
            if (!userName || userName === 'undefined') {
                try {
                    const contact = sock.contactStore?.contacts?.[sender] || await sock.getContact(sender);
                    userName = contact?.name || contact?.pushname || contact?.verifiedName || '';
                } catch {}
            }
            if (!userName || userName === 'undefined' && from.endsWith('@g.us')) {
                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participant = groupMetadata?.participants?.find(p => p.id === sender);
                    userName = participant?.name || '';
                } catch {}
            }
            userName = userName?.trim() || `User_${userNumber.slice(-4)}`;

            // ========== 🔧 CONFIG (Firebase removed – using local config) ==========
            const prefix = config.prefix || '.';
            const botMode = (config.mode || 'public').toUpperCase();

            const uptimeSeconds = process.uptime();
            const uptimeStr = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`;

            // ========== 🗂️ CATEGORIZE COMMANDS ==========
            const categories = {};
            (commands || []).forEach(cmd => {
                const cat = cmd.category ? cmd.category.toUpperCase() : 'GENERAL';
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(cmd.name);
            });

            // ========== 🎨 BUILD LUXURY MENU BODY (ENGLISH ONLY) ==========
            let menuBody = `╭─── • 🥀 • ───╮\n`;
            menuBody += `   ɪ ɴ ꜱ ɪ ᴅ ɪ ᴏ ᴜ ꜱ  ʙ ᴏ ᴛ \n`;
            menuBody += `╰─── • 🥀 • ───╯\n\n`;

            menuBody += `┌  🥀  *ꜱʏꜱᴛᴇᴍ  ɪɴꜰᴏ*\n`;
            menuBody += `│  ᴜꜱᴇʀ: ${userName}\n`;
            menuBody += `│  ᴍᴏᴅᴇ: ${botMode}\n`;
            menuBody += `│  ᴘʀᴇꜰɪx: [ ${prefix} ]\n`;
            menuBody += `│  ᴄᴏᴍᴍᴀɴᴅꜱ: ${(commands || []).length}\n`;
            menuBody += `│  ᴜᴘᴛɪᴍᴇ: ${uptimeStr}\n`;
            menuBody += `│  ᴅᴇᴠ: ${config.developerName || 'Stany'}\n`;
            menuBody += `└──────────────\n\n`;

            // Sort categories alphabetically
            const sortedCats = Object.keys(categories).sort();
            
            for (const cat of sortedCats) {
                menuBody += `╭──• *${cat}* •\n`;
                categories[cat].sort().forEach(name => {
                    menuBody += `│ ◦ ${prefix}${name}\n`;
                });
                menuBody += `╰──────────────\n\n`;
            }

            menuBody += `_© 2026 ${config.developerName || 'Stany'} Industries_`;

            // ========== 🖼️ BUFFERED LOGO (LARGE THUMBNAIL) ==========
            let logoBuffer = null;
            try {
                const axios = require('axios');
                const response = await axios.get(config.menuImage || 'https://files.catbox.moe/59ays3.jpg', { 
                    responseType: 'arraybuffer',
                    timeout: 8000 
                });
                logoBuffer = Buffer.from(response.data, 'binary');
            } catch (e) {
                console.warn("⚠️ Logo fetch failed, using fallback");
            }

            // ========== 📲 SEND LUXURY TEXT MESSAGE ==========
            await sock.sendMessage(from, { 
                text: menuBody, 
                contextInfo: {
                    ...forwardedContext,
                    externalAdReply: {
                        title: "ɪɴꜱɪᴅɪᴏᴜꜱ : ᴇᴍᴇʀɢᴇɴᴄʏ ʜᴜʙ",
                        body: "ꜱʏꜱᴛᴇᴍ ᴀʀᴍᴇᴅ & ᴏᴘᴇʀᴀᴛɪᴏɴᴀʟ",
                        mediaType: 1, 
                        renderLargerThumbnail: true, // ✅ Forces large logo display
                        thumbnail: logoBuffer,        // ✅ Buffered image (not URL)
                        sourceUrl: config.channelUrl || "https://whatsapp.com/channel/stanytz",
                        showAdAttribution: true 
                    },
                    mentionedJid: [sender] // ✅ Username mention support
                }
            }, { quoted: m });

        } catch (e) {
            console.error("❌ Menu2 Emergency Error:", e);
            
            // ========== 🆘 ULTIMATE FALLBACK: PURE TEXT ==========
            const from = m.key.remoteJid;
            const pushName = m.pushName || "User";
            const prefix = config.prefix || '.';
            
            let text = `╭─── • 🥀 • ───╮\n   ɪ ɴ ꜱ ɪ ᴅ ɪ ᴏ ᴜ ꜱ\n╰─── • 🥀 • ───╯\n\n👤 ${pushName}\n⏱️ Uptime: ${runtime(process.uptime())}\n\n`;
            
            const categories = {};
            (commands || []).forEach(cmd => {
                const cat = cmd.category ? cmd.category.toUpperCase() : 'GENERAL';
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(cmd.name);
            });
            
            for (const [cat, cmds] of Object.entries(categories)) {
                text += `✦ ${cat}\n`;
                text += cmds.map(c => `  ${prefix}${c}`).join(' · ') + '\n\n';
            }
            text += `━━━ 🥀 ━━━\n👑 ${config.developerName || 'Stany'} Industries`;
            
            await sock.sendMessage(from, { text: fancy(text) }, { quoted: m });
        }
    }
};