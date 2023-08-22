import RedisClient from './RedisClient';
import type { ChannelCallback } from './RedisClient';
import errors from 'mountebank/src/util/errors';
import type { Stub, StubMatch, StubMeta, MbRequest, MbResponse, ImposterId, ImposterConfig, StubDefinition, Logger } from './types';
import type { RedisOptions } from 'ioredis';

export enum CHANNEL_IDS {
    imposter_change = 'imposter_change',
    imposter_delete = 'imposter_delete',
    all_imposters_delete = 'all_imposters_delete',
}

type CHANNELS = {
    [ CHANNEL_IDS.imposter_change ]: ImposterId;
    [ CHANNEL_IDS.imposter_delete ]: ImposterId;
    [ CHANNEL_IDS.all_imposters_delete ]: void;
}

enum ENTITY_IDS {
    imposter ='imposter',
    matchList ='matches',
    meta = 'meta',
    requestCounter ='requestCounter',
    requestList = 'requests',
    response = 'response',
    stub = 'stub',
}

type ENTITIES = {
    [ ENTITY_IDS.imposter ]: ImposterConfig;
    [ ENTITY_IDS.matchList ]: Array<StubMatch>;
    [ ENTITY_IDS.meta ]: StubMeta;
    [ ENTITY_IDS.requestCounter ]: number;
    [ ENTITY_IDS.requestList ]: Array<MbRequest>;
    [ ENTITY_IDS.response ]: MbResponse;
    [ ENTITY_IDS.stub ]: Stub;
};

function repeatsFor(response: MbResponse) {
    return response.repeat || 1;
}

export class ImposterStorage {
    dbClient: RedisClient<CHANNELS, ENTITIES>;
    _logger: Logger;
    _idCounter = 0;

    constructor(options: RedisOptions, logger: Logger) {
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

    _generateId(prefix: ENTITY_IDS | 'stub') {
        const epoch = new Date().valueOf();
        this._idCounter += 1;
        return `${ prefix }-${ epoch }-${ process.pid }-${ this._idCounter }`;
    }

    async saveImposter(imposter: ImposterConfig) {
        try {
            const res = await this.dbClient.setObject(ENTITY_IDS.imposter, imposter.port, imposter);
            this.dbClient.publish(CHANNEL_IDS.imposter_change, imposter.port);
            return res;
        } catch (e) {
            this._logger.error(e, 'SAVE_IMPOSTER_ERROR');
            return null;
        }
    }

    async subscribe<T extends CHANNEL_IDS>(channel: T, callbackFn: ChannelCallback<CHANNELS[T]>) {
        try {
            return await this.dbClient.subscribe<T>(channel, callbackFn);
        } catch (e) {
            this._logger.error(e, 'SUBSCRIBE_ERROR');
        }
    }

    async unsubscribe(channel: CHANNEL_IDS) {
        try {
            return await this.dbClient.unsubscribe(channel);
        } catch (e) {
            this._logger.error(e, 'UNSUBSCRIBE_ERROR');
        }
    }

    async getAllImposters(): Promise<Array<ImposterConfig>> {
        try {
            return await this.dbClient.getAllObjects(ENTITY_IDS.imposter) || [];
        } catch (e) {
            this._logger.error(e, 'GET_ALL_IMPOSTERS_ERROR');
            return [];
        }
    }

    async getImposter(imposterId: ImposterId): Promise<ImposterConfig | null> {
        try {
            const res = await this.dbClient.getObject<ENTITY_IDS.imposter>(ENTITY_IDS.imposter, imposterId);
            return res;
        } catch (e) {
            this._logger.error(e, 'GET_IMPOSTER_ERROR');
            return null;
        }
    }

    async deleteImposter(imposterId: ImposterId) {
        try {
            const imposter = await this.dbClient.getObject<ENTITY_IDS.imposter>(ENTITY_IDS.imposter, imposterId);
            if (imposter === null) {
                return;
            }
            const stubIds = imposter.stubs.map(stub => stub.meta.id);

            const deleteStubPromises = stubIds.map((stubId: string) => this._deleteStub(imposterId, stubId));
            await Promise.all(deleteStubPromises);

            const res = await this.dbClient.delObject(ENTITY_IDS.imposter, imposterId);
            this.deleteRequests(imposterId);

            this.dbClient.publish<CHANNEL_IDS.imposter_delete>(CHANNEL_IDS.imposter_delete, imposterId);

            return res;
        } catch (e) {
            this._logger.error(e, 'DELETE_IMPOSTER_ERROR');
            return null;
        }
    }

    async getStubs(imposterId: ImposterId): Promise<Array<StubDefinition>> {
        const imposter = await this.getImposter(imposterId);
        if (!imposter || !Array.isArray(imposter.stubs)) {
            return [];
        }

        return imposter.stubs;
    }

    async deleteAllImposters() {
        try {
            await this.dbClient.delAllObjects(ENTITY_IDS.imposter);
            await this.dbClient.delAllObjects(ENTITY_IDS.matchList);
            await this.dbClient.delAllObjects(ENTITY_IDS.meta);
            await this.dbClient.delAllObjects(ENTITY_IDS.requestCounter);
            await this.dbClient.delAllObjects(ENTITY_IDS.requestList);
            await this.dbClient.delAllObjects(ENTITY_IDS.response);

            this.dbClient.publish<CHANNEL_IDS.all_imposters_delete>(CHANNEL_IDS.all_imposters_delete, undefined);
        } catch (e) {
            this._logger.error(e, 'DELETE_ALL_IMPOSTERS_ERROR');
            return null;
        }
    }

    async addRequest(imposterId: ImposterId, request: MbRequest) {
        try {
            return await this.dbClient.pushToObject<ENTITY_IDS.requestList>(ENTITY_IDS.requestList, imposterId, request);
        } catch (e) {
            this._logger.error(e, 'ADD_REQUEST_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteRequests(imposterId: ImposterId) {
        try {
            return await this.dbClient.delObject(ENTITY_IDS.requestList, imposterId);
        } catch (e) {
            this._logger.error(e, 'DELETE_REQUESTS_ERROR');
            return Promise.reject(e);
        }
    }

    async getRequests(imposterId: ImposterId): Promise<Array<MbRequest>> {
        try {
            return await this.dbClient.getObject<ENTITY_IDS.requestList>(ENTITY_IDS.requestList, imposterId) || [];
        } catch (e) {
            this._logger.error(e, 'GET_REQUESTS_ERROR');
            return Promise.reject(e);
        }
    }

    async getResponses(imposterId: ImposterId, stubId: string): Promise<Array<MbResponse>> {
        const meta = await this._getMeta(imposterId, stubId);
        if (!meta || !meta.responseIds) {
            return [];
        }

        const responsePromises = meta.responseIds.map(responseId => this._getResponse(responseId));
        const responses = await Promise.all(responsePromises);
        return responses.filter(Boolean) as unknown as Array<MbResponse>;
    }

    async _getResponse(responseId: string): Promise<MbResponse | null> {
        try {
            return await this.dbClient.getObject(ENTITY_IDS.response, responseId);
        } catch (e) {
            this._logger.error(e, 'GET_RESPONSE_ERROR');
            return Promise.reject(e);
        }
    }

    async _saveResponse(response: MbResponse) {
        const responseId = this._generateId(ENTITY_IDS.response);
        try {
            await this.dbClient.setObject(ENTITY_IDS.response, responseId, response);
            return responseId;
        } catch (e) {
            this._logger.error(e, 'SAVE_RESPONSE_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteResponse(responseId: string) {
        try {
            return await this.dbClient.delObject(ENTITY_IDS.response, responseId);
        } catch (e) {
            this._logger.error(e, 'DELETE_RESPONSE_ERROR');
            return Promise.reject(e);
        }
    }

    async _deleteMeta(imposterId: ImposterId, stubId: string) {
        try {
            const res = await this.dbClient.delObject(ENTITY_IDS.meta, [ imposterId, stubId ].join(':'));
            return res;
        } catch (e) {
            this._logger.error(e, 'DELETE_META_ERROR');
            return Promise.reject(e);
        }
    }

    async _saveMeta(imposterId: ImposterId, stubId: string, meta: StubMeta) {
        try {
            const res = await this.dbClient.setObject(ENTITY_IDS.meta, [ imposterId, stubId ].join(':'), meta);
            return res;
        } catch (e) {
            this._logger.error(e, 'SET_META_ERROR');
            return Promise.reject(e);
        }
    }

    async _getMeta(imposterId: ImposterId, stubId: string): Promise<StubMeta | null> {
        try {
            const res = await this.dbClient.getObject<ENTITY_IDS.meta>(ENTITY_IDS.meta, [ imposterId, stubId ].join(':'));
            return res;
        } catch (e) {
            this._logger.error(e, 'GET_META_ERROR');
            return Promise.reject(e);
        }
    }

    async addMatch(stubId: string, match: StubMatch): Promise<number | null> {
        try {
            return await this.dbClient.pushToObject(ENTITY_IDS.matchList, stubId, match);
        } catch (e) {
            this._logger.error(e, 'ADD_MATCH_ERROR');
            return Promise.reject(e);
        }
    }

    async getMatches(stubId: string): Promise<Array<StubMatch> | null> {

        try {
            return await this.dbClient.getObject<ENTITY_IDS.matchList>(ENTITY_IDS.matchList, stubId);
        } catch (e) {
            this._logger.error(e, 'GET_MATCHES_ERROR');
            return Promise.reject(e);
        }
    }

    async deleteMatches(stubId: string) {
        try {
            return await this.dbClient.delObject(ENTITY_IDS.matchList, stubId);
        } catch (e) {
            this._logger.error(e, 'DELETE_MATCHES_ERROR');
            return Promise.reject(e);
        }
    }

    async getRequestCounter(imposterId: ImposterId) {
        try {
            return await this.dbClient.getObject(ENTITY_IDS.requestCounter, imposterId);
        } catch (e) {
            this._logger.error(e, 'GET_REQUEST_COUNTER_ERROR');
            return Promise.reject(e);
        }
    }

    async incrementRequestCounter(imposterId: ImposterId) {
        try {
            await this.dbClient.incrementCounter(ENTITY_IDS.requestCounter, imposterId);
            const val = await this.dbClient.getObject(ENTITY_IDS.requestCounter, imposterId);
            return val;
        } catch (e) {
            this._logger.error(e, 'INCREMENT_REQUEST_COUNTER_ERROR');
            return Promise.reject(e);
        }
    }

    async addStub(imposterId: ImposterId, stub: Stub, index?: number) {
        const imposter = await this.getImposter(imposterId);
        if (!imposter) {
            return;
        }

        const stubDefinition = await this.saveStubMetaAndResponses(imposterId, stub);
        if (!stubDefinition) {
            return;
        }
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

    async deleteStubAtIndex(imposterId: ImposterId, index: number) {
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

    async _deleteStub(imposterId: ImposterId, stubId: string) {
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

    async overwriteAllStubs(imposterId: ImposterId, stubs: Array<Stub> = []) {
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
            const stubDefinition = await this.saveStubMetaAndResponses(imposterId, stubs[i]);
            if (stubDefinition) {
                stubDefinitions.push(stubDefinition);
            }
        }

        imposter.stubs = stubDefinitions;
        await this.saveImposter(imposter);
    }

    async addResponse(imposterId: ImposterId, stubId: string, response: MbResponse) {

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

    async getNextResponse(imposterId: ImposterId, stubId: string): Promise<MbResponse | null> {
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

    async saveStubMetaAndResponses(imposterId: ImposterId, stub: Stub): Promise<StubDefinition | undefined> {
        if (!stub) {
            return;
        }
        const stubId = this._generateId('stub');
        const stubDefinition: StubDefinition = {
            meta: { id: stubId },
        };
        const meta: StubMeta = {
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

export default ImposterStorage;
