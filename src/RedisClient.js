'use strict';

const crypto = require('crypto');
const Redis = require('ioredis');

class RedisClient {
    constructor(options = {}, logger) {
        this._client = new Redis(options);
        this._subscriber = new Redis(options);
        this._clientId = crypto.randomBytes(16).toString('base64');
        this._logger = logger;
        this._isStopped = false;

        this._subscriber.on('error', err => this._logger.error('REDIS_CLIENT_ERROR', err));

        this._pubSubCallbacks = {};
        this._subscriber.on('message', (channel, message) => {
            if (typeof this._pubSubCallbacks[channel] === 'function') {
                this._pubSubCallbacks[channel](message);
            }
        });

        this._client.on('error', err => this._logger.error('REDIS_CLIENT_ERROR', err));
        this._client.on('connect', () => {
            this._logger.info('Connected to redis.');
            this.connected = true;
        });
        this._client.on('reconnecting', (ms) => {
            this._logger.info(`Reconnecting to redis in ${ ms }.`);
        });
    }

    async setObject(type, id, obj) {
        try {
            const client = await this.getClient();
            const json = JSON.stringify(obj);
            return await client.hset(type, String(id), json);
        } catch (e) {
            this._logger.error('REDIS_SET_OBJECT_ERROR', e);
            return null;
        }
    }

    async pushToObject(type, id, obj) {
        try {
            const client = await this.getClient();

            const itemsString = await client.hget(type, String(id)) || '[]';
            const items = JSON.parse(itemsString);
            items.push(obj);
            const json = JSON.stringify(items);

            return await client.hset(type, String(id), json);
        } catch (e) {
            this._logger.error('REDIS_PUSH_TO_OBJECT_ERROR', e);
            return null;
        }
    }

    async getObject(type, id) {
        try {
            const client = await this.getClient();
            const json = await client.hget(type, String(id));
            return JSON.parse(json);
        } catch (e) {
            this._logger.error('REDIS_GET_OBJECT_ERROR', e, type, id);
            return null;
        }
    }

    async getAllObjects(type) {
        try {
            const client = await this.getClient();
            const list = await client.hvals(type);
            return list.map(item => JSON.parse(item));
        } catch (e) {
            this._logger.error('REDIS_GET_ALL_OBJECTS_ERROR', e);
            return null;
        }
    }

    async delObject(type, id) {
        try {
            const client = await this.getClient();
            return await client.hdel(type, String(id));
        } catch (e) {
            this._logger.error('REDIS_DEL_OBJECT_ERROR', e);
            return 0;
        }
    }

    async delAllObjects(type) {
        try {
            const client = await this.getClient();
            const res = await client.del(type);
            return res;
        } catch (e) {
            this._logger.error('REDIS_DEL_ALL_OBJECTS_ERROR', e);
            return null;
        }
    }

    async incrementCounter(type, id) {
        try {
            const client = await this.getClient();
            const res = await client.hincrby(type, String(id), 1);
            return res;
        } catch (e) {
            this._logger.error('REDIS_INCREMENT_COUNTER_ERROR', e);
            return null;
        }
    }

    async decrementCounter(type, id) {
        try {
            const client = await this.getClient();
            const res = await client.hincrby(type, String(id), -1);
            return res;
        } catch (e) {
            this._logger.error('REDIS_DECREMENT_COUNTER_ERROR', e);
            return null;
        }
    }

    async resetCounter(type, id) {
        try {
            const client = await this.getClient();
            const res = await client.hset(type, String(id), 0);
            return res;
        } catch (e) {
            this._logger.error('REDIS_RESET_COUNTER_ERROR', e);
            return null;
        }
    }

    // Pass clientId for testing purpose only
    async _publish(channel, payload, clientId) {
        try {
            const client = await this.getClient();
            const data = {
                _clientId: clientId,
                payload,
            };
            const res = await client.publish(channel, JSON.stringify(data));
            return res;
        } catch (e) {
            this._logger.error('REDIS_PUBLISH_ERROR', e, channel, payload);
            return null;
        }
    }

    async publish(channel, payload) {
        return await this._publish(channel, payload, this._clientId);
    }

    async subscribe(channel, callbackFn) {
        try {
            const client = await this.getPubSubClient();
            await client.subscribe(channel);

            this._pubSubCallbacks[channel] = this.wrapCallbackFn(callbackFn);
        } catch (e) {
            this._logger.error('REDIS_SUBSCRIBE_ERROR', e);
            return null;
        }
    }

    async unsubscribe(channel) {
        try {
            delete this._pubSubCallbacks[channel];
            const client = await this.getPubSubClient();
            const res = await client.unsubscribe(channel);
            return res;
        } catch (e) {
            this._logger.error('REDIS_UNSUBSCRIBE_ERROR', e);
            return null;
        }
    }

    wrapCallbackFn(callbackFn) {
        return message => {
            try {
                const data = JSON.parse(message);
                if (data._clientId !== this._clientId) {
                    callbackFn(data.payload);
                }
            } catch (e) {
                this._logger.error('REDIS_MESSAGE_CALLBACK_ERROR', e);
            }
        };
    }

    async flushDb() {
        const client = await this.getClient();
        return await client.flushdb();
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
            this._logger.error('REDIS_CONNECT_ERROR', e);
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
            this._logger.error('REDIS_STOP_ERROR', e);
        }
    }
}

module.exports = RedisClient;
