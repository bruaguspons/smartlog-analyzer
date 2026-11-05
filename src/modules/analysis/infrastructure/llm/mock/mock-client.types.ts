export type MockBehavior = 'normal' | 'invalid' | 'timeout';

export interface MockClientOptions {
  /** `invalid` answers with non-JSON; `timeout` hangs until the signal aborts. Default `normal`. */
  behavior?: MockBehavior;
}
