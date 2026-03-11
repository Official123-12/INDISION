require('dotenv').config();
const { app, dbPromise } = require('./index');
const PORT = process.env.PORT || 3000;

// Wait for MongoDB before starting the server
dbPromise.then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server listening on port ${PORT}`);
    });
    require('./telegramBot'); // Start Telegram bot after DB is ready
}).catch(err => {
    console.error('Failed to connect to DB, exiting.', err);
    process.exit(1);
});