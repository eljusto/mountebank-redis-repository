import type ImposterStorage from './ImposterStorage';
import type { ImposterId, MbRequest, MbResponse, OutgoingResponse, ResponseConfig, StubDefinition, StubMeta, WrappedStub } from './types';

export default function wrap(stub: StubDefinition | undefined, imposterId: ImposterId, imposterStorage: ImposterStorage): WrappedStub {
    const { meta, ...cloned } = stub ? structuredClone(stub) : { meta: { id: '-' } };

    const stubId = meta.id;

    if (typeof stub === 'undefined') {
        return {
            addResponse: () => Promise.resolve(null),
            nextResponse: () => Promise.resolve({
                is: {},
                stubIndex: () => Promise.resolve(0),
            }),
            recordMatch: () => Promise.resolve(),
        };
    }

    function createResponse(responseConfig?: ResponseConfig): OutgoingResponse {
        return {
            ...structuredClone(responseConfig || { is: {} }),
            stubIndex: getStubIndex,
        };
    }

    const addResponse = async(response: MbResponse): Promise<StubMeta | null> => {
        return await imposterStorage.addResponse(imposterId, stubId, response);
    };

    async function getStubIndex() {
        const imposter = await imposterStorage.getImposter(imposterId);

        if (!imposter?.stubs) {
            throw new Error(`Something weird. Imposter without stubs ${ JSON.stringify(imposter) }`);
        }

        for (let i = 0; i < imposter.stubs.length; i += 1) {
            if (imposter.stubs[i].meta.id === stubId) {
                return i;
            }
        }
        return 0;
    }

    // Returns the next response for the stub, taking into consideration repeat behavior and cycling back the beginning
    async function nextResponse(): Promise<OutgoingResponse> {
        const responseConfig = await imposterStorage.getNextResponse(imposterId, stubId);
        await imposterStorage.incrementRequestCounter(imposterId);

        if (responseConfig) {
            return createResponse(responseConfig);
        } else {
            return createResponse();
        }
    }

    // Records a match for debugging purposes
    const recordMatch = async(request: MbRequest, response: MbResponse, responseConfig: ResponseConfig, processingTime: Date): Promise<void> => {
        await imposterStorage.addMatch(stubId, {
            timestamp: new Date().toJSON(),
            request,
            response,
            responseConfig,
            processingTime,
        });
    };

    return {
        ...cloned,
        addResponse,
        nextResponse,
        recordMatch,
    };
}
