require('dotenv').config();               // Load .env variables
const app = require('./index');           // Import the Express app
const PORT = process.env.PORT || 3000;

// Start Express server (only if not started already)
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server started from main.js on port ${PORT}`);
    });
}

// Start Telegram bot
require('./telegramBot');