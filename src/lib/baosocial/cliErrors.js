/** Order matters: retryable-admission beats link-shape when both could match. */
export function classifyCliError(message) {
    const m = String(message);
    if (/timed out waiting for welcomer wrap|admission unreachable|connection lost before relay answered/i.test(m)) {
        return { code: 4, token: 'ADMISSION_UNREACHABLE' };
    }
    if (/expired|used up|max uses/i.test(m))
        return { code: 3, token: 'LINK_EXHAUSTED' };
    if (/no fragment|malformed or was truncated|fragment too large|bad invite secret|bad room id|carries no relay/i.test(m)) {
        return { code: 3, token: 'LINK_INVALID' };
    }
    return { code: 1, token: 'ERROR' };
}
