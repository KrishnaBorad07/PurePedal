const config = require('../config');
const logger = require('./logger');

const CHUNK_SIZE = 100;

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function sendPushNotifications(notifications) {
  const tickets = [];
  for (const batch of chunk(notifications, CHUNK_SIZE)) {
    try {
      const res = await fetch(config.expo.pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      const { data } = await res.json();
      for (const ticket of data) {
        if (ticket.status === 'error') {
          logger.error({ ticket }, 'pushClient: notification delivery error');
        }
        tickets.push(ticket);
      }
    } catch (err) {
      logger.error({ err }, 'pushClient: failed to send batch');
    }
  }
  return tickets;
}

async function sendPushNotification(token, title, body, data) {
  return sendPushNotifications([{ to: token, title, body, data, sound: 'default', priority: 'high' }]);
}

module.exports = { sendPushNotifications, sendPushNotification };
