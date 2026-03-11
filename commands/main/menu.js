const fs = require('fs-extra');
const path = require('path');
const config = require('../../config');
const { fancy, runtime } = require('../../lib/tools');
const { generateWAMessageFromContent, prepareWAMessageMedia } = require('@whiskeysockets/baileys');

module.exports = {
    name: "menu",
    execute: async (conn, msg, args, { from, sender, pushname }) => {
        try {
            // ========== GET REAL USERNAME ==========
            const userNumber = sender.split('@')[0];
            let userName = pushname?.trim() || '';
            if (!userName || userName === 'undefined') {
                try {
                    const contact = await conn.getContact(sender);
                    userName = contact?.name || contact?.pushname || '';
                } catch {}
            }
            if (!userName && from.endsWith('@g.us')) {
                try {
                    const groupMeta = await conn.groupMetadata(from);
                    const participant = groupMeta.participants.find(p => p.id === sender);
                    userName = participant?.name || '';
                } catch {}
            }
            userName = userName.trim() || `User_${userNumber.slice(-4)}`;
            const mentions = [sender];

            // ========== COMMAND SCAN ==========
            const cmdPath = path.join(__dirname, '../../commands');
            const allCategories = fs.readdirSync(cmdPath).filter(cat =>
                fs.statSync(path.join(cmdPath, cat)).isDirectory()
            );

            let targetCategory = null;
            let targetPage = 0;
            if (args[0] === 'nav' && args[1] && args[2]) {
                targetCategory = args[1];
                targetPage = Math.max(0, parseInt(args[2]) || 0);
            }

            const categories = targetCategory ? [targetCategory] : allCategories;

            // ========== OPTIONAL HEADER IMAGE ==========
            let imageMedia = null;
            if (config.menuImage) {
                try {
                    imageMedia = await prepareWAMessageMedia(
                        { image: { url: config.menuImage } },
                        { upload: conn.waUploadToServer }
                    );
                } catch (e) {}
            }

            // ========== BUTTON FACTORY ==========
            const cmdButton = (cmdName, icon = '▸') => ({
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                    display_text: `${icon} ${cmdName}`,
                    id: `${config.prefix}${cmdName}`
                })
            });

            const navButton = (text, id, icon) => ({
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                    display_text: `${icon} ${text}`,
                    id: id
                })
            });

            // ========== BUILD CARDS ==========
            const cards = [];
            const BUTTONS_PER_PAGE = 4; // Keep card short

            for (const cat of categories) {
                const catPath = path.join(cmdPath, cat);
                let files = fs.readdirSync(catPath)
                    .filter(f => f.endsWith('.js') && f !== 'index.js')
                    .map(f => f.replace('.js', ''))
                    .sort();

                if (files.length === 0) continue;

                // Paginate
                const pages = [];
                for (let i = 0; i < files.length; i += BUTTONS_PER_PAGE) {
                    pages.push(files.slice(i, i + BUTTONS_PER_PAGE));
                }

                const startPage = (targetCategory === cat) ? targetPage : 0;

                pages.forEach((pageFiles, pageIndex) => {
                    if (targetCategory === cat && pageIndex !== startPage) return;

                    // Command buttons with rotating icons
                    const icons = ['⚡', '🎯', '🔧', '✨', '🚀', '💎', '🔥', '🌟'];
                    const buttons = pageFiles.map((cmd, idx) =>
                        cmdButton(cmd, icons[idx % icons.length])
                    );

                    // Navigation buttons
                    const navs = [];
                    if (pages.length > 1) {
                        if (pageIndex > 0) {
                            navs.push(navButton('Back', `${config.prefix}nav ${cat} ${pageIndex - 1}`, '◀'));
                        }
                        if (pageIndex < pages.length - 1) {
                            navs.push(navButton('Next', `${config.prefix}nav ${cat} ${pageIndex + 1}`, '▶'));
                        }
                        navs.push(navButton('Home', `${config.prefix}menu`, '🏠'));
                    }

                    const allButtons = [...buttons, ...navs];

                    // Card content (short and elegant)
                    const pageInfo = pages.length > 1 ? ` • Page ${pageIndex + 1}/${pages.length}` : '';
                    const bodyText = 
`╭─── • 🥀 • ───╮
   ✦ *${cat.toUpperCase()}* ✦
╰─── • 🥀 • ───╯

👤 ${userName}
📌 Choose a command:`;

                    const card = {
                        body: { text: fancy(bodyText) },
                        footer: { text: fancy(`━━━━━━━━━━━━━━━\n👑 ${config.developerName} • v2.2`) },
                        header: imageMedia ? {
                            hasMediaAttachment: true,
                            imageMessage: imageMedia.imageMessage
                        } : {
                            hasMediaAttachment: false,
                            title: fancy(`✨ ${config.botName} ✨`)
                        },
                        nativeFlowMessage: { buttons: allButtons }
                    };
                    cards.push(card);
                });
            }

            // ========== MAIN DASHBOARD CARD ==========
            const stats = {
                cmds: cards.reduce((s, c) => s + (c.nativeFlowMessage?.buttons?.length || 0), 0),
                cats: categories.length,
                uptime: runtime(process.uptime())
            };

            const mainHeader =
`╭─── • 🥀 • ───╮
   ✦ *ɪɴꜱɪᴅɪᴏᴜꜱ ᴠ2.2* ✦
╰─── • 🥀 • ───╯

⚡ ${stats.cmds}+ commands
📂 ${stats.cats} categories
⏱️ ${stats.uptime} uptime

👤 ${userName}
➡️ Swipe left/right`;

            const mainCard = {
                body: { text: fancy(mainHeader) },
                footer: { text: fancy(`━━━━━━━━━━━━━━━\n📱 ${config.prefix}help for guide`) },
                header: {
                    hasMediaAttachment: false,
                    title: fancy(`🌟 ${config.botName} 🌟`)
                },
                nativeFlowMessage: {
                    buttons: [
                        navButton('Browse', `${config.prefix}menu nav ${categories[0]} 0`, '📂')
                    ]
                }
            };
            cards.unshift(mainCard); // Make it the first card

            // ========== SEND CAROUSEL ==========
            const interactiveMessage = {
                body: { text: fancy('✨ *Premium Menu* ✨') },
                footer: { text: fancy('◀️  Swipe for more  •  .help  ▶️') },
                header: {
                    title: fancy(`🤖 ${config.botName}`),
                    hasMediaAttachment: false
                },
                carouselMessage: {
                    cards: cards.slice(0, 10), // WhatsApp limit 10 cards
                    messageVersion: 1
                }
            };

            const waMsg = generateWAMessageFromContent(from, { interactiveMessage }, {
                userJid: conn.user.id,
                upload: conn.waUploadToServer
            });
            await conn.relayMessage(from, waMsg.message, { messageId: waMsg.key.id, mentions });

        } catch (e) {
            console.error('Menu error:', e);
            // Fallback plain text menu
            const userNumber = sender.split('@')[0];
            let userName = pushname || `User_${userNumber.slice(-4)}`;
            try {
                const contact = await conn.getContact(sender);
                userName = contact?.name || contact?.pushname || userName;
            } catch {}
            let text = 
`╭─── • 🥀 • ───╮
   ✦ *INSIDIOUS MENU* ✦
╰─── • 🥀 • ───╯

👤 ${userName}
⏱️ ${runtime(process.uptime())}

`;
            const cmdPath = path.join(__dirname, '../../commands');
            const cats = fs.readdirSync(cmdPath).filter(c =>
                fs.statSync(path.join(cmdPath, c)).isDirectory()
            );
            for (const cat of cats) {
                const files = fs.readdirSync(path.join(cmdPath, cat))
                    .filter(f => f.endsWith('.js'))
                    .map(f => f.replace('.js', ''));
                if (files.length) {
                    text += `✦ *${cat.toUpperCase()}*\n`;
                    text += files.map(c => `  ${config.prefix}${c}`).join(' · ') + '\n\n';
                }
            }
            text += `━━━━━━━━━━━━━━━\n👑 ${config.developerName}`;
            await conn.sendMessage(from, { text: fancy(text), mentions: [sender] }, { quoted: msg });
        }
    }
};