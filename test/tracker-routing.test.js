const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectRoomProxyRoute,
  roomHasUsableProxy,
  mergeCommanderStatus,
  applyMergedRoomStatuses,
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
