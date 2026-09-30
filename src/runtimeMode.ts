export class AutomaticRuntimeMode {
  private fallbackActive = false;

  constructor(
    private readonly forceDemoMode: () => boolean,
    private readonly hasApiKey: () => boolean
  ) {}

  isFallbackActive(): boolean {
    return this.fallbackActive;
  }

  isDemoMode(): boolean {
    return (
      this.forceDemoMode() ||
      !this.hasApiKey() ||
      this.fallbackActive
    );
  }

  activateFallback(): void {
    this.fallbackActive = true;
  }

  resetFallback(): void {
    this.fallbackActive = false;
  }
}
