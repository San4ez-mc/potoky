'use strict';

const { getBot } = require('./src/bot');
const {
    sendMessage,
    sendPhoto,
    sendInlineKeyboard,
    notifyOwner,
    enableTestChat,
    disableTestChat,
    consumeTestMessages,
} = require('./src/sender');

module.exports = {
    getBot,
    sendMessage,
    sendPhoto,
    sendInlineKeyboard,
    notifyOwner,
    enableTestChat,
    disableTestChat,
    consumeTestMessages,
};
