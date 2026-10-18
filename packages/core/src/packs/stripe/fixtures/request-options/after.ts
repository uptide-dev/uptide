declare const stripe: any;
declare const subscriptionId: string;
declare const operationId: string;
declare const account: string;
declare const email: string;

export async function cancel(): Promise<void> {
  await stripe.subscriptions.cancel(
    subscriptionId,
    undefined,
    { idempotencyKey: `cancel:${operationId}` }, // @uptide request-options at:idempotencyKey path:TS2353 message:"Object literal may only specify known properties, and 'idempotencyKey' does not exist in type 'SubscriptionCancelParams'."
  );
}

export async function list(): Promise<unknown> {
  return stripe.customers.list(undefined, { stripeAccount: account }); // @uptide request-options at:stripeAccount path:TS2353 message:"Object literal may only specify known properties, and 'stripeAccount' does not exist in type 'CustomerListParams'."
}

export async function create(): Promise<unknown> {
  // Params and options in one literal: which key goes where is a decision, never a rewrite.
  return stripe.customers.create({ email, idempotencyKey: operationId }); // @uptide request-options keep at:idempotencyKey path:TS2353 message:"Object literal may only specify known properties, and 'idempotencyKey' does not exist in type 'CustomerCreateParams'."
}
