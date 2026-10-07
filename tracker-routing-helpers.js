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

  // ── Shared room order (events/<id>/config/roomOrder: array of room names).
  // Both apps sort their room cards by it. Rooms missing from the list keep
  // their existing relative order after the ordered ones.
  function normRoomName(name) {
    return String(name == null ? '' : name).trim().toLowerCase();
  }

  function sortRoomsByOrder(rooms, order) {
    const list = Array.isArray(rooms) ? rooms.slice() : [];
    const idx = {};
    (Array.isArray(order) ? order : []).forEach((name, i) => {
      const key = normRoomName(name);
      if (key && !(key in idx)) idx[key] = i;
    });
    return list
      .map((room, i) => ({ room, i, at: idx[normRoomName(room && room.name)] }))
      .sort((a, b) => {
        const ao = a.at === undefined ? Infinity : a.at;
        const bo = b.at === undefined ? Infinity : b.at;
        return ao === bo ? a.i - b.i : ao - bo;
      })
      .map((x) => x.room);
  }

  // A crew member reorders only the rooms they can see. Put their new
  // sequence into the slots their rooms already occupy in the full order,
  // so everyone else's rooms stay exactly where they were.
  function reorderRoomSubset(currentOrder, allNames, newSubset) {
    const full = sortRoomsByOrder((allNames || []).map((name) => ({ name })), currentOrder).map((r) => r.name);
    (Array.isArray(currentOrder) ? currentOrder : []).forEach((name) => {
      if (!full.some((n) => normRoomName(n) === normRoomName(name))) full.push(name);
    });
    const subsetKeys = (newSubset || []).map(normRoomName);
    const slots = [];
    full.forEach((name, i) => { if (subsetKeys.includes(normRoomName(name))) slots.push(i); });
    const next = full.slice();
    const placed = (newSubset || []).filter((name) => full.some((n) => normRoomName(n) === normRoomName(name)));
    slots.forEach((slot, i) => { next[slot] = placed[i]; });
    return next;
  }

  // ── Which functions START ALL / STOP ALL control, per event
  // (events/<id>/config/allActionFns: subset of record, stream, multicorder).
  // Missing or empty means all three, which is the old behaviour.
  const ALL_ACTION_KEYS = ['record', 'stream', 'multicorder'];
  const ALL_ACTION_FN_KEY = {
    StartRecording: 'record', StopRecording: 'record',
    StartStreaming: 'stream', StopStreaming: 'stream',
    StartMultiCorder: 'multicorder', StopMultiCorder: 'multicorder',
  };
  const ALL_ACTION_SHORT = { record: 'REC', stream: 'STREAM', multicorder: 'MULTI' };

  function normalizeAllActionFns(enabled) {
    const list = Array.isArray(enabled) ? enabled.filter((k) => ALL_ACTION_KEYS.includes(k)) : [];
    return list.length ? ALL_ACTION_KEYS.filter((k) => list.includes(k)) : ALL_ACTION_KEYS.slice();
  }

  function filterActionSequence(sequence, enabled) {
    const keys = normalizeAllActionFns(enabled);
    return (sequence || []).filter((fn) => keys.includes(ALL_ACTION_FN_KEY[fn]));
  }

  // "ALL" when all three are on, otherwise e.g. "REC + STREAM".
  function allActionLabel(enabled) {
    const keys = normalizeAllActionFns(enabled);
    return keys.length === ALL_ACTION_KEYS.length ? 'ALL' : keys.map((k) => ALL_ACTION_SHORT[k]).join(' + ');
  }

  return {
    normalizeAllActionFns,
    filterActionSequence,
    allActionLabel,
    normRoomName,
    sortRoomsByOrder,
    reorderRoomSubset,
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
