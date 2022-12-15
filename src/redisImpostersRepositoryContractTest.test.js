'use strict';

/**
* Tests the semantics of each repository implementation to ensure they function equivalently
*/

/* eslint max-nested-callbacks: 0 */

const RedisClient = require('./RedisClient');

const { loadProtocols } = require('mountebank/src/models/protocols');

const create = require('./index').create;

const mock = require('./testUtils/mock').mock;
const deimposterize = require('./testUtils/deimposterize');
const imposterize = require('./testUtils/imposterize');
const createLogger = require('./testUtils/createLogger');
const stripFunctions = require('./testUtils/stripFunctions');

describe('redisImpostersRepository', () => {
    let dbClient;
    let protocols;
    let repo;
    const logger = createLogger();

    beforeAll(async() => {
        dbClient = new RedisClient({}, logger);
    });

    beforeEach(() => {
        repo = create({}, logger);

        const options = { log: { level: 'info' } };
        protocols = loadProtocols(options, '', { baseLogger: logger }, () => true, repo);
    });

    afterEach(async() => {
        await repo.stopAll();
        await dbClient.flushDb();
    });

    afterAll(async() => {
        await dbClient.stop();
    });

    describe('#add', () => {
        it('should allow a reciprocal get', async() => {
            await repo.add(imposterize({ port: 1, value: 2 }));
            const imposter = await repo.get(1);
            expect(deimposterize(imposter)).toEqual({ port: 1, value: 2, stubs: [] });
        });

        it('should accept a string add and a number get', async() => {
            await repo.add(imposterize({ port: '1', value: 2 }));
            const imposter = await repo.get(1);
            expect(deimposterize(imposter)).toEqual({ port: '1', value: 2, stubs: [] });
        });

        it('should accept a number add and a string get', async() => {
            await repo.add(imposterize({ port: 1, value: 2 }));
            const imposter = await repo.get('1');
            expect(deimposterize(imposter)).toEqual({ port: 1, value: 2, stubs: [] });
        });

        it('should save functions on imposter', async() => {
            const imposter = {
                port: 1,
                truthy: () => true,
                falsy: () => false,
            };

            await repo.add(imposterize(imposter));
            const saved = await repo.get('1');

            expect(saved.truthy()).toBeTruthy();
            expect(!saved.falsy()).toBeTruthy();
        });
    });

    describe('#get', () => {
        it('should return null if no imposter exists', async() => {
            const imposter = await repo.get(1);
            expect(imposter).toBe(null);
        });

        it('should retrieve with stubs', async() => {
            const imposter = {
                port: 1,
                protocol: 'test',
                stubs: [ {
                    predicates: [ { equals: { key: 1 } } ],
                    responses: [ { is: { field: 'value' } } ],
                } ],
            };

            await repo.add(imposterize(imposter));
            const saved = await repo.get('1');
            expect(deimposterize(saved)).toEqual(imposter);
        });
    });

    describe('#all', () => {
        it('should return an empty list if nothing added', async() => {
            const imposters = await repo.all();

            expect(imposters).toEqual([]);
        });

        it('should return all previously added', async() => {
            await repo.add(imposterize({ port: 1, value: 2 }));
            await repo.add(imposterize({ port: 2, value: 3 }));

            const imposters = await repo.all();
            expect(deimposterize(imposters)).toEqual([
                { port: 1, value: 2, stubs: [] },
                { port: 2, value: 3, stubs: [] },
            ]);
        });

        it('should return all added with stubs', async() => {
            await repo.stopAll();
            await repo.loadAll(protocols);
            const first = {
                port: 1,
                stubs: [ {
                    predicates: [ { equals: { key: 1 } } ],
                    responses: [ { is: { field: 'value' } } ],
                } ],
            };
            const second = {
                port: 2,
                stubs: [ {
                    predicates: [],
                    responses: [ { is: { key: 1 } } ],
                } ],
            };

            await repo.add(imposterize(first));
            await repo.add(imposterize(second));

            const imposters = await repo.all();
            const actualResult = deimposterize(imposters);

            const actualFirst = actualResult.find(imp => imp.port === 1);
            const actualSecond = actualResult.find(imp => imp.port === 2);

            expect([ actualFirst, actualSecond ]).toEqual([ first, second ]);
            expect(actualResult.length === 2).toBeTruthy();
        });
    });

    describe('#exists', () => {
        it('should return false if given port has not been added', async() => {
            await repo.add(imposterize({ port: 1, value: 2 }));

            const exists = await repo.exists(2);
            expect(exists).toBe(false);
        });

        it('should return true if given port has been added', async() => {
            await repo.add(imposterize({ port: 1, value: 2 }));

            const exists = await repo.exists(1);
            expect(exists).toBe(true);
        });

        it('should do type conversion if needed', async() => {
            await repo.add(imposterize({ port: 1, value: 2 }));

            const exists = await repo.exists('1');
            expect(exists).toBe(true);
        });
    });

    describe('#del', () => {
        it('should return null if imposter never added', async() => {
            const imposter = await repo.del(1);
            expect(imposter).toBe(null);
        });

        it('should return imposter and remove from list', async() => {
            await repo.add(imposterize({
                port: 1,
                value: 2,
                stop: mock().returns(Promise.resolve()),
            }));

            const imposter = await repo.del(1);

            expect(deimposterize(imposter)).toEqual({ port: 1, value: 2, stubs: [] });
            const saved = await repo.get(1);
            expect(saved).toBe(null);
        });

        it('should empty the stubs associated with the imposter', async() => {
            const stub = { responses: [ { is: { key: 'value' } } ] };
            const imposter = { port: 1, stubs: [ stub ], stop: mock().returns(Promise.resolve()) };

            await repo.add(imposterize(imposter));
            await repo.del(1);
            const count = await repo.stubsFor(1).count();
            expect(count).toBe(0);
        });
    });

    describe('#stopAll', () => {
        it('should empty list', async() => {
            const first = { port: 1, value: 2 };
            const second = { port: 2, value: 3 };

            await repo.add(imposterize(first));
            await repo.add(imposterize(second));
            repo.stopAllSync();

            const imposters = await repo.all();
            expect(imposters).toEqual([]);
        });
    });

    describe('#deleteAll', () => {
        it('should call stop() on all imposters and empty list', async() => {
            const first = { port: 1, value: 2 };
            const second = { port: 2, value: 3 };

            await repo.add(imposterize(first));
            await repo.add(imposterize(second));
            await repo.deleteAll();

            const imposters = await repo.all();
            expect(imposters).toEqual([]);
        });
    });

    describe('#loadAll', () => {
        it('should load an empty set if nothing previously saved', async() => {
            await repo.stopAll();
            await repo.loadAll(protocols);

            const imposters = await repo.all();

            expect(imposters).toStrictEqual([]);
        });

        it('should load previously saved imposters', async() => {
            await repo.add(imposterize({ port: 2526, protocol: 'tcp' }));
            await repo.add(imposterize({ port: 2527, protocol: 'tcp' }));
            await repo.stopAll();

            // Validate clean state
            const imposters = await repo.all();
            expect(imposters).toStrictEqual([]);

            await repo.loadAll(protocols);
            const loaded = await repo.all();
            const ports = loaded.map(imposter => imposter.port);

            expect(ports).toStrictEqual([ 2526, 2527 ]);
            await repo.stopAll();
        });
    });

    describe('#stubsFor', () => {
        describe('#count', () => {
            it('should be 0 if no stubs on the imposter', async() => {
                await repo.add(imposterize({ port: 1 }));

                const count = await repo.stubsFor(1).count();
                expect(0).toBe(count);
            });

            it(
                'should provide count of all stubs on imposter added initially',
                async() => {
                    const imposter = {
                        port: 1,
                        protocol: 'test',
                        stubs: [
                            { responses: [ { is: { field: 1 } } ] },
                            { responses: [ { is: { field: 2 } } ] },
                        ],
                    };

                    await repo.add(imposterize(imposter));

                    const count = await repo.stubsFor(1).count();
                    expect(2).toBe(count);
                },
            );

            it('should all stubs added after creation', async() => {
                const imposter = {
                    port: 1,
                    protocol: 'test',
                    stubs: [ { responses: [ { is: { field: 1 } } ] } ],
                };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).add({ responses: [ { is: { field: 2 } } ] });

                const count = await repo.stubsFor(1).count();
                expect(2).toBe(count);
            });
        });

        describe('#first', () => {
            it(
                'should default empty array to filter function if no predicates on stub',
                async() => {
                    const imposter = {
                        port: 1,
                        stubs: [ { responses: [] } ],
                    };

                    await repo.add(imposterize(imposter));

                    await repo.stubsFor(1).first(predicates => {
                        expect(predicates).toEqual([]);
                        return true;
                    });
                },
            );

            it('should return default stub if no match', async() => {
                const imposter = { port: 1, protocol: 'test' };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => false);

                expect(match.success).toBe(false);
                const response = await match.stub.nextResponse();
                expect(stripFunctions(response)).toEqual({ is: {} });
            });

            it('should return match with index', async() => {
                const stubs = repo.stubsFor(1);
                const firstStub = { predicates: [ { equals: { field: 'value' } } ], responses: [ { is: 'first' } ] };
                const secondStub = { responses: [ { is: 'third' }, { is: 'fourth' } ] };
                const thirdStub = { responses: [ { is: 'fifth' }, { is: 'sixth' } ] };
                const imposter = { port: 1, protocol: 'test', stubs: [ firstStub, secondStub, thirdStub ] };

                await repo.add(imposterize(imposter));
                const match = await stubs.first(predicates => predicates.length === 0);

                expect(match.success).toBe(true);
                const response = await match.stub.nextResponse();
                expect(stripFunctions(response)).toEqual({ is: 'third' });
                const index = await response.stubIndex();
                expect(index).toBe(1);
            });

            it('should loop through responses on nextResponse()', async() => {
                const stub = { responses: [ { is: 'first' }, { is: 'second' } ] };
                const imposter = { port: 1, stubs: [ stub ] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true);
                const firstResponse = await match.stub.nextResponse();
                const secondResponse = await match.stub.nextResponse();
                const thirdResponse = await match.stub.nextResponse();

                expect(stripFunctions(firstResponse)).toEqual({ is: 'first' });
                expect(stripFunctions(secondResponse)).toEqual({ is: 'second' });
                expect(stripFunctions(thirdResponse)).toEqual({ is: 'first' });
            });

            it('should handle repeat behavior on nextResponse()', async() => {
                const stub = { responses: [ { is: 'first', repeat: 2 }, { is: 'second' } ] };
                const imposter = { port: 1, stubs: [ stub ] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true);
                const firstResponse = await match.stub.nextResponse();
                const secondResponse = await match.stub.nextResponse();
                const thirdResponse = await match.stub.nextResponse();
                const fourthResponse = await match.stub.nextResponse();

                expect(firstResponse.is).toEqual('first');
                expect(secondResponse.is).toEqual('first');
                expect(thirdResponse.is).toEqual('second');
                expect(fourthResponse.is).toEqual('first');
            });

            it('should support adding responses through addResponse()', async() => {
                const imposter = { port: 1, stubs: [ {} ] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true);
                await match.stub.addResponse({ is: { field: 1 } });
                const secondMatch = await repo.stubsFor(1).first(() => true);
                const response = await secondMatch.stub.nextResponse();

                expect(stripFunctions(response)).toEqual({ is: { field: 1 } });
            });

            it('should support recording matches', async() => {
                const imposter = { port: 1, stubs: [ {} ] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true);
                await match.stub.recordMatch('REQUEST', 'RESPONSE');
                const all = await repo.stubsFor(1).toJSON({ debug: true });

                expect(1).toBe(all[0].matches.length);
                delete all[0].matches[0].timestamp;
                expect(all[0].matches).toEqual([ { request: 'REQUEST', response: 'RESPONSE' } ]);
            });
        });

        describe('#toJSON', () => {
            it('should return empty array if nothing added', async() => {
                const json = await repo.stubsFor(1).toJSON();
                expect(json).toEqual([]);
            });

            it(
                'should return all predicates and original response order of all stubs',
                async() => {
                    const first = {
                        predicates: [ { equals: { field: 'value' } } ],
                        responses: [ { is: { field: 1 } }, { is: { field: 2 } } ],
                    };
                    const second = {
                        responses: [ { is: { key: 'value' }, behaviors: [ { repeat: 2 } ] } ],
                    };
                    const imposter = { port: 1, stubs: [ first, second ] };

                    await repo.add(imposterize(imposter));
                    const match = await repo.stubsFor(1).first(() => true);
                    await match.stub.nextResponse();
                    const json = await repo.stubsFor(1).toJSON();

                    expect(json).toEqual([ first, second ]);
                },
            );

            it('should not return matches if debug option not set', async() => {
                const imposter = { port: 1, stubs: [ {} ] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true);
                await match.stub.recordMatch('REQUEST', 'RESPONSE');
                const all = await repo.stubsFor(1).toJSON();

                expect(typeof all[0].matches).toBe('undefined');
            });
        });

        describe('#deleteSavedProxyResponses', () => {
            it('should remove recorded responses and stubs', async() => {
                const first = {
                    predicates: [ { equals: { key: 1 } } ],
                    responses: [ { is: { field: 1, _proxyResponseTime: 100 } } ],
                };
                const second = {
                    predicates: [ { equals: { key: 2 } } ],
                    responses: [
                        { is: { field: 2, _proxyResponseTime: 100 } },
                        { is: { field: 3 } },
                    ],
                };
                const third = {
                    responses: [ { proxy: { to: 'http://test.com' } } ],
                };
                const imposter = { port: 1, stubs: [ first, second, third ] };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).deleteSavedProxyResponses();
                const json = await repo.stubsFor(1).toJSON();

                expect(json).toEqual([
                    {
                        predicates: [ { equals: { key: 2 } } ],
                        responses: [ { is: { field: 3 } } ],
                    },
                    {
                        responses: [ { proxy: { to: 'http://test.com' } } ],
                    },
                ]);
            });
        });

        describe('#overwriteAll', () => {
            it('should overwrite entire list', async() => {
                const first = { responses: [ { is: 'first' }, { is: 'second' } ] };
                const second = { responses: [ { is: 'third' }, { is: 'fourth' } ] };
                const newStub = { responses: [ { is: 'fifth' }, { is: 'sixth' } ] };
                const imposter = { port: 1, stubs: [ first, second ] };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).overwriteAll([ newStub ]);
                const all = await repo.stubsFor(1).toJSON();
                const responses = all.map(stub => stub.responses);

                expect(responses).toEqual([
                    [ { is: 'fifth' }, { is: 'sixth' } ],
                ]);
            });
        });

        describe('#overwriteAtIndex', () => {
            it('should overwrite single stub', async() => {
                const first = { responses: [ { is: 'first' }, { is: 'second' } ] };
                const second = { responses: [ { is: 'third' }, { is: 'fourth' } ] };
                const newStub = { responses: [ { is: 'fifth' }, { is: 'sixth' } ] };
                const imposter = { port: 1, stubs: [ first, second ] };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).overwriteAtIndex(newStub, 1);
                const all = await repo.stubsFor(1).toJSON();
                const responses = all.map(stub => stub.responses);

                expect(responses).toEqual([
                    [ { is: 'first' }, { is: 'second' } ],
                    [ { is: 'fifth' }, { is: 'sixth' } ],
                ]);
            });

            it('should reject the promise if no stub at that index', async() => {
                const imposter = { port: 1 };

                await repo.add(imposterize(imposter));

                try {
                    await repo.stubsFor(1).overwriteAtIndex({}, 0);
                } catch (err) {
                    // eslint-disable-next-line jest/no-conditional-expect
                    expect(err).toEqual({
                        code: 'no such resource',
                        message: 'no stub at index 0',
                    });
                }
            });
        });

        describe('#deleteAtIndex', () => {
            it('should delete single stub', async() => {
                const first = { responses: [ { is: 'first' }, { is: 'second' } ] };
                const second = { responses: [ { is: 'third' }, { is: 'fourth' } ] };
                const third = { responses: [ { is: 'fifth' }, { is: 'sixth' } ] };
                const imposter = { port: 1, stubs: [ first, second, third ] };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).deleteAtIndex(0);
                const all = await repo.stubsFor(1).toJSON();
                const responses = all.map(stub => stub.responses);

                expect(responses).toEqual([
                    [ { is: 'third' }, { is: 'fourth' } ],
                    [ { is: 'fifth' }, { is: 'sixth' } ],
                ]);
            });

            it('should reject the promise if no stub at that index', async() => {
                const imposter = { port: 1 };

                await repo.add(imposterize(imposter));

                try {
                    await repo.stubsFor(1).deleteAtIndex(0);
                } catch (err) {
                    // eslint-disable-next-line jest/no-conditional-expect
                    expect(err).toEqual({
                        code: 'no such resource',
                        message: 'no stub at index 0',
                    });
                }
            });
        });

        describe('#insertAtIndex', () => {
            it('should add single stub at given index', async() => {
                const first = { responses: [ { is: 'first' }, { is: 'second' } ] };
                const second = { responses: [ { is: 'third' }, { is: 'fourth' } ] };
                const insertedStub = { responses: [ { is: 'fifth' }, { is: 'sixth' } ] };
                const imposter = { port: 1, stubs: [ first, second ] };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).insertAtIndex(insertedStub, 0);
                const all = await repo.stubsFor(1).toJSON();
                const responses = all.map(stub => stub.responses);

                expect(responses).toEqual([
                    [ { is: 'fifth' }, { is: 'sixth' } ],
                    [ { is: 'first' }, { is: 'second' } ],
                    [ { is: 'third' }, { is: 'fourth' } ],
                ]);
            });
        });

        describe('#addRequest', () => {
            it('should save request with timestamp', async() => {
                const imposter = { port: 1 };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).addRequest({ field: 'value' });
                const requests = await repo.stubsFor(1).loadRequests();

                expect(requests).toEqual([ { field: 'value', timestamp: requests[0].timestamp } ]);
                const delta = new Date() - Date.parse(requests[0].timestamp);
                expect(delta < 1000).toBeTruthy();
            });
        });

        describe('#deleteSavedRequests', () => {
            it('should clear the requests list', async() => {
                const imposter = { port: 1 };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).addRequest({ field: 'value' });
                const requests = await repo.stubsFor(1).loadRequests();

                expect(requests).toEqual([ { field: 'value', timestamp: requests[0].timestamp } ]);

                await repo.stubsFor(1).deleteSavedRequests();
                const secondRequests = await repo.stubsFor(1).loadRequests();
                expect(secondRequests).toEqual([]);
            });
        });

        describe('#loadRequests', () => {
            it('should return requests in order without losing any', async() => {
                const stubs = repo.stubsFor(1);
                await stubs.addRequest({ value: 1 });
                await stubs.addRequest({ value: 2 });
                await stubs.addRequest({ value: 3 });
                await stubs.addRequest({ value: 4 });
                await stubs.addRequest({ value: 5 });
                await stubs.addRequest({ value: 6 });
                await stubs.addRequest({ value: 7 });
                await stubs.addRequest({ value: 8 });
                await stubs.addRequest({ value: 9 });
                await stubs.addRequest({ value: 10 });

                const requests = await stubs.loadRequests();
                const values = requests.map(request => request.value);

                expect(values).toEqual([ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]);
            });
        });
    });
});
