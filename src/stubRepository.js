'use strict';

const clone = require('./clone');
const wrap = require('./wrap');

function stubRepository(imposterId, imposterStorage, logger) {
    const _logger = logger.child({ _context: 'stub_repository' });

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
            _logger.error(e, 'STUB_FIRST_ERROR');
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
                _logger.warn(`Can't find imposter with id ${ imposterId }`);
            }
            return [];
        }

        if (!Array.isArray(imposter.stubs)) {
            return [];
        }

        try {
            for (let i = 0; i < imposter.stubs.length; i++) {
                const stub = imposter.stubs[i];
                stub.responses = await imposterStorage.getResponses(imposterId, stub.meta.id);
                if (options.debug) {
                    stub.matches = await imposterStorage.getMatches(stub.meta.id);
                }
                delete stub.meta;
            }

            return imposter.stubs;
        } catch (e) {
            _logger.error(e, 'STUB_TO_JSON_ERROR');
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
        return await imposterStorage.addRequest(imposterId, recordedRequest);
    }

    /**
     * Returns the saved requests for the imposter
     * @memberOf module:models/redisImpostersRepository#
     * @returns {Object} - the promise resolving to the array of requests
     */
    async function loadRequests() {
        return await imposterStorage.getRequests(imposterId);
    }

    async function getNumberOfRequests() {
        return await imposterStorage.getRequestCounter(imposterId) || 0;
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
