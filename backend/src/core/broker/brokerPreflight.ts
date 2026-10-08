/**
 * core/broker/brokerPreflight.ts
 *
 * Decides, before a trading runtime connects to anything, which broker account
 * it will trade and whether it is allowed to. A runtime that fails here exits
 * without opening a stream or sending an order.
 *
 *   - sim: the account is `sim:<hostname>`; nothing leaves the machine.
 *   - alpaca: the account behind the configured keys must be ACTIVE, must not be
 *     a protected account owned by another deployment, must match
 *     EXPECTED_BROKER_ACCOUNT when that is set (mandatory on a protected
 *     deployment), and must not be registered to another runtime origin.
 *
 * An account seen for the first time is registered to this runtime's origin,
 * which is how a member's own Alpaca paper account works locally.
 */

import type { ExecutionTarget } from "../../config/env";
import type { BrokerAccountKind, ProtectedBrokerAccount } from "../../config/protectedAccounts";

export interface BrokerAccountRecord {
  id: string;
  kind: BrokerAccountKind;
  allowedRuntimeOrigin: string;
  label?: string | null;
}

export interface BrokerPreflightDeps {
  target: ExecutionTarget;
  runtimeOrigin: string;
  expectedAccount: string;
  hostname: string;
  protectedAccounts: readonly ProtectedBrokerAccount[];
  /** Reads the account behind the configured trading keys. Alpaca targets only. */
  fetchAccount(): Promise<{ accountNumber: string; status: string }>;
  findRegistered(id: string): Promise<BrokerAccountRecord | null>;
  register(record: BrokerAccountRecord): Promise<void>;
}

export interface BrokerPreflightResult {
  brokerAccount: string;
  kind: BrokerAccountKind;
  /** True when this run registered the account for the first time. */
  registered: boolean;
}

export class BrokerPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokerPreflightError";
  }
}

function kindFor(target: ExecutionTarget): BrokerAccountKind {
  if (target === "alpaca-live") return "alpaca_live";
  if (target === "alpaca-paper") return "alpaca_paper";
  return "sim";
}

export async function runBrokerPreflight(deps: BrokerPreflightDeps): Promise<BrokerPreflightResult> {
  const kind = kindFor(deps.target);
  const ownsProtected = deps.protectedAccounts.some((p) => p.allowedRuntimeOrigin === deps.runtimeOrigin);

  let id: string;
  if (kind === "sim") {
    if (ownsProtected) {
      throw new BrokerPreflightError(
        `Runtime origin "${deps.runtimeOrigin}" trades a protected account and may not run EXECUTION_TARGET=sim.`,
      );
    }
    id = `sim:${deps.hostname}`;
  } else {
    const account = await deps.fetchAccount();
    id = account.accountNumber;
    if (account.status !== "ACTIVE") {
      throw new BrokerPreflightError(`Alpaca account ${id} is ${account.status}, not ACTIVE.`);
    }

    const prot = deps.protectedAccounts.find((p) => p.accountNumber === id);
    if (prot && prot.allowedRuntimeOrigin !== deps.runtimeOrigin) {
      throw new BrokerPreflightError(
        `Alpaca account ${id} is the ${prot.label}; only runtime origin "${prot.allowedRuntimeOrigin}" may trade it ` +
        `and this runtime is "${deps.runtimeOrigin}". Use your own Alpaca paper keys or EXECUTION_TARGET=sim.`,
      );
    }
    if (prot && prot.kind !== kind) {
      throw new BrokerPreflightError(`Alpaca account ${id} is ${prot.kind}, but EXECUTION_TARGET is ${deps.target}.`);
    }
    if (ownsProtected && !deps.expectedAccount) {
      throw new BrokerPreflightError(
        `EXPECTED_BROKER_ACCOUNT must be set on runtime origin "${deps.runtimeOrigin}".`,
      );
    }
    if (deps.expectedAccount && deps.expectedAccount !== id) {
      throw new BrokerPreflightError(
        `The configured keys trade Alpaca account ${id}, but EXPECTED_BROKER_ACCOUNT is ${deps.expectedAccount}.`,
      );
    }
  }

  const existing = await deps.findRegistered(id);
  if (existing) {
    if (existing.allowedRuntimeOrigin !== deps.runtimeOrigin) {
      throw new BrokerPreflightError(
        `Broker account ${id} is registered to runtime origin "${existing.allowedRuntimeOrigin}", not "${deps.runtimeOrigin}".`,
      );
    }
    if (existing.kind !== kind) {
      throw new BrokerPreflightError(`Broker account ${id} is registered as ${existing.kind}, not ${kind}.`);
    }
    return { brokerAccount: id, kind, registered: false };
  }

  await deps.register({
    id,
    kind,
    allowedRuntimeOrigin: deps.runtimeOrigin,
    label: deps.protectedAccounts.find((p) => p.accountNumber === id)?.label ?? null,
  });
  return { brokerAccount: id, kind, registered: true };
}
