const ws = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');

let wss = null;
// Map user ID to Set of active socket connections
const userConnections = new Map();

function initWebSocket(server) {
    wss = new ws.Server({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
        // Handle WebSocket requests
        wss.handleUpgrade(request, socket, head, (wsConn) => {
            wss.emit('connection', wsConn, request);
        });
    });

    wss.on('connection', (wsConn) => {
        let authenticatedUserId = null;

        wsConn.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                if (data.type === 'auth') {
                    const token = data.token;
                    jwt.verify(token, config.jwt.secret, (err, decoded) => {
                        if (err) {
                            wsConn.send(JSON.stringify({ type: 'error', message: '認証に失敗しました' }));
                            wsConn.close();
                            return;
                        }

                        authenticatedUserId = decoded.id;
                        if (!userConnections.has(authenticatedUserId)) {
                            userConnections.set(authenticatedUserId, new Set());
                        }
                        userConnections.get(authenticatedUserId).add(wsConn);
                        wsConn.send(JSON.stringify({ type: 'auth_success', userId: authenticatedUserId }));
                    });
                }
            } catch (err) {
                console.error('WebSocket message error:', err);
            }
        });

        wsConn.on('close', () => {
            if (authenticatedUserId && userConnections.has(authenticatedUserId)) {
                const conns = userConnections.get(authenticatedUserId);
                conns.delete(wsConn);
                if (conns.size === 0) {
                    userConnections.delete(authenticatedUserId);
                }
            }
        });
    });
}

function sendToUser(userId, data) {
    const conns = userConnections.get(userId);
    if (conns) {
        const payload = JSON.stringify(data);
        for (const conn of conns) {
            if (conn.readyState === ws.OPEN) {
                conn.send(payload);
            }
        }
    }
}

function sendToUsers(userIds, data) {
    for (const userId of userIds) {
        sendToUser(userId, data);
    }
}

module.exports = {
    initWebSocket,
    sendToUser,
    sendToUsers
};
