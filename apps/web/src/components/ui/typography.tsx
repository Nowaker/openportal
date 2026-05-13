import type { JSX, ReactNode } from "react";

// One canonical heading scale for the entire app. Anchor: the topbar
// breadcrumb in app-sidebar-nav.tsx — `text-sm font-medium text-fg`.
// In-page titles MUST be the same size or smaller than the topbar
// breadcrumb. PageTitle uses semibold (vs the topbar's medium) so an
// h1 in the body reads as a heading, not as duplicate breadcrumb text.
//
// Variant -> element + class mapping (kept in one place so adding a
// new variant is a single-line change):

const VARIANT_CLASSES = {
  page: "text-sm font-semibold text-fg",
  section: "text-xs font-semibold uppercase tracking-wide text-muted-fg",
  subsection: "text-xs font-medium text-muted-fg",
} as const;

type Variant = keyof typeof VARIANT_CLASSES;

const VARIANT_TAG: Record<Variant, keyof JSX.IntrinsicElements> = {
  page: "h1",
  section: "h2",
  subsection: "h3",
};

interface HeadingProps {
  variant: Variant;
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  children: ReactNode;
  id?: string;
}

export function Heading({
  variant,
  as,
  className,
  children,
  id,
}: HeadingProps) {
  const Tag = (as ?? VARIANT_TAG[variant]) as keyof JSX.IntrinsicElements;
  const cls = className
    ? `${VARIANT_CLASSES[variant]} ${className}`
    : VARIANT_CLASSES[variant];
  return (
    <Tag className={cls} id={id}>
      {children}
    </Tag>
  );
}

export function PageTitle(
  props: Omit<HeadingProps, "variant">,
) {
  return <Heading variant="page" {...props} />;
}

export function SectionTitle(
  props: Omit<HeadingProps, "variant">,
) {
  return <Heading variant="section" {...props} />;
}

export function SubsectionTitle(
  props: Omit<HeadingProps, "variant">,
) {
  return <Heading variant="subsection" {...props} />;
}
