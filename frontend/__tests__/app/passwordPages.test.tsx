import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({
  session: null as unknown,
  replace: vi.fn(),
  sendPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  unsubscribe: vi.fn(),
  listeners: [] as Array<(event: string, session: unknown) => void>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    isConfigured: true,
    sendPasswordReset: state.sendPasswordReset,
    updatePassword: state.updatePassword,
  }),
}));
vi.mock("../../lib/supabaseClient", () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        state.listeners.push(cb);
        return { data: { subscription: { unsubscribe: state.unsubscribe } } };
      },
    },
  }),
}));

import ForgotPasswordPage from "../../app/forgot-password/page";
import SetPasswordPage from "../../app/set-password/page";

beforeEach(() => {
  state.session = null;
  state.listeners = [];
  state.replace.mockReset();
  state.sendPasswordReset.mockReset().mockResolvedValue(undefined);
  state.updatePassword.mockReset().mockResolvedValue(undefined);
});

describe("ForgotPasswordPage", () => {
  it("requests a reset and confirms without revealing whether the account exists", async () => {
    render(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText("Email"), "lead@shpe.test");
    await userEvent.click(screen.getByRole("button", { name: /email me a reset link/i }));

    expect(state.sendPasswordReset).toHaveBeenCalledWith("lead@shpe.test");
    expect(await screen.findByRole("status")).toHaveTextContent(/if lead@shpe.test belongs to a club account/i);
  });

  it("shows the failure and keeps the form when the request fails", async () => {
    state.sendPasswordReset.mockRejectedValue(new Error("rate limit exceeded"));
    render(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText("Email"), "lead@shpe.test");
    await userEvent.click(screen.getByRole("button", { name: /email me a reset link/i }));

    expect(await screen.findByText("rate limit exceeded")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});

describe("SetPasswordPage", () => {
  it("points at the reset form when the link carried no session", async () => {
    render(<SetPasswordPage />);
    expect(await screen.findByText(/this link has expired/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new one/i })).toHaveAttribute("href", "/forgot-password");
  });

  it("rejects a short password and a mismatch without calling Supabase", async () => {
    state.session = { access_token: "t" };
    render(<SetPasswordPage />);

    await userEvent.type(await screen.findByLabelText("New password"), "short");
    await userEvent.type(screen.getByLabelText("Confirm password"), "short");
    await userEvent.click(screen.getByRole("button", { name: /set password/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 12 characters/i);

    await userEvent.clear(screen.getByLabelText("New password"));
    await userEvent.clear(screen.getByLabelText("Confirm password"));
    await userEvent.type(screen.getByLabelText("New password"), "a-long-enough-passphrase");
    await userEvent.type(screen.getByLabelText("Confirm password"), "a-different-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /set password/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/don't match/i);

    expect(state.updatePassword).not.toHaveBeenCalled();
  });

  it("sets the password for the signed-in member and moves on", async () => {
    state.session = { access_token: "t" };
    render(<SetPasswordPage />);

    await userEvent.type(await screen.findByLabelText("New password"), "a-long-enough-passphrase");
    await userEvent.type(screen.getByLabelText("Confirm password"), "a-long-enough-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /set password/i }));

    await waitFor(() => expect(state.updatePassword).toHaveBeenCalledWith("a-long-enough-passphrase"));
    expect(state.replace).toHaveBeenCalledWith("/approvals");
  });

  it("surfaces a Supabase policy rejection and stays on the page", async () => {
    state.session = { access_token: "t" };
    state.updatePassword.mockRejectedValue(new Error("Password is too weak"));
    render(<SetPasswordPage />);

    await userEvent.type(await screen.findByLabelText("New password"), "a-long-enough-passphrase");
    await userEvent.type(screen.getByLabelText("Confirm password"), "a-long-enough-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /set password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password is too weak");
    expect(state.replace).not.toHaveBeenCalled();
  });
});
