module.exports = {
    name: "setgroup",
    adminOnly: true,
    description: "Configure group‑specific settings",
    usage: "[feature] [value]",
    execute: async (conn, msg, args, { from, isOwner, isGroupAdmin, reply, config, fancy, getGroupSetting, setGroupSetting, getBotSetting }) => {
        if (!from.endsWith('@g.us')) return reply("❌ This command is for groups only.");
        if (!isOwner && !isGroupAdmin) return reply("❌ Only group admins can change group settings.");

        // Get bot's global settings for defaults and newsletter info
        const newsletterJid = await getBotSetting('newsletterJid') || '120363404317544295@newsletter';
        const newsletterName = await getBotSetting('botName') || 'INSIDIOUS';

        const sendWithForward = async (content, quoted = msg) => {
            const options = {
                contextInfo: {
                    isForwarded: true,
                    forwardingScore: 999,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: newsletterJid,
                        newsletterName: newsletterName
                    }
                }
            };
            if (typeof content === 'string') {
                return await conn.sendMessage(from, { text: fancy(content), ...options }, { quoted });
            } else {
                return await conn.sendMessage(from, { ...content, ...options }, { quoted });
            }
        };

        // List of features that can be configured per group
        const features = [
            'antilink', 'antiporn', 'antiscam', 'antimedia', 'antitag',
            'antiviewonce', 'antidelete', 'antibugs', 'antispam', 'anticall',
            'autoRead', 'autoReact', 'autoTyping', 'autoRecording', 'autoBio',
            'autostatus', 'welcomeGoodbye', 'activemembers', 'autoblockCountry',
            'chatbot', 'warnLimit', 'maxTags', 'antiSpamLimit', 'antiSpamInterval',
            'sleepingStart', 'sleepingEnd', 'blockedMediaTypes'
        ];

        if (args.length === 0) {
            let text = `╭━━━━━━━━━━━━━━╮\n`;
            text += `   *GROUP SETTINGS*  \n`;
            text += `╰━━━━━━━━━━━━━━╯\n\n`;

            for (const f of features) {
                // Get current group-specific value, fallback to bot's global setting
                const groupVal = await getGroupSetting(from, f);
                const globalVal = await getBotSetting(f);
                const val = groupVal !== undefined ? groupVal : globalVal;
                text += `│ ${f.padEnd(18)} : ${typeof val === 'boolean' ? (val ? '✅' : '❌') : val}\n`;
            }
            text += `└────────────────────────────\n\n`;
            text += `💡 Use: ${config.prefix}setgroup <feature> <value>\n`;
            text += `_Example: ${config.prefix}setgroup antilink on_`;

            return await sendWithForward(text);
        }

        let feature = args[0].toLowerCase();
        const value = args.slice(1).join(' ');

        // Normalise aliases
        const featureMap = {
            'antilink': 'antilink', 'anti-link': 'antilink',
            'antiporn': 'antiporn', 'anti-porn': 'antiporn',
            'antiscam': 'antiscam', 'anti-scam': 'antiscam',
            'antimedia': 'antimedia', 'anti-media': 'antimedia',
            'antitag': 'antitag', 'anti-tag': 'antitag',
            'antiviewonce': 'antiviewonce', 'anti-viewonce': 'antiviewonce', 'anti-view-once': 'antiviewonce',
            'antidelete': 'antidelete', 'anti-delete': 'antidelete',
            'antibugs': 'antibugs', 'anti-bugs': 'antibugs',
            'antispam': 'antispam', 'anti-spam': 'antispam',
            'anticall': 'anticall', 'anti-call': 'anticall',
            'autoread': 'autoRead', 'auto-read': 'autoRead',
            'autoreact': 'autoReact', 'auto-react': 'autoReact',
            'autotyping': 'autoTyping', 'auto-typing': 'autoTyping',
            'autorecording': 'autoRecording', 'auto-recording': 'autoRecording',
            'autobio': 'autoBio', 'auto-bio': 'autoBio',
            'autostatus': 'autostatus', 'auto-status': 'autostatus',
            'welcome': 'welcomeGoodbye', 'goodbye': 'welcomeGoodbye',
            'welcomegoodbye': 'welcomeGoodbye', 'welcome-goodbye': 'welcomeGoodbye',
            'activemembers': 'activemembers', 'active-members': 'activemembers',
            'autoblockcountry': 'autoblockCountry', 'auto-block-country': 'autoblockCountry',
            'chatbot': 'chatbot', 'ai': 'chatbot',
            'warnlimit': 'warnLimit', 'warn-limit': 'warnLimit',
            'maxtags': 'maxTags', 'max-tags': 'maxTags',
            'antispamlimit': 'antiSpamLimit', 'antispam-limit': 'antiSpamLimit',
            'antispaminterval': 'antiSpamInterval', 'antispam-interval': 'antiSpamInterval',
            'sleepingstart': 'sleepingStart', 'sleeping-start': 'sleepingStart',
            'sleepingend': 'sleepingEnd', 'sleeping-end': 'sleepingEnd',
            'blockedmediatypes': 'blockedMediaTypes', 'blocked-media-types': 'blockedMediaTypes'
        };

        if (featureMap[feature]) feature = featureMap[feature];

        // Get current value: group-specific if set, else global
        const currentGroupVal = await getGroupSetting(from, feature);
        const currentGlobalVal = await getBotSetting(feature);
        const currentVal = currentGroupVal !== undefined ? currentGroupVal : currentGlobalVal;

        let parsedValue;
        if (typeof currentVal === 'boolean') {
            if (!value) {
                parsedValue = !currentVal;
            } else if (['on', 'enable', 'true', '1'].includes(value.toLowerCase())) {
                parsedValue = true;
            } else if (['off', 'disable', 'false', '0'].includes(value.toLowerCase())) {
                parsedValue = false;
            } else {
                return reply(`❌ Invalid value. Use: on / off (or no value to toggle).`);
            }
        } else if (typeof currentVal === 'number') {
            const num = Number(value);
            if (isNaN(num)) return reply(`❌ Must be a number.`);
            parsedValue = num;
        } else if (typeof currentVal === 'string') {
            parsedValue = value;
        } else if (Array.isArray(currentVal)) {
            parsedValue = value.split(',').map(v => v.trim());
        } else {
            return reply(`❌ Unsupported feature type.`);
        }

        await setGroupSetting(from, feature, parsedValue);
        await sendWithForward(`✅ Group setting *${feature}* updated to *${parsedValue}*.`);
    }
};