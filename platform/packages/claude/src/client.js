'use strict';

const Anthropic = require('@anthropic-ai/sdk');

let _client = null;

function createClient(apiKey) {
    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not set');
    }
    return new Anthropic({ apiKey });
}

function getClient() {
    if (!_client) {
        _client = createClient(process.env.ANTHROPIC_API_KEY);
    }
    return _client;
}

module.exports = { getClient, createClient };
