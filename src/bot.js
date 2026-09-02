import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import {
    examKeyboard,
    buttonText,
    getChannelUrl,
    getDiagnosticText,
    getNotSubscribedText,
    getSubscriptionText,
    interfaceText,
    materialKeyboard,
    materials,
    planText,
    useful,
    usefulKeyboard,
    welcomeText,
} from './content.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const subscribedStatuses = new Set([
    'creator',
    'administrator',
    'member',
    'restricted',
]);

export function createBot(api, logger = console) {
    async function isSubscribed(userId) {
        try {
            const member = await api.call('getChatMember', {
                chat_id: config.channel,
                user_id: userId,
            });
            return (
                subscribedStatuses.has(member.status) &&
                member.is_member !== false
            );
        } catch (error) {
            logger.error('Не удалось проверить подписку:', error.message);
            return false;
        }
    }

    async function sendFileIfExists(chatId, relativePath, caption) {
        const filePath = path.resolve(relativePath);
        if (fs.existsSync(filePath))
            await api.sendDocument(chatId, filePath, caption);
        else logger.warn(`Файл не найден: ${filePath}`);
    }

    async function sendEgeFollowUps(chatId) {
        await sleep(config.followUpDelayMs);
        await api.sendMessage(chatId, planText);
        await sleep(config.followUpDelayMs);
        await api.sendMessage(chatId, getDiagnosticText(config.teacher));
        await sendFileIfExists(
            chatId,
            'assets/diagnostic.docx',
            interfaceText.diagnosticCaption,
        );
    }

    async function sendUsefulMaterials(chatId) {
        await sleep(config.followUpDelayMs);
        await api.sendMessage(
            chatId,
            interfaceText.usefulMaterials,
            usefulKeyboard,
        );
    }

    async function handleCallback(query) {
        const chatId = query.message?.chat?.id;
        if (!chatId) return;
        await api.call('answerCallbackQuery', { callback_query_id: query.id });
        const isSubscriptionCheck = query.data.startsWith('check|');
        let callbackData = isSubscriptionCheck
            ? query.data.slice('check|'.length)
            : query.data;

        if (!(await isSubscribed(query.from.id))) {
            await sendNotSubscribedMessage(chatId, callbackData);
            return;
        }

        // Поддержка старых кнопок из уже отправленных сообщений.
        if (callbackData.startsWith('exam:')) {
            const oldExam = callbackData.slice('exam:'.length);
            callbackData = `material:${oldExam === 'oge' ? 'oge' : 'ege'}`;
        }

        if (callbackData === 'command:materials')
            return api.sendMessage(
                chatId,
                interfaceText.chooseMaterial,
                materialKeyboard,
            );
        if (callbackData === 'command:useful')
            return api.sendMessage(
                chatId,
                interfaceText.usefulMaterials,
                usefulKeyboard,
            );
        if (callbackData === 'command:help')
            return api.sendMessage(chatId, interfaceText.help);

        if (callbackData.startsWith('material:')) {
            const key = callbackData.slice('material:'.length);
            if (!materials[key]) return;
            await api.sendMessage(chatId, materials[key]);
            if (key === 'ege' || key === 'essay')
                await sendEgeFollowUps(chatId);
            await sendUsefulMaterials(chatId);
            return;
        }

        if (callbackData.startsWith('useful:')) {
            const key = callbackData.slice('useful:'.length);
            if (!useful[key]) return;
            await api.sendMessage(chatId, useful[key]);
            if (key === 'oge')
                await sendFileIfExists(
                    chatId,
                    'assets/Шпоры ОГЭ.pdf',
                    interfaceText.ogeCheatsheetsCaption,
                );
        }
    }

    async function sendSubscriptionGate(chatId, retryCallback) {
        const channelUrl = getChannelUrl(config.channel);
        await api.sendMessage(chatId, getSubscriptionText(channelUrl), {
            inline_keyboard: [
                [{ text: buttonText.subscribe, url: channelUrl }],
                [
                    {
                        text: buttonText.checkSubscription,
                        callback_data: `check|${retryCallback}`,
                    },
                ],
            ],
        });
    }

    async function sendNotSubscribedMessage(chatId, retryCallback) {
        const channelUrl = getChannelUrl(config.channel);
        await api.sendMessage(chatId, getNotSubscribedText(channelUrl), {
            inline_keyboard: [
                [{ text: buttonText.subscribe, url: channelUrl }],
                [
                    {
                        text: buttonText.checkSubscription,
                        callback_data: `check|${retryCallback}`,
                    },
                ],
            ],
        });
    }

    async function handleUpdate(update) {
        if (update.callback_query) return handleCallback(update.callback_query);
        const message = update.message;
        if (!message?.text) return;
        const command = message.text.split(/\s/)[0].split('@')[0];
        if (command === '/start')
            return api.sendPhoto(
                message.chat.id,
                path.resolve('assets/main.jpg'),
                welcomeText,
                examKeyboard,
            );
        const knownCommands = new Set(['/materials', '/useful', '/help']);
        if (!knownCommands.has(command))
            return api.sendMessage(message.chat.id, interfaceText.unknownCommand);
        if (!(await isSubscribed(message.from.id)))
            return sendNotSubscribedMessage(
                message.chat.id,
                `command:${command.slice(1)}`,
            );
        if (command === '/materials')
            return api.sendMessage(
                message.chat.id,
                interfaceText.chooseMaterial,
                materialKeyboard,
            );
        if (command === '/useful')
            return api.sendMessage(
                message.chat.id,
                interfaceText.usefulMaterials,
                usefulKeyboard,
            );
        if (command === '/help')
            return api.sendMessage(message.chat.id, interfaceText.help);
    }

    return { handleUpdate, isSubscribed };
}
