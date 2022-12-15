'use strict';

const ResponseResolver = require('mountebank/src/models/responseResolver');
const helpers = require('mountebank/src/util/helpers');
const util = require('util');

const mock = require('./testUtils/mock').mock;
const imposterize = require('./testUtils/imposterize');
const createLogger = require('./testUtils/createLogger');
const logger = createLogger();
const repo = require('./index').create({}, logger);
const createStubsRepository = repo.stubsFor;

beforeEach(async() => {
    return await repo.add(imposterize({ port: 1 }));
});

afterEach(async() => {
    return await repo.del(1);
});

afterAll(async() => {
    await repo.stopAll();
});

describe('responseResolver', () => {
    function cleanedProxyResponse(response) {
        if (helpers.defined(response.is)) {
            delete response.is._proxyResponseTime;
        }
        return response;
    }

    function proxyResponses(responses) {
        return responses.map(response => cleanedProxyResponse(response));
    }

    async function stubListFor(stubs) {
        const result = await stubs.toJSON();
        result.forEach(stub => {
            stub.responses = proxyResponses(stub.responses);
        });
        return result;
    }

    async function getResponseFrom(stubs) {
        // Simulates what the imposter / stubRepository do
        const match = await stubs.first(predicates => predicates.length === 0);
        const response = await match.stub.nextResponse();
        return response;
    }

    async function delay(duration) {
        return new Promise(resolve => {
            setTimeout(resolve, duration);
        });
    }

    describe('#resolve', () => {
        it('should resolve "is" without transformation', async() => {
            const proxy = {};
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, proxy);
            const responseConfig = { is: 'value' };

            const response = await resolver.resolve(responseConfig, 'request', logger, {});

            expect(response).toStrictEqual('value');
        });

        it(
            'should resolve "proxy" by delegating to the proxy for in process resolution',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);

                // Call through the stubRepository to have it add the setMetadata function
                await stubs.add({ responses: [ { proxy: { to: 'where' } } ] });
                const responseConfig = await getResponseFrom(stubs);
                const response = await resolver.resolve(responseConfig, 'request', logger, {});

                expect(response.key).toBe('value');
                expect(proxy.to.wasCalledWith('where', 'request', {
                    to: 'where',
                    mode: 'proxyOnce',
                })).toBeTruthy();
            },
        );

        it(
            'should resolve "proxy" by returning proxy configuration for out of process resolution',
            async() => {
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, null, 'CALLBACK URL');

                // Call through the stubRepository to have it add the setMetadata function
                await stubs.add({ responses: [ { proxy: { to: 'where' } } ] });
                const responseConfig = await getResponseFrom(stubs);
                const response = await resolver.resolve(responseConfig, 'request', logger, {});

                expect(response).toEqual({
                    proxy: { to: 'where', mode: 'proxyOnce' },
                    request: 'request',
                    callbackURL: 'CALLBACK URL/0',
                });
            },
        );

        it('should default to "proxyOnce" mode', async() => {
            const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, proxy);

            // Call through the stubRepository to have it add the setMetadata function
            await stubs.add({ responses: [ { proxy: { to: 'where' } } ] });
            const responseConfig = await getResponseFrom(stubs);
            await resolver.resolve(responseConfig, 'request', logger, {});

            expect(responseConfig.proxy.mode).toBe('proxyOnce');
        });

        it('should change unrecognized mode to "proxyOnce" mode', async() => {
            const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, proxy);

            // Call through the stubRepository to have it add the setMetadata function
            await stubs.add({ responses: [ { proxy: { to: 'where', mode: 'unrecognized' } } ] });
            const responseConfig = await getResponseFrom(stubs);
            await resolver.resolve(responseConfig, 'request', logger, {});

            expect(responseConfig.proxy.mode).toBe('proxyOnce');
        });

        it(
            'should resolve proxy in proxyOnce mode by adding a new "is" stub to the front of the list',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);

                await stubs.add({ responses: [], predicates: [ { equals: { ignore: 'true' } } ] });
                await stubs.add({ responses: [ { proxy: { to: 'where' } } ] });
                const responseConfig = await getResponseFrom(stubs);
                const response = await resolver.resolve(responseConfig, {}, logger, {});
                const all = await stubs.toJSON();
                const stubResponses = all.map(stub => proxyResponses(stub.responses));

                expect(response.key).toBe('value');
                expect(stubResponses).toEqual([
                    [],
                    [ { is: { key: 'value' } } ],
                    [ { proxy: { to: 'where' } } ],
                ]);
            },
        );

        it(
            'should support adding wait behavior to newly created stub for in process imposters',
            async() => {
                const proxy = { to: mock().returns(delay(100).then(() => Promise.resolve({ data: 'value' }))) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const request = {};

                await stubs.add({ responses: [ { proxy: { to: 'where', addWaitBehavior: true } } ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const all = await stubs.toJSON();
                const stubResponses = all.map(stub => stub.responses);
                const wait = stubResponses[0][0].is._proxyResponseTime;

                expect(wait > 90).toBeTruthy(); // allow some variability
                expect(stubResponses).toEqual([
                    [ { is: { data: 'value', _proxyResponseTime: wait }, behaviors: [ { wait: wait } ] } ],
                    [ { proxy: { to: 'where', addWaitBehavior: true } } ],
                ]);
            },
        );

        it(
            'should support adding wait behavior to newly created response in proxyAlways mode',
            async() => {
                let call = 0;
                async function proxyReturn() {
                    await delay(100);
                    call += 1;
                    return { data: call };
                }

                const proxy = { to: proxyReturn };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const request = {};

                await stubs.add({ responses: [ { proxy: { to: 'where', mode: 'proxyAlways', addWaitBehavior: true } } ] });
                const responseConfig = await getResponseFrom(stubs);

                // First call adds the stub, second call adds a response
                await resolver.resolve(responseConfig, request, logger, {});
                await resolver.resolve(responseConfig, request, logger, {});

                const all = await stubs.toJSON();
                const stubResponses = all.map(stub => stub.responses);
                const firstWait = stubResponses[1][0].is._proxyResponseTime;
                const secondWait = stubResponses[1][1].is._proxyResponseTime;

                expect(stubResponses).toEqual([
                    [ { proxy: { to: 'where', mode: 'proxyAlways', addWaitBehavior: true } } ],
                    [
                        { is: { data: 1, _proxyResponseTime: firstWait }, behaviors: [ { wait: firstWait } ] },
                        { is: { data: 2, _proxyResponseTime: secondWait }, behaviors: [ { wait: secondWait } ] },
                    ],
                ]);
            },
        );

        it(
            'should run behaviors on proxy response before recording it',
            async() => {
                const decorateFunc = (request, response) => {
                    response.data += '-DECORATED';
                };
                const proxy = { to: mock().returns(Promise.resolve({ data: 'RESPONSE' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: { to: 'where' },
                    behaviors: [ { decorate: decorateFunc.toString() } ],
                };
                const request = {};

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const all = await stubs.toJSON();
                const stubResponses = all.map(stub => proxyResponses(stub.responses));

                expect(stubResponses).toEqual([
                    [ { is: { data: 'RESPONSE-DECORATED' } } ],
                    [ { proxy: { to: 'where' }, behaviors: [ { decorate: decorateFunc.toString() } ] } ],
                ]);
            },
        );

        it(
            'should support adding decorate behavior to newly created stub',
            async() => {
                const decorateFunc = '(request, response) => {}';
                const proxy = { to: mock().returns(Promise.resolve({ data: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const request = {};

                await stubs.add({ responses: [ { proxy: { to: 'where', addDecorateBehavior: decorateFunc } } ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const all = await stubs.toJSON();
                const stubResponses = all.map(stub => proxyResponses(stub.responses));

                expect(stubResponses).toEqual([
                    [ { is: { data: 'value' }, behaviors: [ { decorate: decorateFunc } ] } ],
                    [ { proxy: { to: 'where', addDecorateBehavior: decorateFunc } } ],
                ]);
            },
        );

        it(
            'should support adding decorate behavior to newly created response in proxyAlways mode',
            async() => {
                const decorateFunc = '(request, response) => {}';
                const proxy = { to: mock().returns(Promise.resolve({ data: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const request = {};

                await stubs.add({ responses: [ { proxy: { to: 'where', mode: 'proxyAlways', addDecorateBehavior: decorateFunc } } ] });
                const responseConfig = await getResponseFrom(stubs);

                // First call adds the stub, second call adds a response
                await resolver.resolve(responseConfig, request, logger, {});
                await resolver.resolve(responseConfig, request, logger, stubs);
                const all = await stubs.toJSON();
                const stubResponses = all.map(stub => proxyResponses(stub.responses));

                expect(stubResponses).toEqual([
                    [ { proxy: { to: 'where', mode: 'proxyAlways', addDecorateBehavior: decorateFunc } } ],
                    [
                        { is: { data: 'value' }, behaviors: [ { decorate: decorateFunc } ] },
                        { is: { data: 'value' }, behaviors: [ { decorate: decorateFunc } ] },
                    ],
                ]);
            },
        );

        it(
            'should resolve "proxy" and remember full objects as "deepEquals" predicates',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ { matches: { key: true } } ],
                    },
                };
                const request = { key: { nested: { first: 'one', second: 'two' }, third: 'three' } };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: {
                                key: {
                                    nested: { first: 'one', second: 'two' },
                                    third: 'three',
                                },
                            },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ {
                            proxy: { to: 'where', predicateGenerators: [ { matches: { key: true } } ] },
                        } ],
                    },
                ]);
            },
        );

        it(
            'should resolve "proxy" and remember nested keys as "equals" predicates',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        mode: 'proxyOnce',
                        predicateGenerators: [ { matches: { key: { nested: { first: true } } } } ],
                    },
                };
                const request = { key: { nested: { first: 'one', second: 'two' }, third: 'three' } };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ { equals: { key: { nested: { first: 'one' } } } } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ {
                            proxy: {
                                to: 'where',
                                mode: 'proxyOnce',
                                predicateGenerators: [ { matches: { key: { nested: { first: true } } } } ],
                            },
                        } ],
                    },
                ]);
            },
        );

        it(
            'should add predicate parameters from predicateGenerators',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        mode: 'proxyOnce',
                        predicateGenerators: [ {
                            matches: { key: true },
                            caseSensitive: true,
                            except: 'xxx',
                        } ],
                    },
                };
                const request = { key: 'Test' };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: { key: 'Test' },
                            caseSensitive: true,
                            except: 'xxx',
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it(
            'should choose predicate operator from predicateGenerators',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        mode: 'proxyOnce',
                        predicateGenerators: [ {
                            matches: { key: true },
                            predicateOperator: 'contains',
                        } ],
                    },
                };
                const request = { key: 'Test' };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            contains: { key: 'Test' },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it('should format exists matcher from predicateOperator', async() => {
            const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, proxy);
            const response = {
                proxy: {
                    to: 'where',
                    mode: 'proxyOnce',
                    predicateGenerators: [ {
                        matches: { key: true },
                        predicateOperator: 'exists',
                    } ],
                },
            };
            const request = { key: 'Test' };

            await stubs.add({ responses: [ response ] });
            const responseConfig = await getResponseFrom(stubs);
            await resolver.resolve(responseConfig, request, logger, {});
            const stubList = await stubListFor(stubs);

            expect(stubList).toEqual([
                {
                    predicates: [ {
                        exists: { key: true },
                    } ],
                    responses: [ { is: { key: 'value' } } ],
                },
                {
                    responses: [ response ],
                },
            ]);
        });

        it(
            'should format exists matcher from predicateOperator with nested match',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        mode: 'proxyOnce',
                        predicateGenerators: [ {
                            matches: { key: { nested: true } },
                            predicateOperator: 'exists',
                        } ],
                    },
                };
                const request = { key: { nested: 'Test' } };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            exists: { key: { nested: true } },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it('should support "inject" predicateGenerators', async() => {
            const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, proxy);
            const response = {
                proxy: {
                    to: 'where',
                    mode: 'proxyOnce',
                    predicateGenerators: [ {
                        inject: 'function(config) { return [{ deepEquals: config.request, caseSensitive: true }, { not: { equals: { foo: "bar" }}}]; }',
                    } ],
                },
            };
            const request = { key: 'Test' };

            await stubs.add({ responses: [ response ] });
            const responseConfig = await getResponseFrom(stubs);
            await resolver.resolve(responseConfig, request, logger, {});
            const stubList = await stubListFor(stubs);

            expect(stubList).toEqual([
                {
                    predicates: [ {
                        deepEquals: { key: 'Test' },
                        caseSensitive: true,
                    }, {
                        not: {
                            equals: { foo: 'bar' },
                        },
                    } ],
                    responses: [ { is: { key: 'value' } } ],
                },
                {
                    responses: [ response ],
                },
            ]);
        });

        it('should log "inject" predicateGenerator exceptions', async() => {
            const errorsLogged = [];
            const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, proxy);
            const response = {
                proxy: {
                    to: 'where',
                    mode: 'proxyOnce',
                    predicateGenerators: [ {
                        inject: 'function(config) { throw Error("BOOM!!!"); }',
                    } ],
                },
            };
            const request = { key: 'Test' };

            logger.error.mockImplementationOnce(function() {
                const message = util.format.apply(this, Array.prototype.slice.call(arguments));
                errorsLogged.push(message);
            });

            await stubs.add({ responses: [ response ] });
            const responseConfig = await getResponseFrom(stubs);

            try {
                await resolver.resolve(responseConfig, request, logger, {});
                expect(false).toBe(true);
            } catch (error) {
                /* eslint-disable jest/no-conditional-expect */
                expect(error.message).toBe('invalid predicateGenerator injection');
                expect(errorsLogged.indexOf('injection X=> Error: BOOM!!!') >= 0).toBeTruthy();
                /* eslint-enable jest/no-conditional-expect */
            }
        });

        it(
            'should add xpath predicate parameter in predicateGenerators with one match',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { field: true },
                            xpath: { selector: '//title' },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = { field: '<books><book><title>Harry Potter</title></book></books>' };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: { field: 'Harry Potter' },
                            xpath: { selector: '//title' },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it(
            'should add xpath predicate parameter in predicateGenerators with one match and a nested match key',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { parent: { child: true } },
                            xpath: { selector: '//title' },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = { parent: { child: '<books><book><title>Harry Potter</title></book></books>' } };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            equals: { parent: { child: 'Harry Potter' } },
                            xpath: { selector: '//title' },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it(
            'should add xpath predicate parameter in predicateGenerators with multiple matches',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { field: true },
                            xpath: {
                                selector: '//isbn:title',
                                ns: { isbn: 'http://schemas.isbn.org/ns/1999/basic.dtd' },
                            },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const xml = '<root xmlns:isbn="http://schemas.isbn.org/ns/1999/basic.dtd">' +
                          '  <isbn:book><isbn:title>Harry Potter</isbn:title></isbn:book>' +
                          '  <isbn:book><isbn:title>The Hobbit</isbn:title></isbn:book>' +
                          '  <isbn:book><isbn:title>Game of Thrones</isbn:title></isbn:book>' +
                          '</root>';
                const request = { field: xml };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: { field: [ 'Harry Potter', 'The Hobbit', 'Game of Thrones' ] },
                            xpath: {
                                selector: '//isbn:title',
                                ns: { isbn: 'http://schemas.isbn.org/ns/1999/basic.dtd' },
                            },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it(
            'should add xpath predicate parameter in predicateGenerators even if no xpath match',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { field: true },
                            xpath: { selector: '//title' },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = { field: '<books />' };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: { field: '' },
                            xpath: { selector: '//title' },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it(
            'should add xpath predicate parameter in predicateGenerators even if scalar xpath match',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { field: true },
                            xpath: { selector: 'count(//title)' },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = { field: '<doc><title>first</title><title>second</title></doc>' };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: { field: 2 },
                            xpath: { selector: 'count(//title)' },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it(
            'should add xpath predicate parameter in predicateGenerators even if boolean match',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { field: true },
                            xpath: { selector: 'boolean(//title)' },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = { field: '<doc></doc>' };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: { field: false },
                            xpath: { selector: 'boolean(//title)' },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it(
            'should add jsonpath predicate parameter in predicateGenerators with one match',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { field: true },
                            jsonpath: { selector: '$..title' },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = { field: { title: 'Harry Potter' } };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: { field: 'Harry Potter' },
                            jsonpath: { selector: '$..title' },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it(
            'should add jsonpath predicate parameter in predicateGenerators with multiple matches',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { field: true },
                            jsonpath: { selector: '$.books[*].title' },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = {
                    field: {
                        books: [
                            { title: 'Harry Potter' },
                            { title: 'The Hobbit' },
                            { title: 'Game of Thrones' },
                        ],
                    },
                };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: { field: [ 'Harry Potter', 'The Hobbit', 'Game of Thrones' ] },
                            jsonpath: { selector: '$.books[*].title' },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );

        it(
            'should add jsonpath predicate parameter in predicateGenerators with no match',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { field: true },
                            jsonpath: { selector: '$..title' },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = { field: false };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: { field: '' },
                            jsonpath: { selector: '$..title' },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );
        it(
            'should not ignored a field from the request before recording',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { query: true },
                            ignore: { query: 'deleteAt' },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = { query: { limit: 100, enhanced: true, endDate: '2017-10-11', startDate: '2017-09-07' } };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: request,
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );
        it(
            'should ignore one specific field from the request before recording',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { query: true },
                            ignore: { query: 'startDate' },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = { query: { limit: 100, enhanced: true, endDate: '2017-10-11', startDate: '2017-09-07' } };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: { query: { limit: 100, enhanced: true, endDate: '2017-10-11' } },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );
        it(
            'should ignore multiple fields from the request before recording',
            async() => {
                const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, proxy);
                const response = {
                    proxy: {
                        to: 'where',
                        predicateGenerators: [ {
                            matches: { field: true },
                            ignore: { field: { mutable: { date: [ 'deleteAt', 'endDate' ] } } },
                        } ],
                        mode: 'proxyOnce',
                    },
                };
                const request = {
                    field: {
                        immutable: {
                            id: '63e3a55f-ee87-457f-b808-cf986c28b312',
                            categories: 'promotion-2021',
                        },
                        mutable: {
                            date: {
                                endDate: '2017-10-11',
                                startDate: '2017-09-07',
                                creatAt: '2017-08-06',
                                deleteAt: '2017-10-11',
                            },
                        },
                    },
                };

                await stubs.add({ responses: [ response ] });
                const responseConfig = await getResponseFrom(stubs);
                await resolver.resolve(responseConfig, request, logger, {});
                const stubList = await stubListFor(stubs);

                expect(stubList).toEqual([
                    {
                        predicates: [ {
                            deepEquals: {
                                field: {
                                    immutable: {
                                        id: '63e3a55f-ee87-457f-b808-cf986c28b312',
                                        categories: 'promotion-2021',
                                    },
                                    mutable: {
                                        date: {
                                            startDate: '2017-09-07',
                                            creatAt: '2017-08-06',
                                        },
                                    },
                                },
                            },
                        } ],
                        responses: [ { is: { key: 'value' } } ],
                    },
                    {
                        responses: [ response ],
                    },
                ]);
            },
        );
        it('should log warning if request not JSON', async() => {
            logger.warn.mockClear();
            const proxy = { to: mock().returns(Promise.resolve({ key: 'value' })) };
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, proxy);
            const response = {
                proxy: {
                    to: 'where',
                    predicateGenerators: [ {
                        matches: { field: true },
                        jsonpath: { selector: '$..title' },
                    } ],
                    mode: 'proxyOnce',
                },
            };
            const request = { field: 'Hello, world' };

            await stubs.add({ responses: [ response ] });
            const responseConfig = await getResponseFrom(stubs);
            await resolver.resolve(responseConfig, request, logger, {});
            const stubList = await stubListFor(stubs);

            expect(stubList).toEqual([
                {
                    predicates: [ {
                        deepEquals: { field: '' },
                        jsonpath: { selector: '$..title' },
                    } ],
                    responses: [ { is: { key: 'value' } } ],
                },
                {
                    responses: [ response ],
                },
            ]);
            expect(logger.warn).toHaveBeenCalledWith('Cannot parse as JSON: "Hello, world"');
        });

        it('should allow "inject" response', async() => {
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, {});
            const fn = request => request.data + ' injected';
            const responseConfig = { inject: fn.toString() };
            const request = { data: 'request' };

            const response = await resolver.resolve(responseConfig, request, logger, {});

            expect(response).toBe('request injected');
        });

        it('should log injection exceptions', async() => {
            logger.error.mockClear();
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, {});
            const fn = () => {
                throw Error('BOOM!!!');
            };
            const responseConfig = { inject: fn };

            try {
                await resolver.resolve(responseConfig, {}, logger, {});
            } catch (error) {
                /* eslint-disable jest/no-conditional-expect */
                expect(error.message).toBe('invalid response injection');
                expect(logger.error).toHaveBeenCalledWith('injection X=> Error: BOOM!!!');
                /* eslint-enable jest/no-conditional-expect */
            }
        });

        it(
            'should allow injection request state across calls to resolve',
            async() => {
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, {});
                const fn = (request, state) => {
                    state.counter = state.counter || 0;
                    state.counter += 1;
                    return state.counter;
                };
                const responseConfig = { inject: fn.toString() };
                const request = { key: 'request' };

                const firstResponse = await resolver.resolve(responseConfig, request, logger, {});
                const secondResponse = await resolver.resolve(responseConfig, request, logger, []);

                expect(firstResponse).toBe(1);
                expect(secondResponse).toBe(2);
            },
        );

        it(
            'should allow injection imposter state across calls to resolve',
            async() => {
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, {});
                const imposterState = { foo: 'bar', counter: 0 };
                const fn = (request, localState, logger, deferred, globalState) => {
                    globalState.foo = 'barbar';
                    globalState.counter += 1;
                    return globalState.foo + globalState.counter;
                };
                const responseConfig = { inject: fn.toString() };
                const request = { key: 'request' };

                const firstResponse = await resolver.resolve(responseConfig, request, logger, imposterState);
                const secondResponse = await resolver.resolve(responseConfig, request, logger, imposterState);

                expect(firstResponse).toBe('barbar1');
                expect(secondResponse).toBe('barbar2');
            },
        );

        it('should allow wait behavior', async() => {
            const start = Date.now();

            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, {});
            const responseConfig = {
                is: 'value',
                behaviors: [ { wait: 50 } ],
            };
            const request = { key: 'request' };

            await resolver.resolve(responseConfig, request, logger, {});
            const elapsed = Date.now() - start;

            // allow some approximation
            expect(elapsed >= 45).toBeTruthy();
        });

        it('should allow wait behavior based on a function', async() => {
            const start = Date.now();

            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, {});
            const fn = () => 50;
            const responseConfig = {
                is: 'value',
                behaviors: [ { wait: fn.toString() } ],
            };
            const request = { key: 'request' };

            await resolver.resolve(responseConfig, request, logger, {});
            const elapsed = Date.now() - start;

            // allow for some lack of precision
            expect(elapsed >= 48).toBeTruthy();
        });

        it(
            'should reject the promise when the wait function fails',
            async() => {
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, {});
                const fn = () => {
                    throw new Error('Error message');
                };
                const responseConfig = {
                    is: 'value',
                    behaviors: [ { wait: fn.toString() } ],
                };
                const request = { key: 'request' };

                try {
                    await resolver.resolve(responseConfig, request, logger, {});
                } catch (error) {
                    // eslint-disable-next-line jest/no-conditional-expect
                    expect(error.message).toEqual('invalid wait injection');
                }
            },
        );

        it('should allow asynchronous injection', async() => {
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, {});
            const fn = (request, state, logger, callback) => {
                setTimeout(() => {
                    callback('value');
                }, 1);
            };
            const responseConfig = { inject: fn };
            const request = { key: 'request' };

            const response = await resolver.resolve(responseConfig, request, { debug: mock() }, {});

            expect(response).toBe('value');
        });

        it('should not be able to change state through inject', async() => {
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, {});
            const fn = request => {
                request.key = 'CHANGED';
                return 0;
            };
            const responseConfig = { inject: fn.toString() };
            const request = { key: 'ORIGINAL' };

            await resolver.resolve(responseConfig, request, logger, {});

            expect(request.key).toBe('ORIGINAL');
        });

        it('should not run injection during dry run validation', async() => {
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, {});
            const fn = () => {
                throw Error('BOOM!!!');
            };
            const responseConfig = { inject: fn.toString() };
            const request = { isDryRun: true };

            const response = await resolver.resolve(responseConfig, request, logger, {});

            expect(response).toEqual({});
        });

        it('should throw error if multiple response types given', async() => {
            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, {});
            const responseConfig = { is: 'value', proxy: { to: 'http://www.google.com' } };

            try {
                await resolver.resolve(responseConfig, {}, logger, {});
                expect(false).toBe(true);
            } catch (error) {
                // eslint-disable-next-line jest/no-conditional-expect
                expect(error.message).toBe('each response object must have only one response type');
            }
        });

        it(
            'should throw error if fault used with other response type',
            async() => {
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, {});
                const responseConfig = { fault: 'value', proxy: { to: 'http://www.google.com' } };

                try {
                    await resolver.resolve(responseConfig, {}, logger, {});
                } catch (error) {
                    // eslint-disable-next-line jest/no-conditional-expect
                    expect(error.message).toBe('each response object must have only one response type');
                }
            },
        );
    });

    describe('#resolveProxy', () => {
        function jsonResponse(response) {
            delete response.recordMatch;
            if (helpers.defined(response._proxyResponseTime)) {
                delete response._proxyResponseTime;
            }
            return response;
        }

        it(
            'should error if called with invalid proxyResolutionKey',
            async() => {
                logger.error.mockClear();

                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, null, 'CALLBACK-URL');

                try {
                    await resolver.resolveProxy({ field: 'value' }, 0, logger);
                    expect(false).toBe(true);
                } catch (error) {
                    /* eslint-disable jest/no-conditional-expect */
                    expect(error).toEqual({
                        code: 'no such resource',
                        message: 'invalid proxy resolution key',
                        source: 'CALLBACK-URL/0',
                    });
                    expect(logger.error).toHaveBeenCalledWith('Invalid proxy resolution key: 0');
                    /* eslint-enable jest/no-conditional-expect */
                }
            },
        );

        it(
            'should save new response in front of proxy for "proxyOnce" mode',
            async() => {
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, null, 'CALLBACK-URL');
                const responseConfig = { proxy: { to: 'where', mode: 'proxyOnce' } };
                const request = {};

                await stubs.add({ responses: [ responseConfig ] });
                responseConfig.stubIndex = () => Promise.resolve(0);
                const firstResponse = await resolver.resolve(responseConfig, request, logger, {});
                const proxyResolutionKey = parseInt(firstResponse.callbackURL.replace('CALLBACK-URL/', ''), 10);
                const secondResponse = await resolver.resolveProxy({ data: 'RESPONSE' }, proxyResolutionKey, logger);
                const all = await stubs.toJSON();
                const stubResponses = all.map(stub => proxyResponses(stub.responses));

                expect(jsonResponse(secondResponse)).toEqual({ data: 'RESPONSE' });
                delete responseConfig.stubIndex;
                expect(stubResponses).toEqual([
                    [ { is: { data: 'RESPONSE' } } ],
                    [ responseConfig ],
                ]);
            },
        );

        it(
            'should save new response after proxy for "proxyAlways" mode',
            async() => {
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, null, 'CALLBACK-URL');
                const responseConfig = { proxy: { to: 'where', mode: 'proxyAlways' } };
                const request = {};

                await stubs.add({ responses: [ responseConfig ] });
                responseConfig.stubIndex = () => Promise.resolve(0);
                const firstResponse = await resolver.resolve(responseConfig, request, logger, {});
                const proxyResolutionKey = parseInt(firstResponse.callbackURL.replace('CALLBACK-URL/', ''), 10);
                const secondResponse = await resolver.resolveProxy({ data: 'RESPONSE' }, proxyResolutionKey, logger);
                const all = await stubs.toJSON();
                const stubResponses = all.map(stub => proxyResponses(stub.responses));

                expect(jsonResponse(secondResponse)).toEqual({ data: 'RESPONSE' });
                delete responseConfig.stubIndex;
                expect(stubResponses).toEqual([
                    [ responseConfig ],
                    [ { is: { data: 'RESPONSE' } } ],
                ]);
            },
        );

        it(
            'should run behaviors from original proxy config on proxy response before recording it',
            async() => {
                const decorateFunc = (request, response) => {
                    response.data += '-DECORATED';
                };
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, null, 'CALLBACK-URL');
                const proxyResponse = {
                    proxy: { to: 'where', mode: 'proxyOnce' },
                    behaviors: [ { decorate: decorateFunc.toString() } ],
                };
                const request = {};

                await stubs.add({ responses: [ proxyResponse ] });
                const responseConfig = await getResponseFrom(stubs);
                const firstResponse = await resolver.resolve(responseConfig, request, logger, {});
                const proxyResolutionKey = parseInt(firstResponse.callbackURL.replace('CALLBACK-URL/', ''), 10);
                const secondResponse = await resolver.resolveProxy({ data: 'RESPONSE' }, proxyResolutionKey, logger);
                const all = await stubs.toJSON();
                const stubResponses = all.map(stub => proxyResponses(stub.responses));

                expect(jsonResponse(secondResponse)).toEqual({ data: 'RESPONSE-DECORATED' });
                expect(stubResponses).toEqual([
                    [ { is: { data: 'RESPONSE-DECORATED' } } ],
                    [ proxyResponse ],
                ]);
            },
        );

        it(
            'should add wait behavior based on the proxy resolution time',
            async() => {
                const stubs = createStubsRepository(1);
                const resolver = ResponseResolver.create(stubs, null, 'CALLBACK-URL');
                const proxyResponse = { proxy: { to: 'where', mode: 'proxyOnce', addWaitBehavior: true } };
                const request = {};

                await stubs.add({ responses: [ proxyResponse ] });
                const responseConfig = await getResponseFrom(stubs);
                const response = await resolver.resolve(responseConfig, request, logger, {});
                const proxyResolutionKey = parseInt(response.callbackURL.replace('CALLBACK-URL/', ''), 10);
                await delay(100);
                await resolver.resolveProxy({ data: 'RESPONSE' }, proxyResolutionKey, logger);
                const all = await stubs.toJSON();
                const stubResponses = all.map(stub => stub.responses);
                const wait = stubResponses[0][0].is._proxyResponseTime;

                expect(wait > 90).toBeTruthy(); // allow some variability
                expect(stubResponses).toEqual([
                    [ { is: { data: 'RESPONSE', _proxyResponseTime: wait }, behaviors: [ { wait: wait } ] } ],
                    [ proxyResponse ],
                ]);
            },
        );

        it('should not resolve the same proxyResolutionKey twice', async() => {
            logger.error.mockClear();

            const stubs = createStubsRepository(1);
            const resolver = ResponseResolver.create(stubs, null, 'CALLBACK-URL');
            const proxyResponse = { proxy: { to: 'where' } };
            const request = {};

            await stubs.add({ responses: [ proxyResponse ] });
            const responseConfig = await getResponseFrom(stubs);
            const response = await resolver.resolve(responseConfig, request, logger, {});
            const proxyResolutionKey = parseInt(response.callbackURL.replace('CALLBACK-URL/', ''), 10);
            await resolver.resolveProxy({ data: 'RESPONSE' }, proxyResolutionKey, logger);

            try {
                await resolver.resolveProxy({ data: 'RESPONSE' }, proxyResolutionKey, logger);
            } catch (error) {
                /* eslint-disable jest/no-conditional-expect */
                expect(error).toEqual({
                    code: 'no such resource',
                    message: 'invalid proxy resolution key',
                    source: 'CALLBACK-URL/0',
                });
                expect(logger.error).toHaveBeenCalledWith('Invalid proxy resolution key: 0');
                /* eslint-enable jest/no-conditional-expect */
            }
        });
    });
});
