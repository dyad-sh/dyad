import { createHash } from "node:crypto";

export function testEvidence(score) {
  if (!score) return null;
  return {
    buildStatus: score.buildStatus,
    cujPassed: score.cujPassed,
    cujTotal: score.cujTotal,
    failures: [...(score.failures ?? [])].sort(),
  };
}

export function evidenceHash(score) {
  return createHash("sha256")
    .update(JSON.stringify(testEvidence(score)))
    .digest("hex");
}
