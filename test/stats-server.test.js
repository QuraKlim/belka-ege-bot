import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAnalytics } from '../src/analytics.js';
import { validateStatsToken, renderStats, startStatsServer } from '../src/stats-server.js';

function directory(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-stats-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('missing, short and URL-unsafe tokens are rejected before listening', async () => {
    validateStatsToken('a'.repeat(64));
    for (const token of [undefined, '', 'short', '../stats', 'a'.repeat(63) + '?']) {
        await assert.rejects(startStatsServer({ token, port: 0 }), /STATS_TOKEN/);
    }
});

test('table groups action counts by user and escapes user-controlled HTML', () => {
    const event = (id, action, name) => ({ user: { id, username: name },
        action, type: 'command', timestamp: '2026-09-22T00:00:00.000Z' });
    const html = renderStats([
        event(1, '/start', 'alice'), event(1, '/start', 'alice'),
        event(1, '/help', 'alice'), event(2, '/start', null),
        { ...event(3, '<script>alert(1)</script>', '<img src=x onerror=alert(1)>'),
            button_text: '<svg onload=alert(1)>' },
    ]);
    assert.equal(html.split('@alice').length - 1, 1);
    assert.match(html, /rowspan="2"/);
    assert.match(html, /\/start<\/td>\s*<td>Команда<\/td>\s*<td class="count">2<\/td>/);
    assert.match(html, /ID: 2/);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<svg'));
    assert.ok(html.includes('&lt;script&gt;'));
});

test('HTTP endpoint protects stats and reads new events without restarting', async (t) => {
    const dir = directory(t);
    const analytics = createAnalytics(dir);
    const token = 'b'.repeat(64);
    const { server, secretPath } = await startStatsServer({ directory: dir, token, host: '127.0.0.1', port: 0,
        logger: { error() {} } });
    try {
        assert.equal(secretPath, `/stats/${token}`);
        assert.equal(fs.existsSync(path.join(dir, 'stats-token')), false);
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const url of ['/', '/stats', '/stats/invalid', '/events.jsonl', '/stats-token']) {
            const response = await fetch(base + url);
            assert.equal(response.status, 404);
            assert.ok(!(await response.text()).includes(secretPath));
        }
        let response = await fetch(base + secretPath);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
        assert.match(await response.text(), /Пока нет действий/);
        analytics.recordUpdate({ update_id: 1, message: {
            from: { id: 42, username: 'student' }, chat: { id: 42 }, text: '/start',
        } });
        response = await fetch(base + secretPath);
        assert.match(await response.text(), /@student/);
        response = await fetch(base + secretPath, { method: 'HEAD' });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), '');
        response = await fetch(base + secretPath, { method: 'POST' });
        assert.equal(response.status, 405);
        fs.appendFileSync(path.join(dir, 'events.jsonl'), 'invalid\n');
        response = await fetch(base + secretPath);
        assert.equal(response.status, 500);
        assert.ok(!(await response.text()).includes(dir));
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
