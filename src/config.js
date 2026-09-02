import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
    const envPath = path.resolve('.env');
    if (!fs.existsSync(envPath)) return;
    for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        const value = line
            .slice(separator + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, '$2');
        if (!(key in process.env)) process.env[key] = value;
    }
}

loadEnv();

function normalizeChannelUsername(value) {
    const username = value || 'belkaege';
    const withoutUrl = username.replace(/^https?:\/\/t\.me\//, '');
    return withoutUrl.startsWith('@') ? withoutUrl : `@${withoutUrl}`;
}

export const config = {
    token: process.env.BOT_TOKEN,
    channel: normalizeChannelUsername(process.env.CHANNEL_USERNAME),
    teacher: process.env.TEACHER_USERNAME || '@Belkateacher',
    followUpDelayMs: Number(process.env.FOLLOW_UP_DELAY_MS || 1000),
};

export function validateConfig() {
    if (!config.token || !/^\d+:[\w-]+$/.test(config.token)) {
        throw new Error('Укажите корректный BOT_TOKEN в файле .env');
    }
    if (
        !Number.isFinite(config.followUpDelayMs) ||
        config.followUpDelayMs < 0
    ) {
        throw new Error(
            'FOLLOW_UP_DELAY_MS должен быть неотрицательным числом',
        );
    }
}
