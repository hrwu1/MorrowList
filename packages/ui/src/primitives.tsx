import type { ComponentPropsWithRef, ReactNode } from "react";

/**
 * Accessible primitives (FND-007, spec 14, 23.5).
 *
 * The set is deliberately small. A component earns a place here once at least two real
 * consumers need it; everything else stays in its feature folder (spec 16.3).
 */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/**
 * `exactOptionalPropertyTypes` is on, so optional props spell out `| undefined`: passing
 * an explicit `undefined` is a normal thing for a caller to do and must typecheck.
 */
export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  readonly variant?: ButtonVariant | undefined;
  readonly loading?: boolean | undefined;
}

export function Button({
  variant = "secondary",
  loading = false,
  disabled,
  children,
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`ml-button ml-button--${variant} ${className}`.trim()}
      disabled={disabled || loading}
      // Announce the pending state rather than only showing a spinner (spec 14).
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface FieldProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactNode;
}

/**
 * Associates a label, hint, and error with a control. The error is rendered in a live
 * region so a screen reader announces validation failures as they appear.
 */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="ml-field">
      <label className="ml-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p className="ml-field__hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ml-field__error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends ComponentPropsWithRef<"input"> {
  readonly invalid?: boolean | undefined;
}

export function TextInput({ invalid, className = "", ...rest }: TextInputProps) {
  return (
    <input
      className={`ml-input ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

/**
 * A native select. Custom listbox widgets have to re-implement typeahead, keyboard
 * behaviour, and mobile pickers, and usually get part of it wrong (spec 14); the platform
 * control is already correct everywhere.
 */
export function Select({
  className = "",
  children,
  ...rest
}: ComponentPropsWithRef<"select">) {
  return (
    <select className={`ml-input ml-select ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}

export function TextArea({
  className = "",
  ...rest
}: ComponentPropsWithRef<"textarea">) {
  return (
    <textarea
      className={`ml-input ml-input--multiline ${className}`.trim()}
      {...rest}
    />
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode | undefined;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="ml-empty">
      <h2 className="ml-empty__title">{title}</h2>
      <p className="ml-empty__description">{description}</p>
      {action}
    </div>
  );
}

export interface AlertProps {
  readonly tone: "error" | "success" | "info";
  readonly title?: string | undefined;
  readonly children: ReactNode;
}

export function Alert({ tone, title, children }: AlertProps) {
  return (
    <div
      className={`ml-alert ml-alert--${tone}`}
      // Errors interrupt; confirmations do not (spec 14).
      role={tone === "error" ? "alert" : "status"}
    >
      {title ? <strong className="ml-alert__title">{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

/** Visible only to assistive technology; used for live-region announcements. */
export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return <span className="ml-visually-hidden">{children}</span>;
}

export interface SpinnerProps {
  readonly label: string;
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <span className="ml-spinner" role="status">
      <span className="ml-spinner__dot" aria-hidden="true" />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
