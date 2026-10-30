// Copyright 2026 Anviq LLC. All rights reserved.
import type { ThreadSnapshot } from "@anviq/contracts";
import { describe, expect, it } from "vitest";
import { ownAskIds } from "./own-asks.js";

const snapshot = {
  members: [
    { botId: "ada", name: "Ada", color: "blue", ownerUserId: "ana" },
    { botId: "bea", name: "Bea", color: "green", ownerUserId: "ben" },
  ],
  messages: [
    { id: "m1", botId: "ada", role: "bot" },
    { id: "m2", botId: "bea", role: "bot" },
    { id: "m3", role: "bot" },
  ],
} as unknown as ThreadSnapshot;
const all = new Set(["m1", "m2", "m3"]);

describe("ownAskIds", () => {
  it("leaves every question alone outside a shared chat", () => {
    expect([...ownAskIds(snapshot, all, false, "ben")]).toEqual(["m1", "m2", "m3"]);
  });

  it("keeps only the questions of the reader's own bots in a shared chat", () => {
    expect([...ownAskIds(snapshot, all, true, "ben")]).toEqual(["m2", "m3"]);
    expect([...ownAskIds(snapshot, all, true, "ana")]).toEqual(["m1", "m3"]);
    expect([...ownAskIds(snapshot, all, true, "cy")]).toEqual(["m3"]);
  });

  it("answers nothing before the chat has loaded", () => {
    expect([...ownAskIds(null, all, true, "ben")]).toEqual(["m1", "m2", "m3"]);
  });
});
