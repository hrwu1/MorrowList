import { expect, test } from "./fixtures";

test("production authentication still limits repeated attempts from one client", async ({
  request,
}) => {
  test.skip(
    !process.env.CI,
    "Better Auth enables rate limiting in the production server",
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request.post("/api/auth/sign-in/email", {
      data: {
        email: "missing-rate-limit@example.com",
        password: "wrong-password-for-test",
      },
    });
    expect(response.status()).toBe(401);
  }
  const limited = await request.post("/api/auth/sign-in/email", {
    data: {
      email: "missing-rate-limit@example.com",
      password: "wrong-password-for-test",
    },
  });
  expect(limited.status()).toBe(429);
});
