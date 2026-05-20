const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectRoomProxyRoute,
  roomHasUsableProxy,
  mergeCommanderStatus,
  applyMergedRoomStatuses,
  shouldDelayEmptyRoomState,
  roomsFromEventConfig,
  shouldRebindEventSubscription,
} = require('../tracker-routing-helpers');

test('selectRoomProxyRoute prefers freshest per-commander claim', () => {
  const now = 100_000;
  const route = selectRoomProxyRoute({
    roomKey: 'roomA',
    now,
    claimMap: {
      cmdOld: { url: 'https://old.example', updatedAt: now - 5_000, commanderId: 'cmdOld' },
      cmdNew: { url: 'https://new.example', updatedAt: now - 1_000, commanderId: 'cmdNew' },
    },
    legacyRoute: { url: 'https://legacy.example', updatedAt: now - 500 },
    eventProxyUrl: 'https://event.example',
    globalProxyUrl: 'https://global.example',
  });

  assert.equal(route.url, 'https://new.example');
  assert.equal(route.source, 'claim');
});

test('selectRoomProxyRoute keeps a recently working sticky claim while it is still fresh', () => {
  const now = 100_000;
  const route = selectRoomProxyRoute({
    roomKey: 'roomA',
    now,
    claimMap: {
      stable: { url: 'https://stable.example', updatedAt: now - 4_000, commanderId: 'stable' },
      newer: { url: 'https://newer.example', updatedAt: now - 500, commanderId: 'newer' },
    },
    stickyRoute: {
      url: 'https://stable.example',
      commanderId: 'stable',
      selectedAt: now - 3_000,
    },
    stickyMs: 10_000,
  });

  assert.equal(route.url, 'https://stable.example');
  assert.equal(route.commanderId, 'stable');
  assert.equal(route.sticky, true);
});

test('selectRoomProxyRoute abandons sticky claim after stickiness expires', () => {
  const now = 100_000;
  const route = selectRoomProxyRoute({
    roomKey: 'roomA',
    now,
    claimMap: {
      stable: { url: 'https://stable.example', updatedAt: now - 4_000, commanderId: 'stable' },
      newer: { url: 'https://newer.example', updatedAt: now - 500, commanderId: 'newer' },
    },
    stickyRoute: {
      url: 'https://stable.example',
      commanderId: 'stable',
      selectedAt: now - 20_000,
    },
    stickyMs: 10_000,
  });

  assert.equal(route.url, 'https://newer.example');
  assert.equal(route.commanderId, 'newer');
  assert.equal(route.sticky, undefined);
});

test('selectRoomProxyRoute rejects stale claims and falls back to legacy', () => {
  const now = 100_000;
  const route = selectRoomProxyRoute({
    roomKey: 'roomA',
    now,
    claimMap: {
      cmdOld: { url: 'https://old.example', updatedAt: now - 31_000, commanderId: 'cmdOld' },
    },
    legacyRoute: { url: 'https://legacy.example', updatedAt: now - 1_000 },
    eventProxyUrl: 'https://event.example',
    globalProxyUrl: 'https://global.example',
  });

  assert.equal(route.url, 'https://legacy.example');
  assert.equal(route.source, 'legacy-room');
});

test('roomHasUsableProxy accepts a per-room claim even without a global proxy', () => {
  assert.equal(roomHasUsableProxy({
    roomKey: 'roomA',
    now: 100_000,
    claimMap: {
      cmd1: { url: 'https://room.example', updatedAt: 99_000 },
    },
  }), true);
});

test('selectRoomProxyRoute falls back from stale room routes to event then global proxy', () => {
  const eventRoute = selectRoomProxyRoute({
    roomKey: 'roomA',
    now: 100_000,
    claimMap: {},
    legacyRoute: null,
    eventProxyUrl: 'https://event.example',
    globalProxyUrl: 'https://global.example',
  });
  assert.equal(eventRoute.source, 'event');

  const globalRoute = selectRoomProxyRoute({
    roomKey: 'roomA',
    now: 100_000,
    claimMap: {},
    legacyRoute: null,
    eventProxyUrl: '',
    globalProxyUrl: 'https://global.example',
  });
  assert.equal(globalRoute.source, 'global');
});

test('mergeCommanderStatus lets a fresh reachable source beat fresh unreachable reports', () => {
  const now = 100_000;
  const merged = mergeCommanderStatus({
    commanders: {
      commanderA: {
        updatedAt: now - 1000,
        rooms: {
          roomA: { ok: true, latency: 8, tier: 'healthy' },
          roomB: { ok: false, latency: 0, tier: 'unreachable' },
        },
      },
      commanderB: {
        updatedAt: now - 500,
        rooms: {
          roomA: { ok: false, latency: 0, tier: 'unreachable' },
          roomB: { ok: true, latency: 10, tier: 'healthy' },
        },
      },
    },
  }, { now, staleMs: 15_000 });

  assert.equal(merged.rooms.roomA.ok, true);
  assert.equal(merged.rooms.roomA.latency, 8);
  assert.equal(merged.rooms.roomB.ok, true);
  assert.equal(merged.rooms.roomB.latency, 10);
});

test('mergeCommanderStatus annotates room status with the source update time', () => {
  const now = 100_000;
  const merged = mergeCommanderStatus({
    commanders: {
      commanderA: {
        updatedAt: now - 1200,
        rooms: {
          roomA: { ok: true, latency: 8, tier: 'healthy' },
        },
      },
    },
  }, { now, staleMs: 15_000 });

  assert.equal(merged.rooms.roomA.updatedAt, now - 1200);
});

test('applyMergedRoomStatuses clears rooms absent from the merged Firebase snapshot', () => {
  const next = applyMergedRoomStatuses(
    {
      roomA: { ok: true, latency: 8, tier: 'healthy' },
      roomB: { ok: true, latency: 9, tier: 'healthy' },
    },
    {
      roomA: { ok: true, latency: 8, tier: 'healthy' },
    },
    [{ key: 'roomA' }, { key: 'roomB' }]
  );

  assert.equal(next.roomA.ok, true);
  assert.deepEqual(next.roomB, {
    ok: false,
    recording: false,
    streaming: false,
    multicorder: false,
    latency: 0,
    tier: 'offline',
    recordingStartTime: null,
  });
});

test('applyMergedRoomStatuses preserves last known good state during transient failed reports', () => {
  const now = 200_000;
  const next = applyMergedRoomStatuses(
    {
      roomA: {
        ok: true,
        recording: true,
        streaming: false,
        multicorder: false,
        latency: 8,
        tier: 'healthy',
        recordingStartTime: 123,
        _lastGoodAt: now - 5_000,
      },
    },
    {
      roomA: { ok: false, latency: 0, tier: 'degraded' },
    },
    [{ key: 'roomA' }],
    { now, transientFailureGraceMs: 20_000 }
  );

  assert.equal(next.roomA.ok, true);
  assert.equal(next.roomA.recording, true);
  assert.equal(next.roomA._stale, true);
});

test('applyMergedRoomStatuses shows failure after transient grace expires', () => {
  const now = 200_000;
  const next = applyMergedRoomStatuses(
    {
      roomA: {
        ok: true,
        recording: true,
        streaming: false,
        multicorder: false,
        latency: 8,
        tier: 'healthy',
        recordingStartTime: 123,
        _lastGoodAt: now - 25_000,
      },
    },
    {
      roomA: { ok: false, latency: 0, tier: 'unreachable' },
    },
    [{ key: 'roomA' }],
    { now, transientFailureGraceMs: 20_000 }
  );

  assert.equal(next.roomA.ok, false);
  assert.equal(next.roomA.recording, false);
  assert.equal(next.roomA.tier, 'unreachable');
});

test('shouldDelayEmptyRoomState holds empty room warnings until first remote snapshot or timeout', () => {
  assert.equal(shouldDelayEmptyRoomState({
    hasEmptyState: true,
    remoteLoaded: false,
    now: 10_000,
    startedAt: 8_000,
    holdMs: 4_000,
  }), true);

  assert.equal(shouldDelayEmptyRoomState({
    hasEmptyState: true,
    remoteLoaded: true,
    now: 10_000,
    startedAt: 8_000,
    holdMs: 4_000,
  }), false);

  assert.equal(shouldDelayEmptyRoomState({
    hasEmptyState: true,
    remoteLoaded: false,
    now: 13_000,
    startedAt: 8_000,
    holdMs: 4_000,
  }), false);

  assert.equal(shouldDelayEmptyRoomState({
    hasEmptyState: false,
    remoteLoaded: false,
    now: 10_000,
    startedAt: 8_000,
    holdMs: 4_000,
  }), false);
});

test('roomsFromEventConfig returns current event vMix rooms before falling back', () => {
  assert.deepEqual(roomsFromEventConfig({
    config: {
      vmixRooms: [
        { key: 'a', name: '200E', ip: '192.168.0.101' },
        { key: 'b', name: '200F' },
      ],
    },
  }, [{ key: 'legacy', name: 'Legacy', ip: '' }]), [
    { key: 'a', name: '200E', ip: '192.168.0.101' },
    { key: 'b', name: '200F', ip: '' },
  ]);

  assert.deepEqual(roomsFromEventConfig({
    config: { vmixRooms: [] },
  }, [{ key: 'legacy', name: 'Legacy', ip: '' }]), [
    { key: 'legacy', name: 'Legacy', ip: '' },
  ]);
});

test('shouldRebindEventSubscription forces a same-event subscription after auth changes', () => {
  assert.equal(shouldRebindEventSubscription({
    eventId: 'ev1',
    boundEventId: 'ev1',
    force: false,
  }), false);

  assert.equal(shouldRebindEventSubscription({
    eventId: 'ev1',
    boundEventId: 'ev1',
    force: true,
  }), true);

  assert.equal(shouldRebindEventSubscription({
    eventId: 'ev2',
    boundEventId: 'ev1',
    force: false,
  }), true);
});
