import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramApi } from '../src/telegram.js';

test('all request types have a timeout and retry explicit rate limits', async () => {
    const calls = [];
    const waits = [];
    const api = new TelegramApi('test', {
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return { status: 200, json: async () => calls.length === 1
                ? { ok: false, error_code: 429, parameters: { retry_after: 2 } }
                : { ok: true, result: { message_id: 1 } } };
        }, sleep: async (ms) => waits.push(ms),
    });
    await api.sendMessage(1, 'hello');
    await api.sendPhoto(1, 'assets/main.jpg', 'photo');
    await api.sendDocument(1, 'assets/diagnostic.docx', 'document');
    assert.deepEqual(waits, [2000]);
    assert.equal(calls.length, 4);
    assert.ok(calls.every(({ options }) => options.signal instanceof AbortSignal));
    assert.ok(calls[2].options.body instanceof FormData);
    assert.ok(calls[3].options.body instanceof FormData);
});

test('uncertain network sends are not duplicated and invalid gateway responses retain status', async () => {
    let calls = 0;
    const api = new TelegramApi('test', { fetchImpl: async () => {
        calls++;
        throw new TypeError('fetch failed');
    } });
    await assert.rejects(api.sendMessage(1, 'hello'), /fetch failed/);
    assert.equal(calls, 1);
    const gateway = new TelegramApi('test', { fetchImpl: async () => ({ status: 502,
        json: async () => { throw new SyntaxError('HTML response'); } }) });
    await assert.rejects(gateway.call('getUpdates'), (error) => error.status === 502);
});

test('persistent rate limits have bounded retries', async () => {
    let calls = 0;
    const api = new TelegramApi('test', { sleep: async () => {}, fetchImpl: async () => {
        calls++;
        return { status: 429, json: async () => ({ ok: false, error_code: 429 }) };
    } });
    await assert.rejects(api.sendMessage(1, 'hello'), (error) => error.status === 429);
    assert.equal(calls, 3);
});
