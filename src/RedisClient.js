'use strict';

const crypto = require('crypto');
const Redis = require('ioredis');

class RedisClient {
    constructor(options = {}, logger) {
        this._clientId = crypto.randomBytes(16).toString('base64');
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
        this._pubSubCallbacks = {};
        this._subscriber.on('error', err => this._logger.error(err, 'SUBSCRIBER_ERROR'));
        this._subscriber.on('message', (channel, message) => {
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
            this._logger.error(e, 'SET_OBJECT_ERROR');
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
            this._logger.error(e, 'PUSH_TO_OBJECT_ERROR');
            return null;
        }
    }

    async getObject(type, id) {
        try {
            const client = await this.getClient();
            const json = await client.hget(type, String(id));
            return JSON.parse(json);
        } catch (e) {
            this._logger.error(e, 'GET_OBJECT_ERROR');
            return null;
        }
    }

    async getAllObjects(type) {
        try {
            const client = await this.getClient();
            const list = await client.hvals(type);
            return list.map(item => JSON.parse(item));
        } catch (e) {
            this._logger.error(e, 'GET_ALL_OBJECTS_ERROR');
            return null;
        }
    }

    async delObject(type, id) {
        try {
            const client = await this.getClient();
            return await client.hdel(type, String(id));
        } catch (e) {
            this._logger.error(e, 'DEL_OBJECT_ERROR');
            return 0;
        }
    }

    async delAllObjects(type) {
        try {
            const client = await this.getClient();
            const res = await client.del(type);
            return res;
        } catch (e) {
            this._logger.error(e, 'DEL_ALL_OBJECTS_ERROR');
            return null;
        }
    }

    async incrementCounter(type, id) {
        try {
            const client = await this.getClient();
            const res = await client.hincrby(type, String(id), 1);
            return res;
        } catch (e) {
            this._logger.error(e, 'INCREMENT_COUNTER_ERROR');
            return null;
        }
    }

    async decrementCounter(type, id) {
        try {
            const client = await this.getClient();
            const res = await client.hincrby(type, String(id), -1);
            return res;
        } catch (e) {
            this._logger.error(e, 'DECREMENT_COUNTER_ERROR');
            return null;
        }
    }

    async resetCounter(type, id) {
        try {
            const client = await this.getClient();
            const res = await client.hset(type, String(id), 0);
            return res;
        } catch (e) {
            this._logger.error(e, 'RESET_COUNTER_ERROR');
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
            this._logger.error(e, 'PUBLISH_ERROR');
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
            this._logger.error(e, 'SUBSCRIBE_ERROR');
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
            this._logger.error(e, 'UNSUBSCRIBE_ERROR');
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

module.exports = RedisClient;
