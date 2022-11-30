'use strict';

const crypto = require('crypto');
const Redis = require('ioredis');

function wrapCallbackFn(clientId, callbackFn) {
    return message => {
        try {
            const data = JSON.parse(message);

            if (data._clientId !== clientId) {
                callbackFn(data.payload);
            }
        } catch (e) {
            this.logger.error('REDIS_MESSAGE_CALLBACK_ERROR', e);
        }
    };
}

class RedisClient {
    constructor(options = {}, logger) {
        this._client = new Redis(options);
        this._subscriber = new Redis(options);
        this._clientId = crypto.randomBytes(16).toString('base64');
        this._logger = logger;

        this._client.on('error', err => this.logger.error('REDIS_CLIENT_ERROR', err));
        this._subscriber.on('error', err => this.logger.error('REDIS_CLIENT_ERROR', err));

        this._pubSubCallbacks = {};
        this._subscriber.on("message", (channel, message) => {
            console.log(`Received ${message} from ${channel}`);
            if (typeof this._pubSubCallbacks[channel] === 'function') {
                this._pubSubCallbacks[channel](message);
            }
        });

    }

    async setObject(type, id, obj) {
        try {
            const client = await this.getClient();
            const json = JSON.stringify(obj);
            return await client.hset(type, String(id), json);
        } catch (e) {
            this.logger.error('REDIS_SET_OBJECT_ERROR', e);
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
            this.logger.error('REDIS_PUSH_TO_OBJECT_ERROR', e);
            return null;
        }
    }

    async getObject(type, id) {
        try {
            const client = await this.getClient();
            const json = await client.hget(type, String(id));
            return JSON.parse(json);
        } catch (e) {
            this.logger.error('REDIS_GET_OBJECT_ERROR', e, type, id);
            return null;
        }
    }

    async getAllObjects(type) {
        try {
            const client = await this.getClient();
            const list = await client.hvals(type);
            return list.map(item => JSON.parse(item));
        } catch (e) {
            this.logger.error('REDIS_GET_ALL_OBJECTS_ERROR', e);
            return null;
        }
    }

    async delObject(type, id) {
        try {
            const client = await this.getClient();
            return await client.hdel(type, String(id));
        } catch (e) {
            this.logger.error('REDIS_DEL_OBJECT_ERROR', e);
            return 0;
        }
    }

    async delAllObjects(type) {
        try {
            const client = await this.getClient();
            const res = await client.del(type);
            return res;
        } catch (e) {
            this.logger.error('REDIS_DEL_ALL_OBJECTS_ERROR', e);
            return null;
        }
    }

    async incrementCounter(type, id) {
        try {
            const client = await this.getClient();
            const res = await client.hIncrBy(type, String(id), 1);
            return res;
        } catch (e) {
            this.logger.error('REDIS_INCREMENT_COUNTER_ERROR', e);
            return null;
        }
    }

    async decrementCounter(type, id) {
        try {
            const client = await this.getClient();
            const res = await client.hIncrBy(type, String(id), -1);
            return res;
        } catch (e) {
            this.logger.error('REDIS_DECREMENT_COUNTER_ERROR', e);
            return null;
        }
    }

    async resetCounter(type, id) {
        try {
            const client = await this.getClient();
            const res = await client.hset(type, String(id), 0);
            return res;
        } catch (e) {
            this.logger.error('REDIS_RESET_COUNTER_ERROR', e);
            return null;
        }
    }

    async publish(channel, payload) {
        try {
            const client = await this.getClient();
            const data = {
                _clientId: this._clientId,
                payload,
            };
            const res = await client.publish(channel, JSON.stringify(data));
            return res;
        } catch (e) {
            this.logger.error('REDIS_PUBLISH_ERROR', e, channel, payload);
            return null;
        }
    }

    async subscribe(channel, callbackFn) {
        try {
            const client = await this.getPubSubClient();
            await client.subscribe(channel);

            this._pubSubCallbacks[channel] = wrapCallbackFn(this._clientId, callbackFn);
        } catch (e) {
            this.logger.error('REDIS_SUBSCRIBE_ERROR', e);
            return null;
        }
    }

    async unsubscribe(channel) {
        try {
            const client = await this.getPubSubClient();
            const res = await client.unsubscribe(channel);
            delete this._pubSubCallbacks[channel];
            return res;
        } catch (e) {
            this.logger.error('REDIS_UNSUBSCRIBE_ERROR', e);
            return null;
        }
    }

    async flushDb() {
        const client = await this.getClient();
        return await client.flushDb();
    }

    async connectToServer() {
        try {
            this._isStopped = false;
            return await this._client.connect();
        } catch (e) {
            this.logger.error('REDIS_CONNECT_ERROR', e);
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
            await this._client.disconnect();
            await this._subscriber.disconnect();
            this._isStopped = true;
        } catch (e) {
            this.logger.error('REDIS_STOP_ERROR', e);
        }
    }
}

module.exports = RedisClient;
