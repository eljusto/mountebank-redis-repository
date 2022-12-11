module.exports = function stripFunctions(obj) {
    return JSON.parse(JSON.stringify(obj));
};
