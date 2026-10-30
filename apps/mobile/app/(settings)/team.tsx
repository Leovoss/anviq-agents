// Copyright 2026 Anviq LLC. All rights reserved.
import type { MyTeamInvitation, Team } from "@anviq/contracts";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadFailure } from "../../components/load-failure";
import { NativeActionButton } from "../../components/native-action-button";
import { SettingsGroup, SettingsRow } from "../../components/settings-group";
import { rpc, selectSpace } from "../../lib/api";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import { native, useThemedStyles } from "../../lib/native";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

type Loaded = { teams: Team[]; personal: string | null; invitations: MyTeamInvitation[] };

/** Personal, the teams a person belongs to, invitations waiting for them, and a way to start a team. */
export default function Teams() {
  const router = useRouter();
  const { t } = useI18n();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      void Promise.all([
        rpc("organizations/list"),
        rpc("organizations/personalSpace"),
        rpc("organizations/myInvitations"),
      ])
        .then(([teams, personal, invitations]) => {
          if (!current) return;
          setLoaded({ teams, personal: personal.spaceId, invitations });
          setError(null);
        })
        .catch((reason: unknown) => {
          if (current) setError(errorText(reason, t("Something went wrong. Try again.")));
        });
      return () => {
        current = false;
      };
    }, [attempt, t]),
  );

  async function openSpace(spaceId: string) {
    if (!(await selectSpace(spaceId))) {
      Alert.alert(t("It could not be opened. Try again from the sidebar."));
      return;
    }
    router.dismissAll();
    router.replace("/");
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(errorText(reason, t("Something went wrong. Try again.")));
    } finally {
      setBusy(false);
    }
  }

  const roleLabel = (role: Team["role"]) =>
    role === "owner" ? t("Owner") : role === "admin" ? t("Admin") : t("Member");

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        style={sideInsets}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        {error && !loaded ? (
          <LoadFailure message={error} onRetry={() => setAttempt((count) => count + 1)} />
        ) : error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {loaded?.invitations.length ? (
          <SettingsGroup label={t("Invitations")}>
            {loaded.invitations.map((invitation) => (
              <SettingsRow
                key={invitation.id}
                title={invitation.organizationName}
                detail={invitation.inviterName}
                trailing={
                  <NativeActionButton
                    label={t("Join")}
                    size="compact"
                    fill={false}
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        const joined = await rpc("organizations/acceptInvitation", {
                          invitationId: invitation.id,
                        });
                        await openSpace(joined.spaceId);
                      })
                    }
                  />
                }
              />
            ))}
          </SettingsGroup>
        ) : null}

        <SettingsGroup label={t("Teams")}>
          {loaded?.personal ? (
            <SettingsRow
              accessibilityRole="button"
              title={t("Personal")}
              chevron="right"
              onPress={() => void openSpace(loaded.personal as string)}
            />
          ) : null}
          {loaded?.teams.map((team) => (
            <SettingsRow
              key={team.id}
              accessibilityRole="button"
              title={team.name}
              value={roleLabel(team.role)}
              chevron="right"
              onPress={() =>
                router.push({
                  pathname: "/team-detail",
                  params: { organizationId: team.id, name: team.name, spaceId: team.spaceId },
                })
              }
            />
          ))}
        </SettingsGroup>

        <TextInput
          value={name}
          maxLength={60}
          onChangeText={setName}
          placeholder={t("New team")}
          placeholderTextColor={mobileTokens().mutedForeground}
          returnKeyType="done"
          style={styles.input}
        />
        <NativeActionButton
          disabled={!name.trim() || busy}
          label={t("Create team")}
          onPress={() =>
            void run(async () => {
              const created = await rpc("organizations/create", { name: name.trim() });
              setName("");
              await openSpace(created.defaultSpaceId);
            })
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.groupedPage },
    content: { width: "100%", padding: 20, gap: 24, paddingBottom: 40 },
    error: { color: tokens.destructive, fontSize: 14 },
    input: {
      backgroundColor: native.fill,
      borderRadius: 11,
      padding: 14,
      color: tokens.foreground,
      fontSize: 16,
    },
  });
}
