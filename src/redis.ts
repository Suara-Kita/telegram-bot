import { Redis } from 'ioredis';
import pino from 'pino';
import type { Config } from './types.js';

const logger = pino({ name: 'redis' });
let client: Redis | null = null;

export function getRedis(config: Config): Redis {
  if (!client) {
    client = new Redis({
      host: config.redisHost,
      port: config.redisPort,
      password: config.redisPassword || undefined,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    client.on('error', (err: Error) => {
      logger.error({ err }, 'Redis connection error');
    });

    client.on('ready', () => {
      logger.info('Redis connected');
    });
  }
  return client;
}

export async function pushToQueue(redis: Redis, queue: string, message: string): Promise<void> {
  const length = await redis.lpush(queue, message);
  logger.info({ queue, preview: message.slice(0, 120), queueDepth: length }, 'LPUSH to queue');
}

export async function incrementCounter(redis: Redis, counter: string): Promise<void> {
  await redis.incr(counter);
}
