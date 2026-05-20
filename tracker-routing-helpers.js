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
    stickyRoute = null,
    stickyMs = 10_000,
  }) {
    const claims = Object.values(claimMap || {})
      .filter((claim) => fresh(claim, now))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (stickyRoute && stickyRoute.url && stickyRoute.selectedAt && (now - stickyRoute.selectedAt) < stickyMs) {
      const stickyClaim = claims.find((claim) => (
        claim.url === stickyRoute.url &&
        (!stickyRoute.commanderId || claim.commanderId === stickyRoute.commanderId)
      ));
      if (stickyClaim) return { ...stickyClaim, source: 'claim', roomKey, sticky: true };
      if (legacyRoute && stickyRoute.source === 'legacy-room' && fresh(legacyRoute, now) && legacyRoute.url === stickyRoute.url) {
        return { ...legacyRoute, source: 'legacy-room', roomKey, sticky: true };
      }
      if (stickyRoute.source === 'event' && eventProxyUrl && eventProxyUrl === stickyRoute.url) {
        return { url: eventProxyUrl, source: 'event', roomKey, sticky: true };
      }
      if (stickyRoute.source === 'global' && globalProxyUrl && globalProxyUrl === stickyRoute.url) {
        return { url: globalProxyUrl, source: 'global', roomKey, sticky: true };
      }
    }

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
        if (at) candidate.updatedAt = at;
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

  function withGoodStamp(status, now) {
    if (!status || !status.ok) return status;
    return { ...status, _lastGoodAt: now, _stale: false };
  }

  function preserveDuringTransientFailure(previous, failed, now, graceMs) {
    if (!previous || !previous.ok || !failed || failed.ok) return null;
    const lastGoodAt = previous._lastGoodAt || now;
    if ((now - lastGoodAt) > graceMs) return null;
    return {
      ...previous,
      tier: previous.tier === 'unreachable' || previous.tier === 'offline' ? 'degraded' : (previous.tier || 'degraded'),
      _lastGoodAt: lastGoodAt,
      _stale: true,
      _lastErrorAt: now,
      _lastErrorTier: failed.tier || 'unreachable',
    };
  }

  function applyMergedRoomStatuses(current = {}, mergedRooms = {}, roomList = [], options = {}) {
    const now = options.now || Date.now();
    const transientFailureGraceMs = options.transientFailureGraceMs == null ? 20_000 : options.transientFailureGraceMs;
    const next = { ...(current || {}) };
    (roomList || []).forEach((room) => {
      const key = room && room.key;
      if (!key) return;
      const previous = current && current[key];
      const merged = mergedRooms && mergedRooms[key];
      const candidate = merged ? normalizeRoomStatus(merged, true) : offlineRoomStatus();
      if (candidate.ok) {
        next[key] = withGoodStamp(candidate, now);
        return;
      }
      // Only smooth explicit failed reports from an owner. If a room is absent
      // from the merged status tree, no Commander currently owns it, so clear
      // it immediately instead of preserving a ghost status.
      next[key] = merged
        ? (preserveDuringTransientFailure(previous, candidate, now, transientFailureGraceMs) || candidate)
        : candidate;
    });
    return next;
  }

  function shouldDelayEmptyRoomState({
    hasEmptyState = false,
    remoteLoaded = false,
    now = Date.now(),
    startedAt = 0,
    holdMs = 4_000,
  } = {}) {
    if (!hasEmptyState) return false;
    if (remoteLoaded) return false;
    if (!startedAt) return false;
    return (now - startedAt) < holdMs;
  }

  function roomsFromEventConfig(event, fallbackRooms = []) {
    const eventRooms = event && event.config && Array.isArray(event.config.vmixRooms)
      ? event.config.vmixRooms
      : null;
    const source = eventRooms && eventRooms.length ? eventRooms : (fallbackRooms || []);
    return source
      .filter((room) => room && room.key && room.name)
      .map((room) => ({
        key: room.key,
        name: room.name,
        ip: room.ip || '',
      }));
  }

  function shouldRebindEventSubscription({
    eventId = null,
    boundEventId = null,
    force = false,
  } = {}) {
    return !!force || eventId !== boundEventId;
  }

  return {
    ROOM_PROXY_STALE_MS,
    selectRoomProxyRoute,
    roomHasUsableProxy,
    mergeCommanderStatus,
    applyMergedRoomStatuses,
    shouldDelayEmptyRoomState,
    roomsFromEventConfig,
    shouldRebindEventSubscription,
  };
});
