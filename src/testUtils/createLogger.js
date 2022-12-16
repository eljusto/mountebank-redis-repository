function createLogger() {
    return {
        debug: jest.fn(),
        // eslint-disable-next-line no-console
        error: jest.fn((...args) => console.log(args)),
        info: jest.fn(),
        warn: jest.fn(),
        child: createLogger,
    };

}
module.exports = createLogger;
