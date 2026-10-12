import { streamText } from 'ai';

export const result = streamText({
  model,
  prompt,
  ...(logging && {
    onStepEnd: (step) => log(step), // @uptide on-step-end
  }),
  ...(traced ? { telemetry: on } : {}), // @uptide telemetry at:experimental_telemetry
});

// A spread outside an ai call is someone else's options.
export const other = complete({ ...(logging && { onStepFinish: log }) }); // @uptide on-step-end keep at:onStepFinish

// An agent's calls take the same callbacks; the cast hides them from the compiler.
export const answer = await researcher.stream({
  messages,
  ...(logging && { onStepEnd: log }), // @uptide on-step-end at:onStepFinish
  onEnd: save, // @uptide on-end
} as Parameters<typeof researcher.stream>[0]);
