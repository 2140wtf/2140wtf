# Canonical input validation (R03 containment)

The existing `baoLedger` helper uses recursively sorted, NFC-normalized JSON
and bare hexadecimal BLAKE3 digests. The normative document also contains
schema-order, prefix and nonce-elision requirements that are not reconciled
with this implementation. This fix does not freeze a wire contract or rename
ProofMeta; those review items remain open.

Valid plain JSON with safe integer numbers keeps its existing encoding.
Inputs that cannot be represented faithfully are rejected: unsafe numbers,
BigInt, undefined, functions, symbol keys, sparse or augmented arrays,
non-plain objects, accessors/hidden fields, cyclic data, normalized-key
collisions, and unpaired UTF-16 surrogates. Shared acyclic objects and
null-prototype dictionaries remain supported. Negative zero encodes as zero.

Tests pin literal output bytes for safe integer endpoints and non-ASCII
ordering, verify rejection of ambiguous inputs, and ensure hashing does not
invoke getters. These are input-domain regressions, not independent Merkle
vectors or a resolution of the broader protocol byte-order/hash-format issue.
