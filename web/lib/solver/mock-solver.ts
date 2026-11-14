/**
 * Mock NEAR Intents solver for the hackathon demo.
 * Paper fill only — no 1Click settlement, not a live solver network.
 */
import {
  checkIntent,
  type CertificateLookup,
  type CheckIntentInput,
  type GateDecision,
} from "../solver-gate";

export type MockIntent = CheckIntentInput & {
  assetIn?: string;
  assetOut?: string;
  amount?: string;
};

export type MockFillResult =
  | {
      status: "filled";
      mock: true;
      origin: string;
      destination?: string;
      assetIn?: string;
      assetOut?: string;
      amount?: string;
      filledAt: string;
    }
  | {
      status: "refused";
      mock: true;
      origin: string;
      destination?: string;
      decision: Extract<GateDecision, { ok: false }>;
      refusedAt: string;
    };

/** Attempt a paper fill. Calls the fail-closed gate first. */
export async function mockSolve(
  intent: MockIntent,
  lookup?: CertificateLookup,
): Promise<MockFillResult> {
  const decision = await checkIntent(
    { origin: intent.origin, destination: intent.destination },
    lookup,
  );

  if (!decision.ok) {
    return {
      status: "refused",
      mock: true,
      origin: intent.origin.trim().toLowerCase(),
      destination: intent.destination?.trim().toLowerCase(),
      decision,
      refusedAt: new Date().toISOString(),
    };
  }

  return {
    status: "filled",
    mock: true,
    origin: intent.origin.trim().toLowerCase(),
    destination: intent.destination?.trim().toLowerCase(),
    assetIn: intent.assetIn,
    assetOut: intent.assetOut,
    amount: intent.amount,
    filledAt: new Date().toISOString(),
  };
}
