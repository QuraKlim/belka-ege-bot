import { botCommands } from './content.js';

export function describeConnectionError(error) {
    const codes = new Set();
    function visit(item) {
        if (!item) return;
        if (item.code) codes.add(item.code);
        visit(item.cause);
        for (const child of item.errors ?? []) visit(child);
    }
    visit(error);
    return [error.message, ...codes].join('; ');
}

export async function setupTelegram(api, {
    logger = console,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
    const operations = [
        ['setMyCommands', { commands: botCommands, scope: { type: 'all_private_chats' } }],
        ['setChatMenuButton', { menu_button: { type: 'commands' } }],
    ];
    for (const [method, payload] of operations) {
        let delay = 3000;
        while (true) {
            try {
                await api.call(method, payload);
                break;
            } catch (error) {
                const transient = error.message === 'fetch failed' || error.cause?.code ||
                    error.name === 'TimeoutError' || error.status === 429 || error.status >= 500;
                if (!transient) throw error;
                const retryMs = Math.max(delay, (error.retryAfter ?? 0) * 1000);
                logger.warn(`Telegram недоступен (${method}): ${describeConnectionError(error)}. ` +
                    `Повтор через ${retryMs / 1000} с. Страница статистики продолжает работать.`);
                await sleep(retryMs);
                delay = Math.min(delay * 2, 30000);
            }
        }
    }
}
