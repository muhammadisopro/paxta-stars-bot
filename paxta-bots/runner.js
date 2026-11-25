import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotApi, PaxtaWebApi } from './lib/bot-api.js';
import { store } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '.env.json');

const BOT_MODULES = [
  { key: 'Pricebot', file: './bots/pricebot.js' },
  { key: 'Checkbot', file: './bots/checkbot.js' },
  { key: 'Statsbot', file: './bots/statsbot.js' },
  { key: 'Pixelbot', file: './bots/pixelbot.js' },
  { key: 'Searchbot', file: './bots/searchbot.js' },
  { key: 'Trustbot', file: './bots/trustbot.js' },
  { key: 'Radarbot', file: './bots/radarbot.js' },
  { key: 'Ratebot', file: './bots/ratebot.js' },
  { key: 'Weather_bot', file: './bots/weatherbot.js' },
  { key: 'Soat_bot', file: './bots/soatbot.js' },
];

function createLogger(tag) {
  const prefix = () => `[${new Date().toISOString()}] [${tag}]`;
  return {
    info: (...args) => console.log(prefix(), ...args),
    warn: (...args) => console.warn(prefix(), ...args),
    error: (...args) => console.error(prefix(), ...args),
  };
}

const log = createLogger('runner');

async function loadEnv() {
  if (process.env.BOT_ENV_JSON) {
    return JSON.parse(process.env.BOT_ENV_JSON);
  }
  const raw = await fs.readFile(ENV_PATH, 'utf8');
  return JSON.parse(raw);
}

async function startBot(entry, env, webApi) {
  const botCfg = env.bots?.[entry.key];
  const botLog = createLogger(entry.key);

  if (!botCfg?.token) {
    botLog.warn(`No token found in .env.json for ${entry.key}, skipping.`);
    return null;
  }

  let mod;
  try {
    mod = await import(entry.file);
  } catch (err) {
    botLog.error(`Failed to load ${entry.file}: ${err.message}`);
    return null;
  }

  const registerFn = mod.register || mod.default;
  if (typeof registerFn !== 'function') {
    botLog.error(`${entry.file} must export register({ api, webApi, store, config, botInfo, logger })`);
    return null;
  }

  const api = new BotApi(botCfg.token, {
    baseUrl: env.botApiBase || 'https://paxta.online',
    logger: botLog,
  });

  let botInfo;
  try {
    botInfo = await api.getMe();
    botLog.info(`Connected as @${botInfo.username} (id: ${botInfo.id})`);
  } catch (err) {
    botLog.error(`getMe failed for ${entry.key}: ${err.message}`);
    return null;
  }

  const registration = await registerFn({
    api,
    webApi,
    store,
    config: botCfg,
    env,
    botInfo,
    logger: botLog,
  });

  const handleUpdate =
    typeof registration === 'function' ? registration : registration?.handleUpdate;

  if (typeof handleUpdate !== 'function') {
    botLog.error(`${entry.file} register() did not return an update handler function`);
    return null;
  }

  if (Array.isArray(registration?.commands) && registration.commands.length > 0) {
    try {
      await api.setMyCommands(registration.commands);
      botLog.info(`Registered ${registration.commands.length} bot commands.`);
    } catch (err) {
      botLog.warn(`setMyCommands warning: ${err.message}`);
    }
  }

  const pollingPromise = api.startPolling(handleUpdate).catch((err) => {
    botLog.error(`Polling loop crashed: ${err.message}`);
  });

  return { key: entry.key, api, pollingPromise };
}

async function main() {
  log.info('Starting PaxtaGram 10-bot runner...');
  const env = await loadEnv();
  await store.init();
  log.info(`Store initialized (${Object.keys(store.data.users).length} users loaded).`);

  const webApi = new PaxtaWebApi({
    webApiBase: env.webApiBase || 'https://paxta.online/api',
  });

  const activeBots = (
    await Promise.all(BOT_MODULES.map((entry) => startBot(entry, env, webApi)))
  ).filter(Boolean);

  if (activeBots.length === 0) {
    log.error('No bots started. Exiting.');
    process.exitCode = 1;
    return;
  }

  log.info(`Running ${activeBots.length} bot(s): ${activeBots.map((b) => `@${b.key}`).join(', ')}`);

  if (process.env.PORT) {
    const port = Number(process.env.PORT);
    http
      .createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, bots: activeBots.map((b) => b.key) }));
      })
      .listen(port, '0.0.0.0', () => log.info(`Health server listening on :${port}`));
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down gracefully...`);
    for (const bot of activeBots) {
      bot.api.stop();
    }
    await store.flush();
    log.info('Store flushed. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('exit', () => store.flushSync());

  process.on('unhandledRejection', (err) => {
    log.error('Unhandled rejection:', err);
  });
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception:', err);
  });

  await Promise.all(activeBots.map((b) => b.pollingPromise));
}

main().catch((err) => {
  log.error('Fatal startup error:', err);
  store.flushSync();
  process.exit(1);
});
