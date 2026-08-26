const express = require('express');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');

dotenv.config({ path: './config/config.env' });

const app = express();

app.use(express.json());
app.use(cookieParser());

const PORT = process.env.PORT || 5000;

let server;

const start = async () => {
    await connectDB();
    server = app.listen(PORT, () => {
        console.log('Server running in', process.env.NODE_ENV, 'mode on port', PORT);
    });
};

start();

process.on('unhandledRejection', (err) => {
    console.log(`Error: ${err.message}`);
    if (server) {
        server.close(() => process.exit(1));
    } else {
        process.exit(1);
    }
});
