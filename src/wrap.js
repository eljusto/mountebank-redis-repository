'use strict';

const clone = require('./clone');

function wrap(stub, imposterId, imposterStorage) {
    const cloned = clone(stub || {});
    const stubId = stub ? stub.meta.id : '-';

    if (typeof stub === 'undefined') {
        return {
            addResponse: () => Promise.resolve(),
            nextResponse: () => Promise.resolve({
                is: {},
                stubIndex: () => Promise.resolve(0),
            }),
            recordMatch: () => Promise.resolve(),
        };
    }

    delete cloned.meta;

    function createResponse(responseConfig) {
        const result = clone(responseConfig || { is: {} });
        result.stubIndex = getStubIndex;

        return result;
    }

    /**
     * Adds a response to the stub
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} response - the new response
     * @returns {Object} - the promise
     */
    cloned.addResponse = async response => {
        return await imposterStorage.addResponse(imposterId, stubId, response);
    };

    async function getStubIndex() {
        const imposter = await imposterStorage.getImposter(imposterId);

        if (!imposter.stubs) {
            throw new Error(`Something weird. Imposter without stubs ${ JSON.stringify(imposter) }`);
        }

        for (let i = 0; i < imposter.stubs.length; i += 1) {
            if (imposter.stubs[i].meta.id === stub.meta.id) {
                return i;
            }
        }
        return 0;
    }

    /**
     * Returns the next response for the stub, taking into consideration repeat behavior and cycling back the beginning
     * @memberOf module:models/redisImpostersRepository#
     * @returns {Object} - the promise
     */
    cloned.nextResponse = async() => {
        const responseConfig = await imposterStorage.getNextResponse(imposterId, stubId);
        await imposterStorage.incrementRequestCounter(imposterId);

        if (responseConfig) {
            return createResponse(responseConfig);
        } else {
            return createResponse();
        }
    };

    /**
     * Records a match for debugging purposes
     * @memberOf module:models/redisImpostersRepository#
     * @param {Object} request - the request
     * @param {Object} response - the response
     * @param {Object} responseConfig - the config that generated the response
     * @param {Number} processingTime - the time to match the predicate and generate the full response
     * @returns {Object} - the promise
     */
    cloned.recordMatch = async(request, response, responseConfig, processingTime) => {
        if (!Array.isArray(cloned.matches)) {
            cloned.matches = [];
        }

        const match = {
            timestamp: new Date().toJSON(),
            request,
            response,
            responseConfig,
            processingTime,
        };

        cloned.matches.push(match);

        await imposterStorage.addMatch(stubId, match);
    };

    return cloned;
}

module.exports = wrap;
