import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTelegram, describeConnectionError } from '../src/startup.js';

test('startup recovers from connection failures and retries only the unfinished operation', async () => {
    const calls = [];
    const waits = [];
    const warnings = [];
    let failures = 0;
    await setupTelegram({ call: async (method) => {
        calls.push(method);
        if (method === 'setChatMenuButton' && failures++ < 2) {
            throw new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ETIMEDOUT' }) });
        }
    } }, { sleep: async (ms) => waits.push(ms), logger: { warn: (text) => warnings.push(text) } });
    assert.deepEqual(calls, ['setMyCommands', 'setChatMenuButton', 'setChatMenuButton', 'setChatMenuButton']);
    assert.deepEqual(waits, [3000, 6000]);
    assert.match(warnings[0], /ETIMEDOUT/);
});

test('startup respects Telegram retry_after and does not retry invalid credentials', async () => {
    const waits = [];
    let attempts = 0;
    await setupTelegram({ call: async () => {
        if (attempts++ === 0) throw Object.assign(new Error('rate limit'), { status: 429, retryAfter: 12 });
    } }, { sleep: async (ms) => waits.push(ms), logger: { warn() {} } });
    assert.deepEqual(waits, [12000]);
    await assert.rejects(setupTelegram({ call: async () => {
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
    } }), /Unauthorized/);
});

test('connection diagnostics include nested IPv4 and IPv6 errors', () => {
    const error = new TypeError('fetch failed', { cause: new AggregateError([
        Object.assign(new Error(), { code: 'ETIMEDOUT' }),
        Object.assign(new Error(), { code: 'ENETUNREACH' }),
    ]) });
    assert.equal(describeConnectionError(error), 'fetch failed; ETIMEDOUT; ENETUNREACH');
});
