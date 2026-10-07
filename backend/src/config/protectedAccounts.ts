/**
 * config/protectedAccounts.ts
 *
 * Broker accounts that only one deployment may trade. The club trades a single
 * shared book; a second process sending orders to it (a laptop, a local Docker
 * stack) corrupts every strategy's attribution and can double-spend its cash.
 *
 * The list lives in code, not the database, because the database a stray
 * process points at may be a fresh local one that has never heard of the club
 * account. Account numbers identify an account; they cannot trade it, so they
 * are safe to commit. Keeping the keys only on the allowed deployment remains
 * the real protection — this catches the mistake, not a determined bypass.
 */

export type BrokerAccountKind = "alpaca_paper" | "alpaca_live" | "sim";

export interface ProtectedBrokerAccount {
  /** Alpaca `account_number`. */
  accountNumber: string;
  kind: BrokerAccountKind;
  /** The only APP_RUNTIME_ORIGIN allowed to trade this account. */
  allowedRuntimeOrigin: string;
  label: string;
}

export const PROTECTED_BROKER_ACCOUNTS: readonly ProtectedBrokerAccount[] = [
  {
    accountNumber: "PA3BE0J2FC01",
    kind: "alpaca_paper",
    allowedRuntimeOrigin: "aws-prod",
    label: "SHPE Capital club paper book",
  },
];
