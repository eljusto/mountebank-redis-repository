// То, что приходит в контроллер в ручку создания импостера (если порт не задан, он присваивается в контроллере)
interface ImposterCreationRequest {
    name?: string;
    protocol: string;
    recordRequests?: boolean;
    requests?: unknown;
    port: number;
    stubs?: Array<StubDefinition>;
    url: string;
}

// То, что хранится в базе
export type ImposterConfig = Omit<ImposterCreationRequest, 'requests' | 'stubs'> & {
    stubs: Array<StubDefinition>;
}

interface ImposterProps {
    port: number;
    protocol: string;
    url: string;
    requests?: unknown;
}

// @see https://github.com/bbyars/mountebank/blob/7ecd77ad677606743fde908010c2da8ef7198860/src/models/imposter.js#L229
//const imposter = await protocol.createImposterFrom(imposterConfig);
export interface ImposterFunctions {
    // @see https://github.com/bbyars/mountebank/blob/4af7890d5e8bfbc67df302b78bead4921eb41e41/src/models/imposterPrinter.js#L83
    toJSON: CallableFunction;
    stop: CallableFunction;
    getResponseFor: CallableFunction;
    getProxyResponseFor: CallableFunction;
    resetRequests: CallableFunction;
}

export type Imposter = ImposterProps & ImposterFunctions;

// Type created in controller on POST request
// @see https://github.com/bbyars/mountebank/blob/7ecd77ad677606743fde908010c2da8ef7198860/src/models/imposter.js#L225
export type IncomingImposter = Imposter & {
    creationRequest: ImposterCreationRequest;
}

export type OutgoingImposter = Omit<ImposterConfig, 'stubs'> & {
    stubs: Array<OutgoingStub>;
};

// Just in case imposterId may be a string or symbol in future
export type ImposterId = number;

type PredicateValue = unknown;

export type StubPredicate =
    | { equals: PredicateValue }
    | { deepEquals: PredicateValue }
    | { contains: PredicateValue }
    | { startsWith: PredicateValue }
    | { endsWith: PredicateValue }
    | { matches: PredicateValue }
    | { exists: PredicateValue }
    | { not: PredicateValue }
    | { or: PredicateValue }
    | { and: PredicateValue }
    | { inject: PredicateValue };

export interface Stub {
    responses?: Array<MbResponse>;
    predicates?: Array<StubPredicate>;
}

export interface StubDefinition {
    meta: { id: string };
    predicates?: Array<StubPredicate>;
}

export type OutgoingStub = Omit<StubDefinition, 'meta'> & {
    matches?: Array<StubMatch>;
    responses: Array<MbResponse>;
}

export interface WrappedStub {
    addResponse: (response: MbResponse) => Promise<StubMeta | null>;
    nextResponse: () => Promise<OutgoingResponse>;
    recordMatch: (request: MbRequest, response: MbResponse, responseConfig: ResponseConfig, processingTime: Date) => Promise<void>;
    predicates?: Array<StubPredicate>;
}

export type StubFilterFunction = (predicate: Array<StubPredicate>) => boolean;

export type MbRequest = Record<string, unknown>;

export type RecordedMbRequest = MbRequest & {
    timestamp: string;
}

export interface MbResponse {
    is: {
        _proxyResponseTime?: number;
    };
    repeat: number;
}

export interface MbOptions {
    debug?: boolean;
}

export interface StubMeta {
    responseIds: Array<string>;
    nextIndex: number;
    orderWithRepeats: Array<number>; //array of response indices
}

export interface ResponseConfig {
    is: Record<string | number, unknown>;
    matches?: unknown;
}

export type OutgoingResponse = ResponseConfig & {
    stubIndex: () => Promise<number>;
}

export interface StubMatch {
    request: MbRequest;
    response: MbResponse;
    responseConfig: ResponseConfig;
    processingTime: Date;
    timestamp: string;
}

type LoggerFn = (e: unknown, code?: string) => void;

export interface Logger {
    child: (...args: Array<unknown>) => Logger;
    debug: LoggerFn;
    info: LoggerFn;
    warn: LoggerFn;
    error: LoggerFn;
}
