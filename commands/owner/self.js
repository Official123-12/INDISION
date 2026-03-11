module.exports = {
    name: "self",
    description: "Switch bot to self (private) mode – only owner can command",
    category: "owner",
    execute: async (conn, msg, args, { from, fancy, isOwner, reply, setBotSetting }) => {
        if (!isOwner) return;
        await setBotSetting('mode', 'self');
        reply(fancy("🥀 ʙᴏᴛ ɪꜱ ɴᴏᴡ ɪɴ ꜱᴇʟꜰ ᴍᴏᴅᴇ. ᴏɴʟʏ ᴛʜᴇ ᴏᴡɴᴇʀ ᴄᴀɴ ᴄᴏᴍᴍᴀɴᴅ ᴍᴇ."));
    }
};