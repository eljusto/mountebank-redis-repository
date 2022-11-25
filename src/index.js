'use strict';

const fs = require('fs');

const ImposterStorage = require('./ImposterStorage');
const stubsRepository = require('./stubRepository');

function create(config, logger) {
    let appProtocols;

    const imposterFns = {};
    let repoConfig = {};
    if (config.impostersRepositoryConfig) {
        try {
            repoConfig = JSON.parse(fs.readFileSync(config.impostersRepositoryConfig));
        } catch (e) {
            logger.error(`Can't read impostersRepositoryConfig from ${ config.impostersRepositoryConfig }.`, e);
        }
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
    function addReference(imposter) {
        if (config.debug) {
            logger.info('addReference');
        }
        const id = String(imposter.port);
        imposterFns[id] = {};
        Object.keys(imposter).forEach(key => {
            if (typeof imposter[key] === 'function') {
                imposterFns[id][key] = imposter[key];
            }
        });
    }

    function rehydrate(imposter) {
        if (config.debug) {
            logger.info('rehydrate');
        }
        const id = String(imposter.port);
        Object.keys(imposterFns[id]).forEach(key => {
            imposter[key] = imposterFns[id][key];
        });
    }

    /**
     * Adds a new imposter
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Object} imposter - the imposter to add
     * @returns {Object} - the promise
     */
    async function add(imposter) {
        try {
            const imposterConfig = imposter.creationRequest;
            const stubs = imposterConfig.stubs || [];

            const saveStubs = stubs.map(stub => imposterStorage.saveStubMetaAndResponses(imposter.port, stub));
            const stubDefinitions = await Promise.all(saveStubs);

            delete imposterConfig.requests;
            imposterConfig.port = imposter.port;
            imposterConfig.stubs = stubDefinitions;

            await imposterStorage.addImposter(imposterConfig);

            addReference(imposter);

            return imposter;
        } catch (e) {
            logger.error('ADD_STUB_ERROR', e);
            return null;
        }
    }

    /**
     * Gets the imposter by id
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Number} id - the id of the imposter (e.g. the port)
     * @returns {Object} - the promise resolving to the imposter
     */
    async function get(id) {
        try {
            const imposter = await imposterStorage.getImposter(id);
            if (!imposter) {
                return null;
            }
            imposter.stubs = await stubsFor(id).toJSON();
            rehydrate(imposter);

            return imposter;
        } catch (e) {
            logger.error('GET_STUB_ERROR', e);
            return Promise.reject(e);
        }
    }

    /**
     * Gets all imposters
     * @memberOf module:models/redisBackedImpostersRepository#
     * @returns {Object} - all imposters keyed by port
     */
    async function all() {
        if (imposterStorage.dbClient.isClosed()) {
            return [];
        }
        try {
            return Promise.all(Object.keys(imposterFns).map(get));
        } catch (e) {
            logger.error('GET_ALL_ERROR', e);
        }
    }

    /**
     * Returns whether an imposter at the given id exists or not
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Number} id - the id (e.g. the port)
     * @returns {boolean}
     */
    async function exists(id) {
        return Object.keys(imposterFns).indexOf(String(id)) >= 0;
    }

    async function shutdown(id) {
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
            logger.error('SHUTDOWN_ERROR', e);
        }
    }

    /**
     * Deletes the imposter at the given id
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Number} id - the id (e.g. the port)
     * @returns {Object} - the deletion promise
     */
    async function del(id) {
        try {
            const imposter = await get(id);
            const cleanup = [ shutdown(id) ];

            if (imposter !== null) {
                cleanup.push(imposterStorage.deleteImposter(id));
            }

            await Promise.all(cleanup);
            return imposter;
        } catch (e) {
            logger.error('DELETE_STUB_ERROR', e);
            return Promise.reject(e);
        }
    }

    /**
     * Deletes all imposters; used during testing
     * @memberOf module:models/redisBackedImpostersRepository#
     */
    async function stopAll() {

        try {
            await Promise.all(Object.keys(imposterFns).map(shutdown));
            return await imposterStorage.stop();
        } catch (e) {
            logger.error('STOP_ALL_ERROR', e);
        }
    }

    /**
     * Deletes all imposters synchronously; used during shutdown
     * @memberOf module:models/redisBackedImpostersRepository#
     */
    async function stopAllSync() {
        try {
            await Promise.all(Object.keys(imposterFns).map(shutdown));

            // FIXME need to make it synchronic
            return await imposterStorage.stop();
        } catch (e) {
            logger.error('STOP_ALL_SYNC_ERROR', e);
        }
    }

    /**
     * Deletes all imposters
     * @memberOf module:models/redisBackedImpostersRepository#
     * @returns {Object} - the deletion promise
     */
    async function deleteAll() {
        const ids = Object.keys(imposterFns);
        try {
            await Promise.all(ids.map(shutdown));
            await imposterStorage.deleteAllImposters();
        } catch (e) {
            logger.error('DELETE_ALL_ERROR', e, ids);
        }
    }

    async function loadImposter(imposterConfig, protocols) {
        const protocol = protocols[imposterConfig.protocol];

        if (protocol) {
            if (config.debug) {
                logger.info(`Loading ${ imposterConfig.protocol }:${ imposterConfig.port } from db`);
            }
            try {
                const imposter = await protocol.createImposterFrom(imposterConfig);
                addReference(imposter);
            } catch (e) {
                logger.error(`Cannot load imposter ${ imposterConfig.port }; ${ e }`);
            }
        } else {
            logger.error(`Cannot load imposter ${ imposterConfig.port }; no protocol loaded for ${ config.protocol }`);
        }
    }

    function onImposterChange(imposterId) {
        const imposter = imposterFns[imposterId];

        if (imposter) {
            shutdown(imposterId).then(() => {
                imposterStorage.getImposter(imposterId).then(imposterConfig => {
                    loadImposter(imposterConfig, appProtocols).then(() => {
                        if (config.debug) {
                            logger.info(`Imposter ${ imposterId } reloaded`);
                        }
                    });
                });
            });
        } else {
            imposterStorage.getImposter(imposterId).then(imposterConfig => {
                loadImposter(imposterConfig, appProtocols).then(() => {
                    if (config.debug) {
                        logger.info(`Imposter ${ imposterId } reloaded`);
                    }
                });

            });
        }
    }

    function onImposterDelete(imposterId) {
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
                logger.info('All imposters have stopped. ids: ', ids);
            }
        });
    }

    /**
     * Loads all saved imposters at startup
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Object} protocols - The protocol map, used to instantiate a new instance
     * @returns {Object} - a promise
     */
    async function loadAll(protocols) {
        appProtocols = protocols;

        try {
            await imposterStorage.start();
            logger.info('Connection done. Going to load all imposters');
            const allImposters = await imposterStorage.getAllImposters();
            const promises = allImposters.map(async imposter => loadImposter(imposter, protocols));
            await Promise.all(promises);
            await imposterStorage.subscribe(ImposterStorage.CHANNELS.imposter_change, onImposterChange);
            await imposterStorage.subscribe(ImposterStorage.CHANNELS.imposter_delete, onImposterDelete);
            await imposterStorage.subscribe(ImposterStorage.CHANNELS.all_imposters_delete, onAllImpostersDelete);
        } catch (e) {
            logger.error('LOAD_ALL_ERROR', e);
        }
    }

    function stubsFor(id) {
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

module.exports = { create };
