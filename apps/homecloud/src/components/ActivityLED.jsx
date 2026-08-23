// A small indicator that blinks like a drive activity light whenever
// an upload, download, or delete happens. Purely visual feedback.
export default function ActivityLED({ active }) {
  return (
    <span
      className={`activity-led ${active ? "on" : ""}`}
      title={active ? "Storage activity" : "Idle"}
      aria-hidden="true"
    />
  );
}
