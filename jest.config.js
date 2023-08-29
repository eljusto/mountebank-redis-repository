module.exports = {
    // preset: 'ts-jest',
    transform: {
        '^.+\\.ts?$': 'ts-jest',
        '^.+\\.js?$': 'babel-jest',
    },
    testEnvironment: 'node',
    transformIgnorePatterns: [
        'node_modules/ioredis',
        'node_modules/testcontainers',
        'node_modules/node-fetch',
    ],
};
