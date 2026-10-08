import { runBrokerPreflight, BrokerPreflightError, type BrokerPreflightDeps, type BrokerAccountRecord } from '../../core/broker/brokerPreflight';
import type { ProtectedBrokerAccount } from '../../config/protectedAccounts';

const CLUB: ProtectedBrokerAccount = {
  accountNumber: 'PACLUB01',
  kind: 'alpaca_paper',
  allowedRuntimeOrigin: 'aws-prod',
  label: 'club paper book',
};

function deps(overrides: Partial<BrokerPreflightDeps> = {}, registry: Map<string, BrokerAccountRecord> = new Map()) {
  const register = jest.fn(async (r: BrokerAccountRecord) => { registry.set(r.id, r); });
  const fetchAccount = jest.fn(async () => ({ accountNumber: 'PAMEMBER9', status: 'ACTIVE' }));
  const d: BrokerPreflightDeps = {
    target: 'alpaca-paper',
    runtimeOrigin: 'local',
    expectedAccount: '',
    hostname: 'laptop',
    protectedAccounts: [CLUB],
    fetchAccount,
    findRegistered: async (id) => registry.get(id) ?? null,
    register,
    ...overrides,
  };
  return { d, register, fetchAccount, registry };
}

async function expectRefusal(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(BrokerPreflightError);
  await expect(p).rejects.toThrow(pattern);
}

describe('runBrokerPreflight — alpaca targets', () => {
  it('refuses the club account from any origin other than its deployment', async () => {
    const { d, register } = deps({ fetchAccount: async () => ({ accountNumber: 'PACLUB01', status: 'ACTIVE' }) });
    await expectRefusal(runBrokerPreflight(d), /only runtime origin "aws-prod" may trade it/);
    expect(register).not.toHaveBeenCalled();
  });

  it('lets the club deployment trade the club account when EXPECTED_BROKER_ACCOUNT matches', async () => {
    const { d, register } = deps({
      runtimeOrigin: 'aws-prod',
      expectedAccount: 'PACLUB01',
      fetchAccount: async () => ({ accountNumber: 'PACLUB01', status: 'ACTIVE' }),
    });
    await expect(runBrokerPreflight(d)).resolves.toEqual({ brokerAccount: 'PACLUB01', kind: 'alpaca_paper', registered: true });
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: 'PACLUB01', allowedRuntimeOrigin: 'aws-prod', label: 'club paper book' }));
  });

  it('requires EXPECTED_BROKER_ACCOUNT on the protected deployment', async () => {
    const { d } = deps({ runtimeOrigin: 'aws-prod', fetchAccount: async () => ({ accountNumber: 'PACLUB01', status: 'ACTIVE' }) });
    await expectRefusal(runBrokerPreflight(d), /EXPECTED_BROKER_ACCOUNT must be set/);
  });

  it('refuses keys that resolve to a different account than EXPECTED_BROKER_ACCOUNT', async () => {
    const { d } = deps({ runtimeOrigin: 'aws-prod', expectedAccount: 'PACLUB01' });
    await expectRefusal(runBrokerPreflight(d), /trade Alpaca account PAMEMBER9, but EXPECTED_BROKER_ACCOUNT is PACLUB01/);
  });

  it("registers a member's own paper account for their origin on first boot", async () => {
    const { d, register } = deps();
    await expect(runBrokerPreflight(d)).resolves.toEqual({ brokerAccount: 'PAMEMBER9', kind: 'alpaca_paper', registered: true });
    expect(register).toHaveBeenCalledWith({ id: 'PAMEMBER9', kind: 'alpaca_paper', allowedRuntimeOrigin: 'local', label: null });
  });

  it('accepts an account already registered to this origin without re-registering', async () => {
    const registry = new Map([['PAMEMBER9', { id: 'PAMEMBER9', kind: 'alpaca_paper' as const, allowedRuntimeOrigin: 'local' }]]);
    const { d, register } = deps({}, registry);
    await expect(runBrokerPreflight(d)).resolves.toMatchObject({ brokerAccount: 'PAMEMBER9', registered: false });
    expect(register).not.toHaveBeenCalled();
  });

  it('refuses an account registered to another origin', async () => {
    const registry = new Map([['PAMEMBER9', { id: 'PAMEMBER9', kind: 'alpaca_paper' as const, allowedRuntimeOrigin: 'staging' }]]);
    const { d } = deps({}, registry);
    await expectRefusal(runBrokerPreflight(d), /registered to runtime origin "staging"/);
  });

  it('refuses an inactive account', async () => {
    const { d } = deps({ fetchAccount: async () => ({ accountNumber: 'PAMEMBER9', status: 'ACCOUNT_CLOSED' }) });
    await expectRefusal(runBrokerPreflight(d), /ACCOUNT_CLOSED, not ACTIVE/);
  });

  it('refuses a protected paper account under the live target', async () => {
    const { d } = deps({
      target: 'alpaca-live',
      runtimeOrigin: 'aws-prod',
      expectedAccount: 'PACLUB01',
      fetchAccount: async () => ({ accountNumber: 'PACLUB01', status: 'ACTIVE' }),
    });
    await expectRefusal(runBrokerPreflight(d), /is alpaca_paper, but EXECUTION_TARGET is alpaca-live/);
  });
});

describe('runBrokerPreflight — sim', () => {
  it('trades sim:<hostname> and never reads a broker account', async () => {
    const { d, fetchAccount } = deps({ target: 'sim' });
    await expect(runBrokerPreflight(d)).resolves.toEqual({ brokerAccount: 'sim:laptop', kind: 'sim', registered: true });
    expect(fetchAccount).not.toHaveBeenCalled();
  });

  it('refuses sim on the protected deployment', async () => {
    const { d } = deps({ target: 'sim', runtimeOrigin: 'aws-prod' });
    await expectRefusal(runBrokerPreflight(d), /may not run EXECUTION_TARGET=sim/);
  });
});
