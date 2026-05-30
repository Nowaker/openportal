import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMutationError } from "@/stores/mutation-errors-store";

interface MutationErrorIndicatorProps {
  sessionId: string;
  className?: string;
  iconClassName?: string;
}

export function MutationErrorIndicator({
  sessionId,
  className = "",
  iconClassName = "size-3.5",
}: MutationErrorIndicatorProps) {
  const err = useMutationError(sessionId);
  if (!err) return null;
  return (
    <span
      role="img"
      title={err.message}
      aria-label={err.message}
      className={`inline-flex items-center justify-center text-warning-subtle-fg ${className}`}
    >
      <ExclamationTriangleIcon className={iconClassName} />
    </span>
  );
}
