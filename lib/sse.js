/**
 * Server-Sent Events (SSE) registry.
 * Routes call broadcast() to push live match updates to all connected browsers.
 */
const clients = new Set();

function register(res) {
  clients.add(res);
}

function unregister(res) {
  clients.delete(res);
}

function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...clients]) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function clientCount() {
  return clients.size;
}

module.exports = { register, unregister, broadcast, clientCount };
