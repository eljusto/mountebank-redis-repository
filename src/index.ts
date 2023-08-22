import { readFileSync } from 'fs';
import type { RedisOptions } from 'ioredis';

import ImposterStorage, { CHANNEL_IDS } from './ImposterStorage';
import stubsRepository from './stubRepository';

import type { Imposter, ImposterConfig, ImposterFunctions, ImposterId, IncomingImposter, Logger, OutgoingImposter, StubDefinition } from './types';

const DEFAULT_REPO_CONFIG = {
    redisOptions: {
        host: 'localhost',
        port: 6379,
    },
};

interface RedisMbConfig {
    redisOptions: RedisOptions;
}

interface MbConfig {
    debug?: boolean;
    impostersRepositoryConfig?: RedisMbConfig | string;
}

interface MbProtocol {
    createImposterFrom: (imposterConfig: ImposterConfig) => Promise<IncomingImposter>;
}

function getRedisRepoConfig(config: MbConfig): RedisMbConfig {
    if (!config.impostersRepositoryConfig) {
        return DEFAULT_REPO_CONFIG;
    }

    if (typeof config.impostersRepositoryConfig === 'object') {
        return config.impostersRepositoryConfig;
    }
    try {
        return JSON.parse(readFileSync(config.impostersRepositoryConfig) as unknown as string);
    } catch (e) {
        throw new Error(`Can't read impostersRepositoryConfig from ${ config.impostersRepositoryConfig }: ${ e }`);
    }
}

function create(config: MbConfig, logger: Logger) {
    let appProtocols: Record<string, MbProtocol>;

    const imposterFns: Record<string, Partial<ImposterFunctions>> = {};
    let repoConfig: RedisMbConfig;
    try {
        repoConfig = getRedisRepoConfig(config);
    } catch (e) {
        logger.error(e, 'READ_CONFIG_ERROR');
        return;
    }

    const imposterStorage = new ImposterStorage(repoConfig.redisOptions, logger);

    /**
     * Saves a reference to the imposter so that the functions
     * (which can't be persisted) can be rehydrated to a loaded imposter.
     * This means that any data in the function closures will be held in
     * memory.
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Object} imposter - the imposter
     */
    function addReference(imposter: IncomingImposter) {
        const id = String(imposter.port);
        imposterFns[id] = Object.fromEntries(
            Object.keys(imposter)
                .filter(key => {
                    return (typeof imposter[key as keyof Imposter] === 'function');
                })
                .map(key => {
                    return [ key as keyof ImposterFunctions, imposter[key as keyof ImposterFunctions] ];
                }));
    }

    function rehydrate(imposterConfig: ImposterConfig) {
        const newImposterFns: Partial<ImposterFunctions> = {};
        const id = String(imposterConfig.port);
        Object.keys(imposterFns[id]).forEach((key) => {
            newImposterFns[key as keyof ImposterFunctions] = imposterFns[id][key as keyof ImposterFunctions];
        });

        return { ...newImposterFns as ImposterFunctions, ...imposterConfig };
    }

    /**
     * Adds a new imposter
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Object} imposter - the imposter to add
     * @returns {Object} - the promise
     */
    async function add(imposter: IncomingImposter): Promise<Imposter | null> {
        try {
            const stubs = imposter.creationRequest.stubs || [];

            const saveStubs = stubs.map(stub => imposterStorage.saveStubMetaAndResponses(imposter.port, stub));
            const stubDefinitions = await Promise.all(saveStubs);

            const { requests, ...imposterConfig } = {
                ...imposter.creationRequest,
                stubs: stubDefinitions.filter(Boolean) as unknown as Array<StubDefinition>,
            };

            await imposterStorage.saveImposter(imposterConfig);

            addReference(imposter);

            return imposter;
        } catch (e) {
            logger.error(e, 'ADD_STUB_ERROR');
            return null;
        }
    }

    /**
     * Gets the imposter by id
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Number} id - the id of the imposter (e.g. the port)
     * @returns {Object} - the promise resolving to the imposter
     */
    async function get(id: ImposterId): Promise<OutgoingImposter | null> {
        try {
            const imposter = await imposterStorage.getImposter(id);
            if (!imposter) {
                return null;
            }
            return {
                ...rehydrate(imposter),
                stubs: await stubsFor(id).toJSON(),
            } as OutgoingImposter;

        } catch (e) {
            logger.error(e, 'GET_STUB_ERROR');
            return Promise.reject(e);
        }
    }

    /**
     * Gets all imposters
     * @memberOf module:models/redisBackedImpostersRepository#
     * @returns {Object} - all imposters keyed by port
     */
    async function all(): Promise<Array<OutgoingImposter | null> | undefined> {
        if (imposterStorage.dbClient.isClosed()) {
            return [];
        }
        try {
            return Promise.all(Object.keys(imposterFns).map((key) => get(Number(key))));
        } catch (e) {
            logger.error(e, 'GET_ALL_ERROR');
        }
    }

    /**
     * Returns whether an imposter at the given id exists or not
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Number} id - the id (e.g. the port)
     * @returns {boolean}
     */
    async function exists(id: ImposterId): Promise<boolean> {
        return Object.keys(imposterFns).indexOf(String(id)) >= 0;
    }

    async function shutdown(id: ImposterId | string): Promise<void> {
        if (typeof imposterFns[String(id)] === 'undefined') {
            return;
        }

        try {
            const stop = imposterFns[String(id)].stop;
            delete imposterFns[String(id)];
            if (stop) {
                await stop();
            }
        } catch (e) {
            logger.error(e, 'SHUTDOWN_ERROR');
        }
    }

    /**
     * Deletes the imposter at the given id
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Number} id - the id (e.g. the port)
     * @returns {Object} - the deletion promise
     */
    async function del(id: ImposterId): Promise<OutgoingImposter | null> {
        try {
            const imposter = await get(id);
            const cleanup: Array<Promise<unknown>> = [ shutdown(id) ];

            if (imposter !== null) {
                cleanup.push(imposterStorage.deleteImposter(id));
            }

            await Promise.all(cleanup);
            return imposter;
        } catch (e) {
            logger.error(e, 'DELETE_STUB_ERROR');
            return Promise.reject(e);
        }
    }

    /**
     * Deletes all imposters; used during testing
     * @memberOf module:models/redisBackedImpostersRepository#
     */
    async function stopAll() {

        try {
            const shutdownFns = Object.keys(imposterFns).map(shutdown);
            await Promise.all(shutdownFns);
            await Promise.all([
                await imposterStorage.unsubscribe(CHANNEL_IDS.imposter_change),
                await imposterStorage.unsubscribe(CHANNEL_IDS.imposter_delete),
                await imposterStorage.unsubscribe(CHANNEL_IDS.all_imposters_delete),
            ]);
            await imposterStorage.stop();
        } catch (e) {
            logger.error(e, 'STOP_ALL_ERROR');
        }
    }

    /**
     * Deletes all imposters synchronously; used during shutdown
     * @memberOf module:models/redisBackedImpostersRepository#
     */
    async function stopAllSync() {
        // FIXME: make it sync
        return stopAll();
    }

    /**
     * Deletes all imposters
     * @memberOf module:models/redisBackedImpostersRepository#
     * @returns {Object} - the deletion promise
     */
    async function deleteAll(): Promise<void> {
        const ids = Object.keys(imposterFns);
        try {
            await Promise.all(ids.map(shutdown));
            await imposterStorage.deleteAllImposters();
        } catch (e) {
            logger.error(e, 'DELETE_ALL_ERROR');
        }
    }

    async function loadImposter(imposterConfig: ImposterConfig, protocols: Record<string, MbProtocol>): Promise<Imposter | undefined> {
        const protocol = protocols[imposterConfig.protocol];

        if (protocol) {
            if (config.debug) {
                logger.info(`Loading ${ imposterConfig.protocol }:${ imposterConfig.port } from db`);
            }
            try {
                const imposter = await protocol.createImposterFrom(imposterConfig);
                addReference(imposter);
                return imposter;
            } catch (e) {
                logger.error(e, `Cannot load imposter ${ imposterConfig.port }`);
            }
        } else {
            logger.error(`Cannot load imposter ${ imposterConfig.port }; no protocol loaded for ${ imposterConfig.protocol }`);
        }
    }

    function onImposterChange(imposterId: ImposterId) {
        const imposter = imposterFns[imposterId];

        if (imposter) {
            shutdown(imposterId).then(() => {
                imposterStorage.getImposter(imposterId).then(imposterConfig => {
                    if (!imposterConfig) {
                        return;
                    }
                    loadImposter(imposterConfig, appProtocols).then(() => {
                        if (config.debug) {
                            logger.info(`Imposter ${ imposterId } reloaded`);
                        }
                    });
                });
            });
        } else {
            imposterStorage.getImposter(imposterId).then(imposterConfig => {
                if (!imposterConfig) {
                    return;
                }
                loadImposter(imposterConfig, appProtocols).then(() => {
                    if (config.debug) {
                        logger.info(`Imposter ${ imposterId } reloaded`);
                    }
                });

            });
        }
    }

    function onImposterDelete(imposterId: ImposterId) {
        const imposter = imposterFns[imposterId];

        if (imposter) {
            shutdown(imposterId).then(() => {
                if (config.debug) {
                    logger.info(`Imposter ${ imposterId } stopped`);
                }
            });
        }
    }

    function onAllImpostersDelete() {
        const ids = Object.keys(imposterFns);
        Promise.all(Object.keys(imposterFns).map(shutdown)).then(() => {
            if (config.debug) {
                logger.info(`All imposters have stopped. ids: ${ ids }`);
            }
        });
    }

    /**
     * Loads all saved imposters at startup
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Object} protocols - The protocol map, used to instantiate a new instance
     * @returns {Object} - a promise
     */
    async function loadAll(protocols: Record<string, MbProtocol>): Promise<void> {
        appProtocols = protocols;

        try {
            await imposterStorage.start();
            logger.info('Connection done. Going to load all imposters');
            const allImposters = await imposterStorage.getAllImposters();

            const promises = allImposters.map(imposter => loadImposter(imposter, protocols));
            await Promise.all(promises);
            await Promise.all([
                await imposterStorage.subscribe<CHANNEL_IDS.imposter_change>(CHANNEL_IDS.imposter_change, onImposterChange),
                await imposterStorage.subscribe<CHANNEL_IDS.imposter_delete>(CHANNEL_IDS.imposter_delete, onImposterDelete),
                await imposterStorage.subscribe<CHANNEL_IDS.all_imposters_delete>(CHANNEL_IDS.all_imposters_delete, onAllImpostersDelete),
            ]);
        } catch (e) {
            logger.error(e, 'LOAD_ALL_ERROR');
        }
    }

    function stubsFor(id: ImposterId) {
        return stubsRepository(id, imposterStorage, logger);
    }

    return {
        add,
        all,
        del,
        deleteAll,
        exists,
        get,
        loadAll,
        stopAll,
        stopAllSync,
        stubsFor,
    };
}

export default { create };
