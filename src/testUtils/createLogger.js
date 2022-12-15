function createLogger() {
    return {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        child: createLogger,
    };

}
module.exports = createLogger;
