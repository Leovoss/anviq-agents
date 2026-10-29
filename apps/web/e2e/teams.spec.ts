// Copyright 2026 Anviq LLC. All rights reserved.
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("creating a team opens its space and invites a colleague", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `team-owner-${stamp}@anviq.test`, "password12", "Owner");
  await completeOnboarding(page);

  const settings = await openUserSettings(page, "team");
  await settings.getByLabel("Team name").fill("Acme");
  await settings.getByRole("button", { name: "Create" }).click();

  // Another space is a full reload, so the switcher shows both workspaces afterwards.
  await page.getByTestId("user-menu-trigger").click();
  const switcher = page.getByTestId("workspace-switcher");
  await expect(switcher.getByRole("button", { name: "Acme" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(switcher.getByRole("button", { name: "Personal" })).toBeVisible();
  await page.keyboard.press("Escape");

  const team = await openUserSettings(page, "team");
  await team.getByRole("button", { name: "Manage Acme" }).click();
  await team.getByLabel("Email").fill(`colleague-${stamp}@anviq.test`);
  await team.getByRole("button", { name: "Send" }).click();
  await expect(team.getByText(`colleague-${stamp}@anviq.test`)).toBeVisible();
  await captureScreenshot(page, testInfo, "team-settings");
});
