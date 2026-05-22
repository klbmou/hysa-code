export function isValidResponse(res) {
    return !!((res.message && res.message.trim()) || (res.toolCalls && res.toolCalls.length > 0));
}
//# sourceMappingURL=types.js.map