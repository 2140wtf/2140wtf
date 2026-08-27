/**
 * campaignPreset — bao.fund funding-campaign room preset (#7).
 *
 * Convention layer over existing primitives: admission posture defaults,
 * a bot-command manifest template, and directory metadata for PUBLIC
 * campaign rooms. No wire changes — everything rides existing payload
 * conventions (botCommands manifest, P6b directory tags).
 */
import type { BotCommand } from './botCommands.js';
/** Suggested slash commands every campaign room publishes as a manifest. */
export declare const CAMPAIGN_COMMANDS: BotCommand[];
export interface CampaignRoomOptions {
    /** Public display name, e.g. "Cycle 12 — LN routing bounties". */
    name: string;
    /** Funding goal in sats (advertised in the directory topic). */
    goalSats?: number;
    topic?: string;
}
/**
 * Directory row for a PUBLIC campaign room. Campaign rooms are public by
 * nature (fundraising is the point); private campaigns simply never call
 * this. policy defaults to cap-pow: open enough to onboard strangers,
 * hostile-crowd resistant.
 */
export declare function campaignDirectoryRow(o: CampaignRoomOptions): {
    name: string;
    topic: string;
    policy: "cap-pow";
};
