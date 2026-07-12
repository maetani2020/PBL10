function firstHeaderValue(value) {
    if (Array.isArray(value)) {
        return String(value[0] || '').trim();
    }
    return String(value || '').trim();
}

function normalizeIp(ip) {
    const value = String(ip || '').trim();
    return value.startsWith('::ffff:') ? value.substring(7) : value;
}

function getForwardedForIp(req) {
    const forwardedFor = firstHeaderValue(req.headers?.['x-forwarded-for']);
    return forwardedFor.split(',')[0]?.trim() || '';
}

function getClientIp(req) {
    const cloudflareIp = firstHeaderValue(req.headers?.['cf-connecting-ip']);
    const forwardedForIp = getForwardedForIp(req);
    const directIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';

    return normalizeIp(cloudflareIp || forwardedForIp || directIp);
}

module.exports = {
    getClientIp,
    normalizeIp
};
