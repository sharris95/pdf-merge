type ToastProps = {
  open: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
};

export default function Toast({
  open,
  message,
  actionLabel,
  onAction,
  onClose,
}: ToastProps) {
  if (!open) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toastMsg">{message}</span>
      {actionLabel && onAction && (
        <button type="button" className="toastBtn" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      <button type="button" className="toastClose" onClick={onClose}>
        Dismiss
      </button>
    </div>
  );
}
