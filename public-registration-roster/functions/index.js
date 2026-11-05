'use strict';
const {onDocumentWritten} = require('firebase-functions/v2/firestore');
const {getFirestore} = require('firebase-admin/firestore');
const {createSync} = require('./service.cjs');
// The caller must initialize Firebase Admin before importing this module.
const sync = createSync(getFirestore());
const options = {region:'asia-east1', retry:true, maxInstances:1, concurrency:1};
exports.syncPublicRegistrationRoster = onDocumentWritten({
  ...options,
  document:'tournaments/{code}/registrations/{registrationId}'
}, async event => {
  if (event.data) await sync(event.params.code);
});

exports.refreshPublicRegistrationRoster = onDocumentWritten({
  ...options, document:'tournaments/{code}'
}, async event => {
  if (event.data?.after?.exists) await sync(event.params.code);
});
