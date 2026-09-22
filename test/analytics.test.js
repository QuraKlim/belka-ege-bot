import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAnalytics, readEvents, summarize } from '../src/analytics.js';
import { createBot } from '../src/bot.js';

test('partial failed writes are removed before retry in the same process', (t) => {
    const dir = directory(t);
    const analytics = createAnalytics(dir);
    analytics.recordUpdate(command(1, '/start'));
    const original = fs.writeFileSync;
    const mock = t.mock.method(fs, 'writeFileSync', (fd, data) => {
        original(fd, data.slice(0, 20));
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    });
    assert.throws(() => analytics.recordUpdate(command(2, '/help')), /disk full/);
    mock.mock.restore();
    analytics.recordUpdate(command(2, '/help'));
    assert.deepEqual(readEvents(dir).map((event) => event.update_id), [1, 2]);
});

function directory(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-analytics-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function command(id, text, user = 7) {
    return { update_id: id, message: {
        from: { id: user, first_name: 'Тест', username: 'student' },
        chat: { id: user }, text,
    } };
}

test('persistent users, repeated starts and menu commands; duplicate delivery is ignored', (t) => {
    const dir = directory(t);
    let analytics = createAnalytics(dir);
    analytics.recordUpdate(command(1, '/start source'));
    analytics.recordUpdate(command(2, '/start'));
    analytics.recordUpdate(command(3, '/materials@mybot'));
    analytics = createAnalytics(dir);
    analytics.recordUpdate(command(3, '/materials@mybot'));
    analytics.recordUpdate(command(4, '/useful', 8));
    analytics.recordUpdate(command(5, '/help', 8));
    const report = summarize(readEvents(dir));
    assert.equal(report.total_users, 2);
    assert.equal(report.started_users, 1);
    assert.equal(report.total_starts, 2);
    assert.equal(report.total_events, 5);
    assert.equal(report.active_24h, 2);
    assert.equal(report.actions.find((a) => a.action === '/materials').count, 1);
    assert.equal(report.users[0].username, 'student');
});

test('callbacks including subscription checks are recorded before API failures', async (t) => {
    const dir = directory(t);
    const analytics = createAnalytics(dir);
    const bot = createBot({ call: async () => { throw new Error('offline'); } }, console, analytics);
    for (const [i, data] of ['material:oge', 'check|material:oge', 'useful:roots', 'command:help'].entries()) {
        await assert.rejects(bot.handleUpdate({ update_id: i, callback_query: {
            id: `q${i}`, from: { id: 9 }, data,
            message: { chat: { id: 9 }, message_id: 20,
                reply_markup: { inline_keyboard: [[{ text: 'Кнопка', callback_data: data }]] } },
        } }), /offline/);
    }
    const events = readEvents(dir);
    assert.equal(events.length, 4);
    assert.equal(events[0].button_text, 'Кнопка');
    assert.equal(events[1].action, 'check|material:oge');
    assert.equal(events[0].message_id, 20);
});

test('unsubscribed user clicks and subsequent clicks are separate events', async (t) => {
    const dir = directory(t);
    const analytics = createAnalytics(dir);
    const bot = createBot({ call: async () => ({ status: 'left' }), sendMessage: async () => {} }, console, analytics);
    for (const id of [1, 2]) await bot.handleUpdate({ update_id: id, callback_query: {
        id: String(id), from: { id: 9 }, data: 'material:oge', message: { chat: { id: 9 } },
    } });
    const report = summarize(readEvents(dir));
    assert.equal(report.actions[0].count, 2);
    assert.equal(report.actions[0].users, 1);
});

test('incomplete final write is recovered without losing completed events', (t) => {
    const dir = directory(t);
    createAnalytics(dir).recordUpdate(command(1, '/start'));
    fs.appendFileSync(path.join(dir, 'events.jsonl'), '{"incomplete":');
    assert.equal(readEvents(dir).length, 1);
    createAnalytics(dir).recordUpdate(command(2, '/help'));
    assert.equal(readEvents(dir).length, 2);
});

test('storage failure is surfaced and the same update can be retried', (t) => {
    const dir = directory(t);
    const analytics = createAnalytics(dir);
    const file = path.join(dir, 'events.jsonl');
    fs.mkdirSync(file);
    assert.throws(() => analytics.recordUpdate(command(1, '/start')));
    fs.rmdirSync(file);
    analytics.recordUpdate(command(1, '/start'));
    assert.equal(readEvents(dir).length, 1);
});

test('activity windows, profile changes, and arbitrary message privacy', (t) => {
    const dir = directory(t);
    const analytics = createAnalytics(dir);
    analytics.recordUpdate(command(1, 'private message'));
    const update = command(2, '/help');
    update.message.from.username = 'new_name';
    analytics.recordUpdate(update);
    const events = readEvents(dir);
    assert.ok(!JSON.stringify(events).includes('private message'));
    events[0].timestamp = '2026-01-01T00:00:00.000Z';
    events[1].timestamp = '2026-01-03T00:00:00.000Z';
    const report = summarize(events, Date.parse('2026-01-05T00:00:00.000Z'));
    assert.equal(report.active_24h, 0);
    assert.equal(report.active_7d, 1);
    assert.equal(report.users[0].username, 'new_name');
    assert.equal(report.users[0].first_seen, events[0].timestamp);
    assert.equal(report.users[0].last_seen, events[1].timestamp);
});
