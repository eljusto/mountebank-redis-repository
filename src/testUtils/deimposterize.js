const stripFunctions = require('./stripFunctions');

module.exports = function deimposterize(obj) {
    const withoutFunctions = stripFunctions(obj);
    if (Array.isArray(withoutFunctions)) {
        withoutFunctions.forEach(imposter => {
            delete imposter.creationRequest;
        });
    }
    delete withoutFunctions.creationRequest;
    return withoutFunctions;
};
