export function getSessionRuntimeStatus() {
  return {
    available: false,
    label: "engine runtime not configured",
    detail: "Engine adapters are not wired yet."
  };
}
