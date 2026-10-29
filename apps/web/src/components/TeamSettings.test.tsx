// @vitest-environment jsdom
// Copyright 2026 Anviq LLC. All rights reserved.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }) };
});
vi.mock("@anviq/ui-web", () => ({
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
  NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
}));
vi.mock("lucide-react", () => ({ ChevronLeft: () => null }));

const rpc = vi.hoisted(() => ({
  organizations: {
    list: vi.fn(),
    personalSpace: vi.fn(),
    myInvitations: vi.fn(),
    acceptInvitation: vi.fn(),
    create: vi.fn(),
    members: vi.fn(),
    invitations: vi.fn(),
    invite: vi.fn(),
    setRole: vi.fn(),
    removeMember: vi.fn(),
    transferOwnership: vi.fn(),
    cancelInvitation: vi.fn(),
    leave: vi.fn(),
  },
}));
const selectSpace = vi.hoisted(() => vi.fn(() => true));
vi.mock("../lib/rpc", () => ({ rpc, selectSpace }));

import { TeamSettings } from "./TeamSettings";

let container: HTMLDivElement;
let root: Root;

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TeamSettings />
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent === name);

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rpc.organizations.list.mockResolvedValue([
    { id: "t1", name: "Acme", role: "admin", memberCount: 2, spaceId: "s-acme" },
  ]);
  rpc.organizations.personalSpace.mockResolvedValue({ spaceId: "s-me" });
  rpc.organizations.myInvitations.mockResolvedValue([]);
  rpc.organizations.members.mockResolvedValue([
    { userId: "u1", name: "Ana", email: "ana@anviq.test", role: "owner", joinedAt: "2026-01-01" },
    { userId: "u2", name: "Ben", email: "ben@anviq.test", role: "admin", joinedAt: "2026-01-02" },
  ]);
  rpc.organizations.invitations.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TeamSettings", () => {
  it("lists personal and team spaces and switches into a team", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    await render();
    expect(container.textContent).toContain("Personal");
    expect(container.textContent).toContain("Acme");
    await act(async () => button("Open")?.click());
    expect(selectSpace).toHaveBeenCalledWith("s-me");
    vi.unstubAllGlobals();
  });

  it("lets an admin invite but not change roles or hand over ownership", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Manage Acme"]')?.click(),
    );
    await settle();
    expect(container.textContent).toContain("ana@anviq.test");
    expect(container.querySelector("select[aria-label='Role']")).toBeNull();
    expect(container.querySelector('[aria-label="Make Ben the owner"]')).toBeNull();
    expect(container.querySelector('[aria-label="Remove Ana"]')).toBeNull();
    expect(container.querySelector('[aria-label="Remove Ben"]')).not.toBeNull();
  });

  it("offers an invitation addressed to the person", async () => {
    rpc.organizations.myInvitations.mockResolvedValue([
      {
        id: "inv-1",
        organizationName: "Globex",
        inviterName: "Cy",
        role: "member",
        expiresAt: "2026-02-01",
      },
    ]);
    rpc.organizations.acceptInvitation.mockResolvedValue({
      organizationId: "g",
      spaceId: "s-globex",
    });
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    await render();
    expect(container.textContent).toContain("Globex");
    await act(async () => button("Join")?.click());
    expect(rpc.organizations.acceptInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
    expect(selectSpace).toHaveBeenCalledWith("s-globex");
    vi.unstubAllGlobals();
  });
});
