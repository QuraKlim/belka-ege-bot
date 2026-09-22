import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot.js';

test('subscription outages do not accuse users of being unsubscribed', async () => {
  const messages = [];
  const bot = createBot({ call: async () => { throw new Error('network'); },
    sendMessage: async (...args) => messages.push(args) }, { error() {} });
  await bot.handleUpdate({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/materials' } });
  assert.equal(messages.length, 1);
  assert.match(messages[0][1], /не удалось проверить подписку/);
  assert.doesNotMatch(messages[0][1], /Ты не подписан/);
});

test('expired acknowledgements do not stop valid actions', async () => {
  const messages = [];
  const bot = createBot({ call: async (method) => {
    if (method === 'answerCallbackQuery') throw Object.assign(new Error('query is too old'), { status: 400 });
    return { status: 'member' };
  }, sendMessage: async (...args) => messages.push(args) }, { warn() {} });
  await bot.handleUpdate({ callback_query: { id: 'old', data: 'command:help',
    from: { id: 1 }, message: { chat: { id: 1 } } } });
  assert.equal(messages.length, 1);
  assert.match(messages[0][1], /Нажми \/start/);
});

test('missing callback data and inherited object keys are ignored safely', async () => {
  const messages = [];
  const bot = createBot({ call: async () => ({ status: 'member' }),
    sendMessage: async (...args) => messages.push(args) });
  for (const data of [undefined, 'material:constructor', 'useful:__proto__']) {
    await bot.handleUpdate({ callback_query: { id: 'q', data,
      from: { id: 1 }, message: { chat: { id: 1 } } } });
  }
  assert.deepEqual(messages, []);
});

test('/start отправляет приветствие и клавиатуру', async () => {
  const calls = [];
  const api = { sendPhoto: async (...args) => calls.push(args), call: async () => ({}) };
  await createBot(api).handleUpdate({ message: { chat: { id: 42 }, text: '/start' } });
  assert.equal(calls.length, 1);
  assert.match(calls[0][1], /assets[\\/]main\.jpg$/);
  assert.match(calls[0][2], /Какой экзамен/);
  assert.equal(calls[0][3].inline_keyboard[0][0].text, 'ОГЭ');
  assert.equal(calls[0][3].inline_keyboard[0][0].callback_data, 'material:oge');
  assert.equal(calls[0][3].inline_keyboard[0][1].text, 'ЕГЭ');
  assert.equal(calls[0][3].inline_keyboard[1][0].text, 'Итоговое сочинение');
});

test('без подписки материал закрыт', async () => {
  const messages = [];
  const api = {
    sendMessage: async (...args) => messages.push(args),
    call: async (method) => method === 'getChatMember' ? { status: 'left' } : {},
  };
  await createBot(api).handleUpdate({ callback_query: {
    id: 'q1', data: 'material:oge', from: { id: 7 }, message: { chat: { id: 42 } },
  } });
  assert.equal(messages.length, 1);
  assert.match(messages[0][1], /Ты не подписан/);
});

test('повторная проверка выводит отдельное сообщение', async () => {
  const messages = [];
  const api = {
    sendMessage: async (...args) => messages.push(args),
    call: async (method) => method === 'getChatMember' ? { status: 'left' } : {},
  };
  await createBot(api).handleUpdate({ callback_query: {
    id: 'q2', data: 'check|exam:oge', from: { id: 7 }, message: { chat: { id: 42 } },
  } });
  assert.equal(messages.length, 1);
  assert.match(messages[0][1], /Ты не подписан/);
  assert.match(messages[0][1], /<a href="https:\/\/t\.me\//);
});

test('неизвестный текст получает сообщение об ошибке', async () => {
  const messages = [];
  const api = { sendMessage: async (...args) => messages.push(args) };
  await createBot(api).handleUpdate({
    message: { chat: { id: 42 }, from: { id: 7 }, text: 'привет' },
  });
  assert.equal(messages[0][1], 'Такой команды не существует');
});
