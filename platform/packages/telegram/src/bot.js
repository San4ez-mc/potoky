'use strict';

const TelegramBot = require('node-telegram-bot-api');

let _bot = null;

function getBot() {
    if (!_bot) {
        if (!process.env.TELEGRAM_BOT_TOKEN) {
            throw new Error('TELEGRAM_BOT_TOKEN is not set');
        }
        _bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
    }
    return _bot;
}

module.exports = { getBot };
