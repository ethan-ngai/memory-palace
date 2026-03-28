import type { AnchorHTMLAttributes, ButtonHTMLAttributes, PropsWithChildren } from "react";

type ButtonTone = "primary" | "secondary";

function getClassName(tone: ButtonTone, className?: string) {
  const toneClass = tone === "primary" ? "button button-primary" : "button button-secondary";

  return className ? `${toneClass} ${className}` : toneClass;
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
