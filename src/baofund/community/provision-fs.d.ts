import type { ChatRoomEntry } from './provision-core.js';
/** Atomically upsert room(s) into a rooms file: tmp + rename so a
 *  hot-reloading daemon never reads a torn file. Existing rooms with the
 *  same roomId are replaced (not duplicated); unknown app fields on existing
 *  entries survive; retention is serialized to the daemon string form. */
export declare function writeRoomsFile(file: string, entryOrEntries: ChatRoomEntry | ChatRoomEntry[]): void;
/** Tolerant read: missing file → []; structurally invalid file
 *  (not { rooms: [...] }) throws — callers decide keep-current vs fail,
 *  exactly like the daemons' reconcile loop; a single bad/foreign entry is
 *  skipped, never fatal. Retention is normalized to object form. */
export declare function readRoomsFile(file: string): ChatRoomEntry[];
