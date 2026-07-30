/**
 * Paint Chameleon server tests.
 * Run: npx -y @agent8/gameserver-node test
 */

describe("matchmaking", () => {
  test("joinGame returns a room id", async (server) => {
    const res = await server.joinGame("alice");
    expect(res.roomId).toBeTruthy();
  });

  test("two players land in the same lobby", async (server) => {
    server.connect({ account: "user-alice" });
    const a = await server.joinGame("alice");

    server.connect({ account: "user-bob" });
    const b = await server.joinGame("bob");

    expect(b.roomId).toBe(a.roomId);
  });
});

describe("hub", () => {
  test("joinHub returns a room id", async (server) => {
    server.connect({ account: "user-hub-a" });
    const res = await server.joinHub("hubby");
    expect(res.roomId).toBeTruthy();
  });

  test("two players share one hub", async (server) => {
    server.connect({ account: "user-hub-b" });
    const a = await server.joinHub("b");
    server.connect({ account: "user-hub-c" });
    const b = await server.joinHub("c");
    expect(b.roomId).toBe(a.roomId);
  });

  // The local test runtime mints room ids as `room_${Date.now()}`, so two joins
  // inside the same millisecond collide. Spin until the clock ticks — otherwise
  // the ids match for reasons that have nothing to do with matchmaking.
  // (No timers in the isolated VM, hence the busy wait.)
  const tick = () => {
    const started = Date.now();
    while (Date.now() === started) {
      /* wait out the millisecond */
    }
  };

  test("matchmaking never drops a player into the hub", async (server) => {
    server.connect({ account: "user-hub-d" });
    const hub = await server.joinHub("d");
    tick();

    server.connect({ account: "user-game-a" });
    const game = await server.joinGame("ga");

    expect(game.roomId === hub.roomId).toBe(false);

    const rooms = await server.__rooms();
    expect(rooms.find((r: any) => r.roomId === game.roomId)?.kind).toBe("game");
    expect(rooms.find((r: any) => r.roomId === hub.roomId)?.kind).toBe("hub");
  });

  test("entering a match leaves the hub behind", async (server) => {
    server.connect({ account: "user-hub-e" });
    const hub = await server.joinHub("e");
    tick();

    const game = await server.joinGame("e");
    expect(game.roomId === hub.roomId).toBe(false);

    // ...and we are no longer counted among the hub's occupants.
    const rooms = await server.__rooms();
    expect(rooms.find((r: any) => r.roomId === hub.roomId)?.users).toBe(0);
  });
});

describe("painting", () => {
  test("paintDabs accepts a batch without throwing", async (server) => {
    server.connect({ account: "user-carol" });
    await server.joinGame("carol");

    const res = await server.paintDabs([
      { u: 0.5, v: 0.5, r: 24, c: 0xff0000, j: false },
      { u: 0.52, v: 0.51, r: 24, c: 0xff0000, j: true },
    ]);
    expect(res).toBe(undefined);
  });

  test("paintDabs survives garbage input", async (server) => {
    server.connect({ account: "user-dave" });
    await server.joinGame("dave");

    const res = await server.paintDabs([
      { u: 99, v: -5, r: 99999, c: 0xffffffff },
      null,
    ] as any);
    expect(res).toBe(undefined);
  });

  test("paintDabs ignores an empty batch", async (server) => {
    server.connect({ account: "user-eve" });
    await server.joinGame("eve");
    expect(await server.paintDabs([])).toBe(undefined);
  });

  test("paintFill accepts a colour", async (server) => {
    server.connect({ account: "user-frank" });
    await server.joinGame("frank");
    expect(await server.paintFill(0x3366ff)).toBe(undefined);
  });
});

describe("tagging", () => {
  test("shot is refused outside the seeking phase", async (server) => {
    server.connect({ account: "user-erin" });
    await server.joinGame("erin");

    const res = await server.requestShot("user-frank");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_seeking");
  });
});

describe("transform", () => {
  test("updateTransform clamps pose into range", async (server) => {
    server.connect({ account: "user-grace" });
    await server.joinGame("grace");

    await server.updateTransform({ pos: [1, 0, 2], rotY: 0.5, pose: 99, moving: true });
    const state = await server.getMyState();
    // POSE_COUNT lives in server/src/rules.ts and must match src/game/constants.ts
    // POSES.length — check:sync verifies that; this just clamps to whatever it is.
    expect(state.pose).toBe(3);
  });

  test("updateTransform rejects non-finite positions", async (server) => {
    server.connect({ account: "user-heidi" });
    await server.joinGame("heidi");

    await server.updateTransform({ pos: [NaN, Infinity, 0.1], rotY: NaN, pose: 1, moving: false } as any);
    const state = await server.getMyState();
    expect(state.pos[0]).toBe(0);
    expect(state.pos[2]).toBe(0.1);
    expect(state.rotY).toBe(0);
  });

  // The local test harness's $room-scoped calls (getMyState/updateMyState)
  // and joinGame's $global.updateRoomUserState spawn write are backed by
  // different room keys in this offline runtime (confirmed by reading
  // node_modules/@agent8/gameserver-node/dist/runtime/RoomContext.js and
  // GlobalContext.js — RoomContext.setRoomId exists but is never called from
  // anywhere in the package, so $room always operates on the fixed
  // 'test-room' key regardless of the real matchmaking roomId). That means
  // server.getMyState() right after joinGame() alone always reads back {}
  // in this harness — real production state sharing is unaffected, this is
  // purely a local/offline-runtime quirk. Every test below therefore makes
  // one throwaway updateTransform call first to establish a $room-visible
  // baseline position before asserting anything.
  test("updateTransform keeps a small, plausible move exactly", async (server) => {
    server.connect({ account: "user-ivan" });
    await server.joinGame("ivan");

    await server.updateTransform({ pos: [0, 0, 0], rotY: 0, pose: 0, moving: false });
    const baseline = (await server.getMyState()).pos;

    const target = [baseline[0] + 0.1, 0, baseline[2] + 0.1];
    await server.updateTransform({ pos: target, rotY: 0, pose: 0, moving: true });
    const state = await server.getMyState();

    expect(Math.abs(state.pos[0] - target[0]) < 1e-9).toBe(true);
    expect(Math.abs(state.pos[2] - target[2]) < 1e-9).toBe(true);
  });

  test("updateTransform clamps a physically impossible jump", async (server) => {
    server.connect({ account: "user-judy" });
    await server.joinGame("judy");

    await server.updateTransform({ pos: [0, 0, 0], rotY: 0, pose: 0, moving: false });
    const baseline = (await server.getMyState()).pos;

    // 500 units in one update is impossible at any plausible speed this soon
    // after the baseline call — no legitimate client could produce this.
    const target = [baseline[0] + 500, 0, baseline[2]];
    await server.updateTransform({ pos: target, rotY: 0, pose: 0, moving: true });
    const state = await server.getMyState();

    const movedDist = Math.hypot(state.pos[0] - baseline[0], state.pos[2] - baseline[2]);
    // Holds as long as the real wall-clock gap between the baseline call and this
    // call stays under ~490ms (5 units / ~10.2 units-per-second cap, i.e.
    // MOVE_SPEED_CAP * SPEED_GRACE) — comfortably far from normal in-process test
    // execution time, so this isn't flaky in practice. Worth knowing before
    // "tuning" the timing constants without realizing this margin exists.
    expect(movedDist < 5).toBe(true);
    expect(state.pos[0] === target[0]).toBe(false);
  });
});

describe("leaderboard", () => {
  test("getLeaderboard on an account with no history returns no ranking", async (server) => {
    server.connect({ account: "user-leaderboard-fresh" });
    await server.joinGame("fresh");

    const result = await server.getLeaderboard();
    expect(Array.isArray(result.top)).toBe(true);
    expect(result.me).toBe(null);
  });
});

describe("avatar shop", () => {
  test("a brand new account gets the default wallet", async (server) => {
    server.connect({ account: "user-shop-fresh" });
    await server.joinHub("fresh");

    const w = await server.getWallet();
    expect(w.coins).toBe(0);
    expect(w.equipped).toBe("classic");
    expect(w.owned.includes("classic")).toBe(true);
  });

  test("buying with an empty balance is refused", async (server) => {
    server.connect({ account: "user-shop-broke" });
    await server.joinHub("broke");

    const res = await server.buyAvatar("bean");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("broke");
  });

  test("buying something that is not for sale is refused", async (server) => {
    server.connect({ account: "user-shop-unknown" });
    await server.joinHub("unknown");

    const res = await server.buyAvatar("not-a-real-avatar");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unknown");
  });

  test("equipping an avatar you do not own is refused", async (server) => {
    server.connect({ account: "user-shop-cheat" });
    await server.joinHub("cheat");

    const res = await server.equipAvatar("tank");
    expect(res.ok).toBe(false);

    // ...and the refusal must not have quietly changed anything.
    const w = await server.getWallet();
    expect(w.equipped).toBe("classic");
  });

  test("equipping the free avatar works", async (server) => {
    server.connect({ account: "user-shop-default" });
    await server.joinHub("default");

    const res = await server.equipAvatar("classic");
    expect(res.ok).toBe(true);
  });

  test("a refused purchase leaves the balance alone", async (server) => {
    server.connect({ account: "user-shop-intact" });
    await server.joinHub("intact");

    await server.buyAvatar("tank");
    await server.buyAvatar("nope");

    const w = await server.getWallet();
    expect(w.coins).toBe(0);
    expect(w.owned.length).toBe(1);
  });
});
