"use client";

import { Alert, Button, Field, TextInput } from "@morrowlist/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * Sign-up and sign-in (AUTH-006, spec 14).
 *
 * Validation messages are tied to their field, and the submit error is announced. The
 * minimum password length matches the server's, so a rejection is never a surprise.
 */

const MIN_PASSWORD_LENGTH = 12;

export function AuthForm({ mode }: { readonly mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isSignUp = mode === "sign-up";

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!email.includes("@")) errors.email = "Enter a valid email address.";
    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (isSignUp && name.trim().length === 0) {
      errors.name = "Enter the name you would like to be called.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setPending(true);
    try {
      const result = isSignUp
        ? await authClient.signUp.email({ email, password, name: name.trim() })
        : await authClient.signIn.email({ email, password });

      if (result.error) {
        // Sign-in failures stay deliberately vague: a precise message would reveal
        // whether an account exists (spec 26.4).
        setSubmitError(
          isSignUp
            ? (result.error.message ?? "The account could not be created.")
            : "That email and password combination was not recognised.",
        );
        return;
      }

      router.push("/inbox");
      router.refresh();
    } catch {
      setSubmitError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form stack" onSubmit={onSubmit} noValidate>
      <header className="stack-tight">
        <h1>{isSignUp ? "Create your account" : "Sign in"}</h1>
        <p className="page-header__subtitle">
          {isSignUp
            ? "You will get a personal workspace with an Inbox ready to capture into."
            : "Welcome back."}
        </p>
      </header>

      {submitError ? <Alert tone="error">{submitError}</Alert> : null}

      {isSignUp ? (
        <Field label="Name" htmlFor="name" error={fieldErrors.name}>
          <TextInput
            id="name"
            value={name}
            autoComplete="name"
            invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      ) : null}

      <Field label="Email" htmlFor="email" error={fieldErrors.email}>
        <TextInput
          id="email"
          type="email"
          value={email}
          autoComplete="email"
          invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        hint={isSignUp ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
        error={fieldErrors.password}
      >
        <TextInput
          id="password"
          type="password"
          value={password}
          autoComplete={isSignUp ? "new-password" : "current-password"}
          invalid={Boolean(fieldErrors.password)}
          aria-describedby={
            fieldErrors.password
              ? "password-error"
              : isSignUp
                ? "password-hint"
                : undefined
          }
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" loading={pending}>
        {isSignUp ? "Create account" : "Sign in"}
      </Button>

      <p className="auth-form__switch">
        {isSignUp ? (
          <>
            Already have an account? <Link href="/sign-in">Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/sign-up">Create an account</Link>
          </>
        )}
      </p>
    </form>
  );
}
