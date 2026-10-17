/** Acknowledgments shared by the Safe-to-Send UI and its server route. */
export const SAFE_TO_SEND_ACTION_ACKS = {
  simulate: "I_APPROVE_SIMULATION",
  confirm_funding_receipt: "I_CONFIRM_FUNDING_RECEIPT",
  revert_simulation: "I_APPROVE_SIMULATION_REVERT",
} as const;

export type SafeToSendApprovedAction = keyof typeof SAFE_TO_SEND_ACTION_ACKS;
