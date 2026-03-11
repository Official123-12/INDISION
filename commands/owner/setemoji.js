module.exports = {
    name: "setemoji",
    description: "Set an emoji to trigger a specific command (owner only)",
    category: "owner",
    execute: async (conn, msg, args, { from, sender, isOwner, reply, setBotSetting }) => {
        if (!isOwner) return;

        if (args.length < 2) {
            return reply("Usage: .setemoji 🥀 menu\nExample: .setemoji 😂 ping");
        }

        const emoji = args[0];
        const command = args[1].toLowerCase();

        // Validate emoji (basic check)
        const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)$/u;
        if (!emojiRegex.test(emoji)) {
            return reply("❌ That doesn't look like a valid emoji. Use a single emoji.");
        }

        // Validate that the command exists (optional, but good practice)
        if (!global.commands?.has(command)) {
            return reply(`❌ Command "${command}" not found.`);
        }

        try {
            // Save the mapping in bot settings
            await setBotSetting('emojiTriggers', {
                ...(await getBotSetting(conn.user.id.split(':')[0], 'emojiTriggers') || {}),
                [emoji]: command
            });

            reply(`✅ Emoji ${emoji} will now trigger .${command}`);
        } catch (e) {
            console.error('Setemoji error:', e);
            reply('❌ Failed to save emoji mapping.');
        }
    }
};