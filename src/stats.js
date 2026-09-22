import { readEvents, summarize } from './analytics.js';
import { config } from './config.js';

const report = summarize(readEvents(config.analyticsDir));
if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(`Всего пользователей: ${report.total_users}`);
    console.log(`Запускали бота: ${report.started_users}; запусков /start: ${report.total_starts}`);
    console.log(`Активны за 24 часа: ${report.active_24h}; за 7 дней: ${report.active_7d}`);
    console.log(`Всего действий: ${report.total_events}`);
    console.table(report.actions.map((action) => ({
        'Тип': action.type,
        'Действие': action.action,
        'Кнопка': action.label ?? '',
        'Количество': action.count,
        'Пользователей': action.users,
    })));
}
