const express = require('express');
const path = require('path');
const cron = require('node-cron');
const dotenv = require('dotenv');
const { Server } = require('ws'); // WebSocket Server

dotenv.config();

const { defaultLogger, errorLogger } = require('./utils/logger');
const { logRetentionDays } = require('./config/config');
const { setupMqttClient } = require('./src/mqttClient');
const { handleErrors } = require('./utils/middleware');
const { setWebSocketServer } = require('./src/oeeProcessor'); // Import WebSocket setter

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse incoming JSON and URL-encoded payloads
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from the 'public' directory

// Serve index.html at the root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Define routes for different functionalities
app.use('/structure', require('./routes/structure'));
app.use('/oee-logs', require('./routes/oeeLogs'));
app.use('/calculateOEE', require('./routes/calculateOEE'));

// Error handling middleware
app.use(handleErrors);

defaultLogger.info('Logger initialized successfully.');

// Schedule a cron job to clean up old logs daily at midnight
cron.schedule('0 0 * * *', async() => {
    try {
        const { cleanupLogs } = require('./utils/logger');
        await cleanupLogs(logRetentionDays);
        defaultLogger.info('Old logs cleanup job completed successfully.');
    } catch (error) {
        errorLogger.error('Error during log cleanup job:', error.message);
    }
});

// Initialize and set up the MQTT client
let mqttClient;
try {
    mqttClient = setupMqttClient();
    defaultLogger.info('MQTT client initialized successfully.');
} catch (error) {
    errorLogger.error('Error initializing MQTT client:', error.message);
}

// Start the HTTP server and listen on the specified port
const server = app.listen(port, () => {
    defaultLogger.info(`Server is running on port ${port}`);
});

// Secret key for JWT
const SECRET_KEY = 'your_secret_key'; // Replace with your secret key

// Initialize WebSocket server
const wss = new Server({ server });

wss.on('connection', (ws, req) => {
    defaultLogger.info('WebSocket connection established');

    ws.on('message', (message) => {
        defaultLogger.info(`Received message: ${message}`);
    });

    ws.on('close', () => {
        defaultLogger.info('WebSocket connection closed');
    });
});

// Set the WebSocket server instance in oeeProcessor
setWebSocketServer(wss);


// Function to handle graceful shutdown of the server
function gracefulShutdown(signal) {
    defaultLogger.info(`${signal} signal received: closing HTTP server`);
    server.close(() => {
        defaultLogger.info('HTTP server closed');
        if (mqttClient) {
            mqttClient.end(() => {
                defaultLogger.info('MQTT client disconnected');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });
}

// Listen for termination signals to gracefully shut down the server
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));