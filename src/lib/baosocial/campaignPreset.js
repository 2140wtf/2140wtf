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
