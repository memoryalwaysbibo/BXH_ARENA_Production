'use strict';
/** Offline, allowlisted public candidate. Not an endpoint or publication authorization. */
const {POLICY_VERSION, FIELDS, IDS, deepFreeze, validateEvidenceRegistry} = require('./catalog-source-evidence-policy.cjs');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function buildPublicCatalogCandidate(input = {}) {
  if (Object.keys(input).some(k => !['batchBytes', 'registryBytes', 'trust', 'includePartialCompositionFacts'].includes(k)))
    throw Error('PUBLIC_EVIDENCE_UNKNOWN_BUILD_OPTION');
  const includePartial = input.includePartialCompositionFacts ?? false;
  if (typeof includePartial !== 'boolean') throw Error('PUBLIC_EVIDENCE_PARTIAL_OPTION_INVALID');
  const {index, sources, facts, compositions} = validateEvidenceRegistry(input);
  const diagnostics = [];
  const publicPayload = {products: [], parts: [], options: [], assemblyRelations: [], contentFacts: []};
  if (includePartial) publicPayload.partialCompositionFacts = [];
  const fact = (section, id, field) => facts.get(`${section}/${id}/${field}`);
  const urls = proofs => [...new Set(proofs.map(p => sources.get(p.sourceId).url))].sort(compare);
  const fieldProjection = (section, id) => {
    const out = {}, sourceUrls = {};
    for (const field of FIELDS[section]) {
      const f = fact(section, id, field);
      if (f) { out[field] = f.value; sourceUrls[field] = urls(f.proofs); }
    }
    return {...out, sourceUrls};
  };
  const rows = section => [...index[section].values()].sort((a, b) => compare(a[IDS[section]], b[IDS[section]]));
  const products = new Set(), parts = new Set(), options = new Set();
  for (const p of rows('products')) {
    if (fact('products', p.productId, 'productCode') && fact('products', p.productId, 'originalName')) {
      publicPayload.products.push({productId: p.productId, ...fieldProjection('products', p.productId), compositionComplete: false});
      products.add(p.productId);
    } else diagnostics.push({code: 'PRODUCT_IDENTITY_WITHHELD', recordId: p.productId});
  }
  for (const p of rows('parts')) {
    if (fact('parts', p.partId, 'originalName') && fact('parts', p.partId, 'category')) {
      publicPayload.parts.push({partId: p.partId, ...fieldProjection('parts', p.partId)});
      parts.add(p.partId);
    } else diagnostics.push({code: 'PART_IDENTITY_WITHHELD', recordId: p.partId});
  }
  for (const o of rows('options')) {
    const hasName = fact('options', o.optionId, 'originalName');
    const needsCode = (o.officialOptionCode ?? o.reportedOptionCode) != null;
    const structuralManifests = [...compositions.values()].filter(m => index.assemblyClaims.get(m.groupId).optionId === o.optionId);
    const evidenced = needsCode ? hasName && fact('options', o.optionId, 'optionCode') : hasName || structuralManifests.length > 0;
    if (products.has(o.productId) && evidenced) {
      const projected = fieldProjection('options', o.optionId);
      if (!hasName) {
        projected.sourceUrls.optionId = urls(structuralManifests.flatMap(m => m.proofs));
        projected.sourceUrls.productId = [...projected.sourceUrls.optionId];
      }
      publicPayload.options.push({optionId: o.optionId, productId: o.productId,
        ...projected, compositionComplete: false});
      options.add(o.optionId);
    } else diagnostics.push({code: 'OPTION_WITHHELD', recordId: o.optionId});
  }
  for (const g of rows('assemblyClaims')) {
    const claims = rows('contentClaims').filter(c => c.groupId === g.groupId);
    const dependencies = products.has(g.productId) && options.has(g.optionId);
    const ready = claims.filter(c => dependencies && parts.has(c.partId) &&
      fact('contentClaims', c.contentClaimId, 'partId') && fact('contentClaims', c.contentClaimId, 'quantity'));
    const manifest = compositions.get(g.groupId);
    const complete = dependencies && manifest &&
      ready.length === claims.length && claims.length > 0;
    const projectClaim = c => ({contentClaimId: c.contentClaimId, productId: c.productId,
      optionId: c.optionId, groupId: c.groupId, ...fieldProjection('contentClaims', c.contentClaimId)});
    if (complete) {
      publicPayload.assemblyRelations.push({groupId: g.groupId, productId: g.productId, optionId: g.optionId,
        ...fieldProjection('assemblyClaims', g.groupId), compositionComplete: true,
        expectedParts: manifest.expectedParts.map(p => ({contentClaimId: p.contentClaimId, partId: p.partId,
          category: p.category, quantity: p.quantity})).sort((a, b) => compare(a.contentClaimId, b.contentClaimId)),
        compositionSourceUrls: urls(manifest.proofs)});
      publicPayload.contentFacts.push(...ready.map(projectClaim));
    } else {
      diagnostics.push({code: 'COMPOSITION_INCOMPLETE', recordId: g.groupId});
      if (includePartial) publicPayload.partialCompositionFacts.push(...ready.map(c => {
        const out = projectClaim(c);
        // A partial fact refers to its option, not to a missing public assembly entity.
        delete out.groupId;
        return {...out, compositionComplete: false};
      }));
    }
  }
  // A group manifest proves that group only. It cannot prove that the raw batch
  // contains every option/group sold in a product. Product/option completeness
  // stays false until a future separately evidenced inventory-scope contract.
  // No raw record spreading, proof locators, source dumps, reviewer identities, or private diagnostics in this payload.
  return deepFreeze({status: 'not_published', policyVersion: POLICY_VERSION,
    productionWritable: false, publicPayload, diagnostics});
}
module.exports = {buildPublicCatalogCandidate};
