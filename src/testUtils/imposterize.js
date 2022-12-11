module.exports = function imposterize(config) {
    const cloned = JSON.parse(JSON.stringify(config));
    const result = {
        creationRequest: cloned,
        port: cloned.port,
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
};
