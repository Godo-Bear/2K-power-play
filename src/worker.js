// Cloudflare Worker for 2K Power Play.
// - Serves the game (static files in /public)
// - Hosts online rooms: /api/room/<CODE>?role=host|guest is a WebSocket that relays
//   messages between the two players in that room (one Durable Object per room code).
import { DurableObject } from 'cloudflare:workers';

const MAX_MESSAGE_BYTES = 32 * 1024;
const sys = (ev, extra = {}) => JSON.stringify({ k: 'sys', ev, ...extra });

export class Room extends DurableObject {
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const role = new URL(request.url).searchParams.get('role');
    const hosts = this.ctx.getWebSockets('host');
    const guests = this.ctx.getWebSockets('guest');

    let error = null;
    if (role !== 'host' && role !== 'guest') error = 'bad-role';
    else if (role === 'host' && hosts.length) error = 'code-taken';
    else if (role === 'guest' && !hosts.length) error = 'not-found';
    else if (role === 'guest' && guests.length) error = 'full';

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server, [error ? 'rejected' : role]);
    if (error) {
      server.send(sys('error', { code: error }));
      server.close(4001, error);
    } else {
      server.send(sys('joined', { role, peer: role === 'host' ? guests.length > 0 : true }));
      if (role === 'guest') for (const h of hosts) h.send(sys('peer-joined'));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  others(ws) {
    const [role] = this.ctx.getTags(ws);
    if (role !== 'host' && role !== 'guest') return [];
    return this.ctx.getWebSockets(role === 'host' ? 'guest' : 'host');
  }

  webSocketMessage(ws, message) {
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_MESSAGE_BYTES) return;
    for (const peer of this.others(ws)) {
      try { peer.send(message); } catch { /* peer is gone */ }
    }
  }

  leave(ws) {
    const [role] = this.ctx.getTags(ws);
    for (const peer of this.others(ws)) {
      try {
        peer.send(sys('peer-left'));
        if (role === 'host') peer.close(4002, 'host-left'); // the room ends when the host leaves
      } catch { /* already closed */ }
    }
  }

  webSocketClose(ws, code) {
    this.leave(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }

  webSocketError(ws) { this.leave(ws); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4,8})$/);
    if (m) return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
    if (url.pathname === '/api/ping') return Response.json({ ok: true });
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
