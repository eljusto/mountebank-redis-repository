# mountebank-redis-repository

Plugin for [Mountebank](https://github.com/bbyars/mountebank?ysclid=lb2811rutl60384091) to distributedly store imposters in Redis Database.

## Usage

It's recommended to create a wrapper around this plugin to pass on the configuration parameters and your own logger.

```javascript
// impostersRepo.js
const repo = require('mountebank-redis-repository');
const logger = require('pino').child({ _context: 'mountebank-redis-repo' });

const repoConfig = {
  redisOptions: {
    socket: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
    },
    password: process.env.REDIS_PASSWORD,
  },
};

function create(config) {
  const newConfig = {
    ...config,
    impostersRepositoryConfig: repoConfig,
  };
  return repo.create(newConfig, logger);
}

module.exports = {
  create,
};
```

Then, run mb with path to this file: `mb --impostersRepository=./impostersRepo.js`.
