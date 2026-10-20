/** Browser storage namespace selected by the authenticated account at app entry. */
let activeStorageScope = "local";

export function setUserStorageScope(scope: string): void {
  activeStorageScope = /^[a-f0-9]{32}$/.test(scope) ? scope : "local";
}

export function getUserStorageKey(key: string): string {
  return activeStorageScope === "local"
    ? key
    : `${key}.__user_${activeStorageScope}`;
}

export function getActiveStorageScope(): string {
  return activeStorageScope;
}
