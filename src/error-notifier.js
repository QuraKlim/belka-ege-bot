import { describeConnectionError } from './startup.js';

export function createErrorLogger(api, {
    chatId, secrets = [], logger = console, now = Date.now, cooldownMs = 300000,
} = {}) {
    let lastAttempt = -Infinity;
    let sending = false;
    function report(level, args) {
        logger[level](...args);
        if (!chatId || sending || now() - lastAttempt < cooldownMs) return;
        lastAttempt = now();
        sending = true;
        let details = args.map((value) => value instanceof Error
            ? describeConnectionError(value) : String(value)).join(' ');
        for (const secret of secrets.filter(Boolean)) details = details.split(secret).join('[скрыто]');
        const text = `⚠️ Ошибка бота\n${new Date(now()).toISOString()}\n\n${details.slice(0, 3500)}`;
        // Plain text: error messages may contain HTML or arbitrary external text.
        // A failed alert goes only to the original console logger to avoid recursion.
        void Promise.resolve().then(() => api.call('sendMessage', {
            chat_id: chatId, text, disable_web_page_preview: true,
        })).catch((error) => {
            logger.error('Не удалось доставить уведомление об ошибке:', error.message);
        }).finally(() => { sending = false; });
    }
    return {
        error: (...args) => report('error', args),
        warn: (...args) => report('warn', args),
        log: (...args) => logger.log(...args),
    };
}
