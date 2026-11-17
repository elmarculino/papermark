import { useTeam } from "@/context/team-context";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

import type { TeamLimits } from "./server";

/** Client hook for /api/teams/:teamId/limits. Self-hosted: nothing is ever capped. */
export function useLimits() {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data, error, mutate } = useSWR<TeamLimits | null>(
    teamId ? `/api/teams/${teamId}/limits` : null,
    fetcher,
    { dedupingInterval: 30000 },
  );

  return {
    limits: data ?? null,
    canAddDocuments: true,
    canAddLinks: true,
    canAddUsers: true,
    showUpgradePlanModal: false,
    isPaused: false,
    error,
    loading: !data && !error,
    mutate,
  };
}
