import type { HealthStatus } from "generated/prisma/client";

const RANK: Record<HealthStatus, number> = {
  NORMAL: 0,
  WATCH: 1,
  ATTENTION: 2,
};

export function isWorse(
  candidate: HealthStatus,
  current: HealthStatus,
): boolean {
  return RANK[candidate] > RANK[current];
}

export function worstStatus(statuses: readonly HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>(
    (worst, status) => (isWorse(status, worst) ? status : worst),
    "NORMAL",
  );
}
