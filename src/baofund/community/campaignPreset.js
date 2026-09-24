/** Suggested slash commands every campaign room publishes as a manifest. */
export const CAMPAIGN_COMMANDS = [
    { name: 'goal', description: 'Show the campaign goal and current funded total', args: [] },
    {
        name: 'backers',
        description: 'List corroborated funders so far',
        args: [{ name: 'limit', type: 'string', description: 'max entries to print', required: false }],
    },
    {
        name: 'pledge',
        description: 'State your pledge intent on the record (credits request path)',
        args: [
            { name: 'sats', type: 'string', description: 'amount in sats', required: true },
            { name: 'note', type: 'string', description: 'optional note', required: false },
        ],
    },
];
/** Admission policy for a private funding-offer room. The creator/fundraising
 * agent enters through the founder-attestation lane; every investor/donor
 * must present a one-use blind credential bound to this room. The BAO Fund
 * issuer releases that credential only after verifying participation in the
 * specific offer, so possession of a chat invite is never sufficient. */
export function privateOfferAdmissionMenu(participantIssuers) {
    if (!Array.isArray(participantIssuers) || participantIssuers.length === 0) {
        throw new Error('private offer requires at least one participant credential issuer');
    }
    return {
        or: [
            { and: ['founder-attestation'] },
            ...participantIssuers.map((issuerPub) => ({ and: [{ checker: 'trade-credential', issuerPub }] })),
        ],
    };
}
/**
 * Directory row for a PUBLIC campaign room. Campaign rooms are public by
 * nature (fundraising is the point); private campaigns simply never call
 * this. policy defaults to cap-pow: open enough to onboard strangers,
 * hostile-crowd resistant.
 */
export function campaignDirectoryRow(o) {
    if (!o.name?.trim())
        throw new Error('campaign: name required');
    if (o.goalSats !== undefined && (!Number.isSafeInteger(o.goalSats) || o.goalSats <= 0)) {
        throw new Error('campaign: goalSats must be a positive integer');
    }
    const goal = o.goalSats !== undefined ? ` · goal ${o.goalSats} sats` : '';
    return {
        name: o.name.trim().slice(0, 80),
        topic: `${o.topic ?? 'Funding campaign'}${goal}`.slice(0, 200),
        policy: 'cap-pow',
    };
}
