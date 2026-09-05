import { startClaudeBillingFixture } from "../testing/claude-code-billing-fixture";

async function main() {
  const fixture = await startClaudeBillingFixture();
  console.log(
    `Test accounting only; no live debit. DYAD_CLAUDE_BILLING_URL=${fixture.url}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => fixture.close());
}
void main();
