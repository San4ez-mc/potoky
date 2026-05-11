'use strict';

const { getBot } = require('./src/bot');
const { sendMessage, sendInlineKeyboard, notifyOwner } = require('./src/sender');

module.exports = { getBot, sendMessage, sendInlineKeyboard, notifyOwner };
