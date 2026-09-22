import fs from 'node:fs';
import path from 'node:path';

// A single append-only journal is the source of truth for users and actions.
// Only an incomplete last record (e.g. after a power failure) may be discarded.
function readJournal(filePath) {
    let data;
    try {
        data = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return { events: [], validBytes: 0 };
        throw error;
    }
    const end = data.lastIndexOf('\n') + 1;
    const complete = data.slice(0, end);
    const events = complete.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { events, validBytes: Buffer.byteLength(complete) };
}

export function readEvents(directory) {
    return readJournal(path.join(directory, 'events.jsonl')).events;
}

export function createAnalytics(directory) {
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, 'events.jsonl');
    const { events, validBytes } = readJournal(filePath);
    let committedBytes = validBytes;
    if (fs.existsSync(filePath) && fs.statSync(filePath).size !== validBytes) {
        fs.truncateSync(filePath, validBytes);
    }
    const seen = new Set(events.map((event) => event.update_id).filter(Number.isInteger));

    return {
        recordUpdate(update) {
            const query = update.callback_query;
            const message = query?.message ?? update.message;
            const from = query?.from ?? message?.from;
            if (!from || from.is_bot || seen.has(update.update_id)) return;
            const command = message?.text?.match(/^\/[\w]+(?:@[\w]+)?(?=\s|$)/)?.[0]
                .split('@')[0];
            const event = {
                update_id: update.update_id,
                timestamp: new Date().toISOString(),
                user: {
                    id: from.id,
                    username: from.username ?? null,
                    first_name: from.first_name ?? null,
                    last_name: from.last_name ?? null,
                },
                chat_id: message?.chat?.id ?? null,
                message_id: message?.message_id ?? null,
                type: query ? 'callback' : command ? 'command' : 'message',
                action: query ? query.data ?? 'unknown_callback' : command ?? 'message',
                button_text: query ? message?.reply_markup?.inline_keyboard?.flat()
                    .find((button) => button.callback_data === query.data)?.text ?? null : null,
            };
            // Windows append handles cannot truncate; repair before opening one.
            if (fs.existsSync(filePath) && fs.statSync(filePath).size !== committedBytes) {
                fs.truncateSync(filePath, committedBytes);
            }
            const fd = fs.openSync(filePath, 'a');
            try {
                const line = `${JSON.stringify(event)}\n`;
                fs.writeFileSync(fd, line);
                fs.fsyncSync(fd);
                committedBytes += Buffer.byteLength(line);
            } finally {
                fs.closeSync(fd);
            }
            if (Number.isInteger(update.update_id)) seen.add(update.update_id);
        },
    };
}

export function summarize(events, now = Date.now()) {
    const users = new Map();
    const actions = new Map();
    for (const event of events) {
        let user = users.get(event.user.id);
        if (!user) {
            user = { ...event.user, first_seen: event.timestamp, last_seen: event.timestamp,
                starts: 0, events: 0 };
            users.set(user.id, user);
        }
        Object.assign(user, event.user);
        user.first_seen = user.first_seen < event.timestamp ? user.first_seen : event.timestamp;
        user.last_seen = user.last_seen > event.timestamp ? user.last_seen : event.timestamp;
        user.events++;
        if (event.type === 'command' && event.action === '/start') user.starts++;
        const key = `${event.type}:${event.action}`;
        if (!actions.has(key)) actions.set(key, {
            type: event.type, action: event.action, label: event.button_text,
            count: 0, users: new Set(),
        });
        const action = actions.get(key);
        action.count++;
        action.users.add(user.id);
    }
    const list = [...users.values()];
    const active = (days) => list.filter((user) => {
        const age = now - Date.parse(user.last_seen);
        return age >= 0 && age <= days * 86400000;
    }).length;
    return {
        total_users: list.length,
        started_users: list.filter((user) => user.starts > 0).length,
        total_starts: list.reduce((sum, user) => sum + user.starts, 0),
        active_24h: active(1),
        active_7d: active(7),
        total_events: events.length,
        actions: [...actions.values()].map((action) => ({ ...action, users: action.users.size }))
            .sort((a, b) => b.count - a.count),
        users: list,
    };
}
