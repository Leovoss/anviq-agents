/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@anviq/adapter-kit";
import { displayName } from "@anviq/core";
import { lightTokens } from "@anviq/ui-tokens";
import { Hr, Link, Text } from "react-email";
import { linkStyle, message } from "./email.js";

export function welcomeEmail(
  user: { email: string; name: string },
  unsubscribeUrl: string,
): Promise<TransactionalEmail> {
  return message(
    user.email,
    "Welcome to Anviq Agents",
    <>
      <Text>Hi {displayName(user.name, "there")},</Text>
      <Text>Thanks for signing up for Anviq Agents.</Text>
      <Text>
        Questions or ideas?{" "}
        <Link href="https://discord.gg/RWwKa2Sn7h" style={linkStyle}>
          Join us on Discord
        </Link>
        .
      </Text>
      <Text>
        Anviq Agents is open source. If you like it,{" "}
        <Link href="https://github.com/leovoss/anviq-agents" style={linkStyle}>
          a star on GitHub
        </Link>{" "}
        helps others find it.
      </Text>
      <Text>
        Want to run it on your own servers?{" "}
        <Link
          href="https://github.com/leovoss/anviq-agents/blob/main/docs/self-host.md"
          style={linkStyle}
        >
          Self-host Anviq Agents
        </Link>
        .
      </Text>
      <Text>Have any questions? Reply to this email.</Text>
      <Text>Elie</Text>
      <Hr style={{ borderColor: lightTokens.border, marginTop: "32px" }} />
      <Text style={{ color: lightTokens.mutedForeground, fontSize: "12px" }}>
        <Link href={unsubscribeUrl} style={{ color: lightTokens.mutedForeground }}>
          Unsubscribe
        </Link>
      </Text>
    </>,
    {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  );
}
