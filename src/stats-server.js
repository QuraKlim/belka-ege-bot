import http from 'node:http';
import { readEvents, summarize } from './analytics.js';

export function validateStatsToken(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
        throw new Error('Укажите STATS_TOKEN в .env: 64 символа (0-9, a-f)');
    }
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function renderStats(events) {
    const report = summarize(events);
    const groups = new Map();
    for (const event of events) {
        if (!groups.has(event.user.id)) groups.set(event.user.id, new Map());
        const actions = groups.get(event.user.id);
        const key = JSON.stringify([event.type, event.action]);
        if (!actions.has(key)) actions.set(key, { ...event, count: 0 });
        actions.get(key).count++;
    }
    const users = report.users.sort((a, b) => b.last_seen.localeCompare(a.last_seen));
    const rows = users.map((user) => {
        const name = user.username ? `@${user.username}`
            : [user.first_name, user.last_name].filter(Boolean).join(' ') || String(user.id);
        const actions = [...groups.get(user.id).values()].sort((a, b) => b.count - a.count);
        return actions.map((action, index) => `<tr>${index === 0 ? `<th scope="rowgroup" rowspan="${actions.length}">
            ${escapeHtml(name)}<small>ID: ${escapeHtml(user.id)}</small>
            <small>Последняя активность:<br>${escapeHtml(user.last_seen)}</small></th>` : ''}
            <td>${escapeHtml(action.button_text || action.action)}${action.button_text ? `<small>${escapeHtml(action.action)}</small>` : ''}</td>
            <td>${escapeHtml({ command: 'Команда', callback: 'Кнопка', message: 'Сообщение' }[action.type] || action.type)}</td>
            <td class="count">${action.count}</td></tr>`).join('');
    }).join('');
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><title>Статистика бота</title>
    <style>body{font:16px system-ui,sans-serif;background:#f4f6fa;color:#182333;margin:0;padding:24px}
    main{max-width:1100px;margin:auto}h1{margin-bottom:8px}.summary{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}
    .card{background:white;padding:18px;border-radius:12px;flex:1;min-width:140px}.card b{display:block;font-size:28px}
    .table{overflow:auto;background:white;border-radius:12px}table{border-collapse:collapse;width:100%}
    th,td{text-align:left;padding:14px;border-bottom:1px solid #dce2eb;vertical-align:top}
    thead{background:#e8eef8}small{display:block;font-size:12px;color:#58687d;margin-top:5px;overflow-wrap:anywhere}
    .count{font-weight:bold}p{color:#58687d}a{color:#244ea8}</style></head><body><main>
    <h1>Статистика бота</h1><p>Действия за всё время, сгруппированные по пользователю. Время — UTC.</p>
    <div class="summary"><div class="card">Пользователей<b>${report.total_users}</b></div>
    <div class="card">Запусков /start<b>${report.total_starts}</b></div>
    <div class="card">Активны за 24 часа<b>${report.active_24h}</b></div>
    <div class="card">Активны за 7 дней<b>${report.active_7d}</b></div></div>
    <p><a href="">Обновить статистику</a></p>
    ${rows ? `<div class="table"><table><thead><tr><th>Пользователь</th><th>Действие</th><th>Тип</th><th>Количество, раз</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>Пока нет действий пользователей.</p>'}
    <p>Команды из меню и введённые вручную учитываются вместе. Открытие самого меню и переходы по URL-ссылкам Telegram не передаёт.</p>
    </main></body></html>`;
}

export async function startStatsServer({ directory, token, host = '0.0.0.0', port = 3000, logger = console }) {
    validateStatsToken(token);
    const secretPath = `/stats/${token}`;
    const server = http.createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('X-Robots-Tag', 'noindex, nofollow');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        if (request.url !== secretPath) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }
        if (!['GET', 'HEAD'].includes(request.method)) {
            response.writeHead(405, { Allow: 'GET, HEAD' });
            response.end();
            return;
        }
        try {
            const html = renderStats(readEvents(directory));
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(request.method === 'HEAD' ? undefined : html);
        } catch (error) {
            logger.error('Ошибка чтения статистики:', error.message);
            response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Не удалось загрузить статистику');
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
    return { server, secretPath };
}
