# Source-evidenced public projection: local candidate

This additive candidate changes the proposed business acceptance boundary from a
blanket manual research review to individually source-evidenced public facts. This
offline policy module does **not** implement publishing, a web endpoint, database
writes, a backend adapter, IAM/Rules changes, or deployment. A separate standalone
public reader consumes only a pinned public payload; see `CATALOG_PUBLIC_UI.md`.
Existing `safety-gate`, TW-06, TW-09, private loader, authentication and research
review states are unchanged.
It neither creates reviewer identities nor claims two reviewers approved anything.

## Offline entry point and trust boundary

`catalog-public-projection.cjs` exports `buildPublicCatalogCandidate`:

```js
buildPublicCatalogCandidate({
  batchBytes,             // Buffer, Uint8Array, or string; exact selected JSON bytes
  registryBytes,          // exact evidence-registry JSON bytes
  trust: {
    batchBytesHash,       // independently pinned SHA-256, lowercase hex
    registryHash,        // independently pinned SHA-256 of registryBytes
    registryVersion     // independently pinned registry revision
  },
  includePartialCompositionFacts: false // default: withhold incomplete compositions
});
```

The function is synchronous, deterministic, non-mutating and has no I/O. Its
result is deeply frozen. A trusted build process must load both the registry and
its independent hash/version pins. **Never accept the registry or its trust pins
from an HTTP caller, browser, research flags, or the same untrusted data source.**
A caller able to replace both a registry and its pin can forge any claim; hashing
is not an authentication mechanism or an official manufacturer signature.

`batchBytesHash` identifies the exact input snapshot, including a legitimately
corrected derived snapshot if applicable. Preserve immutable original bytes and
the original hash separately in the authorized private build process. Do not
commit real research JSON, the private registry, source images/PDFs, or raw dumps.

The policy does not download source files or prove what a URL says. The trusted
registry producer must actually inspect each cited source artifact, hash its
exact bytes, identify the supporting location, resolve conflicts, and pin the
reviewed registry. Replacing a source with a newer online version requires fresh
inspection and a new registry revision/hash. A hash here identifies the reviewed
snapshot, not the current content at a live URL.

## Registry version 1

All keys are exact allowlists; missing or unknown keys fail closed.

```js
{
  schemaVersion: 1,
  registryVersion: 'build-specific-revision',
  batchBytesHash: '<sha256>',
  sources: [{sourceId: 'source_id', url: 'https://official-host/path', bytesHash: '<sha256>'}],
  facts: [{
    section: 'products', recordId: 'product_id', field: 'originalName', value: 'Official name',
    proofs: [{sourceId: 'source_id', sourceBytesHash: '<same sha256>', locator: 'Named table, row',
      subject: {productId: 'product_id', productCode: 'UX-99', optionId: null,
        optionCode: null, groupId: null, contentClaimId: null, partId: null, category: null}}]
  }],
  compositions: [{groupId: 'group_id',
    expectedParts: [{contentClaimId: 'claim_id', partId: 'part_id', category: 'ratchet', quantity: 1}],
    proofs: ['same proof structure, scoped to the exact assembly group']
  }]
}
```

The illustrative `compositions.proofs` string must be replaced by actual proof
objects. Every proof subject includes all eight keys; inapplicable keys are null.
Product facts use product scope; options add option scope; assemblies add group
scope; content facts add claim/part/category scope. The raw option code used for
identity checking is `officialOptionCode ?? reportedOptionCode ?? null`; that
fallback does not certify a retailer's code. Publishing an option code still
requires its own official evidence fact.

Part identity proofs can use a linked content subject or a generic part subject
with only `partId` and `category` non-null. Generic evidence may identify a part
from another official product; it cannot prove inclusion in any particular SKU.
Each content fact must independently establish its exact SKU, option, group,
claim, part and category. All source bytes hashes must match the pinned source
entries. Conflicting/duplicate facts, source versions or manifests fail closed.

## Public field whitelist

- `products`: `productCode`, `originalName`, `line`, `packageType`, `selectionMode`, `releaseDate`
- `parts`: `originalName`, `category`
- `options`: `optionCode`, `originalName`
- `assemblyClaims`: `originalName`
- `contentClaims`: `partId`, `quantity`

Known database IDs and verified relationships become explicit public foreign
keys. Names may be corrected from official evidence without copying research
display names. Product code, part/category, option code, quantity and all identity
relationships must match the pinned input. The policy is generic across the
input's products, rather than hardcoding three SKUs.

No Taiwan naming claim, observed color, weight, performance, compatibility,
legality, image data, variant claim, reviewer UID, credential, note, source dump,
verification flag or research/publication state is a supported public field.
Prototype keys anywhere in either JSON input are rejected. Allowed strings reject
HTML-like delimiters, control characters and obvious private URL/secret content;
future consumers must still render text with safe text-only APIs, never HTML.

Sources must have HTTPS URLs on the exact hosts `beyblade.takaratomy.co.jp`,
`www.takaratomy.co.jp`, or `takaratomymall.jp`. Lookalike/prefix/suffix hosts,
userinfo, non-default ports, fragments, local paths, private paths and query
parameters are rejected. One narrow public mall product-number query is allowed
(`/shop/g/goods.aspx?g=<8–14 digits>`). Valid percent-encoded Japanese path names
are supported; decoding must succeed and decoded controls, backslashes, private
path segments and double encoding are rejected. Credential-bearing paths include
`jsessionid`, access/refresh/id-token names, and private `.env`/`.git` paths, even
when a credential value itself looks ordinary. URLs reference evidence; no image
or PDF bytes are included or redistributed.

## Composition completeness and output separation

A product needs both its evidenced model code and original name. A part needs
its evidenced original name and category. A coded option needs its evidenced name
and code. A fixed option can be an unnamed structural node when an explicit
manifest proves its group/option/product relationship. No name is invented or
copied from a research label. Missing public dependencies withhold dependent records.

A complete assembly needs an explicit source-supported `expectedParts` manifest
and independently evidenced partId and
quantity for **every** input content claim. The manifest must match all claims
exactly and cannot silently omit one. `expectedIndependentParts`, `partsResolved`,
`verified`, supplier tiers and other raw flags never grant completeness. An assembly name is optional and is emitted only with its own proof. A
modeling mismatch (such as a combined component without separately proved
subcomponents) must remain incomplete until the model/evidence is reconciled.

Five-part CX options such as UX-18-03 and UX-18-04 can be complete when all five
claims and their manifest are proved. A single supported UX-18-05 ratchet cannot
be represented as a complete three-part assembly. By default incomplete assembly
relations and content facts are withheld. With explicit `includePartialCompositionFacts:
true`, individually supported content facts instead appear in a separate
`partialCompositionFacts` array with `compositionComplete: false`, referencing
their published option and part but no missing assembly group. They never appear
in `assemblyRelations` or complete `contentFacts`.

Product/option `compositionComplete` stays false in this version: group-level
proof cannot establish that the input includes every option or group a product
contains. Only an individual assembly can be complete. A product can still expose
its independently evidenced name and model. The build returns:

- `status: 'not_published'`, `productionWritable: false`, and `policyVersion`
- `publicPayload`: only `products`, `parts`, `options`, `assemblyRelations`,
  `contentFacts`, and the optional separate `partialCompositionFacts`
- `diagnostics`: separate withheld-record IDs and safe reason codes

Public entities cite only per-field `sourceUrls`; complete manifests additionally
cite `compositionSourceUrls`. Private locators/hashes and research metadata are
not copied. Do not send the whole result or internal validation structures to a
public client. The policy module's validator is internal build plumbing and its
return value includes private input indexes; only `publicPayload` is the intended
public projection. This candidate is not authority to write or release that payload.

## Validation

Run `node --test tests/bey-catalog-public-evidence-policy.test.cjs`. Synthetic-only
fixtures cover deterministic/non-mutating output, exact-byte and revision pins,
missing evidence, forbidden fields/prototype keys, malicious URLs, conflicts,
wrong SKU/part/category, missing dependencies, five-part completeness, incomplete
single-ratchet separation, privacy and the unchanged legacy production denial.
Existing repository regression suites and frontend verification remain required
before any independently authorized integration or release.
