var _ = require("lodash");
var crypto = require("crypto");

class Fido2ServerError extends Error {
    constructor(message, type) {
        super();
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.message = message;
        this.extra = type;
    }
}

class Fido2Server {
    /**
     * [constructor description]
     * @param  {Object} opts The options for the Fido2Server
     * @return {FIDOServer}      Returns a new Fido2Server object
     */
    constructor(opts) {
        opts = opts || {};

        var defaults = {
            rpid: "example.com", // eTLD + 1
            blacklist: [],
            cryptoParameterPrefs: [],
            challengeSize: 32,
            attestationTimeout: 300, // 5 minutes
            assertionTimeout: 300, // 5 minutes
            version: { // TODO: get this from package.json
                major: 0,
                minor: 8,
                patch: 0
            },
        };
        _.defaultsDeep(opts, defaults);
        _.extend(this, opts);
    }

    /**
     * Gets a challenge and any other parameters for the makeCredential call
     */
    getAttestationChallenge() {
        return new Promise((resolve) => {
            console.log("getAttestationChallenge");

            var challenge = {};
            // TODO: ret.accountInformation = {};
            challenge.blacklist = this.blacklist;
            // TODO: ret.credentialExtensions = [];
            challenge.cryptoParameters = [];
            challenge.attestationChallenge = crypto.randomBytes(this.challengeSize).toString("hex");
            challenge.timeout = this.attestationTimeout;
            resolve(challenge);
        });
    }

    /**
     * Processes the makeCredential response
     */
    makeCredentialResponse(userId, res) {
        return new Promise(function(resolve, reject) {
            console.log(userId);
            console.log(res);

            // validate response
            if (typeof userId !== "string") {
                return reject(new TypeError("makeCredentialResponse: expected userId to be a string"));
            }

            if (typeof res !== "object") {
                return reject(new TypeError("makeCredentialResponse: expected response to be a object"));
            }

            if (typeof res.credential !== "object" ||
                typeof res.credential.type !== "string" ||
                typeof res.credential.id !== "string") {
                return reject(new TypeError("makeCredentialResponse: got an unexpected credential format"));
            }

            if (typeof res.publicKey !== "object") {
                return reject(new TypeError("makeCredentialResponse: got an unexpected publicKey format"));
            }

            // SECURITY TODO: validate public key based on key type
            // SECURITY TODO: verify that publicKey.alg is an algorithm type supported by server

            // SECURITY TODO: validate attestations
            console.log("Attestation:", res.attestation);
            if (res.attestation !== null) {
                return reject(new TypeError("makeCredentialResponse: attestations not currently handled"));
            }

            // save key and credential with account information
            this.account.getUserById(userId)
                .then(function(user) {
                    console.log("makeCredentialResponse User:", user);
                    if (user === undefined) {
                        return reject(new FIDOServerError("User not found", "UserNotFound"));
                    }
                    // SECURITY TODO:
                    // - make sure attestation matches
                    // - lastAttestationUpdate must be somewhat recent (per some definable policy)
                    // -- timeout for lastAttestationUpdate may be tied to the timeout parameter of makeCredential
                    // - save credential
                    // TODO: riskengine.evaluate
                    return this.account.createCredential(userId, res);
                }.bind(this))
                .then(function(cred) {
                    console.log("makeCredentialResponse Cred:", cred);
                    if (cred === undefined) {
                        return reject(new Error("couldn't create credential"));
                    }
                    console.log("created credential:", cred);
                    resolve(cred);
                })
                .catch(function(err) {
                    console.log("makeCredentialResponse error:", err);
                    reject(err);
                });

        }.bind(this));
    }

    /**
     * Creates an assertion challenge and any other parameters for the getAssertion call
     */
    getAssertionChallenge(userId) {
        return new Promise(function(resolve, reject) {
            console.log("getAssertionChallenge");
            // validate response
            if (typeof userId !== "string") {
                return reject(new TypeError("makeCredentialResponse: expected userId to be a string"));
            }

            var ret = {};
            // SECURITY TODO: ret.assertionExtensions = [];
            ret.assertionChallenge = crypto.randomBytes(this.challengeSize).toString("hex");
            ret.timeout = this.assertionTimeout;
            // lookup credentials for whitelist
            console.log("Getting user");
            this.account.updateUserChallenge(userId, ret.assertionChallenge)
                .then(function(user) {
                    // updateUserChallenge doesn't populate credentials so we have to re-lookup here
                    return this.account.getUserById(userId);
                }.bind(this))
                .then(function(user) {
                    if (user === undefined) return (reject(new Error("User not found")));
                    console.log("getAssertionChallenge user:", user);
                    ret.whitelist = _.map(user.credentials, function(o) {
                        return _.pick(o, ["type", "id"]);
                    });
                    console.log("getAssertionChallenge returning:", ret);
                    resolve(ret);
                })
                .catch(function(err) {
                    console.log("ERROR:");
                    console.log(err);
                    reject(err);
                });

        }.bind(this));
    }

    /**
     * Processes a getAssertion response
     */
    getAssertionResponse(userId, res) {
        return new Promise(function(resolve, reject) {
            console.log("getAssertionResponse");
            console.log("res:", res);
            // validate response
            if (typeof userId !== "string") {
                return reject(new TypeError("getAssertionResponse: expected userId to be a string"));
            }

            if (typeof res !== "object") {
                return reject(new TypeError("getAssertionResponse: expected response to be an object"));
            }

            if (typeof res.credential !== "object" ||
                typeof res.credential.type !== "string" ||
                typeof res.credential.id !== "string") {
                return reject(new TypeError("getAssertionResponse: got an unexpected credential format: " + res.credential));
            }

            if (typeof res.clientData !== "string") {
                return reject(new TypeError("getAssertionResponse: got an unexpected clientData format"));
            }

            // SECURITY TODO: clientData must contain challenge, facet, hashAlg

            if (typeof res.authenticatorData !== "string") {
                return reject(new TypeError("getAssertionResponse: got an unexpected authenticatorData format"));
            }

            if (typeof res.signature !== "string") {
                return reject(new TypeError("getAssertionResponse: got an unexpected signature format"));
            }

            console.log(res);
            console.log("Getting user");
            this.account.getUserById(userId)
                .then(function(user) {
                    if (typeof user !== "object") {
                        return reject(new TypeError("User not found: " + userId));
                    }
                    console.log("getAssertionChallenge user:", user);
                    if (user.challenge === undefined ||
                        user.lastChallengeUpdate === undefined) {
                        return reject(new TypeError("Challenge not found"));
                    }
                    console.log(user.challenge);
                    console.log(user.lastChallengeUpdate);
                    // SECURITY TODO: if now() > user.lastChallengeUpdate + this.assertionTimeout, reject()
                    // SECURITY TODO: if res.challenge !== user.challenge, reject()
                    // SECURITY TODO: hash data & verify signature
                    // publicKey.alg = RSA256, ES256, PS256, ED256
                    // crypto.createVerify('RSA-SHA256');
                    // jwkToPem();
                    // SECURITY TODO: verify tokenBinding, if it exists
                    // TODO: process extensions
                    // TODO: riskengine.evaluate
                    var ret = {
                        userId: userId,
                        credential: res.credential,
                        valid: true
                    };
                    resolve(ret);
                })
                .catch(function(err) {
                    reject(err);
                });
        }.bind(this));
    }
}

module.exports = Fido2Server;