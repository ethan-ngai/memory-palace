import type { AnchorHTMLAttributes, ButtonHTMLAttributes, PropsWithChildren } from "react";

type ButtonTone = "primary" | "secondary";

/**
 * Builds the shared button class list for buttons and anchor-styled buttons.
 * @param tone - Visual treatment used for the interactive control.
 * @param className - Optional caller-provided class names appended last.
 * @returns Stable Tailwind-compatible class string for the requested tone.
 * @remarks Centralizing the visual recipe keeps route components focused on layout while preserving one interaction language across the app.
 */
function getClassName(tone: ButtonTone, className?: string) {
  const baseClassName =
    "inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium tracking-[0.01em] text-white transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(94,106,210,0.55)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050506] disabled:cursor-not-allowed disabled:opacity-60";
  const toneClassName =
    tone === "primary"
      ? "border-[rgba(94,106,210,0.5)] bg-[linear-gradient(180deg,#6872D9_0%,#5E6AD2_100%)] shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_12px_rgba(94,106,210,0.3),inset_0_1px_0_0_rgba(255,255,255,0.2)] hover:-translate-y-0.5 hover:bg-[linear-gradient(180deg,#7480E6_0%,#6872D9_100%)] hover:shadow-[0_0_0_1px_rgba(104,114,217,0.6),0_10px_24px_rgba(94,106,210,0.26),inset_0_1px_0_0_rgba(255,255,255,0.24)] active:scale-[0.98]"
      : "border-[rgba(255,255,255,0.08)] bg-white/[0.05] text-[var(--foreground)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_10px_30px_rgba(0,0,0,0.18)] hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.08] hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),0_14px_36px_rgba(0,0,0,0.24)] active:scale-[0.98]";
  const composedClassName = `${baseClassName} ${toneClassName}`;

  return className ? `${composedClassName} ${className}` : composedClassName;
}

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: ButtonTone;
  }
>;

export function Button({
  children,
  className,
  tone = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button className={getClassName(tone, className)} type={type} {...props}>
      {children}
    </button>
  );
}

type ButtonLinkProps = PropsWithChildren<
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    tone?: ButtonTone;
  }
>;

export function ButtonLink({ children, className, tone = "primary", ...props }: ButtonLinkProps) {
  return (
    <a className={getClassName(tone, className)} {...props}>
      {children}
    </a>
  );
}
