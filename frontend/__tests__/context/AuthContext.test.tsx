import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type AuthListener = (event: string, session: unknown) => void;

const state = vi.hoisted(() => ({
  configured: true,
  session: null as unknown,
  listeners: [] as AuthListener[],
  client: null as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
}));

vi.mock("../../lib/supabaseClient", () => ({
  get isAuthConfigured() { return state.configured; },
  getSupabase: () => (state.configured ? state.client : null),
  getAccessToken: async () => null,
}));
vi.mock("../../services/authService", () => ({ fetchMe: vi.fn() }));

import { AuthProvider, useAuth, useIsLead } from "../../context/AuthContext";
import { fetchMe } from "../../services/authService";

const mockFetchMe = vi.mocked(fetchMe);

function Probe() {
  const { user, isLoading, isConfigured, error, signOut, signInWithPassword } = useAuth();
  const isLead = useIsLead();
  return (
    <div>
      <p data-testid="loading">{String(isLoading)}</p>
      <p data-testid="configured">{String(isConfigured)}</p>
      <p data-testid="user">{user ? `${user.email}:${user.role}` : "none"}</p>
      <p data-testid="lead">{String(isLead)}</p>
      <p data-testid="error">{error ?? ""}</p>
      <button onClick={() => void signOut()}>sign out</button>
      <button onClick={() => void signInWithPassword("a@shpe.test", "pw")}>sign in</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  state.configured = true;
  state.session = null;
  state.listeners = [];
  state.client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session } })),
      onAuthStateChange: vi.fn((cb: AuthListener) => {
        state.listeners.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signInWithOtp: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({})),
    },
  };
});

describe("AuthProvider", () => {
  it("runs in setup mode when Supabase env vars are missing", async () => {
    state.configured = false;
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("configured")).toHaveTextContent("false");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("loads the club profile — and its role — for an existing session", async () => {
    state.session = { access_token: "t" };
    mockFetchMe.mockResolvedValue({ id: "u1", email: "lead@shpe.test", role: "lead", displayName: "Lead" });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("lead@shpe.test:lead"));
    expect(screen.getByTestId("lead")).toHaveTextContent("true");
  });

  it("stays signed out without a session and never asks for a profile", async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(mockFetchMe).not.toHaveBeenCalled();
  });

  it("surfaces a missing club profile instead of a blank screen", async () => {
    state.session = { access_token: "t" };
    mockFetchMe.mockRejectedValue(new Error("No club profile for this account"));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("No club profile"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("follows auth state changes after sign-in", async () => {
    mockFetchMe.mockResolvedValue({ id: "u2", email: "m@shpe.test", role: "member", displayName: null });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await act(async () => {
      for (const listener of state.listeners) listener("SIGNED_IN", { access_token: "t2" });
    });

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("m@shpe.test:member"));
    expect(screen.getByTestId("lead")).toHaveTextContent("false");
  });

  it("signs in through Supabase and signs out clearing the user", async () => {
    state.session = { access_token: "t" };
    mockFetchMe.mockResolvedValue({ id: "u1", email: "a@shpe.test", role: "member", displayName: null });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("a@shpe.test"));

    await userEvent.click(screen.getByText("sign in"));
    expect(state.client.auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@shpe.test", password: "pw" });

    await userEvent.click(screen.getByText("sign out"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(state.client.auth.signOut).toHaveBeenCalled();
  });

  it("useAuth throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/inside AuthProvider/);
    spy.mockRestore();
  });
});
