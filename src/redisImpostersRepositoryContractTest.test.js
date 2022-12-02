'use strict';

/**
* Tests the semantics of each repository implementation to ensure they function equivalently
*/

/* eslint max-nested-callbacks: 0 */

const RedisClient = require('./RedisClient');
const Logger = require('./testUtils/fakeLogger');
/* const logger = require('@vertis/pino'); */
/* const mbLogger = logger.child({ _context: 'mountebank' }); */
const realLogger = require('mountebank/src/util/logger').createLogger({
    console: {
        colorize: true,
        format: '%level: %message'
    }
});
const { loadProtocols } = require('mountebank/src/models/protocols');


const assert = require('assert');
const create = require('./index').create;
const mock = require('./testUtils/mock').mock;

function imposterize (config) {
    const cloned = JSON.parse(JSON.stringify(config)),
    result = {
        creationRequest: cloned,
        port: cloned.port
    };
    Object.keys(cloned).forEach(key => {
        result[key] = cloned[key];
    });
    Object.keys(config).forEach(key => {
        if (typeof config[key] === 'function') {
            result[key] = config[key];
        }
    });
    return result;
}

function stripFunctions (obj) {
    return JSON.parse(JSON.stringify(obj));
}

function deimposterize (obj) {
    const withoutFunctions = stripFunctions(obj);
    if (Array.isArray(withoutFunctions)) {
        withoutFunctions.forEach(imposter => { delete imposter.creationRequest; });
    }
    delete withoutFunctions.creationRequest;
    return withoutFunctions;
}

        const loggr = {
            error: console.log,
            warn: console.log,
            info: console.log,

        };
describe('redisImpostersRepository', function () {
    let dbClient;
    let protocols;
    let repo;

    beforeAll(async() => {
        dbClient = new RedisClient({}, loggr);
    });

    beforeEach(function() {
        repo = create({}, loggr);

        const options = { log: { level: 'info' } };
        // FakeLogger hangs, maybe something to do with the ScopedLogger wrapping it in imposter.js
        protocols = loadProtocols(options, '', realLogger, () => true, repo);
    });

    afterEach(async function(){
        await repo.stopAll();
        await dbClient.flushDb();
    });

    afterAll(async () => {
        await dbClient.stop();
    });

    describe('#add', function () {
        it('should allow a reciprocal get', async function () {
            await repo.add(imposterize({ port: 1, value: 2 }));
            const imposter = await repo.get(1);
            assert.deepEqual(deimposterize(imposter), { port: 1, value: 2, stubs: [] });
        });

        it('should accept a string add and a number get', async function () {
            await repo.add(imposterize({ port: '1', value: 2 }));
            const imposter = await repo.get(1);
            assert.deepEqual(deimposterize(imposter), { port: '1', value: 2, stubs: [] });
        });

        it('should accept a number add and a string get', async function () {
            await repo.add(imposterize({ port: 1, value: 2 }));
            const imposter = await repo.get('1');
            assert.deepEqual(deimposterize(imposter), { port: 1, value: 2, stubs: [] });
        });

        it('should properly save imposter with functions and omit it', async function () {
            const imposter = {
                port: 1,
                value: 2,
                truthy: () => true,
                falsy: () => false
            };

            await repo.add(imposterize(imposter));
            const saved = await repo.get('1');

            assert.deepEqual(saved, {
                port: 1,
                value: 2,
                stubs: [],
            });
        });
    });

    describe('#get', function () {
        it('should return null if no imposter exists', async function () {
            const imposter = await repo.get(1);
            assert.strictEqual(imposter, null);
        });

        it('should retrieve with stubs', async function () {
            const imposter = {
                port: 1,
                protocol: 'test',
                stubs: [{
                    predicates: [{ equals: { key: 1 } }],
                    responses: [{ is: { field: 'value' } }]
                }]
            };

            await repo.add(imposterize(imposter));
            const saved = await repo.get('1');
            assert.deepEqual(deimposterize(saved), imposter);
        });
    });

    describe('#all', function () {
        it('should return an empty list if nothing added', async function () {
            const imposters = await repo.all();

            assert.deepEqual(imposters, []);
        });

        it('should return all previously added', async function () {
            await repo.add(imposterize({ port: 1, value: 2 }));
            await repo.add(imposterize({ port: 2, value: 3 }));

            const imposters = await repo.all();
            assert.deepEqual(deimposterize(imposters), [
                { port: 1, value: 2, stubs: [] },
                { port: 2, value: 3, stubs: [] }
            ]);
        });

        it('should return all added with stubs', async function () {
            await repo.stopAll();
            await repo.loadAll(protocols);
            const first = {
                port: 1,
                stubs: [{
                    predicates: [{ equals: { key: 1 } }],
                    responses: [{ is: { field: 'value' } }]
                }]
            },
            second = {
                port: 2,
                stubs: [{
                    predicates: [],
                    responses: [{ is: { key: 1 } }]
                }]
            };

            await repo.add(imposterize(first));
            await repo.add(imposterize(second));

            const imposters = await repo.all();
            const actualResult = deimposterize(imposters);

            const actualFirst = actualResult.find(imp => imp.port === 1);
            const actualSecond = actualResult.find(imp => imp.port === 2);

            assert.deepEqual([actualFirst, actualSecond], [first, second]);
            assert.ok(actualResult.length === 2);
        });
    });

    describe('#exists', function () {
        it('should return false if given port has not been added', async function () {
            await repo.add(imposterize({ port: 1, value: 2 }));

            const exists = await repo.exists(2);
            assert.strictEqual(exists, false);
        });

        it('should return true if given port has been added', async function () {
            await repo.add(imposterize({ port: 1, value: 2 }));

            const exists = await repo.exists(1);
            assert.strictEqual(exists, true);
        });

        it('should do type conversion if needed', async function () {
            await repo.add(imposterize({ port: 1, value: 2 }));

            const exists = await repo.exists('1');
            assert.strictEqual(exists, true);
        });
    });

    describe('#del', function () {
        it('should return null if imposter never added', async function () {
            const imposter = await repo.del(1);
            assert.strictEqual(imposter, null);
        });

        it('should return imposter and remove from list', async function () {
            await repo.add(imposterize({
                port: 1,
                value: 2,
                stop: mock().returns(Promise.resolve())
            }));

            const imposter = await repo.del(1);

            assert.deepEqual(deimposterize(imposter), { port: 1, value: 2, stubs: [] });
            const saved = await repo.get(1);
            assert.strictEqual(saved, null);
        });

        it('should empty the stubs associated with the imposter', async function () {
            const stub = { responses: [{ is: { key: 'value' } }] },
            imposter = { port: 1, stubs: [stub], stop: mock().returns(Promise.resolve()) };

            await repo.add(imposterize(imposter));
            await repo.del(1);
            const count = await repo.stubsFor(1).count();
            assert.strictEqual(count, 0);
        });
    });

    describe('#stopAll', function () {
        it('should empty list', async function () {
            const first = { port: 1, value: 2 };
            const second = { port: 2, value: 3 };

            await repo.add(imposterize(first));
            await repo.add(imposterize(second));
            repo.stopAllSync();

            const imposters = await repo.all();
            assert.deepEqual(imposters, []);
        });
    });

    describe('#deleteAll', function () {
        it('should call stop() on all imposters and empty list', async function () {
            const first = { port: 1, value: 2 },
            second = { port: 2, value: 3 };

            await repo.add(imposterize(first));
            await repo.add(imposterize(second));
            await repo.deleteAll();

            const imposters = await repo.all();
            assert.deepEqual(imposters, []);
        });
    });

    describe('#loadAll', function () {
        it('should load an empty set if nothing previously saved', async function () {
            await repo.stopAll();
            await repo.loadAll(protocols);

            const imposters = await repo.all();

            assert.deepStrictEqual(imposters, []);
        });

        it('should load previously saved imposters', async function () {
            await repo.add(imposterize({ port: 2526, protocol: 'tcp' }));
            await repo.add(imposterize({ port: 2527, protocol: 'tcp' }));
            await repo.stopAll();

            // Validate clean state
            const imposters = await repo.all();
            assert.deepStrictEqual(imposters, []);

            await repo.loadAll(protocols);
            const loaded = await repo.all();
            const ports = loaded.map(imposter => imposter.port);

            assert.deepStrictEqual(ports, [2526, 2527]);
            await repo.stopAll();
        });
    });

    describe('#stubsFor', function () {
        describe('#count', function () {
            it('should be 0 if no stubs on the imposter', async function () {
                await repo.add(imposterize({ port: 1 }));

                const count = await repo.stubsFor(1).count();
                assert.strictEqual(0, count);
            });

            it('should provide count of all stubs on imposter added initially', async function () {
                const imposter = {
                    port: 1,
                    protocol: 'test',
                    stubs: [
                        { responses: [{ is: { field: 1 } }] },
                        { responses: [{ is: { field: 2 } }] }
                    ]
                };

                await repo.add(imposterize(imposter));

                const count = await repo.stubsFor(1).count();
                assert.strictEqual(2, count);
            });

            it('should all stubs added after creation', async function () {
                const imposter = {
                    port: 1,
                    protocol: 'test',
                    stubs: [{ responses: [{ is: { field: 1 } }] }]
                };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).add({ responses: [{ is: { field: 2 } }] });

                const count = await repo.stubsFor(1).count();
                assert.strictEqual(2, count);
            });
        });

        describe('#first', function () {
            it('should default empty array to filter function if no predicates on stub', async function () {
                const imposter = {
                    port: 1,
                    stubs: [{ responses: [] }]
                };

                await repo.add(imposterize(imposter));

                await repo.stubsFor(1).first(predicates => {
                    assert.deepEqual(predicates, []);
                    return true;
                });
            });

            it('should return default stub if no match', async function () {
                const imposter = { port: 1, protocol: 'test' };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => false);

                assert.strictEqual(match.success, false);
                const response = await match.stub.nextResponse();
                assert.deepEqual(stripFunctions(response), { is: {} });
            });

            it('should return match with index', async function () {
                const stubs = repo.stubsFor(1),
                firstStub = { predicates: [{ equals: { field: 'value' } }], responses: [{ is: 'first' }] },
                secondStub = { responses: [{ is: 'third' }, { is: 'fourth' }] },
                thirdStub = { responses: [{ is: 'fifth' }, { is: 'sixth' }] },
                imposter = { port: 1, protocol: 'test', stubs: [firstStub, secondStub, thirdStub] };

                await repo.add(imposterize(imposter));
                const match = await stubs.first(predicates => predicates.length === 0);

                assert.strictEqual(match.success, true);
                const response = await match.stub.nextResponse();
                assert.deepEqual(stripFunctions(response), { is: 'third' });
                const index = await response.stubIndex();
                assert.strictEqual(index, 1);
            });

            it('should loop through responses on nextResponse()', async function () {
                const stub = { responses: [{ is: 'first' }, { is: 'second' }] },
                imposter = { port: 1, stubs: [stub] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true),
                firstResponse = await match.stub.nextResponse(),
                secondResponse = await match.stub.nextResponse(),
                thirdResponse = await match.stub.nextResponse();

                assert.deepEqual(stripFunctions(firstResponse), { is: 'first' });
                assert.deepEqual(stripFunctions(secondResponse), { is: 'second' });
                assert.deepEqual(stripFunctions(thirdResponse), { is: 'first' });
            });

            it('should handle repeat behavior on nextResponse()', async function () {
                const stub = { responses: [{ is: 'first', repeat: 2 }, { is: 'second' }] },
                imposter = { port: 1, stubs: [stub] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true),
                firstResponse = await match.stub.nextResponse(),
                secondResponse = await match.stub.nextResponse(),
                thirdResponse = await match.stub.nextResponse(),
                fourthResponse = await match.stub.nextResponse();

                assert.deepEqual(firstResponse.is, 'first');
                assert.deepEqual(secondResponse.is, 'first');
                assert.deepEqual(thirdResponse.is, 'second');
                assert.deepEqual(fourthResponse.is, 'first');
            });

            it('should support adding responses through addResponse()', async function () {
                const imposter = { port: 1, stubs: [{}] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true);
                await match.stub.addResponse({ is: { field: 1 } });
                const secondMatch = await repo.stubsFor(1).first(() => true),
                response = await secondMatch.stub.nextResponse();

                assert.deepEqual(stripFunctions(response), { is: { field: 1 } });
            });

            it('should support recording matches', async function () {
                const imposter = { port: 1, stubs: [{}] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true);
                await match.stub.recordMatch('REQUEST', 'RESPONSE');
                const all = await repo.stubsFor(1).toJSON({ debug: true });

                assert.strictEqual(1, all[0].matches.length);
                delete all[0].matches[0].timestamp;
                assert.deepEqual(all[0].matches, [{ request: 'REQUEST', response: 'RESPONSE' }]);
            });
        });

        describe('#toJSON', function () {
            it('should return empty array if nothing added', async function () {
                const json = await repo.stubsFor(1).toJSON();
                assert.deepEqual(json, []);
            });

            it('should return all predicates and original response order of all stubs', async function () {
                const first = {
                    predicates: [{ equals: { field: 'value' } }],
                    responses: [{ is: { field: 1 } }, { is: { field: 2 } }]
                },
                second = {
                    responses: [{ is: { key: 'value' }, behaviors: [{ repeat: 2 }] }]
                },
                imposter = { port: 1, stubs: [first, second] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true);
                await match.stub.nextResponse();
                const json = await repo.stubsFor(1).toJSON();

                assert.deepEqual(json, [first, second]);
            });

            it('should not return matches if debug option not set', async function () {
                const imposter = { port: 1, stubs: [{}] };

                await repo.add(imposterize(imposter));
                const match = await repo.stubsFor(1).first(() => true);
                await match.stub.recordMatch('REQUEST', 'RESPONSE');
                const all = await repo.stubsFor(1).toJSON();

                assert.strictEqual(typeof all[0].matches, 'undefined');
            });
        });

        describe('#deleteSavedProxyResponses', function () {
            it('should remove recorded responses and stubs', async function () {
                const first = {
                    predicates: [{ equals: { key: 1 } }],
                    responses: [{ is: { field: 1, _proxyResponseTime: 100 } }]
                },
                second = {
                    predicates: [{ equals: { key: 2 } }],
                    responses: [
                        { is: { field: 2, _proxyResponseTime: 100 } },
                        { is: { field: 3 } }
                    ]
                },
                third = {
                    responses: [{ proxy: { to: 'http://test.com' } }]
                },
                imposter = { port: 1, stubs: [first, second, third] };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).deleteSavedProxyResponses();
                const json = await repo.stubsFor(1).toJSON();

                assert.deepEqual(json, [
                    {
                        predicates: [{ equals: { key: 2 } }],
                        responses: [{ is: { field: 3 } }]
                    },
                    {
                        responses: [{ proxy: { to: 'http://test.com' } }]
                    }
                ]);
            });
        });

        describe('#overwriteAll', function () {
            it('should overwrite entire list', async function () {
                const first = { responses: [{ is: 'first' }, { is: 'second' }] },
                second = { responses: [{ is: 'third' }, { is: 'fourth' }] },
                newStub = { responses: [{ is: 'fifth' }, { is: 'sixth' }] },
                imposter = { port: 1, stubs: [first, second] };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).overwriteAll([newStub]);
                const all = await repo.stubsFor(1).toJSON(),
                responses = all.map(stub => stub.responses);

                assert.deepEqual(responses, [
                    [{ is: 'fifth' }, { is: 'sixth' }]
                ]);
            });
        });

        describe('#overwriteAtIndex', function () {
            it('should overwrite single stub', async function () {
                const first = { responses: [{ is: 'first' }, { is: 'second' }] },
                second = { responses: [{ is: 'third' }, { is: 'fourth' }] },
                newStub = { responses: [{ is: 'fifth' }, { is: 'sixth' }] },
                imposter = { port: 1, stubs: [first, second] };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).overwriteAtIndex(newStub, 1);
                const all = await repo.stubsFor(1).toJSON(),
                responses = all.map(stub => stub.responses);

                assert.deepEqual(responses, [
                    [{ is: 'first' }, { is: 'second' }],
                    [{ is: 'fifth' }, { is: 'sixth' }]
                ]);
            });

            it('should reject the promise if no stub at that index', async function () {
                const imposter = { port: 1 };

                await repo.add(imposterize(imposter));

                try {
                    await repo.stubsFor(1).overwriteAtIndex({}, 0);
                    assert.fail('Should have rejected');
                }
                catch (err) {
                    assert.deepEqual(err, {
                        code: 'no such resource',
                        message: 'no stub at index 0'
                    });
                }
            });
        });

        describe('#deleteAtIndex', function () {
            it('should delete single stub', async function () {
                const first = { responses: [{ is: 'first' }, { is: 'second' }] },
                second = { responses: [{ is: 'third' }, { is: 'fourth' }] },
                third = { responses: [{ is: 'fifth' }, { is: 'sixth' }] },
                imposter = { port: 1, stubs: [first, second, third] };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).deleteAtIndex(0);
                const all = await repo.stubsFor(1).toJSON(),
                responses = all.map(stub => stub.responses);

                assert.deepEqual(responses, [
                    [{ is: 'third' }, { is: 'fourth' }],
                    [{ is: 'fifth' }, { is: 'sixth' }]
                ]);
            });

            it('should reject the promise if no stub at that index', async function () {
                const imposter = { port: 1 };

                await repo.add(imposterize(imposter));

                try {
                    await repo.stubsFor(1).deleteAtIndex(0);
                    assert.fail('Should have rejected');
                }
                catch (err) {
                    assert.deepEqual(err, {
                        code: 'no such resource',
                        message: 'no stub at index 0'
                    });
                }
            });
        });

        describe('#insertAtIndex', function () {
            it('should add single stub at given index', async function () {
                const first = { responses: [{ is: 'first' }, { is: 'second' }] },
                second = { responses: [{ is: 'third' }, { is: 'fourth' }] },
                insertedStub = { responses: [{ is: 'fifth' }, { is: 'sixth' }] },
                imposter = { port: 1, stubs: [first, second] };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).insertAtIndex(insertedStub, 0);
                const all = await repo.stubsFor(1).toJSON(),
                responses = all.map(stub => stub.responses);

                assert.deepEqual(responses, [
                    [{ is: 'fifth' }, { is: 'sixth' }],
                    [{ is: 'first' }, { is: 'second' }],
                    [{ is: 'third' }, { is: 'fourth' }]
                ]);
            });
        });

        describe('#addRequest', function () {
            it('should save request with timestamp', async function () {
                const imposter = { port: 1 };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).addRequest({ field: 'value' });
                const requests = await repo.stubsFor(1).loadRequests();

                assert.deepEqual(requests, [{ field: 'value', timestamp: requests[0].timestamp }]);
                const delta = new Date() - Date.parse(requests[0].timestamp);
                assert.ok(delta < 1000);
                });
        });

        describe('#deleteSavedRequests', function () {
            it('should clear the requests list', async function () {
                const imposter = { port: 1 };

                await repo.add(imposterize(imposter));
                await repo.stubsFor(1).addRequest({ field: 'value' });
                const requests = await repo.stubsFor(1).loadRequests();

                assert.deepEqual(requests, [{ field: 'value', timestamp: requests[0].timestamp }]);

                await repo.stubsFor(1).deleteSavedRequests();
                const secondRequests = await repo.stubsFor(1).loadRequests();
                assert.deepEqual(secondRequests, []);
            });
        });

        describe('#loadRequests', function () {
            it('should return requests in order without losing any', async function () {
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

                const requests = await stubs.loadRequests(),
                values = requests.map(request => request.value);

                assert.deepEqual(values, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            });
        });
    });
});
