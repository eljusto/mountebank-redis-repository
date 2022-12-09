'use strict';

function mock() {
    let wasCalled = false;
    let actualArguments = [];
    let message = '';
    const slice = Array.prototype.slice;
    let retVal;

    function setMessage(expected, actual) {
        message = `\nExpected call with ${ JSON.stringify(expected) }`;
        if (wasCalled) {
            message += `\nActual called with ${ JSON.stringify(actual) }`;
        } else {
            message += '\nActually never called';
        }
    }

    function stubFunction() {
        wasCalled = true;
        actualArguments = slice.call(arguments);
        return retVal;
    }

    stubFunction.returns = function(value) {
        retVal = value;
        return stubFunction;
    };

    stubFunction.wasCalled = () => wasCalled;

    stubFunction.wasCalledWith = function() {
        const expected = slice.call(arguments);
        const actual = actualArguments.slice(0, expected.length); // allow matching only first few params
        setMessage(expected, actualArguments);

        if (JSON.stringify(expected) === '[]') {
            throw new Error('Expected params not captured; please do not convert function to lambda because it loses arguments variable');
        }
        return wasCalled && JSON.stringify(actual) === JSON.stringify(expected);
    };

    stubFunction.message = () => message;

    return stubFunction;
}

module.exports = { mock };
