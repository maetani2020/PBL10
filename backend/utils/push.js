const webPush = require('web-push');
const config = require('../config');
const { query } = require('../db');

const vapidReady = !!(config.webPush.publicKey && config.webPush.privateKey);

if (vapidReady) {
    webPush.setVapidDetails(
        config.webPush.subject,
        config.webPush.publicKey,
        config.webPush.privateKey
    );
}

function getVapidPublicKey() {
    return config.webPush.publicKey;
}

function isWebPushEnabled() {
    return vapidReady;
}

function buildPushPayload(payload) {
    return {
        title: String(payload.title || 'Shared Calendar').trim(),
        message: String(payload.message || '').trim(),
        type: payload.type || 'event',
        url: payload.url || '/calendar.html',
        tag: payload.tag || `shared-calendar-${payload.type || 'event'}`,
        sentAt: new Date().toISOString()
    };
}

async function removeSubscription(subscriptionId) {
    if (!subscriptionId) return;
    await query.run('DELETE FROM push_subscriptions WHERE id = ?', [subscriptionId]);
}

async function sendWebPushToSubscription(subscriptionRow, payload) {
    if (!subscriptionRow?.subscription_json) {
        return { skipped: true, reason: 'missing_subscription' };
    }

    const finalPayload = buildPushPayload(payload);

    if (!isWebPushEnabled()) {
        console.log('\n--- [WEB PUSH MOCK] ---');
        console.log(`Subscription ID: ${subscriptionRow.id}`);
        console.log(`Title: ${finalPayload.title}`);
        console.log(`Message: ${finalPayload.message}`);
        console.log('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required for real Web Push delivery.');
        console.log('-----------------------\n');
        return { mock: true };
    }

    try {
        const subscription = JSON.parse(subscriptionRow.subscription_json);
        await webPush.sendNotification(subscription, JSON.stringify(finalPayload), {
            TTL: 60 * 60 * 24
        });
        return { success: true };
    } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
            await removeSubscription(subscriptionRow.id);
            return { removed: true, statusCode: err.statusCode };
        }
        throw err;
    }
}

async function sendWebPushToUser(userId, payload) {
    const subscriptions = await query.all(
        'SELECT id, subscription_json FROM push_subscriptions WHERE user_id = ?',
        [userId]
    );

    const results = [];
    for (const subscription of subscriptions) {
        try {
            results.push(await sendWebPushToSubscription(subscription, payload));
        } catch (err) {
            console.error('Web Push delivery error:', err);
            results.push({ error: err.message });
        }
    }

    return {
        subscriptionCount: subscriptions.length,
        results
    };
}

module.exports = {
    getVapidPublicKey,
    isWebPushEnabled,
    sendWebPushToUser
};
