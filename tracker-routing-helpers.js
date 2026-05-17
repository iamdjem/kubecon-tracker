(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TrackerRoutingHelpers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ROOM_PROXY_STALE_MS = 30_000;

  function fresh(route, now) {
    return !!(route && route.url && route.updatedAt && (now - route.updatedAt) < ROOM_PROXY_STALE_MS);
  }

  function selectRoomProxyRoute({
    roomKey,
    now = Date.now(),
    claimMap = {},
    legacyRoute = null,
    eventProxyUrl = '',
    globalProxyUrl = '',
  }) {
    const claims = Object.values(claimMap || {})
      .filter((claim) => fresh(claim, now))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (claims[0]) return { ...claims[0], source: 'claim', roomKey };
    if (fresh(legacyRoute, now)) return { ...legacyRoute, source: 'legacy-room', roomKey };
    if (eventProxyUrl) return { url: eventProxyUrl, source: 'event', roomKey };
    if (globalProxyUrl) return { url: globalProxyUrl, source: 'global', roomKey };
    return { url: '', source: 'none', roomKey };
  }

  function roomHasUsableProxy(input) {
    return !!selectRoomProxyRoute(input).url;
  }

  function normalizeRoomStatus(room, freshSource) {
    const fresh = !!freshSource;
    const ok = !!(room && room.ok) && fresh;
    return {
      ok,
      recording: fresh && !!(room && room.recording),
      streaming: fresh && !!(room && room.streaming),
      multicorder: fresh && !!(room && room.multicorder),
      latency: room && room.latency || 0,
      tier: !fresh ? 'offline' : (room && room.tier || (ok ? 'healthy' : 'unreachable')),
      recordingStartTime: fresh && room && room.recordingStartTime || null,
    };
  }

  function mergeCommanderStatus(raw, { now = Date.now(), staleMs = 15_000 } = {}) {
    if (!raw || typeof raw !== 'object') return raw || null;
    const sources = [];
    if (raw.commanders && typeof raw.commanders === 'object') {
      Object.keys(raw.commanders).forEach((id) => {
        const commander = raw.commanders[id];
        if (commander && typeof commander === 'object') sources.push(commander);
      });
    }
    if (raw.rooms && typeof raw.rooms === 'object') {
      sources.push({
        updatedAt: raw.updatedAt || 0,
        operator: raw.operator || null,
        safetyLocked: !!raw.safetyLocked,
        rooms: raw.rooms,
        roomLocks: raw.roomLocks || {},
      });
    }
    if (!sources.length) return raw;

    const merged = { updatedAt: 0, operator: null, safetyLocked: false, rooms: {}, roomLocks: {} };
    let freshestOpAt = -1;
    sources.forEach((source) => {
      const at = source.updatedAt || 0;
      const fresh = (now - at) < staleMs;
      if (at > merged.updatedAt) merged.updatedAt = at;
      if (source.safetyLocked) merged.safetyLocked = true;
      if (source.operator && at > freshestOpAt) {
        merged.operator = source.operator;
        freshestOpAt = at;
      }
      if (source.roomLocks) {
        Object.keys(source.roomLocks).forEach((key) => {
          if (source.roomLocks[key]) merged.roomLocks[key] = true;
        });
      }
      if (!source.rooms) return;
      Object.keys(source.rooms).forEach((key) => {
        const candidate = normalizeRoomStatus(source.rooms[key], fresh);
        candidate._at = at;
        const current = merged.rooms[key];
        if (!current || (candidate.ok && !current.ok) || (candidate.ok === current.ok && candidate._at > (current._at || 0))) {
          merged.rooms[key] = candidate;
        }
      });
    });
    Object.keys(merged.rooms).forEach((key) => { delete merged.rooms[key]._at; });
    return merged;
  }

  function offlineRoomStatus() {
    return {
      ok: false,
      recording: false,
      streaming: false,
      multicorder: false,
      latency: 0,
      tier: 'offline',
      recordingStartTime: null,
    };
  }

  function applyMergedRoomStatuses(current = {}, mergedRooms = {}, roomList = []) {
    const next = { ...(current || {}) };
    (roomList || []).forEach((room) => {
      const key = room && room.key;
      if (!key) return;
      const merged = mergedRooms && mergedRooms[key];
      next[key] = merged ? normalizeRoomStatus(merged, true) : offlineRoomStatus();
    });
    return next;
  }

  return {
    ROOM_PROXY_STALE_MS,
    selectRoomProxyRoute,
    roomHasUsableProxy,
    mergeCommanderStatus,
    applyMergedRoomStatuses,
  };
});
