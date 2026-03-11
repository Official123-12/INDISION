require('dotenv').config();               // Load environment variables
const app = require('./index');           // Import the Express app
const PORT = process.env.PORT || 3000;

// Start Express server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server listening on port ${PORT}`);
});

// Start Telegram bot (it will now find TELEGRAM_BOT_TOKEN from .env)
require('./telegramBot');