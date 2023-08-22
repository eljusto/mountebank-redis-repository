declare module 'mountebank/src/util/errors' {
    interface Errors {
        MissingResourceError: (str: string) => Error;
    }
    const errors: Errors;
    export default errors;
}
