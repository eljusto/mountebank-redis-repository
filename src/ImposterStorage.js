'use strict';

const RedisClient = require('./RedisClient');
const errors = require('mountebank/src/util/errors');

const CHANNELS = {
    imposter_change: 'imposter_change',
    imposter_delete: 'imposter_delete',
    all_imposters_delete: 'all_imposters_delete',

};

function repeatsFor(response) {
    return response.repeat || 1;
}

class ImposterStorage {
    constructor(options = {}, logger) {
        this.dbClient = new RedisClient(options, logger);
        this._logger = logger.child({ _context: 'imposter_storage' });
        this.idCounter = 0;
    }

    async start() {
        if (this.dbClient.isClosed()) {
            return await this.dbClient.connectToServer();
        }
    }

    async stop() {
        return await this.dbClient.stop();
    }

    generateId(prefix) {
        const epoch = new Date().valueOf();
        this.idCounter += 1;
        return `${ prefix }-${ epoch }-${ process.pid }-${ this.idCounter }`;
    }

    async addImposter(imposter) {
        try {
            const res = await this.dbClient.setObject('imposter', imposter.port, imposter);
            this.dbClient.publish(CHANNELS.imposter_change, imposter.port);
            return res;
        } catch (e) {
            this._logger.error(e, 'ADD_IMPOSTER_ERROR');
            return null;
        }
    }

    async subscribe(channel, callbackFn) {
        try {
            return await this.dbClient.subscribe(channel, callbackFn);
        } catch (e) {
            this._logger.error(e, 'SUBSCRIBE_ERROR');
        }
    }

    async unsubscribe(channel) {
        try {
            return await this.dbClient.unsubscribe(channel);
        } catch (e) {
            this._logger.error(e, 'UNSUBSCRIBE_ERROR');
        }
    }

    async updateImposter(imposter) {
        try {
            const res = await this.dbClient.setObject('imposter', imposter.port, imposter);

            this.dbClient.publish(CHANNELS.imposter_change, imposter.port);
            return res;
        } catch (e) {
            this._logger.error(e, 'UPDATE_IMPOSTER_ERROR');
            return null;
        }
    }

    async getAllImposters() {
        try {
            return await this.dbClient.getAllObjects('imposter') || [];
        } catch (e) {
            this._logger.error(e, 'GET_ALL_IMPOSTERS_ERROR');
            return [];
        }
    }

    async getImposter(id) {
        try {
            const res = await this.dbClient.getObject('imposter', id);
            return res;
        } catch (e) {
            this._logger.error(e, 'GET_IMPOSTER_ERROR');
            return null;
        }
    }

    async deleteImposter(id) {
        try {
            const res = await this.dbClient.delObject('imposter', id);
            this.dbClient.publish(CHANNELS.imposter_delete, id);
            // TODO:
            // await this.dbClient.delAllObjects('meta');
            // await this.dbClient.delAllObjects('responses');
            // await this.dbClient.delAllObjects('matches');
            return res;
        } catch (e) {
            this._logger.error(e, 'DELETE_IMPOSTER_ERROR');
            return null;
        }
    }

    async getStubs(imposterId) {
        const imposter = await this.getImposter(imposterId);
        if (!imposter || !Array.isArray(imposter.stubs)) {
            return [];
        }

        return imposter.stubs;
    }

    async deleteAllImposters() {
        try {
            const res = await this.dbClient.delAllObjects('imposter');
            await this.dbClient.flushDb();
            this.dbClient.publish(CHANNELS.all_imposters_delete);

            return res;
        } catch (e) {
            this._logger.error(e, 'DELETE_ALL_IMPOSTERS_ERROR');
            return null;
        }
    }

    async addRequest(imposterId, request) {
        try {
            return await this.dbClient.pushToObject('requests', imposterId, request);
        } catch (e) {
            this._logger.error(e, 'ADD_REQUEST_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteRequests(imposterId) {
        try {
            return await this.dbClient.delObject('requests', imposterId);
        } catch (e) {
            this._logger.error(e, 'DELETE_REQUESTS_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteAllRequests() {
        try {
            return await this.dbClient.delAllObjects('requests');
        } catch (e) {
            this._logger.error(e, 'DELETE_ALL_REQUESTS_ERROR');
            return Promise.reject(e);
        }
    }

    async getRequests(imposterId) {
        try {
            return await this.dbClient.getObject('requests', imposterId) || [];
        } catch (e) {
            this._logger.error(e, 'GET_REQUESTS_ERROR');
            return Promise.reject(e);
        }
    }

    async getResponse(responseId) {
        try {
            return await this.dbClient.getObject('responses', responseId);
        } catch (e) {
            this._logger.error(e, 'GET_RESPONSE_ERROR');
            return Promise.reject(e);
        }
    }

    async saveResponse(response) {
        const responseId = this.generateId('response');
        try {
            await this.dbClient.setObject('responses', responseId, response);
            return responseId;
        } catch (e) {
            this._logger.error(e, 'SAVE_RESPONSE_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteResponse(responseId) {
        try {
            return await this.dbClient.delObject('responses', responseId);
        } catch (e) {
            this._logger.error(e, 'DELETE_RESPONSE_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteAllResponses() {
        try {
            return await this.dbClient.delAllObjects('responses');
        } catch (e) {
            this._logger.error(e, 'DELETE_ALL_RESPONSES_ERROR');
            return Promise.reject(e);
        }
    }

    async delMeta(imposterId, stubId) {
        try {
            const res = await this.dbClient.delObject('meta', [ imposterId, stubId ].join(':'));
            return res;
        } catch (e) {
            this._logger.error(e, 'DELETE_META_ERROR');
            return Promise.reject(e);
        }
    }

    async setMeta(imposterId, stubId, meta) {
        try {
            const res = await this.dbClient.setObject('meta', [ imposterId, stubId ].join(':'), meta);
            return res;
        } catch (e) {
            this._logger.error(e, 'SET_META_ERROR');
            return Promise.reject(e);
        }
    }

    async getMeta(imposterId, stubId) {
        try {
            const res = await this.dbClient.getObject('meta', [ imposterId, stubId ].join(':'));
            return res;
        } catch (e) {
            this._logger.error(e, 'GET_META_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteAllMeta() {

        try {
            return await this.dbClient.delAllObjects('meta');
        } catch (e) {
            this._logger.error(e, 'DELETE_ALL_META_ERROR');
            return Promise.reject(e);
        }
    }

    async addMatch(stubId, match) {
        try {
            return await this.dbClient.pushToObject('matches', stubId, match);
        } catch (e) {
            this._logger.error(e, 'ADD_MATCH_ERROR');
            return Promise.reject(e);
        }
    }

    async getMatches(stubId) {

        try {
            return await this.dbClient.getObject('matches', stubId);
        } catch (e) {
            this._logger.error(e, 'GET_MATCHES_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteMatches(stubId) {
        try {
            return await this.dbClient.delObject('match', stubId);
        } catch (e) {
            this._logger.error(e, 'DELETE_MATCHES_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteAllMatches() {
        try {
            return await this.dbClient.delAllObjects('match');
        } catch (e) {
            this._logger.error(e, 'DELETE_ALL_MATCHES_ERROR');
            return Promise.reject(e);
        }
    }

    async getRequestCounter(imposterId) {
        try {
            return await this.dbClient.getObject('requestCounter', imposterId);
        } catch (e) {
            this._logger.error(e, 'GET_REQUEST_COUNTER_ERROR');
            return Promise.reject(e);
        }
    }

    async incrementRequestCounter(imposterId) {
        try {
            await this.dbClient.incrementCounter('requestCounter', imposterId);
            const val = await this.dbClient.getObject('requestCounter', imposterId);
            return val;
        } catch (e) {
            this._logger.error(e, 'INCREMENT_REQUEST_COUNTER_ERROR');
            return Promise.reject(e);
        }
    }

    async addStub(imposterId, stub, index) {
        const imposter = await this.getImposter(imposterId);
        if (!imposter) {
            return;
        }

        const stubDefinition = await this.saveStubMetaAndResponses(imposterId, stub);

        if (!Array.isArray(imposter.stubs)) {
            imposter.stubs = [];
        }

        if (index === undefined) {
            imposter.stubs.push(stubDefinition);
        } else {
            imposter.stubs.splice(index, 0, stubDefinition);
        }
        await this.updateImposter(imposter);
    }

    async deleteStubAtIndex(imposterId, index) {
        const imposter = await this.getImposter(imposterId);
        if (!imposter) {
            return;
        }

        if (!Array.isArray(imposter.stubs)) {
            imposter.stubs = [];
        }
        if (typeof imposter.stubs[index] === 'undefined') {
            throw errors.MissingResourceError(`no stub at index ${ index }`);
        }

        imposter.stubs.splice(index, 1);
        await this.updateImposter(imposter);

    // FIXME: remove responses and meta
    // await this.addResponse(responseId, responses[i]);
    // }
    // await this.setMeta(imposterId, stubId, meta);
    }

    async overwriteAllStubs(imposterId, stubs = []) {
        const imposter = await this.getImposter(imposterId);
        if (!imposter) {
            return;
        }

        // TODO: remove all stubs and stub data
        const stubDefinitions = [];
        for (let i = 0; i < stubs.length; i += 1) {
            stubDefinitions.push(await this.saveStubMetaAndResponses(imposterId, stubs[i]));
        }

        imposter.stubs = stubDefinitions;
        await this.updateImposter(imposter);
    }

    async addResponse(imposterId, stubId, response) {

        const meta = await this.getMeta(imposterId, stubId);
        if (!meta) {
            return null;
        }

        const responseId = await this.saveResponse(response);
        const responseIndex = meta.responseIds.length;
        meta.responseIds.push(responseId);
        for (let repeats = 0; repeats < repeatsFor(response); repeats += 1) {
            meta.orderWithRepeats.push(responseIndex);
        }
        await this.setMeta(imposterId, stubId, meta);
        return meta;
    }

    async saveStubMetaAndResponses(imposterId, stub) {
        if (!stub) {
            return;
        }
        const stubId = this.generateId('stub');
        const stubDefinition = {
            meta: { id: stubId },
        };
        const meta = {
            responseIds: [],
            orderWithRepeats: [],
            nextIndex: 0,
        };
        const responses = stub.responses || [];
        if (stub.predicates) {
            stubDefinition.predicates = stub.predicates;
        }

        for (let i = 0; i < responses.length; i += 1) {
            const responseId = await this.saveResponse(responses[i]);

            meta.responseIds.push(responseId);

            for (let repeats = 0; repeats < repeatsFor(responses[i]); repeats += 1) {
                meta.orderWithRepeats.push(i);
            }
        }
        await this.setMeta(imposterId, stubId, meta);

        return stubDefinition;
    }
}

ImposterStorage.CHANNELS = CHANNELS;

module.exports = ImposterStorage;
