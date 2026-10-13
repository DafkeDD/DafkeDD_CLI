/**
 * Login with the Belgian eID through DafkeDD eID (https://github.com/DafkeDD/DafkeDD_EID): the library checks the token
 * on the server (@dafkedd/eid/server) and gives the frontend its React hooks (@dafkedd/eid/react). It is installed from
 * the release on GitHub. The users run the DafkeDD eID program (the bridge) on their PC.
 */
export const EID_VERSION = '0.2.0'
export const EID_PACKAGE = `@dafkedd/eid@https://github.com/DafkeDD/DafkeDD_EID/releases/download/v${EID_VERSION}/dafkedd-eid-${EID_VERSION}.tgz`
export const EID_BRIDGE_DOWNLOAD = 'https://github.com/DafkeDD/DafkeDD_EID/releases/latest'
export const EID_BRIDGE_PORT = 47820
/** The PIN of the virtual card of `dafke-eid --mock`. */
export const EID_MOCK_PIN = '1234'
/** npm run eid:mock in the frontend: the bridge with a virtual reader and card, allowed to log in on port 3000. */
export const EID_MOCK_SCRIPT = 'dafke-eid --mock --auth-origin http://localhost:3000'
