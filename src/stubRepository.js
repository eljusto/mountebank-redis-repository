'use strict';

const clone = require('./clone');
const wrap = require('./wrap');

function stubRepository(imposterId, imposterStorage, logger) {
    /**
     * Returns the number of stubs for the imposter
     * @memberOf module:models/redisBackedImpostersRepository#
     * @returns {Object} - the promise
     */
    async function count() {
        const stubs = await imposterStorage.getStubs(imposterId);
        return stubs.length;
    }

    /**
     * Returns the first stub whose preidicates matches the filter
     * @memberOf module:models/redisBackedImpostersRepository#
     * @param {Function} filter - the filter function
     * @param {Number} startIndex - the index to to start searching
     * @returns {Object} - the promise
     */
    async function first(filter, startIndex = 0) {
        let stubs;
        try {
            stubs = await imposterStorage.getStubs(imposterId);
        } catch (e) {
            logger.error('STUB_FIRST_ERROR', e);
            stubs = [];
        }

        for (let i = startIndex; i < stubs.length; i += 1) {
            if (filter(stubs[i].predicates || [])) {
                return { success: true, stub: wrap(stubs[i], imposterId, imposterStorage) };
            }
        }
        return { success: false, stub: wrap() };
    }

    /**
     * Adds a new stub to imposter
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} stub - the stub to add
     * @returns {Object} - the promise
     */
    async function add(stub) {
        return await imposterStorage.addStub(imposterId, stub);
    }

    /**
     * Inserts a new stub at the given index
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} stub - the stub to add
     * @param {Number} index - the index to insert the new stub at
     * @returns {Object} - the promise
     */
    async function insertAtIndex(stub, index) {
        return await imposterStorage.addStub(imposterId, stub, index);
    }

    /**
     * Deletes the stub at the given index
     * @memberOf module:models/redisImpostersRepository#
     * @param {Number} index - the index of the stub to delete
     * @returns {Object} - the promise
     */
    async function deleteAtIndex(index) {
        await imposterStorage.deleteStubAtIndex(imposterId, index);
    }

    /**
     * Overwrites all stubs with a new list
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} newStubs - the new list of stubs
     * @returns {Object} - the promise
     */
    async function overwriteAll(newStubs) {
        await imposterStorage.overwriteAllStubs(imposterId, newStubs);
    }

    /**
     * Overwrites the stub at the given index
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} stub - the new stub
     * @param {Number} index - the index of the stub to overwrite
     * @returns {Object} - the promise
     */
    async function overwriteAtIndex(stub, index) {
        await deleteAtIndex(index);
        await insertAtIndex(stub, index);
    }

    async function loadResponses(stub) {
        if (!stub) {
            throw new Error('STUB_LOAD_RESPONSES_ERROR, no stub');
        }
        if (!stub.meta?.id) {
            return [];
        }
        try {
            const meta = await imposterStorage.getMeta(imposterId, stub.meta.id);
            if (!meta || !meta.responseIds) {
                return [];
            }

            const responsePromises = meta.responseIds.map(id => imposterStorage.getResponse(id));
            const res = await Promise.all(responsePromises);
            return res;
        } catch (e) {
            logger.error('STUB_LOAD_RESPONSES_ERROR', e);
            return [];
        }
    }

    async function loadMatches(stub) {
        if (!stub.meta?.id) {
            return [];
        }
        return await imposterStorage.getMatches(stub.meta.id) || [];
    }

    /**
     * Returns a JSON-convertible representation
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} options - The formatting options
     * @param {Boolean} options.debug - If true, includes debug information
     * @returns {Object} - the promise resolving to the JSON object
     */
    async function toJSON(options = {}) {
        const imposter = await imposterStorage.getImposter(imposterId);
        if (!imposter) {
            if (options.debug) {
                logger.warn('Can\'t find imposter with id ', imposterId);
            }
            return [];
        }

        if (!Array.isArray(imposter.stubs)) {
            imposter.stubs = [];
        }

        try {
            const responsePromises = imposter.stubs.map(loadResponses);
            const stubResponses = await Promise.all(responsePromises);
            const debugPromises = options.debug ? imposter.stubs.map(loadMatches) : [];
            const matches = await Promise.all(debugPromises);

            imposter.stubs.forEach((stub, index) => {
                stub.responses = stubResponses[index];
                if (options.debug && matches[index].length > 0) {
                    stub.matches = matches[index];
                }
                delete stub.meta;
            });

            return imposter.stubs;
        } catch (e) {
            logger.error('STUB_TO_JSON_ERROR', e);
        }
    }

    function isRecordedResponse(response) {
        return response.is && typeof response.is._proxyResponseTime === 'number';
    }

    /**
     * Removes the saved proxy responses
     * @memberOf module:models/redisImpostersRepository#
     * @returns {Object} - Promise
     */
    async function deleteSavedProxyResponses() {
        const allStubs = await toJSON();
        allStubs.forEach(stub => {
            stub.responses = stub.responses.filter(response => !isRecordedResponse(response));
        });

        const nonProxyStubs = allStubs.filter(stub => stub.responses.length > 0);
        return overwriteAll(nonProxyStubs);
    }

    /**
     * Adds a request for the imposter
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} request - the request
     * @returns {Object} - the promise
     */
    async function addRequest(request) {
        const recordedRequest = clone(request);
        recordedRequest.timestamp = new Date().toJSON();
        const res = await imposterStorage.addRequest(imposterId, recordedRequest);
        return res;
    }

    /**
     * Returns the saved requests for the imposter
     * @memberOf module:models/redisImpostersRepository#
     * @returns {Object} - the promise resolving to the array of requests
     */
    async function loadRequests() {
        const res = await imposterStorage.getRequests(imposterId);
        return res;
    }

    async function getNumberOfRequests() {
        const res = await imposterStorage.getRequestCounter(imposterId);
        return res || 0;
    }

    /**
     * Deletes the requests directory for an imposter
     * @memberOf module:models/redisImpostersRepository#
     * @returns {Object} - Promise
     */
    async function deleteSavedRequests() {
        return await imposterStorage.deleteRequests(imposterId);
    }

    return {
        count,
        first,
        add,
        insertAtIndex,
        overwriteAll,
        overwriteAtIndex,
        deleteAtIndex,
        toJSON,
        deleteSavedProxyResponses,
        addRequest,
        loadRequests,
        deleteSavedRequests,
        getNumberOfRequests,
    };
}

module.exports = stubRepository;
