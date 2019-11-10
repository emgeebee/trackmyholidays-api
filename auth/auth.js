'use strict';

console.log('b');
var verifier = require('google-id-token-verifier');

module.exports.auth = function(event, context, callback) {
	console.log('a', event, context);
	// ID token from client.
	var IdToken = 'XYZ123';

	// app's client IDs to check with audience in ID Token.
	var clientId = '195751140228-9tkaoajmqv2ghuh0p1gs0a974aufffuo.apps.googleusercontent.com';

	verifier.verify(IdToken, clientId, function (err, tokenInfo) {
		if (!err) {
			// use tokenInfo in here.
			console.log(tokenInfo);
		}
	};
};
