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

  return {
    ROOM_PROXY_STALE_MS,
    selectRoomProxyRoute,
    roomHasUsableProxy,
  };
});
