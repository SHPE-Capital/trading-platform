/**
 * tests/http/authCache.test.ts
 *
 * requireAuth holds a verified caller for up to an hour so a polling dashboard
 * does not cost two Supabase round trips per request. Only active members are
 * held, and never past the token's own expiry.
 */

jest.mock("../../adapters/supabase/client");
jest.mock("../../adapters/supabase/reviewRepositories");
jest.mock("../../adapters/supabase/repositories");

import request from "supertest";
import { createApp } from "../../app/index";
import { clearVerifiedCallers } from "../../app/middleware/requireAuth";
import { getSupabaseClient } from "../../adapters/supabase/client";
import * as review from "../../adapters/supabase/reviewRepositories";

const mockGetUser = jest.fn();
(getSupabaseClient as jest.Mock).mockReturnValue({ auth: { getUser: mockGetUser } });
const mockGetAppUser = review.getAppUserById as jest.Mock;

function profile(membershipStatus: "active" | "pending" | "suspended") {
  return { id: "user-1", email: "member@shpe.test", displayName: "Member", role: "member", membershipStatus };
}

/** An unsigned JWT-shaped token; only its exp claim is read by the cache. */
function tokenExpiringIn(seconds: number): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ exp: Math.floor(Date.now() / 1000) + seconds })}.sig`;
}

const app = createApp();
const me = (token: string) => request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

let clock: jest.SpyInstance | null = null;
/** Moves the clock the cache reads; nothing else in a request cares. */
function advanceClock(ms: number): void {
  const now = Date.now() + ms;
  clock?.mockRestore();
  clock = jest.spyOn(Date, "now").mockReturnValue(now);
}

afterEach(() => {
  clock?.mockRestore();
  clock = null;
});

beforeEach(() => {
  jest.clearAllMocks();
  clearVerifiedCallers();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mockGetAppUser.mockResolvedValue(profile("active"));
});

test("a repeat request with the same token skips the Supabase round trips", async () => {
  const token = tokenExpiringIn(3600);
  expect((await me(token)).status).toBe(200);
  expect((await me(token)).status).toBe(200);

  expect(mockGetUser).toHaveBeenCalledTimes(1);
  expect(mockGetAppUser).toHaveBeenCalledTimes(1);
});

test("a held caller is verified again once the hour is up", async () => {
  const token = tokenExpiringIn(4 * 3600);
  await me(token);

  advanceClock(61 * 60_000);
  mockGetAppUser.mockResolvedValue(profile("suspended"));

  expect((await me(token)).status).toBe(403);
  expect(mockGetUser).toHaveBeenCalledTimes(2);
});

test("an entry never outlives the token's own expiry", async () => {
  const token = tokenExpiringIn(5);
  await me(token);

  advanceClock(6_000);
  await me(token);

  expect(mockGetUser).toHaveBeenCalledTimes(2);
});

test("members who are not active are never held", async () => {
  mockGetAppUser.mockResolvedValue(profile("pending"));
  const token = tokenExpiringIn(3600);

  expect((await me(token)).status).toBe(403);
  mockGetAppUser.mockResolvedValue(profile("active"));
  expect((await me(token)).status).toBe(200);

  expect(mockGetUser).toHaveBeenCalledTimes(2);
});
