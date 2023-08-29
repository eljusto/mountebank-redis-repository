import { randomBytes } from 'crypto';
import type { RedisOptions } from 'ioredis';
import Redis from 'ioredis';
import type { Logger } from './types';

type WrappedChannelCallback = (message: string) => void;
export type ChannelCallback<Payload> = (payload: Payload) => void;

type ObjectId = number | string;

class RedisClient<
    SubscriptionData extends object,
    ObjectData extends object,
    ObjectType extends keyof ObjectData = keyof ObjectData,
    SubscriptionType extends keyof SubscriptionData & string = keyof SubscriptionData & string
> {
    _clientId: string;
    _isStopped: boolean;
    _logger: Logger;

    _client: Redis;
    _subscriber: Redis;

    _pubSubCallbacks: Record<SubscriptionType, WrappedChannelCallback>;

    connected = false;

    constructor(options: RedisOptions, logger: Logger) {
        this._clientId = randomBytes(16).toString('base64');
        this._logger = logger.child({ _context: 'redis_client' });
        this._isStopped = false;

        this._client = new Redis(options);
        this._client.on('error', err => this._logger.error(err, 'CLIENT_ERROR'));
        this._client.on('connect', () => {
            this._logger.info('Connected to redis.');
            this.connected = true;
        });
        this._client.on('reconnecting', (ms) => {
            this._logger.info(`Reconnecting to redis in ${ ms }.`);
        });

        this._subscriber = new Redis(options);
        this._pubSubCallbacks = {} as Record<SubscriptionType, WrappedChannelCallback>;
        this._subscriber.on('error', err => this._logger.error(err, 'SUBSCRIBER_ERROR'));
        this._subscriber.on('message', (channel: SubscriptionType, message) => {
            if (channel in this._pubSubCallbacks) {
                this._pubSubCallbacks[channel](message);
            }
        });

    }

    async setObject(type: ObjectType, id: string | number, obj: ObjectData[ObjectType]) {
        try {
            const client = await this.getClient();
            const json = JSON.stringify(obj);
            return await client.hset(String(type), String(id), json);
        } catch (e) {
            this._logger.error(e, 'SET_OBJECT_ERROR');
            return null;
        }
    }

    async pushToObject<T extends ObjectType>(type: T, id: ObjectId, obj: ObjectData[T] extends Array<infer U> ? U : never) {
        try {
            const client = await this.getClient();

            const itemsString = await client.hget(String(type), String(id)) || '[]';
            const items = JSON.parse(itemsString);
            items.push(obj);
            const json = JSON.stringify(items);

            return await client.hset(String(type), String(id), json);
        } catch (e) {
            this._logger.error(e, 'PUSH_TO_OBJECT_ERROR');
            return null;
        }
    }

    async getObject<T extends ObjectType>(type: T, id: ObjectId): Promise<Awaited<ObjectData[T] | null>> {
        try {
            const client = await this.getClient();
            const json = await client.hget(String(type), String(id));
            return json !== null ? JSON.parse(json) : null;
        } catch (e) {
            this._logger.error(e, 'GET_OBJECT_ERROR');
            return null;
        }
    }

    async getAllObjects(type: ObjectType) {
        try {
            const client = await this.getClient();
            const list = await client.hvals(String(type));
            return list.map(item => JSON.parse(item));
        } catch (e) {
            this._logger.error(e, 'GET_ALL_OBJECTS_ERROR');
            return null;
        }
    }

    async delObject(type: ObjectType, id: ObjectId) {
        try {
            const client = await this.getClient();
            return await client.hdel(String(type), String(id));
        } catch (e) {
            this._logger.error(e, 'DEL_OBJECT_ERROR');
            return 0;
        }
    }

    async delAllObjects(type: ObjectType) {
        try {
            const client = await this.getClient();
            const res = await client.del(String(type));
            return res;
        } catch (e) {
            this._logger.error(e, 'DEL_ALL_OBJECTS_ERROR');
            return null;
        }
    }

    async incrementCounter(type: ObjectType, id: ObjectId) {
        try {
            const client = await this.getClient();
            const res = await client.hincrby(String(type), String(id), 1);
            return res;
        } catch (e) {
            this._logger.error(e, 'INCREMENT_COUNTER_ERROR');
            return null;
        }
    }

    async decrementCounter(type: ObjectType, id: ObjectId) {
        try {
            const client = await this.getClient();
            const res = await client.hincrby(String(type), String(id), -1);
            return res;
        } catch (e) {
            this._logger.error(e, 'DECREMENT_COUNTER_ERROR');
            return null;
        }
    }

    async resetCounter(type: ObjectType, id: ObjectId) {
        try {
            const client = await this.getClient();
            const res = await client.hset(String(type), String(id), 0);
            return res;
        } catch (e) {
            this._logger.error(e, 'RESET_COUNTER_ERROR');
            return null;
        }
    }

    // Pass clientId for testing purpose only
    async _publish(channel: SubscriptionType, payload: SubscriptionData[SubscriptionType], clientId: string) {
        try {
            const client = await this.getClient();
            const data = {
                _clientId: clientId,
                payload,
            };
            const res = await client.publish(channel, JSON.stringify(data));
            return res;
        } catch (e) {
            this._logger.error(e, 'PUBLISH_ERROR');
            return null;
        }
    }

    async publish<T extends SubscriptionType>(channel: T, payload: SubscriptionData[T]) {
        return await this._publish(channel, payload, this._clientId);
    }

    async subscribe<T extends SubscriptionType>(channel: T, callbackFn: ChannelCallback<SubscriptionData[T]>) {
        try {
            const client = await this.getPubSubClient();
            await client.subscribe(channel);

            this._pubSubCallbacks[channel] = this.wrapCallbackFn<T>(callbackFn);
        } catch (e) {
            this._logger.error(e, 'SUBSCRIBE_ERROR');
            return null;
        }
    }

    async unsubscribe(channel: SubscriptionType) {
        try {
            delete this._pubSubCallbacks[channel];
            const client = await this.getPubSubClient();
            const res = await client.unsubscribe(channel);
            return res;
        } catch (e) {
            this._logger.error(e, 'UNSUBSCRIBE_ERROR');
            return null;
        }
    }

    wrapCallbackFn<T extends SubscriptionType>(callbackFn: ChannelCallback<SubscriptionData[T]>): WrappedChannelCallback {
        return (message: string) => {
            try {
                const data = JSON.parse(message);
                if (data._clientId !== this._clientId) {
                    callbackFn(data.payload);
                }
            } catch (e) {
                this._logger.error(e, 'MESSAGE_CALLBACK_ERROR');
            }
        };
    }

    async connectToServer() {
        try {
            this._isStopped = false;
            if (this._client.status === 'end') {
                await this._client.connect();
            }
            if (this._subscriber.status === 'end') {
                await this._subscriber.connect();
            }
        } catch (e) {
            this._logger.error(e, 'CONNECT_ERROR');
        }
    }

    async getClient() {
        if (this.isClosed()) {
            await this.connectToServer();
        }
        return this._client;
    }

    async getPubSubClient() {
        if (this.isClosed()) {
            await this.connectToServer();
        }
        return this._subscriber;
    }

    isClosed() {
        return this._isStopped;
    }

    async stop() {
        try {
            if (this._isStopped) {
                return;
            }
            this._isStopped = true;
            await this._client.quit();
            await this._subscriber.quit();

            // wait next tick to fix bug with  connection just after disconnection
            return new Promise(resolve => setTimeout(resolve, 0));
        } catch (e) {
            this._logger.error(e, 'STOP_ERROR');
        }
    }
}

export default RedisClient;
