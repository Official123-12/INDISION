require('dotenv').config();

// Catch unhandled errors to prevent SIGTERM
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

const { app, dbPromise } = require('./index');
const PORT = process.env.PORT || 3000;

// Wait for MongoDB before starting server
dbPromise.then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server listening on port ${PORT}`);
    });
    require('./telegramBot'); // Start Telegram bot after DB is ready
}).catch(err => {
    console.error('❌ Failed to connect to DB, exiting.', err);
    process.exit(1);
});