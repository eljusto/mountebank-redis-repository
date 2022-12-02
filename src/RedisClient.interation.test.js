const child_process = require('child_process');

const RedisClient = require('./RedisClient');

const logger = {
    info: console.log,
    error: console.log,
};

let rs;
let client;

beforeAll(async () => {
    rs = child_process.spawn(
        'redis-server',
        [
            '--port 3333',
            '--save ""',
            '--appendonly no',
            '--dbfilename ""',
            '--appendfilename ""',
            '--appendfsync no',
        ],
        { cwd: process.cwd(), env: process.env, stdio: [ 'inherit', 'pipe', 'inherit' ] }
    );

    rs.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    rs.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
    });
    client = new RedisClient({
            port: '3333',
    }, logger);
});

afterAll(() => {
    rs.removeAllListeners('data');
    rs.removeAllListeners('close');
    client.stop();
    rs.kill();
    return new Promise((resolve) => {
        setTimeout(() => resolve(), 1000);
    });
});

it('write and read object', async () => {
    const obj = {
        some: 'payload',
    };
    await client.setObject('foo', 123, obj);

    const res = await client.getObject('foo', 123);

    expect(res).toStrictEqual(obj);
    return;
});

it('push to object', async () => {
    const obj1 = {
        some: 'payload1',
    };
    const obj2 = {
        some: 'payload2',
    };
    await client.pushToObject('some_lists', 123, obj1);
    await client.pushToObject('some_lists', 123, obj2);

    const res = await client.getObject('some_lists', 123);

    expect(res).toStrictEqual([obj1, obj2]);
    return;
});

it('get all objects', async () => {
    const obj1 = {
        some: 'payload1',
    };
    const obj2 = {
        some: 'payload2',
    };

    await client.setObject('some_entities', 123, obj1);
    await client.setObject('some_entities', 124, obj2);

    const res = await client.getAllObjects('some_entities');

    expect(res).toStrictEqual([obj1, obj2]);
    return;
});

it('delete object', async () => {
    const obj1 = {
        some: 'payload1',
    };
    const obj2 = {
        some: 'payload2',
    };

    await client.setObject('entities', 123, obj1);
    await client.setObject('entities', 124, obj2);
    await client.delObject('entities', 123);

    const res = await client.getAllObjects('entities');

    expect(res).toStrictEqual([obj2]);
    return;
});

it('read non-existing object', async () => {
    const res = await client.getObject('foobar', 123);

    expect(res).toBe(null);
    return;
});

it('read a list of non-existing objects', async () => {
    const res = await client.getAllObjects('kapibar');

    expect(res).toStrictEqual([]);
    return;
});

it('increment counter', async () => {
    await client.incrementCounter('my_counter', 123);
    const res = await client.getObject('my_counter', 123);

    expect(res).toStrictEqual(1);
    return;
});

it('decrement counter', async () => {
    await client.incrementCounter('my_counter', 124);
    const res = await client.getObject('my_counter', 124);

    expect(res).toStrictEqual(1);
    return;
});

it('reset counter', async () => {
    await client.incrementCounter('my_counter', 123);
    await client.incrementCounter('my_counter', 123);
    await client.resetCounter('my_counter', 123);
    const res = await client.getObject('my_counter', 123);
    expect(res).toStrictEqual(0);

    return;
});

it('del all objects', async () => {
    const obj1 = {
        some: 'payload1',
    };
    const obj2 = {
        some: 'payload2',
    };

    await client.setObject('entities_to_del', 123, obj1);
    await client.setObject('entities_to_del', 124, obj2);

    await client.delAllObjects('entities_to_del');
    const res = await client.getAllObjects('entities_to_del');

    expect(res).toStrictEqual([]);
    return;
});

it('subscribe, get message and unsubscribe', (done) => {
    const handleMessagePublished = (message) => {
        try {
            expect(message).toBe('message in the bottle');

            client.unsubscribe('channel_1').then(() => done());
        } catch (error) {
            client.unsubscribe('channel_1').then(() => done(error));
        }
    }

    client.subscribe('channel_1', handleMessagePublished).then(() => {
        client._clientId  = 'ANOTHER_CLIENT_ID';
        client.publish('channel_1', 'message in the bottle');
    });
});

it('subscribe, unsubscribe and check that no message received then', (done) =>  {
    const handleMessagePublished = () => {
        done('should not be called');
    }

    client.subscribe('channel_2', handleMessagePublished).then(() => {
        client._clientId  = 'ANOTHER_CLIENT_ID';
        client.publish('channel_2', 'message in the bottle').then(() => {
            // 2 seconds would be enough to wait for callback
            setTimeout(() => done(), 2000);
        });
    });

   client.unsubscribe('channel_2');
});

it('stop client', async () => {
    await client.stop();

    expect(client.isClosed()).toBe(true);
});
