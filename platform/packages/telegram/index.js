'use strict';

const { getBot } = require('./src/bot');
const {
    sendMessage,
    sendInlineKeyboard,
    notifyOwner,
    enableTestChat,
    disableTestChat,
    consumeTestMessages,
} = require('./src/sender');

module.exports = {
    getBot,
    sendMessage,
    sendInlineKeyboard,
    notifyOwner,
    enableTestChat,
    disableTestChat,
    consumeTestMessages,
};
