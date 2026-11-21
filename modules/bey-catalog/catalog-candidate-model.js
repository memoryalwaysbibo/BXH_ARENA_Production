/* Candidate image pairings only. Never an official-name or release-status authority. */
'use strict';
(function(root) {
  const HASH = /^[a-f0-9]{64}$/;
  const validHash = value => typeof value === 'string' && HASH.test(value);
  const KEYS = ['recordId','imageURL','sourceURL','sourceImageURL','imageSha256','sourceImageSha256','pairingConfidence','status'];
  const fail = () => { throw new Error('INVALID_CANDIDATE_MANIFEST'); };
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
  function publicURL(value, allowlist) {
    if (typeof value !== 'string' || value.length > 1000 || /[\s\\]/u.test(value) || !allowlist.has(value)) fail();
    let url; try { url = new URL(value); } catch { fail(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.href !== value) fail();
    return value;
  }
  function validate(data, policy) {
    if (!policy || !validHash(policy.inventorySha256) || !Array.isArray(policy.recordIds) || !Array.isArray(policy.sourceURLs)) fail();
    if (!exact(data,['schemaVersion','inventorySha256','entries']) || data.schemaVersion !== 1 || data.inventorySha256 !== policy.inventorySha256 || !Array.isArray(data.entries) || data.entries.length > 285) fail();
    const ids = new Set(policy.recordIds), urls = new Set(policy.sourceURLs), seen = new Set();
    const entries = data.entries.map(row => {
      const userSupplied = row?.pairingConfidence === 'user_assigned';
      if (!exact(row,userSupplied ? [...KEYS,'provenance','rightsStatus'] : KEYS) || (userSupplied && (row.provenance !== 'user_supplied_retail_source' || row.rightsStatus !== 'unverified')) || typeof row.recordId !== 'string' || !/^supplied_20261014_\d{4}$/.test(row.recordId) || !ids.has(row.recordId) || seen.has(row.recordId) || !validHash(row.imageSha256) || !validHash(row.sourceImageSha256) || !['.webp','.png'].some(ext => row.imageURL === 'assets/bey-catalog/candidates/' + row.imageSha256 + ext) || !['exact_variant','product_reference','user_assigned'].includes(row.pairingConfidence) || row.status !== 'candidate') fail();
      publicURL(row.sourceURL,urls); publicURL(row.sourceImageURL,urls); seen.add(row.recordId);
      return Object.freeze({...row});
    });
    return Object.freeze({schemaVersion:1,inventorySha256:data.inventorySha256,entries:Object.freeze(entries)});
  }
  const canonical = value => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key,value[key]])));
  async function digest(bytes, cryptoProvider = globalThis.crypto) {
    if (!cryptoProvider?.subtle) throw new Error('SECURE_CONTEXT_REQUIRED');
    return Array.from(new Uint8Array(await cryptoProvider.subtle.digest('SHA-256',bytes)), b => b.toString(16).padStart(2,'0')).join('');
  }
  async function candidateVersion(row, cryptoProvider) { return digest(new TextEncoder().encode(canonical(row)), cryptoProvider); }
  async function decodeSnapshot(buffer, policy, cryptoProvider) {
    if (!(buffer instanceof ArrayBuffer) || !Number.isSafeInteger(policy?.bytes) || policy.bytes <= 0 || policy.bytes > 1048576 || buffer.byteLength !== policy.bytes || !validHash(policy.sha256) || await digest(buffer,cryptoProvider) !== policy.sha256) throw new Error('CANDIDATE_VERSION_MISMATCH');
    return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)),policy);
  }
  const api = Object.freeze({validate,decodeSnapshot,candidateVersion});
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BXHCandidateImages = api;
})(typeof window === 'object' ? window : globalThis);
