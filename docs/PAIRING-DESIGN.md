# Multi-server pairing design

Status: signed two-owner pairing, replay protection, live peer status, revocation
notifications and protected HTTPS transport are implemented behind an explicit
experimental opt-in. Pairing grants no account/resource access. Foreign accounts
and guest sessions remain unimplemented. Independent protocol/security review,
public-HTTPS drills and recovery integration remain gates before guest enablement.
See [operator commands](DEPLOYMENT.md#offline-peer-identity-preparation) and the
[pairing API](API.md#experimental-multi-server-pairing).

Core assigns durable account subject UUIDs while preserving numeric local IDs
and existing sessions. The offline tool creates an independent server UUID,
Ed25519 key and instance generation in a separate protected authority database.
Its public descriptors are unsigned preparation metadata, not proof of key
possession or completed pairing. Manual fingerprint confirmation only stages a
pending record. The foundation pin table still cannot represent active trust.
The separate protocol table records local activation only after the signed
transcript and both local owner approvals; staged pins never activate themselves.
Effective trust requires a fresh signed peer status, not a stored active flag.

## First use case and boundaries

A user of HOME A may view and complete one task explicitly shared by its owner
on HOME B. Pairing establishes server identity; it grants no user or resource
access. B's local owner approves the exact foreign subject and task separately.
Existing local assignments retain their current behavior.

Core owns peer identity and guest authentication. Tasks owns its resource ACL
and verifies authority through Core's API, never another service's database.
Bridge is not an identity authority. This design excludes account merging,
foreign administrators, general household membership, directory synchronization,
Cloud/Vault access, shared passwords, shared JWT secrets and storage replication.
The address portal remains a shortcut list. No remote HTML or scripts run inside
HOME's shared application origin.

## Identity and transport

Generate a random, stable federation server UUID and an independent Ed25519
signing key. Neither the operational installation UUID nor a DNS name proves
identity. Pin the server UUID, exact HTTPS issuer/origin, key ID, public JWK,
its [RFC 7638 thumbprint](https://www.rfc-editor.org/rfc/rfc7638.html), and an
instance generation. Federation keys are separate from local HS256 sessions,
service secrets, application keys, automation credentials and Vault keys.
Keep private keys and restore-control state in protected operator configuration,
outside ordinary application database snapshots and exports.

Each account receives an opaque, durable subject UUID that is never reused.
The foreign identity is `(server UUID, subject UUID)`. Numeric IDs, usernames,
display names and administrator roles are not portable authority. A renamed
account retains its subject; a replacement account cannot inherit its grants.

Pairing requires independently reachable HTTPS servers with valid certificates
and public DNS. Guest access additionally needs a separate configured guest
origin on the receiving server. Local HTTP operation remains available without pairing.
Private LAN/VPN pairing needs a later transport design; it must not become an
implicit exception to outbound request protection. Setup never changes routers,
firewalls, DNS or certificates automatically.

Only exact configured origins are contacted: no userinfo, path, query, fragment,
redirects, arbitrary discovery URLs or token-supplied key URLs. Validate all DNS
answers before every connection; reject loopback, private, link-local, reserved,
shared-address and IPv4-mapped equivalents. Connect to the validated address
without resolving again, verify the connected address and original TLS hostname,
and restrict egress away from internal services. Do not inherit an unreviewed
HTTP proxy. Origin/key changes suspend trust pending approval; normal public DNS
address changes may pass the same validation again. Initial bounds: five-second
requests, 32 KiB messages, four concurrent peer requests per peer and bounded
queues. Exceeding capacity fails closed with a retryable unavailable response.

## Pairing ceremony

Both installations need a local administrator with fresh authentication within
five minutes and 2FA when configured. Existing local session and CSRF protections
apply. A signed claim that someone is a remote administrator never authorizes
local administration.

1. A creates a signed offer containing protocol version, invitation ID, A's
   identity/pins/generation, a random nonce and ten-minute expiry. It also creates
   a 256-bit one-use invitation secret, retaining only its hash. Transfer the
   invitation through a trusted channel; never place the secret in a URL or log.
2. B's administrator imports the offer and independently checks A's origin and
   full fingerprint before producing B's signed acceptance. Acceptance binds
   the exact offer bytes, B's identity/pins/generation and a fresh nonce. B sends
   the secret in an HTTPS POST body. A atomically binds its consumption to this
   B identity; competing attempts cannot replace the binding.
3. Both owners compare the full transcript fingerprint through an independently
   trusted channel. Compute it with SHA-256 over a fixed versioned domain label,
   newline, exact compact offer JWS, newline and exact compact acceptance JWS.
   These encodings cannot contain newlines. Do not invent JSON canonicalization.
   The secret is excluded from stored transcripts and audit events. B explicitly
   approves the resulting full transcript through its local administrator API
   after comparison; acceptance alone does not supply this final approval.
4. A explicitly approves B and signs confirmation of the transcript, both
   identities, generations and supported protocol. B acknowledges the same
   transcript before A sends its activation acknowledgement. All messages are
   bound to a fresh pair ID. Retries are idempotent for this transcript only.

The durable state machine is offered -> pending -> ready -> active, with
suspended and permanently revoked states. Partial ceremonies expire after ten
minutes. Distributed activation is not atomic: loss of the final acknowledgement
can leave one side waiting. Authorization requires both local active state and a
fresh signed active status from the peer for the same transcript and generations.
The UI reports waiting/unavailable rather than successful effective access.
Revoke cancels partial ceremonies too; a revoked pair ID is never reactivated.
Re-pairing requires a fresh invitation, pair ID and both approvals. Offers can
be revoked before any peer accepts. Approval snapshots are checked against the
current local administrator role, enabled state and token epoch until activation;
active server identity trust is independent of later local password changes.

## Signed back-channel profile

Use a reviewed JOSE implementation with [RFC 8037 Ed25519 keys](https://www.rfc-editor.org/rfc/rfc8037.html).
Post-bootstrap messages are compact JWS objects with fixed EdDSA algorithm,
protected type `home-peer-message+jwt` and a pinned key ID. Reject algorithm/key
substitution, unknown critical headers, duplicate JSON members and malformed or
oversized input before side effects. Keys come only from the local peer record.

Every message includes sender server UUID, recipient server UUID, exact target
origin, operation, pair ID, both instance generations, transaction ID, issued
time, expiry, random 256-bit message ID and the complete operation payload.
Maximum lifetime is 60 seconds with at most 30 seconds clock tolerance. Bind
the operation to a fixed route: signatures cannot authorize a generic URL fetch.
Responses bind the request transaction and operation as well as sender/recipient,
and hash the exact request JWS so an old status reply cannot answer a new request.
Validate every field and current trust state, not just the signature.

Persist replay IDs atomically with mutations through expiry plus tolerance.
Restarts cannot erase the replay window; capacity exhaustion refuses new work
rather than evicting live entries. Retry with a new message ID and the same
transaction/payload digest may return the recorded result only after current
trust checks. A changed payload conflicts; revocation overrides cached success.
Unexpected clock rollback suspends federation until repaired, using a persisted
time high-water mark. Inspection and refused protocol requests also record the
observed clock before expiry checks. Time is never the sole revocation mechanism.

The implementation pins `jose@6.2.15` for JOSE signing/verification and
`ipaddr.js@2.5.0` for address classification. Neither adds production transitive
dependencies or installation scripts. Transport checks every A/AAAA answer,
pins the selected address, verifies the connected address and certificate hostname,
and uses an explicit agent with no environment proxy. Outbound and incoming peer
requests have five-second deadlines; local administration has 15 seconds for its
two back-channel phases. There are four concurrent requests per peer and 32
operations globally. Replay capacity is 4,096 live IDs per peer / 16,384 total;
never evict a live ID. Retain at most 10,000 invitations/pin records and refuse
new preparation at capacity rather than forgetting a tombstone. Revocation retries
use a private durable outbox with bounded exponential backoff. These bounds are
protocol implementation decisions, not new guarantees about the public network.

Separate validators and keys prevent local sessions, identity assertions, peer
messages, app keys and guest credentials from being interchangeable. This follows
the validation separation guidance in [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html);
it is not a claim of independent review or protocol certification.

## Foreign user authentication and resource grants

Use an OpenID Connect authorization-code profile with mandatory PKCE S256,
transaction-bound state and nonce, and exact pre-registered redirect URIs.
Credentials are entered only at A. B records the selected issuer and verifier
server-side before redirecting. Bind the authorization response to that issuer
to prevent mix-up; do not support implicit or password grants. See
[OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html),
[PKCE](https://www.rfc-editor.org/rfc/rfc7636.html) and the
[OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html).
Conformance must be established during implementation, not assumed here.

The one-use authorization code expires within 60 seconds. Exchange requires B's
signed back channel, exact redirect and PKCE proof. A's signed identity assertion
has a distinct validation profile: exact HTTPS issuer URL, pinned server UUID
and generation, subject UUID, B's registered client audience, authorized party
where required, nonce, authentication time, issued/expiry time and unique ID.
Its maximum lifetime is 60 seconds. No foreign roles or resource grants are
trusted. The issuer URL identifies the OIDC issuer; the pinned server UUID is
the durable namespace. Changing either is never silent account linking.

A resource invitation alone is not authority. A consents to providing a bounded
identity proof for the intended recipient; B's local owner approves that exact
subject tuple and task. A forwarded invitation cannot attach another subject.
B never creates or links a local user automatically. The local grant contains
owner ID, foreign tuple, task ID, allowed actions, pair generation and revocation
state. The initial actions are view, complete and decline, matching the limited
assignee workflow; edit, delete, reopen, project access and recipient reassignment
remain owner-only. Owners can remove the grant locally at any time.

B issues an opaque, hash-stored guest session with a separate prefix, maximum
15-minute lifetime and no refresh token. Its Secure, HttpOnly cookie belongs only
to the isolated guest origin; normal HOME localStorage/session credentials are
never copied there. The guest UI serves trusted local code, uses restrictive CSP
and protects state-changing requests against CSRF. A cookie path alone does not
provide origin isolation.

Core returns an explicit `federated-guest` principal containing peer, foreign
subject, pair generation, grant, application audience and allowed actions.
It never synthesizes a numeric local user ID or normal user/admin role. Separate
guest routes check the live Tasks ACL for the exact task on every operation;
normal application/admin/Vault/app-key/delegation routes reject guest credentials.
Existing normal-session verification caches cannot authorize guests.

Each protected guest request checks B's current session, pair and resource grant,
then obtains A's authenticated live subject status: account enabled, current
account token epoch and pair active for the same generations. There is no
positive authority cache. Offline, timeout, malformed status or queue exhaustion
returns a bounded retryable failure, never stale access. Already authorized
in-flight work may finish. This deliberately trades offline guest availability
for revocation at the next authorization check.

## Revocation, rotation and recovery

Local peer suspension/revocation atomically blocks guests, advances authority
state, records a durable tombstone/audit event and queues a signed notification.
Subject disable and sign-out-everywhere on A invalidate foreign sessions through
live epoch checks. B can independently revoke one guest or resource grant without
contacting A. Notifications retry but are not the authority: an unreachable peer
cannot pass live checks. Do not promise cancellation of an already authorized
request or instantaneous delivery across an outage.

Planned key/origin changes require proof from the old and new keys and explicit
approval by both local owners. Advance generations, invalidate guest sessions
and suspend grants until their local owners reconfirm them. Do not automatically
trust a refreshed JWKS or a valid certificate for a replacement key. Lost or
compromised keys require a new server UUID/key and a new two-owner ceremony;
peers revoke the old identity. The compromised key alone cannot approve recovery.

Every restore, import or clone must start with federation disabled before any
listener accepts peer traffic. Generate a fresh instance generation in protected
restore-control state outside the restored database. Preserve revocation
tombstones independently; never restore old active trust from application data.
Peers observing a generation change suspend the pair. Recovery requires fresh
mutual pairing and new owner-approved resource grants; ordinary local recovery
must still work with federation off. Partial restore publication blocks startup.

An application cannot detect rollback of all its keys, database and external
control state by inspecting that same snapshot. Whole-machine recovery therefore
requires an operator-enforced restore gate or independent non-rollback state;
implementation must document and test this prerequisite. A copied identity must
never run concurrently as a second trusted HOME. A compromised issuer can lie
about its own users until revoked, but cannot expand B's local resource ACL.

Audit actor, peer/pair IDs, fingerprints, operation/result and generation changes;
never invitation secrets, passwords, codes, assertions or session tokens. Peer
metadata and foreign subject labels are private administrative information.

## Implementation and enablement gates

The [API guide](API.md#experimental-multi-server-pairing) owns implemented local
administrator and fixed `/federation/v1/` protocol routes. Guest resource routes
remain proposals and must not be mounted until typed authentication and resource
authorization exist. Do not mount a generic peer proxy or extend the local JWT validator.

Implement in these bounded slices, default off throughout:

1. Durable identities, protected peer records, signed pairing/status/revoke
   operations, replay ledger and transport are complete behind experimental
   opt-in. No foreign user access is enabled. Local TLS and adversarial checks are
   recorded in [validation](VALIDATION.md#multi-server-pairing).
2. Reviewed OIDC/JOSE library integration, typed guest principals, isolated guest
   origin and explicit Tasks foreign-subject ACLs. No general foreign login.
3. Revocation/rotation/restore integration across both source and managed runtime
   paths, then two isolated HTTPS HOME end-to-end drills and independent protocol
   review before enabling guest access.

Required adversarial proof includes invitation races/reuse, substituted pins and
transcripts, partial activation, revoked-state retries, replay after restart,
ledger exhaustion, clock rollback, wrong algorithm/type/key/issuer/audience,
code/nonce/PKCE reuse, login CSRF and issuer mix-up. Test foreign/local ID collisions,
forwarded invitations, denied resources/actions and guest rejection on every
normal credential path. Exercise redirect/DNS-rebinding/mapped-IP/proxy SSRF,
peer outages, next-request revocation, in-flight limits, key loss, origin changes,
old backup import and cloned identity startup. Store wire vectors and actual
results; passing unit tests alone does not establish independent review or
physical recovery. Storage replication needs its own use case and design.
