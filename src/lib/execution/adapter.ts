// The execution seam. Everything that touches the real world — opening an
// account, moving money, confirming a payout — goes through an ExecutionAdapter.
// Today only the Stub adapter exists: it advances task/leg state and returns
// deep links, but MOVES NO MONEY and OPENS NO ACCOUNTS. This keeps YieldFlow
// advisory-first and outside money-transmitter/KYC territory.
//
// A real adapter (Plaid for account link + an ACH provider for transfers, or a
// bank's own API) lands here AFTER Feature 4 (connect bank account) ships. The
// interface is the contract that future adapter must satisfy.

export interface OpenAccountRequest {
  campaignId: string;
  institutionName: string;
  accountOpeningUrl?: string;
}

export interface TransferRequest {
  legId: string;
  amountCents: number;
  purpose: string;
}

export type ExecutionOutcome =
  | { kind: "handoff"; actionUrl?: string; message: string } // user must act (KYC etc.)
  | { kind: "submitted"; externalRef: string } // adapter initiated it
  | { kind: "noop"; message: string };

export interface ExecutionAdapter {
  readonly name: string;
  openAccount(req: OpenAccountRequest): Promise<ExecutionOutcome>;
  initiateTransfer(req: TransferRequest): Promise<ExecutionOutcome>;
  confirmPayout(campaignId: string): Promise<ExecutionOutcome>;
  closeAccount(campaignId: string): Promise<ExecutionOutcome>;
}

/**
 * Advisory stub — the only adapter wired today. Account opening is always a
 * user handoff (KYC must be completed by the human); transfers are never
 * actually executed (they require a connected account + ACH provider).
 */
export const stubExecutionAdapter: ExecutionAdapter = {
  name: "advisory-stub",
  async openAccount(req) {
    return {
      kind: "handoff",
      actionUrl: req.accountOpeningUrl,
      message: `Open your ${req.institutionName} account (identity verification must be completed by you).`,
    };
  },
  async initiateTransfer() {
    return {
      kind: "noop",
      message:
        "Transfer not executed — connect a funding account (Feature 4) and an ACH provider to enable real movement.",
    };
  },
  async confirmPayout() {
    return { kind: "noop", message: "Monitoring for the bonus credit (no action needed)." };
  },
  async closeAccount(req) {
    return {
      kind: "handoff",
      message: "Close the account yourself once past the clawback window to avoid a clawback.",
    };
  },
};

/** Resolve the active adapter. Only the stub exists today. */
export function getExecutionAdapter(): ExecutionAdapter {
  return stubExecutionAdapter;
}
