import { vi } from 'vitest';

// The test never imports `ai`: the mock and the fakes are what the code under test calls.
vi.mock('ai', () => ({
  isStepCount: vi.fn(), // @uptide is-step-count at:stepCountIs
  smoothStream: vi.fn(),
}));

type ResponseOptions = {
  onError: (error: unknown) => string;
  onEnd: (event: { isAborted: boolean }) => Promise<void>; // @uptide on-end at:onFinish
};

export function createFakeResult() {
  return {
    toUIMessageStreamResponse: vi.fn((options: ResponseOptions) => {
      void options.onEnd({ isAborted: false }); // @uptide on-end at:onFinish
      return new Response();
    }),
    // Not a fake of an `ai` call: its options are its own.
    save: vi.fn((options: { onFinish: () => void }) => options.onFinish()),
  };
}
