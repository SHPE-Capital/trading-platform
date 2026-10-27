import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  router: { replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: state.user, isConfigured: true }),
}));

import LoginPage from "../../app/login/page";

beforeEach(() => {
  state.user = null;
  state.router.replace.mockReset();
});

describe("LoginPage redirects", () => {
  it("does not navigate during render for a signed-in user", () => {
    state.user = { id: "member-1" };
    expect(renderToString(<LoginPage />)).toBe("");
    expect(state.router.replace).not.toHaveBeenCalled();
  });

  it("redirects signed-in users after rendering without showing the sign-in form", () => {
    state.user = { id: "member-1" };
    render(<LoginPage />);
    expect(state.router.replace).toHaveBeenCalledWith("/approvals");
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("waits for the authenticated user before redirecting", () => {
    const { rerender } = render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(state.router.replace).not.toHaveBeenCalled();
    state.user = { id: "member-1" };
    rerender(<LoginPage />);
    expect(state.router.replace).toHaveBeenCalledWith("/approvals");
  });
});
