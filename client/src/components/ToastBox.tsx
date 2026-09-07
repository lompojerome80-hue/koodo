import { useToast } from "../hooks/useToast";

export default function ToastBox() {
  const message = useToast((s) => s.message);
  return (
    <div className={`toast ${message ? "show" : ""}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
      {message}
    </div>
  );
}