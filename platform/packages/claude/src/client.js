'use strict';

const Anthropic = require('@anthropic-ai/sdk');

let _client = null;

function getClient() {
    if (!_client) {
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY is not set');
        }
        _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return _client;
}

module.exports = { getClient };
