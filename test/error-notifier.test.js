import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createErrorLogger } from '../src/error-notifier.js';

const quiet = { error() {}, warn() {}, log() {} };

test('alerts use configured recipient, plain text and redact secrets', async () => {
    const calls = [];
    const logger = createErrorLogger({ call: async (...args) => calls.push(args) }, {
        chatId: '123', secrets: ['private-token', 'private-path'], logger: quiet,
    });
    logger.error('failure private-token', new Error('<bad> private-path'));
    await setImmediate();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'sendMessage');
    assert.equal(calls[0][1].chat_id, '123');
    assert.equal(calls[0][1].parse_mode, undefined);
    assert.ok(!calls[0][1].text.includes('private-'));
    assert.match(calls[0][1].text, /<bad>/);
});

test('alerts are throttled, failures do not recurse, and sending resumes later', async () => {
    let attempts = 0;
    let time = 0;
    const logger = createErrorLogger({ call: async () => { attempts++; throw new Error('offline'); } }, {
        chatId: '123', now: () => time, logger: quiet,
    });
    logger.error('first');
    logger.error('second');
    await setImmediate();
    logger.warn('third');
    await setImmediate();
    assert.equal(attempts, 1);
    time = 300000;
    logger.error('later');
    await setImmediate();
    assert.equal(attempts, 2);
});

test('unset recipient disables notifications', async () => {
    let calls = 0;
    createErrorLogger({ call: async () => { calls++; } }, { logger: quiet }).error('failure');
    await setImmediate();
    assert.equal(calls, 0);
});
