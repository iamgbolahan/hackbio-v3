import type { Prisma } from "generated/prisma/client";
import type { ParameterEvaluations } from "../types";

// Reading.evaluation is JSON this service writes itself from ParameterEvaluations, so reading it back is a typed cast.
export function parseStoredEvaluation(
  value: Prisma.JsonValue | null,
): ParameterEvaluations {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return {};
  return value as unknown as ParameterEvaluations;
}

export function toStoredEvaluation(
  parameters: ParameterEvaluations,
): Prisma.InputJsonObject {
  return parameters as unknown as Prisma.InputJsonObject;
}
