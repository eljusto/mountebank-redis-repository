import wrap from './wrap';

import type {
    Stub,
    MbRequest,
    RecordedMbRequest,
    MbResponse,
    MbOptions,
    ImposterId,
    Logger,
    StubDefinition,
    StubFilterFunction,
    WrappedStub,
    OutgoingStub,
} from './types';
import type ImposterStorage from './ImposterStorage';

function stubRepository(imposterId: ImposterId, imposterStorage: ImposterStorage, logger: Logger) {
    const _logger = logger.child({ _context: 'stub_repository' });

    /**
     * Returns the number of stubs for the imposter
     * @memberOf module:models/redisBackedImpostersRepository#
     * @returns {Object} - the promise
     */
    async function count(): Promise<number> {
        const stubs = await imposterStorage.getStubs(imposterId);
        return stubs.length;
    }

    // Returns the first stub whose preidicates matches the filter
    async function first(filter: StubFilterFunction, startIndex = 0): Promise<{ success: boolean; stub: WrappedStub }> {
        let stubs: Array<StubDefinition>;
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
        return { success: false, stub: wrap(undefined, imposterId, imposterStorage) };
    }

    /**
     * Adds a new stub to imposter
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} stub - the stub to add
     * @returns {Object} - the promise
     */
    async function add(stub: Stub): Promise<void> {
        return await imposterStorage.addStub(imposterId, stub);
    }

    /**
     * Inserts a new stub at the given index
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} stub - the stub to add
     * @param {Number} index - the index to insert the new stub at
     * @returns {Object} - the promise
     */
    async function insertAtIndex(stub: Stub, index: number): Promise<void> {
        return await imposterStorage.addStub(imposterId, stub, index);
    }

    /**
     * Deletes the stub at the given index
     * @memberOf module:models/redisImpostersRepository#
     * @param {Number} index - the index of the stub to delete
     * @returns {Object} - the promise
     */
    async function deleteAtIndex(index: number): Promise<void> {
        await imposterStorage.deleteStubAtIndex(imposterId, index);
    }

    /**
     * Overwrites all stubs with a new list
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} newStubs - the new list of stubs
     * @returns {Object} - the promise
     */
    async function overwriteAll(newStubs: Array<Stub>): Promise<void> {
        await imposterStorage.overwriteAllStubs(imposterId, newStubs);
    }

    /**
     * Overwrites the stub at the given index
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} stub - the new stub
     * @param {Number} index - the index of the stub to overwrite
     * @returns {Object} - the promise
     */
    async function overwriteAtIndex(stub: Stub, index: number): Promise<void> {
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
    async function toJSON(options: MbOptions = {}): Promise<Array<OutgoingStub>> {
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

        const result: Array<OutgoingStub> = [];

        try {
            for (let i = 0; i < imposter.stubs.length; i++) {
                const { meta, ...stubDefinition } = imposter.stubs[i];
                const responses = await imposterStorage.getResponses(imposterId, meta.id);
                const stub: OutgoingStub = {
                    ...stubDefinition,
                    responses,
                };
                if (options.debug) {
                    const matches = await imposterStorage.getMatches(meta.id);
                    if (matches !== null) {
                        stub.matches = matches;
                    }
                }
                result.push(stub);
            }

            return result;
        } catch (e) {
            _logger.error(e, 'STUB_TO_JSON_ERROR');
            return [];
        }
    }

    function isRecordedResponse(response: MbResponse): boolean {
        return response.is && typeof response.is._proxyResponseTime === 'number';
    }

    /**
     * Removes the saved proxy responses
     * @memberOf module:models/redisImpostersRepository#
     * @returns {Object} - Promise
     */
    async function deleteSavedProxyResponses(): Promise<void> {
        const allStubs = await toJSON();
        allStubs.forEach(stub => {
            stub.responses = stub.responses?.filter(response => !isRecordedResponse(response));
        });

        const nonProxyStubs = allStubs.filter(stub => stub?.responses && stub.responses.length > 0);
        return overwriteAll(nonProxyStubs);
    }

    /**
     * Adds a request for the imposter
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} request - the request
     * @returns {Object} - the promise
     */
    async function addRequest(request: MbRequest): Promise<number | null> {
        const recordedRequest: RecordedMbRequest = {
            ...structuredClone(request),
            timestamp: new Date().toJSON(),
        };
        return await imposterStorage.addRequest(imposterId, recordedRequest);
    }

    /**
     * Returns the saved requests for the imposter
     * @memberOf module:models/redisImpostersRepository#
     * @returns {Object} - the promise resolving to the array of requests
     */
    async function loadRequests(): Promise<Array<MbRequest>> {
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
    async function deleteSavedRequests(): Promise<number> {
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

export default stubRepository;
