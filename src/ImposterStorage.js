'use strict';

const RedisClient = require('./RedisClient');
const errors = require('mountebank/src/util/errors');

const CHANNELS = {
    imposter_change: 'imposter_change',
    imposter_delete: 'imposter_delete',
    all_imposters_delete: 'all_imposters_delete',
};

const ENTITIES = {
    imposter: 'imposter',
    matchList: 'matches',
    meta: 'meta',
    requestCounter: 'requestCounter',
    requestList: 'requests',
    response: 'response',
};

function repeatsFor(response) {
    return response.repeat || 1;
}

class ImposterStorage {
    constructor(options = {}, logger) {
        this.dbClient = new RedisClient(options, logger);
        this._logger = logger.child({ _context: 'imposter_storage' });
    }

    async start() {
        if (this.dbClient.isClosed()) {
            return await this.dbClient.connectToServer();
        }
    }

    async stop() {
        return await this.dbClient.stop();
    }

    _generateId(prefix) {
        if (this._idCounter === undefined) {
            this._idCounter = 0;
        }
        const epoch = new Date().valueOf();
        this._idCounter += 1;
        return `${ prefix }-${ epoch }-${ process.pid }-${ this._idCounter }`;
    }

    async saveImposter(imposter) {
        try {
            const res = await this.dbClient.setObject(ENTITIES.imposter, imposter.port, imposter);
            this.dbClient.publish(CHANNELS.imposter_change, imposter.port);
            return res;
        } catch (e) {
            this._logger.error(e, 'SAVE_IMPOSTER_ERROR');
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

    async getAllImposters() {
        try {
            return await this.dbClient.getAllObjects(ENTITIES.imposter) || [];
        } catch (e) {
            this._logger.error(e, 'GET_ALL_IMPOSTERS_ERROR');
            return [];
        }
    }

    async getImposter(imposterId) {
        try {
            const res = await this.dbClient.getObject(ENTITIES.imposter, imposterId);
            return res;
        } catch (e) {
            this._logger.error(e, 'GET_IMPOSTER_ERROR');
            return null;
        }
    }

    async deleteImposter(imposterId) {
        try {
            const imposter = await this.dbClient.getObject(ENTITIES.imposter, imposterId);
            const stubIds = imposter.stubs.map(stub => stub.meta.id);

            const deleteStubPromises = stubIds.map(stubId => this._deleteStub(imposterId, stubId));
            await Promise.all(deleteStubPromises);

            const res = await this.dbClient.delObject(ENTITIES.imposter, imposterId);
            this.deleteRequests(imposterId);

            this.dbClient.publish(CHANNELS.imposter_delete, imposterId);

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
            await this.dbClient.delAllObjects(ENTITIES.imposter);
            await this.dbClient.delAllObjects(ENTITIES.matchList);
            await this.dbClient.delAllObjects(ENTITIES.meta);
            await this.dbClient.delAllObjects(ENTITIES.requestCounter);
            await this.dbClient.delAllObjects(ENTITIES.requestList);
            await this.dbClient.delAllObjects(ENTITIES.response);

            this.dbClient.publish(CHANNELS.all_imposters_delete);
        } catch (e) {
            this._logger.error(e, 'DELETE_ALL_IMPOSTERS_ERROR');
            return null;
        }
    }

    async addRequest(imposterId, request) {
        try {
            return await this.dbClient.pushToObject(ENTITIES.requestList, imposterId, request);
        } catch (e) {
            this._logger.error(e, 'ADD_REQUEST_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteRequests(imposterId) {
        try {
            return await this.dbClient.delObject(ENTITIES.requestList, imposterId);
        } catch (e) {
            this._logger.error(e, 'DELETE_REQUESTS_ERROR');
            return Promise.reject(e);
        }
    }

    async getRequests(imposterId) {
        try {
            return await this.dbClient.getObject(ENTITIES.requestList, imposterId) || [];
        } catch (e) {
            this._logger.error(e, 'GET_REQUESTS_ERROR');
            return Promise.reject(e);
        }
    }

    async getResponses(imposterId, stubId) {
        const meta = await this._getMeta(imposterId, stubId);
        if (!meta || !meta.responseIds) {
            return [];
        }

        const responsePromises = meta.responseIds.map(responseId => this._getResponse(responseId));
        return await Promise.all(responsePromises);
    }

    async _getResponse(responseId) {
        try {
            return await this.dbClient.getObject(ENTITIES.response, responseId);
        } catch (e) {
            this._logger.error(e, 'GET_RESPONSE_ERROR');
            return Promise.reject(e);
        }
    }

    async _saveResponse(response) {
        const responseId = this._generateId(ENTITIES.response);
        try {
            await this.dbClient.setObject(ENTITIES.response, responseId, response);
            return responseId;
        } catch (e) {
            this._logger.error(e, 'SAVE_RESPONSE_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteResponse(responseId) {
        try {
            return await this.dbClient.delObject(ENTITIES.response, responseId);
        } catch (e) {
            this._logger.error(e, 'DELETE_RESPONSE_ERROR');
            return Promise.reject(e);
        }
    }

    async _deleteMeta(imposterId, stubId) {
        try {
            const res = await this.dbClient.delObject(ENTITIES.meta, [ imposterId, stubId ].join(':'));
            return res;
        } catch (e) {
            this._logger.error(e, 'DELETE_META_ERROR');
            return Promise.reject(e);
        }
    }

    async _saveMeta(imposterId, stubId, meta) {
        try {
            const res = await this.dbClient.setObject(ENTITIES.meta, [ imposterId, stubId ].join(':'), meta);
            return res;
        } catch (e) {
            this._logger.error(e, 'SET_META_ERROR');
            return Promise.reject(e);
        }
    }

    async _getMeta(imposterId, stubId) {
        try {
            const res = await this.dbClient.getObject(ENTITIES.meta, [ imposterId, stubId ].join(':'));
            return res;
        } catch (e) {
            this._logger.error(e, 'GET_META_ERROR');
            return Promise.reject(e);
        }
    }

    async addMatch(stubId, match) {
        try {
            return await this.dbClient.pushToObject(ENTITIES.matchList, stubId, match);
        } catch (e) {
            this._logger.error(e, 'ADD_MATCH_ERROR');
            return Promise.reject(e);
        }
    }

    async getMatches(stubId) {

        try {
            return await this.dbClient.getObject(ENTITIES.matchList, stubId);
        } catch (e) {
            this._logger.error(e, 'GET_MATCHES_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteMatches(stubId) {
        try {
            return await this.dbClient.delObject(ENTITIES.matchList, stubId);
        } catch (e) {
            this._logger.error(e, 'DELETE_MATCHES_ERROR');
            return Promise.reject(e);
        }
    }

    async getRequestCounter(imposterId) {
        try {
            return await this.dbClient.getObject(ENTITIES.requestCounter, imposterId);
        } catch (e) {
            this._logger.error(e, 'GET_REQUEST_COUNTER_ERROR');
            return Promise.reject(e);
        }
    }

    async incrementRequestCounter(imposterId) {
        try {
            await this.dbClient.incrementCounter(ENTITIES.requestCounter, imposterId);
            const val = await this.dbClient.getObject(ENTITIES.requestCounter, imposterId);
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
        await this.saveImposter(imposter);
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

        const deletedStub = imposter.stubs.splice(index, 1)[0];

        await this._deleteStub(imposterId, deletedStub.meta.id);

        await this.saveImposter(imposter);
    }

    async _deleteStub(imposterId, stubId) {
        if (!stubId) {
            return;
        }

        const meta = await this._getMeta(imposterId, stubId);
        if (meta) {
            const deleteResponsePromises = meta.responseIds.map(id => this.deleteResponse(id));
            await Promise.all(deleteResponsePromises);
            await this._deleteMeta(imposterId, stubId);
        }

        await this.deleteMatches(stubId);
    }

    async overwriteAllStubs(imposterId, stubs = []) {
        const imposter = await this.getImposter(imposterId);
        if (!imposter) {
            return;
        }

        if (Array.isArray(imposter.stubs)) {
            const deleteStubPromises = imposter.stubs.map(stub => this._deleteStub(imposterId, stub.meta.id));
            await Promise.all(deleteStubPromises);
        }

        const stubDefinitions = [];
        for (let i = 0; i < stubs.length; i += 1) {
            stubDefinitions.push(await this.saveStubMetaAndResponses(imposterId, stubs[i]));
        }

        imposter.stubs = stubDefinitions;
        await this.saveImposter(imposter);
    }

    async addResponse(imposterId, stubId, response) {

        const meta = await this._getMeta(imposterId, stubId);
        if (!meta) {
            return null;
        }

        const responseId = await this._saveResponse(response);
        const responseIndex = meta.responseIds.length;
        meta.responseIds.push(responseId);
        for (let repeats = 0; repeats < repeatsFor(response); repeats += 1) {
            meta.orderWithRepeats.push(responseIndex);
        }
        await this._saveMeta(imposterId, stubId, meta);
        return meta;
    }

    async getNextResponse(imposterId, stubId) {
        const meta = await this._getMeta(imposterId, stubId);

        if (!meta) {
            throw new Error(`GET_NEXT_RESPONSE_ERROR, no meta for stubId ${ stubId }`);
        }

        const maxIndex = meta.orderWithRepeats.length;
        const responseIndex = meta.orderWithRepeats[meta.nextIndex % maxIndex];

        const responseId = meta.responseIds[responseIndex];
        meta.nextIndex = (meta.nextIndex + 1) % maxIndex;

        await this._saveMeta(imposterId, stubId, meta);

        const responseConfig = await this._getResponse(responseId);
        return responseConfig;
    }

    async saveStubMetaAndResponses(imposterId, stub) {
        if (!stub) {
            return;
        }
        const stubId = this._generateId('stub');
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
            const responseId = await this._saveResponse(responses[i]);

            meta.responseIds.push(responseId);

            for (let repeats = 0; repeats < repeatsFor(responses[i]); repeats += 1) {
                meta.orderWithRepeats.push(i);
            }
        }
        await this._saveMeta(imposterId, stubId, meta);

        return stubDefinition;
    }
}

ImposterStorage.CHANNELS = CHANNELS;

module.exports = ImposterStorage;
